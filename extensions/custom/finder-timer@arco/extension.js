// Timers: Android-style timers for the File Finder (> timer 25, > timer 10 tea).
//
//  * top bar, next to the clock: a countdown of the soonest timer (paused ones show a
//    pause sign); click it for the list
//  * while running: a notification in the notification list (no popup) with
//    Pause / Resume, +1 min and Cancel, showing when it ends
//  * when it ends: an alarm notification that stays on screen, with the alarm sound
//    repeating until Stop (or +1 min, which starts it again for one more minute)
//
// The timers live in ~/.local/state/file-finder/timers.json, so they survive restarts
// and logouts. Ticks once a second only while a timer is running.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const FILE = GLib.build_filenamev([GLib.get_user_state_dir(), 'file-finder', 'timers.json']);
const ALARM_EVERY_MS = 6500;  // the alarm sound (a 6 s clip) repeats right after it ends...
const ALARM_FOR_S = 180;      // ...for at most this long, then the notification stays silent
const ALARM_SOUNDS = ['alarm-clock-elapsed', 'complete', 'bell'];

function fmt(secs) {
    secs = Math.max(0, Math.ceil(secs));
    const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function clock(unix) {
    return GLib.DateTime.new_from_unix_local(Math.round(unix)).format('%H:%M');
}

function name(t) {
    return t.label || `${fmt(t.secs ?? 0)} timer`;
}

function load() {
    try {
        const [ok, bytes] = GLib.file_get_contents(FILE);
        const data = ok ? JSON.parse(new TextDecoder().decode(bytes)) : [];
        return Array.isArray(data) ? data.filter(t => t && typeof t.end === 'number' && t.id) : [];
    } catch (e) {
        return [];
    }
}

function save(timers) {
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(FILE), 0o755);
        const tmp = `${FILE}.tmp`;
        GLib.file_set_contents(tmp, JSON.stringify(timers.sort((a, b) => a.end - b.end), null, 1));
        Gio.File.new_for_path(tmp).move(Gio.File.new_for_path(FILE), Gio.FileCopyFlags.OVERWRITE, null, null);
    } catch (e) {
        console.error(`finder-timer: ${e.message}`);
    }
}

