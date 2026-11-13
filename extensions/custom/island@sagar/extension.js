// Dynamic Island: one morphing pill at the top center of the screen.
//   - volume / brightness / caps-lock pop-ups (replaces GNOME's OSD)
//   - Bluetooth device connected / disconnected (+ battery when the device reports it)
//   - "Copied" when something is copied to the clipboard
//   - live activities over D-Bus (org.sagar.Island): Timer(seconds), Stopwatch(), Stop(), Show(icon, text)
//     -> the `island` command:  island timer 5m | island stopwatch | island stop
// Click the island while a timer/stopwatch runs to stop it.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OsdWindow from 'resource:///org/gnome/shell/ui/osdWindow.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = `<node><interface name="org.sagar.Island">
  <method name="Timer"><arg type="u" direction="in" name="seconds"/></method>
  <method name="Stopwatch"/>
  <method name="Stop"/>
  <method name="Show"><arg type="s" direction="in" name="icon"/><arg type="s" direction="in" name="text"/></method>
</interface></node>`;

const PILL = 'background-color: rgba(14,12,12,0.96); border-radius: 19px; padding: 7px 16px; spacing: 10px; ' +
    'border: 1px solid rgba(177,68,77,0.30); box-shadow: 0 6px 18px rgba(0,0,0,0.45);';
const BAR_W = 110;

function fmt(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

class Island {
    constructor() {
        this.actor = new St.BoxLayout({style: PILL, reactive: true, visible: false, opacity: 0,
            y_align: Clutter.ActorAlign.CENTER});
        this.actor.set_pivot_point(0.5, 0.5);
        this._icon = new St.Icon({icon_size: 16, style: 'color: #d0606a;', y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({style: 'color: #e6ddd3; font-size: 12px; font-weight: 600;',
            y_align: Clutter.ActorAlign.CENTER});
        this._bar = new St.Widget({width: BAR_W, height: 5, y_align: Clutter.ActorAlign.CENTER,
            style: 'background-color: rgba(230,221,211,0.15); border-radius: 3px;'});
        this._fill = new St.Widget({height: 5, style: 'background-color: #b1444d; border-radius: 3px;'});
        this._bar.add_child(this._fill);
        this.actor.add_child(this._icon);
        this.actor.add_child(this._label);
        this.actor.add_child(this._bar);
        Main.layoutManager.addTopChrome(this.actor);
        this.actor.connect('notify::width', () => this._place());
        this.actor.connect('button-press-event', () => {
            this.onClick?.();
            return Clutter.EVENT_STOP;
        });
        this._hideId = 0;
        this.activity = null;   // {kind:'timer'|'stopwatch', ...}
    }

    destroy() {
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this.actor.destroy();
    }

    _place() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const y = m.y + (Main.panel.visible ? Main.panel.height : 0) + 6;
        this.actor.set_position(Math.round(m.x + (m.width - this.actor.width) / 2), y);
    }

    // transient message; returns to the running activity (if any) afterwards
    flash({icon, gicon, text = '', level = null, maxLevel = 1, ms = 1400}) {
        this._render({icon, gicon, text, level, maxLevel});
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._hideId = 0;
            if (this.activity)
                this.renderActivity();
            else
                this._hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    renderActivity() {
        const a = this.activity;
        if (!a)
            return;
        if (a.kind === 'timer')
            this._render({icon: 'alarm-symbolic', text: fmt((a.end - Date.now()) / 1000)});
        else
            this._render({icon: 'timer-symbolic', text: fmt((Date.now() - a.start) / 1000)});
    }

    _render({icon, gicon, text, level, maxLevel}) {
        if (gicon)
            this._icon.gicon = gicon;
        else
            this._icon.icon_name = icon ?? 'dialog-information-symbolic';
        this._label.text = text ?? '';
        this._label.visible = !!text;
        const hasLevel = typeof level === 'number' && level >= 0;
        this._bar.visible = hasLevel;
        if (hasLevel) {
            const frac = Math.max(0, Math.min(1, level / (maxLevel > 0 ? maxLevel : 1)));
            this._fill.ease({width: Math.round(BAR_W * frac), duration: 90, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        if (!this.actor.visible) {  // morph in
            this.actor.show();
            this._place();
            this.actor.set_scale(0.6, 0.6);
            this.actor.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 220,
                mode: Clutter.AnimationMode.EASE_OUT_BACK});
        } else {
            this.actor.remove_transition('opacity');
            this.actor.opacity = 255;
            this.actor.set_scale(1, 1);
        }
        Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);
    }

    _hide() {
        this.actor.ease({opacity: 0, scale_x: 0.8, scale_y: 0.8, duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_QUAD, onStopped: () => {
                if (this.actor.opacity === 0)
                    this.actor.hide();
            }});
    }
}

export default class IslandExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._island = new Island();
        this._island.onClick = () => this._activityClicked();

        // 1) volume / brightness / caps lock pop-ups
        const proto = OsdWindow.OsdWindowManager.prototype;
        this._origShow = proto._showOsdWindow;
        const self = this;
        proto._showOsdWindow = function (monitorIndex, icon, label, level, maxLevel) {
            if (!self._settings?.get_boolean('replace-osd'))
                return self._origShow.call(this, monitorIndex, icon, label, level, maxLevel);
            if (monitorIndex !== Main.layoutManager.primaryIndex)
                return undefined;
            self._island.flash({gicon: icon, text: label ?? '', level: level ?? null,
                maxLevel: maxLevel > 0 ? maxLevel : 1, ms: 1300});
            return undefined;
        };

        // 2) "Copied"
        this._lastCopied = 0;
        this._selId = global.display.get_selection().connect('owner-changed', (_s, type, source) => {
            if (type !== Meta.SelectionType.SELECTION_CLIPBOARD || !source || !this._settings.get_boolean('show-copied'))
                return;
            const now = Date.now();
            if (now - this._lastCopied < 1500)
                return;
            this._lastCopied = now;
            this._island.flash({icon: 'edit-copy-symbolic', text: 'Copied', ms: 900});
        });

        // 3) Bluetooth connect / disconnect
        this._btIds = [];
        Gio.DBusObjectManagerClient.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusObjectManagerClientFlags.NONE,
            'org.bluez', '/', null, null, (_o, res) => {
                try {
                    this._bt = Gio.DBusObjectManagerClient.new_for_bus_finish(res);
                } catch (e) {
                    return;
                }
                if (!this._island) {
                    this._bt = null;
                    return;
                }
                this._btIds.push(this._bt.connect('interface-proxy-properties-changed',
                    (_m, obj, iface, changed) => this._btChanged(obj, iface, changed)));
            });

        // 4) live activities over D-Bus (`island` command)
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, {
            Timer: secs => this._startTimer(secs),
            Stopwatch: () => this._startStopwatch(),
            Stop: () => this._stopActivity(true),
            Show: (icon, text) => this._island.flash({icon: icon || 'dialog-information-symbolic', text, ms: 2500}),
        });
        this._dbus.export(Gio.DBus.session, '/org/sagar/Island');
        this._nameId = Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.sagar.Island',
            Gio.BusNameOwnerFlags.REPLACE, null, null);
    }

    disable() {
        OsdWindow.OsdWindowManager.prototype._showOsdWindow = this._origShow;
        global.display.get_selection().disconnect(this._selId);
        this._btIds.forEach(id => this._bt?.disconnect(id));
        this._bt = null;
        this._stopActivity(false);
        this._dbus.unexport();
        Gio.bus_unown_name(this._nameId);
        this._island.destroy();
        this._island = null;
        this._settings = null;
    }

    _btChanged(obj, iface, changed) {
        if (iface.get_interface_name() !== 'org.bluez.Device1' || !this._settings.get_boolean('show-bluetooth'))
            return;
        const c = changed.deepUnpack();
        if (!('Connected' in c))
            return;
        const on = c.Connected.deepUnpack?.() ?? c.Connected;
        const name = iface.get_cached_property('Alias')?.unpack() ?? 'Bluetooth device';
        const kind = iface.get_cached_property('Icon')?.unpack() ?? '';
        const icon = /audio-head/.test(kind) ? 'audio-headphones-symbolic'
            : /audio/.test(kind) ? 'audio-speakers-symbolic'
            : /phone/.test(kind) ? 'phone-symbolic' : 'bluetooth-active-symbolic';
        const show = () => {
            const bat = obj.get_interface('org.bluez.Battery1')?.get_cached_property('Percentage')?.unpack();
            this._island?.flash({icon: on ? icon : 'bluetooth-disconnected-symbolic',
                text: on ? `${name} connected${bat !== undefined ? ` · ${bat}%` : ''}` : `${name} disconnected`, ms: 2600});
        };
        // battery level usually arrives a moment after the connection
        if (on)
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                show();
                return GLib.SOURCE_REMOVE;
            });
        else
            show();
    }

    _tick() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            const a = this._island?.activity;
            if (!a) {
                this._tickId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (a.kind === 'timer' && Date.now() >= a.end) {
                this._tickId = 0;
                this._island.activity = null;
                global.display.get_sound_player().play_from_theme('complete', 'Timer finished', null);
                this._island.flash({icon: 'alarm-symbolic', text: "Time's up", ms: 6000});
                Main.notify("Time's up", `Your ${fmt(a.total)} timer has finished.`);
                return GLib.SOURCE_REMOVE;
            }
            if (!this._island._hideId)  // don't overwrite a transient message
                this._island.renderActivity();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _startTimer(secs) {
        if (!secs)
            return;
        this._island.activity = {kind: 'timer', end: Date.now() + secs * 1000, total: secs};
        this._island.flash({icon: 'alarm-symbolic', text: `Timer ${fmt(secs)}`, ms: 1200});
        this._tick();
    }

    _startStopwatch() {
        this._island.activity = {kind: 'stopwatch', start: Date.now()};
        this._island.flash({icon: 'timer-symbolic', text: 'Stopwatch started', ms: 1000});
        this._tick();
    }

    _stopActivity(announce) {
        const a = this._island?.activity;
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        if (!a)
            return;
        this._island.activity = null;
        if (announce)
            this._island.flash({icon: a.kind === 'timer' ? 'alarm-symbolic' : 'timer-symbolic',
                text: a.kind === 'timer' ? 'Timer cancelled' : `Stopwatch ${fmt((Date.now() - a.start) / 1000)}`, ms: 2500});
    }

    _activityClicked() {
        if (this._island.activity)
            this._stopActivity(true);
    }
}
