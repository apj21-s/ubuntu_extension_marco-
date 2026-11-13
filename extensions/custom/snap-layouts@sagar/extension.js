// Snap Layouts: Super+Z opens a Windows-11-style layout picker for the focused window.
// Click a zone (or press Esc to cancel). Zones are fractions of the monitor's work area.
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// each layout: list of zones [x, y, w, h] in fractions
const LAYOUTS = [
    [[0, 0, .5, 1], [.5, 0, .5, 1]],
    [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
    [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
    [[0, 0, .5, 1], [.5, 0, .5, .5], [.5, .5, .5, .5]],
    [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]],
    [[0, 0, .25, 1], [.25, 0, .5, 1], [.75, 0, .25, 1]],
];
const THUMB_W = 120, THUMB_H = 76, PAD = 3;
const ZONE = 'background-color: rgba(230,221,211,0.10); border-radius: 5px; border: 1px solid rgba(230,221,211,0.18);';
const ZONE_HOT = 'background-color: rgba(177,68,77,0.75); border-radius: 5px; border: 1px solid #d0606a;';

export default class SnapLayoutsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        Main.wm.addKeybinding('show-layouts', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL, () => this._open());
    }

    disable() {
        Main.wm.removeKeybinding('show-layouts');
        this._close();
        this._settings = null;
    }

    _open() {
        if (this._backdrop)
            return this._close();
        const win = global.display.focus_window;
        if (!win || win.get_window_type() !== Meta.WindowType.NORMAL || !win.allows_resize?.()) {
            Main.notify('Snap Layouts', 'Click a normal window first, then press Super+Z.');
            return;
        }
        this._win = win;
        const mon = Main.layoutManager.monitors[win.get_monitor()] ?? Main.layoutManager.primaryMonitor;

        this._backdrop = new St.Widget({reactive: true, x: mon.x, y: mon.y, width: mon.width, height: mon.height,
            style: 'background-color: rgba(0,0,0,0.15);'});
        // close only when the click lands on the dim backdrop itself (not on the picker)
        this._backdrop.connect('button-release-event', (actor, ev) => {
            if (global.stage.get_event_actor(ev) === actor)
                this._close();
            return Clutter.EVENT_STOP;
        });
        this._backdrop.connect('key-press-event', (_a, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape)
                this._close();
            return Clutter.EVENT_STOP;
        });

        const panel = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, reactive: true,
            style: 'background-color: rgba(14,12,12,0.96); border-radius: 18px; padding: 14px 16px; ' +
                'border: 1px solid rgba(177,68,77,0.35); box-shadow: 0 8px 28px rgba(0,0,0,0.5); spacing: 10px;'});
        panel.add_child(new St.Label({text: `Snap “${(win.get_title() ?? '').slice(0, 40)}”`,
            style: 'color: #e6ddd3; font-size: 12px; font-weight: 600;'}));
        const grid = new St.BoxLayout({style: 'spacing: 12px;'});
        const grid2 = new St.BoxLayout({style: 'spacing: 12px;'});
        LAYOUTS.forEach((layout, i) => (i < 3 ? grid : grid2).add_child(this._thumb(layout)));
        panel.add_child(grid);
        panel.add_child(grid2);
        panel.add_child(new St.Label({text: 'Click a zone  ·  Esc to cancel',
            style: 'color: rgba(230,221,211,0.5); font-size: 10px;'}));
        this._backdrop.add_child(panel);
        Main.layoutManager.uiGroup.add_child(this._backdrop);

        // place the picker near the top center of that monitor
        panel.connect('notify::width', () => panel.set_position(Math.round((mon.width - panel.width) / 2), 60));
        panel.set_position(Math.round((mon.width - 440) / 2), 60);
        this._grab = Main.pushModal(this._backdrop);
        this._backdrop.grab_key_focus();
        panel.opacity = 0;
        panel.translation_y = -10;
        panel.ease({opacity: 255, translation_y: 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _thumb(layout) {
        const box = new St.Widget({width: THUMB_W, height: THUMB_H,
            style: 'background-color: rgba(230,221,211,0.04); border-radius: 9px;'});
        for (const z of layout) {
            // a plain reactive widget (not St.Button): it reacts to the mouse release directly
            const zone = new St.Widget({style: ZONE, reactive: true,
                x: Math.round(z[0] * THUMB_W + PAD), y: Math.round(z[1] * THUMB_H + PAD),
                width: Math.round(z[2] * THUMB_W - 2 * PAD), height: Math.round(z[3] * THUMB_H - 2 * PAD)});
            zone.connect('enter-event', () => zone.set_style(ZONE_HOT));
            zone.connect('leave-event', () => zone.set_style(ZONE));
            zone.connect('button-press-event', () => Clutter.EVENT_STOP);
            zone.connect('button-release-event', () => {
                this._snap(z);
                return Clutter.EVENT_STOP;
            });
            box.add_child(zone);
        }
        return box;
    }

    _snap(z) {
        const win = this._win;
        this._close();
        if (!win || win.is_destroyed?.())
            return;
        const wa = win.get_work_area_current_monitor();
        const g = this._settings.get_int('gap');
        try {
            if (win.is_maximized?.())
                win.unmaximize();
            else if (win.get_maximized?.())
                win.unmaximize(Meta.MaximizeFlags.BOTH);
        } catch (e) {}
        if (win.is_fullscreen())
            win.unmake_fullscreen();
        const x = Math.round(wa.x + z[0] * wa.width + g / 2);
        const y = Math.round(wa.y + z[1] * wa.height + g / 2);
        const w = Math.round(z[2] * wa.width - g);
        const h = Math.round(z[3] * wa.height - g);
        win.move_resize_frame(true, x, y, w, h);
        win.activate(global.get_current_time());
    }

    _close() {
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._backdrop?.destroy();
        this._backdrop = null;
        this._win = null;
    }
}
