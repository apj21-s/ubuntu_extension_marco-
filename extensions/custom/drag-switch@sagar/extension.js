// Drag Switch: spring-loaded dock icons and screen edges for drags coming from apps
// (Chrome, Files, Telegram, the Drop Shelf...). GNOME already does this for window
// previews in the overview; this adds it to the dock and to the screen edges.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const APP_HOVER_MS = 550;    // hold over a dock icon this long -> its window comes forward
const APP_CYCLE_MS = 1100;   // keep holding -> next window of the same app
const EDGE_MS = 650;         // hold at left/right edge -> switch workspace
const EDGE_REPEAT_MS = 900;  // keep holding -> keep switching
const DOCK_MS = 150;         // push to the dock edge -> reveal a hidden dock
const EDGE_PX = 3;
const DOCK_URL = 'file:///usr/share/gnome-shell/extensions/ubuntu-dock@ubuntu.com/docking.js';

export default class DragSwitchExtension extends Extension {
    enable() {
        this._monitor = {dragMotion: e => this._motion(e)};
        this._ids = [
            Main.xdndHandler.connect('drag-begin', () => this._begin()),
            Main.xdndHandler.connect('drag-end', () => this._end()),
        ];
        this._bar = new St.Widget({
            // colours in stylesheet.css (same crimson as the dock's running dots and the
            // notification badges); Wallpaper Mood recolours it to match the wallpaper
            style_class: 'drag-switch-bar',
            reactive: false, visible: false,
        });
        Main.layoutManager.uiGroup.add_child(this._bar);
        this._DockManager = null;
        import(DOCK_URL).then(m => {
            this._DockManager = m.DockManager;
        }).catch(() => {});
    }

    disable() {
        this._end();
        this._ids.forEach(id => Main.xdndHandler.disconnect(id));
        this._bar.destroy();
        this._bar = this._monitor = this._DockManager = null;
    }

    _begin() {
        if (this._dragging)
            return;
        this._dragging = true;
        this._key = null;
        DND.addDragMonitor(this._monitor);
    }

    _end() {
        if (!this._dragging)
            return;
        this._dragging = false;
        DND.removeDragMonitor(this._monitor);
        this._reset();
        if (this._forcedDock) {
            try {
                this._forcedDock._onDragEnd();
            } catch (e) {}
            this._forcedDock = null;
        }
    }

