// Drop Shelf helper: starts ~/.local/bin/drop-shelf and keeps its window pinned at the
// top center (below the top bar), above other windows, on every workspace, and out of
// Alt+Tab / the overview / the dock.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const APP_ID = 'io.sagar.DropShelf';
const HIDE = {get: () => true, configurable: true};
const HOT_HALF_WIDTH = 140; // top-center hot zone: +-140 px around the middle of the screen
const HOT_DWELL_MS = 250;   // rest there this long (cursor or a drag) -> the shelf peeks out
const POLL_MS = 120;

export default class DropShelfExtension extends Extension {
    enable() {
        this._stopped = false;
        this._crashes = 0;
        this._watch = new Map();   // window -> signal ids (all windows, waiting for app id)
        this._shelves = new Map(); // shelf window -> signal ids
        this._createdId = global.display.connect('window-created', (_d, w) => this._track(w));
        for (const a of global.get_window_actors())
            this._track(a.meta_window);
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._placeAll());
        this._panelId = Main.panel.connect('notify::height', () => this._placeAll());
        this._spawn();
        this._hotSince = 0;
        this._lastPeek = 0;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => this._poll());
    }

    // The shelf is invisible when closed. Resting the cursor (or something being dragged)
    // at the very top edge, center of the screen, asks it to peek out.
    _poll() {
        if (!this._shelves?.size)
            return GLib.SOURCE_CONTINUE;
        const m = Main.layoutManager.primaryMonitor;
        const [x, y] = global.get_pointer();
        const hot = m && y <= m.y + 1 && Math.abs(x - (m.x + m.width / 2)) <= HOT_HALF_WIDTH;
        const now = GLib.get_monotonic_time() / 1000;
        if (!hot) {
            this._hotSince = 0;
        } else if (!this._hotSince) {
            this._hotSince = now;
        } else if (now - this._hotSince >= HOT_DWELL_MS && now - this._lastPeek >= 700) {
            this._lastPeek = now;
            Gio.DBus.session.call(APP_ID, '/io/sagar/DropShelf', 'org.gtk.Actions', 'Activate',
                new GLib.Variant('(sava{sv})', ['peek', [], {}]), null,
                Gio.DBusCallFlags.NO_AUTO_START, 1000, null, null);
        }
        return GLib.SOURCE_CONTINUE;
    }

    disable() {
        this._stopped = true;
        if (this._pollId)
            GLib.source_remove(this._pollId);
        this._pollId = 0;
        if (this._respawnId)
            GLib.source_remove(this._respawnId);
        this._respawnId = 0;
        this._proc?.force_exit();
        this._proc = null;
        global.display.disconnect(this._createdId);
        Main.layoutManager.disconnect(this._monitorsId);
        Main.panel.disconnect(this._panelId);
        for (const [w, ids] of [...this._watch, ...this._shelves]) {
            ids.forEach(id => w.disconnect(id));
            delete w.skip_taskbar;
            delete w.skipTaskbar;
            delete w.is_skip_taskbar;
        }
        this._watch = this._shelves = null;
    }

    _isShelf(w) {
        return w.get_wm_class() === APP_ID || w.get_gtk_application_id?.() === APP_ID;
    }

    _track(w) {
        if (!w || this._watch.has(w) || this._shelves.has(w))
            return;
        const check = () => {
            if (this._isShelf(w) && !this._shelves.has(w)) {
                this._watch.get(w)?.forEach(id => w.disconnect(id));
                this._watch.delete(w);
                this._adopt(w);
            }
        };
        this._watch.set(w, [
            w.connect('notify::wm-class', check),
            w.connect('unmanaged', () => {
                this._watch.get(w)?.forEach(id => w.disconnect(id));
                this._watch.delete(w);
            }),
        ]);
        check();
    }

    _adopt(w) {
        // hide from Alt+Tab, overview and dock (they read these from JS)
        Object.defineProperty(w, 'skip_taskbar', HIDE);
        Object.defineProperty(w, 'skipTaskbar', HIDE);
        w.is_skip_taskbar = () => true;
        w.make_above();
        w.stick();
        this._shelves.set(w, [
            w.connect('size-changed', () => this._place(w)),
            w.connect('notify::minimized', () => w.minimized && w.unminimize()),
            w.connect('notify::above', () => !w.above && w.make_above()),
            w.connect('unmanaged', () => this._shelves?.delete(w)),
        ]);
        this._place(w);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            if (this._shelves?.has(w))
                this._place(w);
            return GLib.SOURCE_REMOVE;
        });
    }

    _place(w) {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const r = w.get_frame_rect();
        const x = m.x + Math.round((m.width - r.width) / 2);
        const y = m.y + (Main.panel.visible ? Main.panel.height : 0);
        if (r.x !== x || r.y !== y)
            w.move_frame(true, x, y);
    }

    _placeAll() {
        for (const w of this._shelves.keys())
            this._place(w);
    }

    _spawn() {
        if (this._stopped)
            return;
        const path = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'drop-shelf']);
        let proc;
        try {
            proc = Gio.Subprocess.new(['python3', path], Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.error(`drop-shelf: could not start: ${e.message}`);
            return;
        }
        this._proc = proc;
        proc.wait_async(null, () => {
            if (this._stopped || this._proc !== proc)
                return;
            this._proc = null;
            // exit 0 = closed normally or already running elsewhere: don't respawn
            if (proc.get_if_exited() && proc.get_exit_status() === 0)
                return;
            if (++this._crashes > 5) {
                console.error('drop-shelf: crashed too often, giving up until next login');
                return;
            }
            this._respawnId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                this._respawnId = 0;
                this._spawn();
                return GLib.SOURCE_REMOVE;
            });
        });
    }
}
