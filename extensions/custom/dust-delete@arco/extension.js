// Dust Delete: Telegram-style "dissolve into dust" when a file is trashed.
//
// The Files app draws its own icons, so the shell can't animate the real one.
// Instead: when you click (or right-click) in Files we keep a small picture of
// that spot in memory. When a file then lands in the Trash, that picture is
// put back exactly where the item was and crumbles into drifting dust.
// Nothing runs while idle: clicks outside Files are ignored and the Trash is
// watched with inotify.
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot_area');

const FILES_APP = 'org.gnome.nautilus';
const SNAP_W = 190;          // area kept around a click (logical px)
const SNAP_H = 160;
const SNAP_DELAY_MS = 140;   // wait so the selection highlight is in the picture
const SNAP_MAX_AGE_US = 30 * 1000 * 1000;
const MENU_GRACE_US = 4 * 1000 * 1000; // a click this soon after a right-click is the menu choice
const MAX_TILES = 420;
const SWEEP_MS = 380;        // left-to-right delay across the item
const DRIFT_MS = 760;
const log_ = msg => console.log(`dust-delete: ${msg}`);

export default class DustDelete extends Extension {
    enable() {
        this._layer = new St.Widget({reactive: false, x: 0, y: 0});
        Main.layoutManager.uiGroup.add_child(this._layer);
        this._raiseId = Main.layoutManager.uiGroup.connect('child-added', () => this._raise());

        this._snap = null;
        this._lastRightClick = 0;
        this._snapTimer = 0;
        this._busy = false;
        this._capId = global.stage.connect('captured-event', (_a, ev) => this._onEvent(ev));

        // Backup: on Wayland, clicks inside app windows may not pass the stage.
        // Watch the mouse buttons, but only while a Files window is focused, and
        // stop for good once the stage path proves it works.
        this._stageWorks = false;
        this._lastMask = 0;
        this._pollId = 0;
        this._focusId = global.display.connect('notify::focus-window', () => this._updatePoll());
        this._updatePoll();

        const trash = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(), 'Trash', 'files']));
        try {
            trash.make_directory_with_parents(null);
        } catch {}
        this._monitor = trash.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._monId = this._monitor.connect('changed', (_m, _f, _o, type) => {
            if (type === Gio.FileMonitorEvent.CREATED || type === Gio.FileMonitorEvent.MOVED_IN)
                this._onTrashed();
        });
    }

    disable() {
        if (this._capId) global.stage.disconnect(this._capId);
        if (this._raiseId) Main.layoutManager.uiGroup.disconnect(this._raiseId);
        if (this._snapTimer) GLib.source_remove(this._snapTimer);
        if (this._focusId) global.display.disconnect(this._focusId);
        if (this._pollId) GLib.source_remove(this._pollId);
        this._focusId = this._pollId = 0;
        if (this._monitor) {
            this._monitor.disconnect(this._monId);
            this._monitor.cancel();
        }
        this._capId = this._raiseId = this._snapTimer = this._monId = 0;
        this._monitor = null;
        this._layer?.destroy();
        this._layer = null;
        this._snap = null;
    }

    _raise() {
        const parent = this._layer?.get_parent();
        if (parent) parent.set_child_above_sibling(this._layer, null);
    }

    _onEvent(ev) {
        if (ev.type() !== Clutter.EventType.BUTTON_PRESS) return Clutter.EVENT_PROPAGATE;
        const [x, y] = ev.get_coords();
        if (this._press(x, y, ev.get_button(), 'stage') && !this._stageWorks) {
            this._stageWorks = true;
            this._updatePoll();
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _isFiles(w) {
        return (w?.get_wm_class() || '').toLowerCase() === FILES_APP;
    }

    _updatePoll() {
        const want = !this._stageWorks && this._isFiles(global.display.focus_window);
        if (want && !this._pollId) {
            this._lastMask = global.get_pointer()[2];
            this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => this._poll());
        } else if (!want && this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
    }

    _poll() {
        const [x, y, mask] = global.get_pointer();
        const b1 = Clutter.ModifierType.BUTTON1_MASK, b3 = Clutter.ModifierType.BUTTON3_MASK;
        if ((mask & b1) && !(this._lastMask & b1)) this._press(x, y, 1, 'poll');
        if ((mask & b3) && !(this._lastMask & b3)) this._press(x, y, 3, 'poll');
        this._lastMask = mask;
        return GLib.SOURCE_CONTINUE;
    }

    // Returns true if the press was inside a Files window.
    _press(x, y, button, how) {
        if (button !== 1 && button !== 3) return false;
        const win = this._filesWindowAt(x, y);
        if (!win) return false;
        const now = GLib.get_monotonic_time();
        if (button === 1 && now - this._lastRightClick < MENU_GRACE_US) {
            this._lastRightClick = 0;  // this click picks "Move to Trash" in the menu
            return true;
        }
        if (button === 3) this._lastRightClick = now;

        if (this._snapTimer) GLib.source_remove(this._snapTimer);
        this._snapTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SNAP_DELAY_MS, () => {
            this._snapTimer = 0;
            this._takeSnap(win, x, y).catch(e => log_(`snapshot failed: ${e}`));
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    _filesWindowAt(x, y) {
        const ws = global.workspace_manager.get_active_workspace();
        const actors = global.get_window_actors().slice().reverse();
        for (const a of actors) {
            const w = a.meta_window;
            if (!w || w.minimized || !w.showing_on_its_workspace() || !w.located_on_workspace(ws)) continue;
            const r = w.get_frame_rect();
            if (x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height) continue;
            return this._isFiles(w) ? w : null;
        }
        return null;
    }

    async _takeSnap(win, cx, cy) {
        if (!St.Settings.get().enable_animations) return;
        const r = win.get_frame_rect();
        const w = Math.min(SNAP_W, r.width), h = Math.min(SNAP_H, r.height);
        const x = Math.round(Math.max(r.x, Math.min(cx - w / 2, r.x + r.width - w)));
        const y = Math.round(Math.max(r.y, Math.min(cy - h * 0.45, r.y + r.height - h)));

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const stream = Gio.MemoryOutputStream.new_resizable();
        await new Shell.Screenshot().screenshot_area(x * scale, y * scale, w * scale, h * scale, stream);
        stream.close(null);
        const bytes = stream.steal_as_bytes();
        const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(Gio.MemoryInputStream.new_from_bytes(bytes), null)
            .add_alpha(false, 0, 0, 0);
        this._snap = {pixbuf, x, y, w, h, scale, time: GLib.get_monotonic_time()};
    }

    _onTrashed() {
        const snap = this._snap;
        if (!snap || this._busy || !this._layer) return;
        if (GLib.get_monotonic_time() - snap.time > SNAP_MAX_AGE_US) return;
        this._snap = null;  // one dissolve per clicked item
        try {
            this._dissolve(snap);
        } catch (e) {
            this._busy = false;
            log_(`dissolve failed: ${e}`);
        }
    }

    _dissolve({pixbuf, x, y, w, h, scale}) {
        const pw = pixbuf.width, ph = pixbuf.height, rs = pixbuf.rowstride;
        const px = pixbuf.read_pixel_bytes();
        const data = px.get_data();

        // Background = most common corner color; tiles that look like it are skipped,
        // so only the item itself (icon, name, highlight) turns to dust.
        const at = (ix, iy) => {
            const o = iy * rs + ix * 4;
            return [data[o], data[o + 1], data[o + 2]];
        };
        const corners = [at(1, 1), at(pw - 2, 1), at(1, ph - 2), at(pw - 2, ph - 2)];
        const key = c => c.map(v => v >> 3).join(',');
        const counts = {};
        corners.forEach(c => (counts[key(c)] = (counts[key(c)] || 0) + 1));
        const bg = corners.find(c => counts[key(c)] === Math.max(...Object.values(counts)));

        const differs = (ix, iy) => {
            const c = at(ix, iy);
            return Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > 30;
        };

        const pickTiles = t => {
            const list = [];
            const tp = Math.max(1, Math.round(t * scale));
            for (let ty = 0; ty + tp <= ph; ty += tp) {
                for (let tx = 0; tx + tp <= pw; tx += tp) {
                    let hit = false;
                    for (let sy = ty; sy < ty + tp && !hit; sy += 2)
                        for (let sx = tx; sx < tx + tp && !hit; sx += 2)
                            hit = differs(sx, sy);
                    if (hit) list.push([tx / scale, ty / scale]);
                }
            }
            return list;
        };
        let tile = 5, tiles = pickTiles(tile);
        while (tiles.length > MAX_TILES && tile < 12) tiles = pickTiles(++tile);
        if (tiles.length === 0) return;

        const coglContext = global.stage.context.get_backend().get_cogl_context();
        const content = St.ImageContent.new_with_preferred_size(pw, ph);
        content.set_bytes(coglContext, px, Cogl.PixelFormat.RGBA_8888, pw, ph, rs);

        this._raise();
        this._busy = true;
        const group = new Clutter.Actor({x, y, width: w, height: h});
        this._layer.add_child(group);
        let left = tiles.length;
        const done = () => {
            if (--left === 0) {
                group.destroy();
                this._busy = false;
            }
        };

        for (const [tx, ty] of tiles) {
            const piece = new Clutter.Actor({x: tx, y: ty, width: tile, height: tile, clip_to_allocation: true});
            piece.add_child(new Clutter.Actor({content, x: -tx, y: -ty, width: w, height: h}));
            piece.set_pivot_point(0.5, 0.5);
            group.add_child(piece);

            const delay = (tx / w) * SWEEP_MS + Math.random() * 90;
            const dur = DRIFT_MS * (0.7 + Math.random() * 0.6);
            piece.ease({
                translation_x: 18 + Math.random() * 46,
                translation_y: -(14 + Math.random() * 40),
                scale_x: 0.25, scale_y: 0.25,
                opacity: 0,
                delay, duration: dur,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: done,
            });
        }
    }
}