    _reset() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._key = null;
        this._cycle = -1;
        this._bar.remove_all_transitions();
        this._bar.hide();
    }

    _motion(e) {
        let key = null, delay = 0, repeat = 0, act = null, rect = null;
        const app = this._appAt(e.targetActor);
        if (app && app.get_windows().length) {
            key = `app:${app.get_id()}`;
            [delay, repeat, act] = [APP_HOVER_MS, APP_CYCLE_MS, () => this._activateApp(app)];
            rect = this._underline(this._iconActor(e.targetActor));
        } else {
            const edge = this._edgeAt(e.x, e.y);
            if (edge?.dock) {
                key = 'dock';
                [delay, act] = [DOCK_MS, () => this._showDock(edge.dock)];
            } else if (edge) {
                key = `ws:${edge.side}`;
                [delay, repeat, act] = [EDGE_MS, EDGE_REPEAT_MS, () => this._switchWs(edge.side)];
                rect = edge.rect;
            }
        }
        if (key !== this._key) {
            this._reset();
            this._key = key;
            if (key)
                this._arm(delay, repeat, act, rect);
        }
        return DND.DragMotionResult.CONTINUE;
    }

    _arm(delay, repeat, act, rect) {
        if (rect) {  // countdown bar
            this._bar.set_position(rect.x, rect.y);
            this._bar.set_size(rect.w, rect.h);
            this._bar.opacity = 0;
            this._bar.show();
            Main.layoutManager.uiGroup.set_child_above_sibling(this._bar, null);
            this._bar.ease({opacity: 255, duration: delay, mode: Clutter.AnimationMode.EASE_IN_QUAD});
        }
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timer = 0;
            const again = act() !== false && repeat > 0 && this._dragging;
            this._bar.remove_all_transitions();
            this._bar.opacity = again ? 90 : 0;
            if (again)
                this._arm(repeat, repeat, act, rect);
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---- dock icons ----
    _iconActor(actor) {
        for (let a = actor, i = 0; a && i < 15; a = a.get_parent(), i++) {
            if (a.app instanceof Shell.App || a._delegate?.app instanceof Shell.App)
                return a;
        }
        return null;
    }

    _appAt(actor) {
        const a = this._iconActor(actor);
        return a ? (a.app instanceof Shell.App ? a.app : a._delegate.app) : null;
    }

    _underline(actor) {
        if (!actor)
            return null;
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        return {x: x + w * 0.2, y: y + h - 4, w: w * 0.6, h: 3};
    }

    _activateApp(app) {
        const wins = app.get_windows().filter(w => !w.skip_taskbar);
        if (!wins.length)
            return false;
        this._cycle = (this._cycle + 1) % wins.length;
        Main.activateWindow(wins[this._cycle], global.get_current_time());
        if (Main.overview.visible)
            Main.overview.hide();
        return wins.length > 1;  // cycle only if there is more than one window
    }

    // ---- screen edges ----
    _dock() {
        try {
            return this._DockManager?.getDefault()?.mainDock ?? null;
        } catch (e) {
            return null;
        }
    }

    _edgeAt(x, y) {
        const mons = Main.layoutManager.monitors;
        const m = mons.find(k => x >= k.x && x < k.x + k.width && y >= k.y && y < k.y + k.height);
        if (!m)
            return null;
        const dock = this._dock();
        const side = x <= m.x + EDGE_PX ? 'left' : x >= m.x + m.width - 1 - EDGE_PX ? 'right'
            : y >= m.y + m.height - 1 - EDGE_PX ? 'bottom' : y <= m.y + EDGE_PX ? 'top' : null;
        if (!side)
            return null;
        const dockSide = {[St.Side.LEFT]: 'left', [St.Side.RIGHT]: 'right',
            [St.Side.BOTTOM]: 'bottom', [St.Side.TOP]: 'top'}[dock?._position];
        if (dock && side === dockSide && dock._dockState !== 2 /* SHOWN */)
            return {dock};
        if (side !== 'left' && side !== 'right')
            return null;
        // only the outer screen edges, not the border between two monitors
        const inner = mons.some(k => k !== m && (side === 'left' ? k.x + k.width === m.x : k.x === m.x + m.width));
        if (inner)
            return null;
        const rect = {x: side === 'left' ? m.x : m.x + m.width - 6, y: m.y, w: 6, h: m.height};
        return {side, rect};
    }

    _showDock(dock) {
        try {
            if (this._forcedDock !== dock) {
                dock._onDragStart();  // shows it and keeps it shown until the drag ends
                this._forcedDock = dock;
            }
        } catch (e) {}
        return false;
    }

    _switchWs(side) {
        const wm = global.workspace_manager;
        const vertical = wm.layout_rows === -1;
        let dir = side === 'left' ? Meta.MotionDirection.LEFT : Meta.MotionDirection.RIGHT;
        if (vertical)
            dir = side === 'left' ? Meta.MotionDirection.UP : Meta.MotionDirection.DOWN;
        if (Clutter.get_default_text_direction() === Clutter.TextDirection.RTL && !vertical)
            dir = dir === Meta.MotionDirection.LEFT ? Meta.MotionDirection.RIGHT : Meta.MotionDirection.LEFT;
        const cur = wm.get_active_workspace();
        const next = cur.get_neighbor(dir);
        if (!next || next === cur)
            return false;
        next.activate(global.get_current_time());
        return true;
    }
}
