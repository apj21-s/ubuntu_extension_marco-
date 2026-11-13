// Power Menu: Alt+F4 on the desktop opens a frosted-glass power menu.
//   with a window focused -> Alt+F4 closes it (as before)
//   desktop / overview    -> Lock · Sleep · Restart · Shut down · Log out
// Keys: ← → (or 1-5) choose, Enter confirms, Esc / Alt+F4 / click outside cancels.
// Shut down / restart / log out go through the session manager, so apps with unsaved work can still ask.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const EASE = Clutter.AnimationMode;
const KEY = 'show-power-menu';

const ACTIONS = [
    {id: 'lock', label: 'Lock', icon: 'system-lock-screen-symbolic'},
    {id: 'sleep', label: 'Sleep', icon: 'weather-clear-night-symbolic'},
    {id: 'restart', label: 'Restart', icon: 'system-reboot-symbolic'},
    {id: 'poweroff', label: 'Shut down', icon: 'system-shutdown-symbolic', danger: true},
    {id: 'logout', label: 'Log out', icon: 'system-log-out-symbolic'},
];

// GNOME session manager, no confirmation dialog (apps with unsaved work can still object)
function session(method, params = null) {
    Gio.DBus.session.call('org.gnome.SessionManager', '/org/gnome/SessionManager', 'org.gnome.SessionManager',
        method, params, null, Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
            try {
                conn.call_finish(res);
            } catch (e) {
                Main.notify('Power Menu', e.message);
            }
        });
}

function isRealWindow(w) {
    if (!w || w.is_skip_taskbar())
        return false;
    const t = w.get_window_type();
    return t !== Meta.WindowType.DESKTOP && t !== Meta.WindowType.DOCK;
}

function uptimeText() {
    try {
        const [, b] = GLib.file_get_contents('/proc/uptime');
        const s = Math.floor(parseFloat(new TextDecoder().decode(b)));
        const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
        return `up ${h ? `${h} h ` : ''}${m} min`;
    } catch (e) {
        return '';
    }
}

// what the menu just asked for: GNOME's end-session dialog type and how long the request is valid
let armed = null;  // {type: 0 logout | 1 shutdown | 2 restart, until: ms}
const DIALOG_TYPE = {logout: 0, poweroff: 1, restart: 2};
const CONFIRM_SIGNAL = {0: 'ConfirmedLogout', 1: 'ConfirmedShutdown', 2: 'ConfirmedReboot'};