export default class FinderTimerExtension extends Extension {
    enable() {
        this._timers = [];
        this._running = new Map();  // timer id -> its "running" notification
        this._alarms = new Map();   // timer id -> {notification, soundId, started, cancel}

        this._button = new PanelMenu.Button(0.5, 'Timers');
        const box = new St.BoxLayout({style_class: 'finder-timer', y_align: Clutter.ActorAlign.CENTER});
        this._icon = new St.Icon({icon_name: 'alarm-symbolic', style_class: 'finder-timer-icon'});
        box.add_child(this._icon);
        this._label = new St.Label({style_class: 'finder-timer-label', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._label);
        this._button.add_child(box);
        this._button.menu.connect('open-state-changed', (_m, open) => open && this._buildMenu());
        Main.panel.addToStatusArea('finder-timer', this._button, 1, 'center');

        const dir = Gio.File.new_for_path(GLib.path_get_dirname(FILE));
        GLib.mkdir_with_parents(dir.get_path(), 0o755);
        this._monitor = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._monitor.connect('changed', (_m, f, o) => {
            if ([f, o].some(x => x?.get_basename() === 'timers.json'))
                this._reload();
        });
        this._reload();
    }

    disable() {
        if (this._tick)
            GLib.source_remove(this._tick);
        this._tick = 0;
        this._monitor.cancel();
        this._monitor = null;
        for (const id of [...this._alarms.keys()])
            this._stopAlarm(id);
        this._source?.destroy();
        this._source = null;
        this._running.clear();
        this._button.destroy();
        this._button = this._label = this._icon = null;
    }

    // ---------- state ----------
    _reload() {
        this._timers = load();
        this._update();
    }

    _write() {
        save(this._timers);
        this._update();
    }

    _find(id) {
        return this._timers.find(t => t.id === id);
    }

    _update() {
        const now = Date.now() / 1000;
        const due = this._timers.filter(t => !t.paused && t.end <= now);
        if (due.length) {
            this._timers = this._timers.filter(t => !due.includes(t));
            save(this._timers);
            for (const t of due)
                this._ring(t, now);
        }
        this._syncRunning();

        const active = this._timers.filter(t => !t.paused).sort((a, b) => a.end - b.end);
        const shown = active[0] ?? this._timers[0];
        this._button.visible = Boolean(shown);
        if (shown) {
            const left = shown.paused ? shown.paused : shown.end - now;
            const more = this._timers.length > 1 ? `  +${this._timers.length - 1}` : '';
            this._label.text = fmt(left) + more;
            this._icon.icon_name = shown.paused ? 'media-playback-pause-symbolic' : 'alarm-symbolic';
            if (!shown.paused && left <= 60)
                this._label.add_style_class_name('finder-timer-soon');
            else
                this._label.remove_style_class_name('finder-timer-soon');
        }
        const ticking = active.length > 0;
        if (ticking && !this._tick) {
            this._tick = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._update();
                return this._tick ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            });
        } else if (!ticking && this._tick) {
            GLib.source_remove(this._tick);
            this._tick = 0;
        }
    }

    // ---------- actions ----------
    _pause(id) {
        const t = this._find(id);
        if (t && !t.paused) {
            t.paused = Math.max(1, t.end - Date.now() / 1000);
            this._write();
        }
    }

    _resume(id) {
        const t = this._find(id);
        if (t?.paused) {
            t.end = Date.now() / 1000 + t.paused;
            delete t.paused;
            this._write();
        }
    }

    _addMinute(id) {
        const t = this._find(id);
        if (!t)
            return;
        if (t.paused)
            t.paused += 60;
        else
            t.end += 60;
        t.secs = (t.secs ?? 0) + 60;
        this._write();
    }

    _cancel(id) {
        this._timers = id ? this._timers.filter(t => t.id !== id) : [];
        this._write();
    }

    _again(t) {  // "+1 min" on a finished timer: one more minute, same name
        this._stopAlarm(t.id);
        this._timers.push({id: GLib.uuid_string_random().slice(0, 8), end: Date.now() / 1000 + 60,
            secs: 60, label: t.label || ''});
        this._write();
    }

    // ---------- notifications ----------
    _getSource() {
        if (!this._source) {
            this._source = new MessageTray.Source({title: 'Timers', iconName: 'alarm-symbolic'});
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
        return this._source;
    }

    // one quiet notification per running timer, kept in step with the timers file
    _syncRunning() {
        const ids = new Set(this._timers.map(t => t.id));
        for (const [id, n] of this._running) {
            if (!ids.has(id)) {
                this._running.delete(id);
                n.destroy();
            }
        }
        for (const t of this._timers) {
            let n = this._running.get(t.id);
            const state = `${t.paused ? 'p' : 'r'}:${Math.round(t.paused ?? t.end)}`;
            if (n && n._timerState === state)
                continue;
            if (!n) {
                n = new MessageTray.Notification({source: this._getSource(), resident: true,
                    iconName: 'alarm-symbolic'});
                n.acknowledged = true;  // straight into the list, no popup (like Android)
                n.connect('destroy', () => {
                    if (this._running.get(t.id) === n)
                        this._running.delete(t.id);
                });
                this._running.set(t.id, n);
                this._getSource().addNotification(n);
            }
            n._timerState = state;
            n.title = `Timer · ${name(t)}`;
            n.body = t.paused ? `Paused · ${fmt(t.paused)} left` : `Ends at ${clock(t.end)}`;
            n.clearActions();
            if (t.paused)
                n.addAction('Resume', () => this._resume(t.id));
            else
                n.addAction('Pause', () => this._pause(t.id));
            n.addAction('+1 min', () => this._addMinute(t.id));
            n.addAction('Cancel', () => this._cancel(t.id));
        }
    }

    _ring(t, now) {
        this._running.get(t.id)?.destroy();
        this._running.delete(t.id);
        const late = now - t.end > 60;  // ended while logged out
        const n = new MessageTray.Notification({
            source: this._getSource(),
            title: `Time's up · ${name(t)}`,
            body: late ? `Ended at ${clock(t.end)}` : `${fmt(t.secs ?? 0)} timer · ${clock(t.end)}`,
            iconName: 'alarm-symbolic',
            urgency: MessageTray.Urgency.CRITICAL,  // stays on screen until handled
            resident: true,
        });
        n.addAction('Stop', () => {
            this._stopAlarm(t.id);
            n.destroy();
        });
        n.addAction('+1 min', () => {
            this._again(t);
            n.destroy();
        });
        n.connect('activated', () => this._stopAlarm(t.id));
        n.connect('destroy', () => this._stopAlarm(t.id));
        this._getSource().addNotification(n);

        if (late)
            return;  // no alarm for a timer that ended long ago
        // one cancellable for every play of this alarm: cancelling it cuts the sound off
        // at once, instead of letting the clip that is playing run to its end
        const alarm = {notification: n, started: now, soundId: 0, cancel: new Gio.Cancellable()};
        this._alarms.set(t.id, alarm);
        this._playAlarm(alarm);
        alarm.soundId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ALARM_EVERY_MS, () => {
            if (Date.now() / 1000 - alarm.started > ALARM_FOR_S) {
                alarm.soundId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._playAlarm(alarm);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _playAlarm(alarm) {
        if (alarm.cancel.is_cancelled())
            return;
        const player = global.display.get_sound_player();
        for (const sound of ALARM_SOUNDS) {
            try {
                player.play_from_theme(sound, 'Timer finished', alarm.cancel);
                return;
            } catch (e) {}
        }
    }

    _stopAlarm(id) {
        const alarm = this._alarms.get(id);
        if (!alarm)
            return;
        this._alarms.delete(id);
        if (alarm.soundId)
            GLib.source_remove(alarm.soundId);
        alarm.cancel.cancel();  // stops the clip that is playing right now
    }

    // ---------- top bar menu ----------
    _buildMenu() {
        const menu = this._button.menu;
        menu.removeAll();
        const now = Date.now() / 1000;
        for (const t of this._timers) {
            const item = new PopupMenu.PopupBaseMenuItem({activate: false});
            const row = new St.BoxLayout({style_class: 'finder-timer-row', x_expand: true});
            row.add_child(new St.Label({text: name(t), x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
            row.add_child(new St.Label({
                text: t.paused ? `paused · ${fmt(t.paused)}` : `${fmt(t.end - now)} left`,
                style_class: 'finder-timer-left', y_align: Clutter.ActorAlign.CENTER,
            }));
            const btn = (icon, label, cb) => {
                const b = new St.Button({style_class: 'finder-timer-btn', can_focus: true,
                    accessible_name: label, child: new St.Icon({icon_name: icon, icon_size: 14})});
                b.connect('clicked', () => {
                    cb();
                    menu.close();
                });
                row.add_child(b);
            };
            if (t.paused)
                btn('media-playback-start-symbolic', 'Resume', () => this._resume(t.id));
            else
                btn('media-playback-pause-symbolic', 'Pause', () => this._pause(t.id));
            btn('list-add-symbolic', 'Add a minute', () => this._addMinute(t.id));
            btn('window-close-symbolic', 'Cancel', () => this._cancel(t.id));
            item.add_child(row);
            menu.addMenuItem(item);
        }
        if (this._timers.length > 1) {
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            menu.addAction('Cancel all', () => this._cancel(null));
        }
    }
}
