// Phone Float helper: starts ~/.local/bin/phone-float, keeps its (transparent,
// click-through) window on top at the right edge, on every workspace and out of Alt+Tab /
// the overview / the dock, and tells it to show or hide when any app starts or ends a drag.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const APP_ID = 'io.arco.PhoneFloat';
const OBJ_PATH = '/io/arco/PhoneFloat';
const HIDE = {get: () => true, configurable: true};
const EDGE_GAP = 8;        // window's right edge this far from the screen edge
const SHOW_DELAY_MS = 120; // ignore tiny accidental drags
const HIDE_DELAY_MS = 900; // let a drop's send animation start before hiding

export default class PhoneFloatExtension extends Extension {
    enable() {
        this._stopped = false;
        this._crashes = 0;
        this._watch = new Map();
        this._phones = new Map();
        this._createdId = global.display.connect('window-created', (_d, w) => this._track(w));
        for (const a of global.get_window_actors())
            this._track(a.meta_window);
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._placeAll());
        this._workareaId = global.display.connect('workareas-changed', () => this._placeAll());
        this._dndIds = [
            Main.xdndHandler.connect('drag-begin', () => this._dragBegin()),
            Main.xdndHandler.connect('drag-end', () => this._dragEnd()),
        ];
        this._spawn();
    }

    disable() {
        this._stopped = true;
        for (const id of ['_showId', '_hideId', '_respawnId']) {
            if (this[id])
                GLib.source_remove(this[id]);
            this[id] = 0;
        }
        this._dndIds.forEach(id => Main.xdndHandler.disconnect(id));
        this._proc?.force_exit();
        this._proc = null;
        global.display.disconnect(this._createdId);
        global.display.disconnect(this._workareaId);
        Main.layoutManager.disconnect(this._monitorsId);
        for (const [w, ids] of [...this._watch, ...this._phones]) {
            ids.forEach(id => w.disconnect(id));
            delete w.skip_taskbar;
            delete w.skipTaskbar;
            delete w.is_skip_taskbar;
        }
        this._watch = this._phones = null;
    }

    _action(name) {
        Gio.DBus.session.call(APP_ID, OBJ_PATH, 'org.gtk.Actions', 'Activate',
            new GLib.Variant('(sava{sv})', [name, [], {}]), null,
            Gio.DBusCallFlags.NO_AUTO_START, 1000, null, null);
    }

    _dragBegin() {
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = 0;
        if (this._showId)
            return;
        this._showId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_DELAY_MS, () => {
            this._showId = 0;
            this._placeAll();
            this._action('show');
            return GLib.SOURCE_REMOVE;
        });
    }

    _dragEnd() {
        if (this._showId) {  // drag was too short to ever show the phone
            GLib.source_remove(this._showId);
            this._showId = 0;
            return;
        }
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
            this._hideId = 0;
            this._action('hide');
            return GLib.SOURCE_REMOVE;
        });
    }

    _isPhone(w) {
        return w.get_wm_class() === APP_ID || w.get_gtk_application_id?.() === APP_ID;
    }

    _track(w) {
        if (!w || this._watch.has(w) || this._phones.has(w))
            return;
        const check = () => {
            if (this._isPhone(w) && !this._phones.has(w)) {
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
        Object.defineProperty(w, 'skip_taskbar', HIDE);
        Object.defineProperty(w, 'skipTaskbar', HIDE);
        w.is_skip_taskbar = () => true;
        w.make_above();
        w.stick();
        this._phones.set(w, [
            w.connect('size-changed', () => this._place(w)),
            w.connect('notify::minimized', () => w.minimized && w.unminimize()),
            w.connect('notify::above', () => !w.above && w.make_above()),
            w.connect('unmanaged', () => this._phones?.delete(w)),
        ]);
        this._place(w);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            if (this._phones?.has(w))
                this._place(w);
            return GLib.SOURCE_REMOVE;
        });
    }

    _place(w) {
        const i = Main.layoutManager.primaryIndex;
        const wa = Main.layoutManager.getWorkAreaForMonitor(i);
        if (!wa)
            return;
        const r = w.get_frame_rect();
        const x = wa.x + wa.width - r.width - EDGE_GAP;
        const y = wa.y + Math.round((wa.height - r.height) / 2);
        if (r.x !== x || r.y !== y)
            w.move_frame(true, x, y);
    }

    _placeAll() {
        for (const w of this._phones?.keys() ?? [])
            this._place(w);
    }

    _spawn() {
        if (this._stopped)
            return;
        const path = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'phone-float']);
        let proc;
        try {
            proc = Gio.Subprocess.new(['python3', path], Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.error(`phone-float: could not start: ${e.message}`);
            return;
        }
        this._proc = proc;
        proc.wait_async(null, () => {
            if (this._stopped || this._proc !== proc)
                return;
            this._proc = null;
            if (proc.get_if_exited() && proc.get_exit_status() === 0)
                return;  // closed normally or already running elsewhere
            if (++this._crashes > 5) {
                console.error('phone-float: crashed too often, giving up until next login');
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