class Menu {
    constructor(onDone) {
        this._onDone = onDone;
        const m = Main.layoutManager.primaryMonitor;
        this.root = new St.Widget({reactive: true, can_focus: true, x: m.x, y: m.y, width: m.width, height: m.height});
        // frosted backdrop: blurs the desktop behind it
        const back = new St.Widget({style_class: 'pm-backdrop', width: m.width, height: m.height, reactive: true});
        back.add_effect(new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND, radius: 46, brightness: 0.55}));
        back.connect('button-release-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        this.root.add_child(back);

        const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'pm-column', reactive: true});
        col.connect('button-release-event', () => Clutter.EVENT_STOP);
        const now = GLib.DateTime.new_now_local();
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const time = new St.Label({style_class: 'pm-time', x_align: Clutter.ActorAlign.CENTER,
            text: now.format(iface.get_string('clock-format') === '24h' ? '%H:%M' : '%-I:%M')});
        const sub = new St.Label({style_class: 'pm-sub', x_align: Clutter.ActorAlign.CENTER,
            text: `See you soon, ${GLib.get_user_name()}`});
        const up = new St.Label({style_class: 'pm-up', x_align: Clutter.ActorAlign.CENTER, text: uptimeText()});
        const line = new St.Widget({style_class: 'pm-line', x_align: Clutter.ActorAlign.CENTER});
        const row = new St.BoxLayout({style_class: 'pm-row', x_align: Clutter.ActorAlign.CENTER});
        this._tiles = ACTIONS.map((a, i) => this._tile(a, i));
        this._tiles.forEach(t => row.add_child(t));
        const hint = new St.Label({style_class: 'pm-hint', x_align: Clutter.ActorAlign.CENTER,
            text: '←  →  choose     Enter  confirm     Esc  cancel'});
        [time, sub, up, line, row, hint].forEach(a => col.add_child(a));
        this.root.add_child(col);
        const center = () => col.set_position(Math.round((m.width - col.width) / 2), Math.round((m.height - col.height) / 2 - 20));
        col.connect('notify::width', center);
        col.connect('notify::height', center);
        center();

        this.root.connect('key-press-event', (_a, ev) => this._key(ev));
        // hover only counts once the pointer actually moves (tiles animating in under a
        // resting cursor used to fire enter/leave over and over -> flicker)
        this._hoverOk = false;
        const [px0, py0] = global.get_pointer();
        this.root.connect('motion-event', () => {
            const [px, py] = global.get_pointer();
            if (!this._hoverOk && (Math.abs(px - px0) > 3 || Math.abs(py - py0) > 3))
                this._hoverOk = true;
            return Clutter.EVENT_PROPAGATE;
        });
        Main.layoutManager.uiGroup.add_child(this.root);
        this._grab = Main.pushModal(this.root);
        this.root.grab_key_focus();
        this._select(3);  // Shut down, like Windows

        // entrance
        this.root.opacity = 0;
        this.root.ease({opacity: 255, duration: 220, mode: EASE.EASE_OUT_QUAD});
        [time, sub, up].forEach((a, i) => {
            a.opacity = 0;
            a.translation_y = -12;
            a.ease({opacity: 255, translation_y: 0, duration: 420, delay: 60 + i * 50, mode: EASE.EASE_OUT_CUBIC});
        });
        line.set_pivot_point(0.5, 0.5);
        line.scale_x = 0;
        line.ease({scale_x: 1, duration: 500, delay: 180, mode: EASE.EASE_OUT_CUBIC});
        this._tiles.forEach((t, i) => {
            t.opacity = 0;
            t.translation_y = 14;
            t.ease({opacity: 255, translation_y: 0, duration: 360, delay: 90 + i * 45, mode: EASE.EASE_OUT_CUBIC});
        });
        hint.opacity = 0;
        hint.ease({opacity: 255, duration: 500, delay: 500, mode: EASE.EASE_OUT_QUAD});
    }

    _tile(a, i) {
        const t = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'pm-tile', reactive: true,
            track_hover: true});
        if (a.danger)
            t.add_style_class_name('danger');
        t.set_pivot_point(0.5, 0.5);
        const icon = new St.Icon({icon_name: a.icon, style_class: 'pm-icon', x_align: Clutter.ActorAlign.CENTER});
        const label = new St.Label({text: a.label, style_class: 'pm-label', x_align: Clutter.ActorAlign.CENTER});
        const num = new St.Label({text: `${i + 1}`, style_class: 'pm-num', x_align: Clutter.ActorAlign.CENTER});
        t.add_child(icon);
        t.add_child(label);
        t.add_child(num);
        t.connect('enter-event', () => {
            if (this._hoverOk)
                this._select(i);
        });
        t.connect('button-press-event', () => Clutter.EVENT_STOP);
        t.connect('button-release-event', () => {
            this._run(i);
            return Clutter.EVENT_STOP;
        });
        return t;
    }

    _select(i) {
        this._sel = (i + this._tiles.length) % this._tiles.length;
        this._tiles.forEach((t, j) => {  // style only - no size change, so nothing moves under the cursor
            if (j === this._sel)
                t.add_style_pseudo_class('selected');
            else
                t.remove_style_pseudo_class('selected');
        });
    }

    _key(ev) {
        const k = ev.get_key_symbol();
        if (k === Clutter.KEY_Escape || k === Clutter.KEY_F4) {
            this.close();
        } else if (k === Clutter.KEY_Left || k === Clutter.KEY_Up || (k === Clutter.KEY_Tab && ev.has_shift_modifier())) {
            this._select(this._sel - 1);
        } else if (k === Clutter.KEY_Right || k === Clutter.KEY_Down || k === Clutter.KEY_Tab) {
            this._select(this._sel + 1);
        } else if (k === Clutter.KEY_Return || k === Clutter.KEY_KP_Enter || k === Clutter.KEY_space) {
            this._run(this._sel);
        } else if (k >= Clutter.KEY_1 && k <= Clutter.KEY_5) {
            this._run(k - Clutter.KEY_1);
        }
        return Clutter.EVENT_STOP;
    }

    _run(i) {
        if (this._running)
            return;
        this._running = true;
        this._select(i);
        const t = this._tiles[i];
        t.ease({scale_x: 0.94, scale_y: 0.94, duration: 90, mode: EASE.EASE_OUT_QUAD,
            onComplete: () => t.ease({scale_x: 1.0, scale_y: 1.0, duration: 140, mode: EASE.EASE_OUT_BACK})});
        const id = ACTIONS[i].id;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 260, () => {
            this.close(() => {
                const sys = SystemActions.getDefault();
                if (id in DIALOG_TYPE)
                    armed = {type: DIALOG_TYPE[id], until: Date.now() + 8000};
                try {
                    if (id === 'lock')
                        sys.activateLockScreen();
                    else if (id === 'sleep')
                        sys.activateSuspend();
                    else if (id === 'restart')
                        session('RequestReboot');
                    else if (id === 'poweroff')
                        session('RequestShutdown');
                    else if (id === 'logout')
                        session('Logout', new GLib.Variant('(u)', [1]));  // 1 = no confirmation
                } catch (e) {
                    Main.notify('Power Menu', e.message);
                }
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    close(after) {
        if (this._closing)
            return;
        this._closing = true;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this.root.ease({opacity: 0, duration: 180, mode: EASE.EASE_IN_QUAD, onStopped: () => {
            this.root.destroy();
            this._onDone?.();
            after?.();
        }});
    }

    destroyNow() {
        if (this._grab)
            Main.popModal(this._grab);
        this._grab = null;
        this.root.destroy();
    }
}

export default class PowerMenuExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        // take Alt+F4 over from the window manager's "close" (handled here: close or menu)
        this._wm = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
        const close = this._wm.get_strv('close');
        if (close.includes('<Alt>F4')) {
            this._settings.set_strv('saved-close-binding', close);
            this._wm.set_strv('close', close.filter(k => k !== '<Alt>F4'));
        }
        Main.wm.addKeybinding(KEY, this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._altF4());

        // GNOME 50 shows its "will power off in 60 seconds" dialog even for no-dialog requests.
        // If the request came from this menu (and no app is blocking with unsaved work),
        // confirm it straight away instead of showing the dialog.
        const dlg = Main.endSessionDialog;
        if (dlg) {
            const origOpen = dlg.OpenAsync;
            this._dlg = dlg;
            dlg.OpenAsync = function (parameters, invocation) {
                const [type, , , inhibitors] = parameters;
                const a = armed;
                if (a && Date.now() < a.until && a.type === type && type in CONFIRM_SIGNAL &&
                    (inhibitors?.length ?? 0) === 0) {
                    armed = null;
                    invocation.return_value(null);
                    this._dbusImpl.emit_signal(CONFIRM_SIGNAL[type], null);
                    return Promise.resolve();
                }
                return origOpen.call(this, parameters, invocation);
            };
        }
    }

    disable() {
        if (this._dlg) {
            delete this._dlg.OpenAsync;  // back to the class method
            this._dlg = null;
        }
        armed = null;
        Main.wm.removeKeybinding(KEY);
        this._menu?.destroyNow();
        this._menu = null;
        const saved = this._settings.get_strv('saved-close-binding');
        if (saved.length) {
            this._wm.set_strv('close', saved);
            this._settings.set_strv('saved-close-binding', []);
        }
        this._wm = null;
        this._settings = null;
    }

    _altF4() {
        if (this._menu)
            return this._menu.close();
        const w = global.display.focus_window;
        if (!Main.overview.visible && isRealWindow(w)) {
            w.delete(global.get_current_time());
            return undefined;
        }
        if (Main.overview.visible)
            Main.overview.hide();
        this._menu = new Menu(() => {
            this._menu = null;
        });
        return undefined;
    }
}
