// Pop-out: picture-in-picture for any window.
//
//  * Super+P          pop out the focused window (again: close its pop-out)
//  * drag             move it; it snaps to the nearest screen corner
//  * scroll           make it bigger or smaller
//  * double-click     go back to the real window
//  * hover            buttons: back to window, see-through, close
//
// The pop-out is a live copy of the window (a Clutter.Clone of its actor), so it keeps
// playing while you work in other windows. It closes by itself when the window closes,
// and steps aside in the overview and for fullscreen apps. Nothing runs without pop-outs.
// The File Finder's "> popout" lists windows through the io.arco.Popout D-Bus object.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const START_W = 360;
const MIN_W = 200;
const MAX_W = 720;
const STEP_W = 40;
const MARGIN = 16;

const DBUS_XML = `<node>
  <interface name="io.arco.Popout">
    <method name="List"><arg type="a(sssb)" direction="out" name="windows"/></method>
    <method name="PopOut"><arg type="s" direction="in" name="id"/></method>
  </interface>
</node>`;

class PopOut {
    constructor(owner, window) {
        this.owner = owner;
        this.window = window;
        this.width = START_W;
        this.seeThrough = false;

        this.box = new St.Widget({
            style_class: 'popout', reactive: true, track_hover: true, clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this.clone = new Clutter.Clone({source: window.get_compositor_private()});
        this.box.add_child(this.clone);

        this.bar = new St.BoxLayout({style_class: 'popout-bar', opacity: 0});
        this.bar.add_child(this._button('view-restore-symbolic', 'Back to the window', () => this.focus()));
        this.bar.add_child(this._button('weather-fog-symbolic', 'See-through', () => this.toggleSeeThrough()));
        this.bar.add_child(this._button('window-close-symbolic', 'Close the pop-out', () => this.destroy()));
        this.box.add_child(this.bar);

        this.box.connect('notify::hover', () => this.bar.ease({
            opacity: this.box.hover ? 255 : 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        }));
        this.box.connect('button-press-event', (_a, ev) => this._press(ev));
        this.box.connect('motion-event', (_a, ev) => this._motion(ev));
        this.box.connect('button-release-event', (_a, ev) => this._release(ev));
        this.box.connect('scroll-event', (_a, ev) => this._scroll(ev));

        this._ids = [
            window.connect('unmanaging', () => this.destroy()),
            window.connect('size-changed', () => this._layout()),
        ];
        Main.layoutManager.addTopChrome(this.box, {trackFullscreen: true});
        this._layout();
        const [x, y] = owner.freeSpot(this);
        this.box.set_position(x, y);
        this.box.opacity = 0;
        this.box.scale_x = this.box.scale_y = 0.9;
        this.box.set_pivot_point(0.5, 0.5);
        this.box.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _button(icon, label, cb) {
        const b = new St.Button({style_class: 'popout-btn', can_focus: true, accessible_name: label,
            child: new St.Icon({icon_name: icon, icon_size: 14})});
        b.connect('clicked', () => {
            cb();
            return Clutter.EVENT_STOP;
        });
        return b;
    }

    // show only the window itself (not its shadow), scaled to the pop-out's width
    _layout() {
        const actor = this.window.get_compositor_private();
        if (!actor)
            return;
        const frame = this.window.get_frame_rect();
        const buffer = this.window.get_buffer_rect();
        if (frame.width <= 0 || frame.height <= 0)
            return;
        const s = this.width / frame.width;
        const h = Math.round(frame.height * s);
        this.clone.set_scale(s, s);
        this.clone.set_position(-(frame.x - buffer.x) * s, -(frame.y - buffer.y) * s);
        this.box.set_size(this.width, h);
        this.bar.set_position(this.width - this.bar.width - 8, 8);
        this.height = h;
    }

    _press(ev) {
        if (ev.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        if (ev.get_click_count() === 2) {
            this.focus();
            return Clutter.EVENT_STOP;
        }
        const [px, py] = ev.get_coords();
        this._drag = {dx: px - this.box.x, dy: py - this.box.y, sx: px, sy: py, moved: false};
        this._grab = global.stage.grab(this.box);
        return Clutter.EVENT_STOP;
    }

    _motion(ev) {
        if (!this._drag)
            return Clutter.EVENT_PROPAGATE;
        const [px, py] = ev.get_coords();
        if (Math.abs(px - this._drag.sx) + Math.abs(py - this._drag.sy) > 4)
            this._drag.moved = true;
        this.box.set_position(px - this._drag.dx, py - this._drag.dy);
        return Clutter.EVENT_STOP;
    }

    _release() {
        if (!this._drag)
            return Clutter.EVENT_PROPAGATE;
        this._grab?.dismiss();
        this._grab = null;
        const moved = this._drag.moved;
        this._drag = null;
        if (moved)
            this.snap();
        return Clutter.EVENT_STOP;
    }

    _scroll(ev) {
        const dir = ev.get_scroll_direction();
        let step = 0;
        if (dir === Clutter.ScrollDirection.UP)
            step = STEP_W;
        else if (dir === Clutter.ScrollDirection.DOWN)
            step = -STEP_W;
        else if (dir === Clutter.ScrollDirection.SMOOTH)
            step = -ev.get_scroll_delta()[1] * STEP_W;
        if (!step)
            return Clutter.EVENT_PROPAGATE;
        const before = [this.box.x + this.box.width, this.box.y + this.box.height];
        this.width = Math.max(MIN_W, Math.min(MAX_W, Math.round(this.width + step)));
        this._layout();
        // grow towards the middle of the screen: keep the corner it sits in fixed
        const area = this._area();
        const right = this.box.x + this.box.width / 2 > area.x + area.width / 2;
        const bottom = this.box.y + this.box.height / 2 > area.y + area.height / 2;
        this.box.set_position(right ? before[0] - this.box.width : this.box.x,
            bottom ? before[1] - this.box.height : this.box.y);
        this._keepOnScreen();
        return Clutter.EVENT_STOP;
    }

    _area() {
        const [x, y] = [this.box.x + this.box.width / 2, this.box.y + this.box.height / 2];
        const rect = new Mtk.Rectangle({x: Math.round(x), y: Math.round(y), width: 1, height: 1});
        const monitor = global.display.get_monitor_index_for_rect(rect);
        return Main.layoutManager.getWorkAreaForMonitor(monitor >= 0 ? monitor : Main.layoutManager.primaryIndex);
    }

    _keepOnScreen() {
        const a = this._area();
        this.box.set_position(
            Math.max(a.x + MARGIN, Math.min(this.box.x, a.x + a.width - this.box.width - MARGIN)),
            Math.max(a.y + MARGIN, Math.min(this.box.y, a.y + a.height - this.box.height - MARGIN)));
    }

    snap() {
        const a = this._area();
        const right = this.box.x + this.box.width / 2 > a.x + a.width / 2;
        const bottom = this.box.y + this.box.height / 2 > a.y + a.height / 2;
        this.box.ease({
            x: right ? a.x + a.width - this.box.width - MARGIN : a.x + MARGIN,
            y: bottom ? a.y + a.height - this.box.height - MARGIN : a.y + MARGIN,
            duration: 220, mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
    }

    toggleSeeThrough() {
        this.seeThrough = !this.seeThrough;
        this.clone.ease({opacity: this.seeThrough ? 110 : 255, duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    focus() {
        Main.activateWindow(this.window);
    }

    setVisible(on) {
        this.box.visible = on;
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._grab?.dismiss();
        this._ids.forEach(id => this.window.disconnect(id));
        this.owner.forget(this);
        Main.layoutManager.removeChrome(this.box);
        this.box.destroy();
    }
}


export default class PopoutExtension extends Extension {
    enable() {
        this._popouts = new Map();  // Meta.Window -> PopOut
        this._settings = this.getSettings();
        Main.wm.addKeybinding('toggle-popout', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL, () => this._toggleFocused());
        this._overviewIds = [
            Main.overview.connect('showing', () => this._popouts.forEach(p => p.setVisible(false))),
            Main.overview.connect('hidden', () => this._popouts.forEach(p => p.setVisible(true))),
        ];
        this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUS_XML, this);
        this._dbus.export(Gio.DBus.session, '/io/arco/Popout');
    }

    disable() {
        Main.wm.removeKeybinding('toggle-popout');
        this._overviewIds.forEach(id => Main.overview.disconnect(id));
        this._dbus.unexport();
        this._dbus = null;
        [...this._popouts.values()].forEach(p => p.destroy());
        this._popouts = null;
        this._settings = null;
    }

    _poppable(w) {
        return w && !w.skip_taskbar && [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG].includes(w.get_window_type()) &&
            w.get_compositor_private();
    }

    _toggleFocused() {
        const w = global.display.focus_window;
        if (!this._poppable(w))
            return;
        if (this._popouts.has(w))
            this._popouts.get(w).destroy();
        else
            this.popOut(w);
    }

    popOut(w) {
        if (this._popouts.has(w) || !this._poppable(w))
            return;
        this._popouts.set(w, new PopOut(this, w));
    }

    forget(p) {
        this._popouts?.delete(p.window);
    }

    // new pop-outs go to the bottom-right corner, above any that are already there
    freeSpot(p) {
        const a = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        let y = a.y + a.height - p.height - MARGIN;
        for (const other of this._popouts.values()) {
            if (other !== p)
                y = Math.min(y, other.box.y - p.height - MARGIN);
        }
        return [a.x + a.width - p.width - MARGIN, Math.max(a.y + MARGIN, y)];
    }

    // ----- D-Bus (File Finder "> popout") -----
    List() {
        const tracker = Shell.WindowTracker.get_default();
        return global.display.list_all_windows()
            .filter(w => this._poppable(w))
            .sort((a, b) => b.get_user_time() - a.get_user_time())
            .map(w => [String(w.get_id()), w.get_title() || '', tracker.get_window_app(w)?.get_name() || '',
                this._popouts.has(w)]);
    }

    PopOut(id) {
        const w = global.display.list_all_windows().find(x => String(x.get_id()) === id);
        if (w && this._popouts.has(w))
            this._popouts.get(w).destroy();
        else if (w)
            this.popOut(w);
    }
}
