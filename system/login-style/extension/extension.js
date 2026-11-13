// Login Style v3 - login screen (gdm) + lock screen (unlock-dialog) for the "I Found You" setup
//
//  both screens   4-circle PIN: "Enter PIN" hint, circles pop as they fill, sign-in on the 4th digit,
//                 shake + "Wrong PIN" on failure, circles sweep together and fade on success.
//                 Safety: a letter or more than 4 characters brings the normal password box back.
//  login screen   slowly drifting frosted background, big clock + date + greeting, status chips
//                 (battery, network), a quote, profile cards, no duplicate top-bar clock,
//                 no "Not listed?" button, "i found you" signature, entrance animations.
//  lock screen    status chips at the bottom: weather (terminal welcome cache), notifications, battery.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AuthPrompt from 'resource:///org/gnome/shell/gdm/authPrompt.js';
import * as LoginDialog from 'resource:///org/gnome/shell/gdm/loginDialog.js';
import * as UserWidget from 'resource:///org/gnome/shell/ui/userWidget.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PIN_LEN = 4;
const PIN_RE = /^\d{0,4}$/;
const BG = '/usr/share/backgrounds/sagar-login.jpg';
const QUOTES = '/usr/share/login-style/quotes.txt';
const EASE = Clutter.AnimationMode;

function noEllipsize(label, wrap = false) {
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    if (wrap) {
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
    }
    return label;
}

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch (e) {
        return null;
    }
}

// =====================================================================================
// PIN (both screens)
// =====================================================================================
function setupPin(ap) {
    if (ap._pin || !ap._passwordEntry || !ap._mainBox)
        return;
    const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'pin-box',
        reactive: true, x_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
    const hint = noEllipsize(new St.Label({text: 'Enter PIN', style_class: 'pin-hint', x_align: Clutter.ActorAlign.CENTER}));
    const row = new St.BoxLayout({style_class: 'pin-dots', x_align: Clutter.ActorAlign.CENTER});
    const dots = [];
    for (let i = 0; i < PIN_LEN; i++) {
        const d = new St.Widget({style_class: 'pin-dot', y_align: Clutter.ActorAlign.CENTER});
        d.set_pivot_point(0.5, 0.5);
        row.add_child(d);
        dots.push(d);
    }
    box.add_child(hint);
    box.add_child(row);
    box.connect('button-press-event', () => {
        ap._entry?.grab_key_focus();
        return Clutter.EVENT_STOP;
    });
    ap._pin = {box, hint, row, dots, count: 0, hintTimer: 0};
    ap._mainBox.insert_child_above(box, ap._entry);
    ap._passwordEntry.clutter_text.connect('text-changed', () => onText(ap));
    syncPin(ap);
}

function syncPin(ap) {
    const pin = ap._pin;
    if (!pin)
        return;
    const entry = ap._passwordEntry;
    const text = entry.get_text();
    const pinMode = ap._entry === entry && PIN_RE.test(text);
    if (pin.box.get_parent() === ap._mainBox && ap._entry?.get_parent() === ap._mainBox)
        ap._mainBox.set_child_above_sibling(pin.box, ap._entry);
    pin.box.visible = pinMode;
    entry.opacity = pinMode ? 0 : 255;
    entry.x_expand = !pinMode;
    entry.set_width(pinMode ? 1 : -1);
    pin.dots.forEach((d, i) => {
        const filled = i < text.length;
        if (filled)
            d.add_style_pseudo_class('filled');
        else
            d.remove_style_pseudo_class('filled');
        if (filled && i >= pin.count) {  // newly typed digit: pop
            d.remove_all_transitions();
            d.set_scale(1.55, 1.55);
            d.ease({scale_x: 1, scale_y: 1, duration: 220, mode: EASE.EASE_OUT_BACK});
        }
    });
    pin.count = text.length;
}

function onText(ap) {
    syncPin(ap);
    const entry = ap._passwordEntry;
    const text = entry.get_text();
    if (text.length < PIN_LEN)
        ap._pinSent = null;
    if (/^\d{4}$/.test(text) && ap._entry === entry && entry.reactive && ap._pinSent !== text) {
        ap._pinSent = text;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 140, () => {  // let the last circle pop first
            if (entry.get_text() === text && entry.reactive)
                entry.clutter_text.activate();
            return GLib.SOURCE_REMOVE;
        });
    }
}

function setHint(pin, text, cls, ms) {
    if (pin.hintTimer)
        GLib.source_remove(pin.hintTimer);
    pin.hint.text = text;
    pin.hint.style_class = `pin-hint ${cls ?? ''}`;
    pin.hintTimer = ms ? GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        pin.hintTimer = 0;
        pin.hint.text = 'Enter PIN';
        pin.hint.style_class = 'pin-hint';
        return GLib.SOURCE_REMOVE;
    }) : 0;
}

function pinFailed(ap) {
    const pin = ap._pin;
    if (!pin?.box.visible)
        return;
    setHint(pin, 'Wrong PIN', 'error', 1600);
    const steps = [-16, 13, -9, 6, -3, 0];
    const next = i => {
        if (i < steps.length)
            pin.row.ease({translation_x: steps[i], duration: 45, mode: EASE.EASE_OUT_QUAD, onComplete: () => next(i + 1)});
    };
    next(0);
}

function pinSucceeded(ap) {
    const pin = ap._pin;
    if (!pin?.box.visible)
        return;
    setHint(pin, 'Welcome back', 'ok', 0);
    // the circles sweep into the middle and fade out
    const w = pin.dots[0].width || 18;
    const gap = w + 22;
    pin.dots.forEach((d, i) => {
        d.add_style_pseudo_class('filled');
        d.ease({translation_x: (1.5 - i) * gap, scale_x: 0.5, scale_y: 0.5, opacity: 0,
            duration: 380, delay: 40 * i, mode: EASE.EASE_IN_OUT_CUBIC});
    });
}

function teardownPin(ap) {
    if (!ap?._pin)
        return;
    if (ap._pin.hintTimer)
        GLib.source_remove(ap._pin.hintTimer);
    ap._pin.box.destroy();
    ap._pin = null;
    const e = ap._passwordEntry;
    if (e) {
        e.opacity = 255;
        e.x_expand = true;
        e.set_width(-1);
    }
}

// =====================================================================================
// status chips (battery, network, weather, notifications)
// =====================================================================================
class Chips {
    constructor(kinds) {
        this.box = new St.BoxLayout({style_class: 'ls-chips', x_align: Clutter.ActorAlign.CENTER, reactive: false});
        this._chips = {};
        for (const k of kinds) {
            const chip = new St.BoxLayout({style_class: 'ls-chip', visible: false});
            const icon = new St.Icon({style_class: 'ls-chip-icon', icon_size: 13, y_align: Clutter.ActorAlign.CENTER});
            const label = noEllipsize(new St.Label({style_class: 'ls-chip-label', y_align: Clutter.ActorAlign.CENTER}));
            chip.add_child(icon);
            chip.add_child(label);
            this.box.add_child(chip);
            this._chips[k] = {chip, icon, label};
        }
        this._proxies = [];
        this._timers = [];
        if (this._chips.battery)
            this._watchBattery();
        if (this._chips.network)
            this._watchNetwork();
        if (this._chips.weather)
            this._weather();
        if (this._chips.notes) {
            this._notes();
            this._timers.push(GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 20, () => {
                this._notes();
                return GLib.SOURCE_CONTINUE;
            }));
        }
    }

    _set(k, iconName, text) {
        const c = this._chips[k];
        if (!c)
            return;
        c.chip.visible = !!text;
        c.icon.icon_name = iconName;
        c.label.text = text ?? '';
    }

    _proxy(bus, name, path, iface, cb) {
        Gio.DBusProxy.new_for_bus(bus, Gio.DBusProxyFlags.NONE, null, name, path, iface, null, (_o, res) => {
            try {
                const p = Gio.DBusProxy.new_for_bus_finish(res);
                if (!this._proxies)
                    return;
                this._proxies.push(p);
                cb(p);
            } catch (e) {}
        });
    }

    _watchBattery() {
        this._proxy(Gio.BusType.SYSTEM, 'org.freedesktop.UPower', '/org/freedesktop/UPower/devices/DisplayDevice',
            'org.freedesktop.UPower.Device', p => {
                const update = () => {
                    if (!p.get_cached_property('IsPresent')?.unpack())
                        return this._set('battery', '', null);
                    const pct = Math.round(p.get_cached_property('Percentage')?.unpack() ?? 0);
                    const state = p.get_cached_property('State')?.unpack();  // 1 charging, 4 full
                    const lvl = Math.min(100, Math.round(pct / 10) * 10);
                    const charging = state === 1 || state === 4;
                    this._set('battery', `battery-level-${lvl}${charging ? '-charging' : ''}-symbolic`,
                        `${pct}%${state === 1 ? ' · charging' : ''}`);
                };
                p.connect('g-properties-changed', update);
                update();
            });
    }

    _watchNetwork() {
        this._proxy(Gio.BusType.SYSTEM, 'org.freedesktop.NetworkManager', '/org/freedesktop/NetworkManager',
            'org.freedesktop.NetworkManager', nm => {
                const update = () => {
                    const path = nm.get_cached_property('PrimaryConnection')?.unpack();
                    if (!path || path === '/')
                        return this._set('network', 'network-offline-symbolic', 'Offline');
                    this._proxy(Gio.BusType.SYSTEM, 'org.freedesktop.NetworkManager', path,
                        'org.freedesktop.NetworkManager.Connection.Active', ac => {
                            const id = ac.get_cached_property('Id')?.unpack() ?? 'Connected';
                            const type = ac.get_cached_property('Type')?.unpack() ?? '';
                            const icon = type.includes('wireless') ? 'network-wireless-signal-good-symbolic'
                                : type.includes('vpn') ? 'network-vpn-symbolic' : 'network-wired-symbolic';
                            this._set('network', icon, id);
                        });
                };
                nm.connect('g-properties-changed', update);
                update();
            });
    }

    _weather() {
        const t = readText(GLib.build_filenamev([GLib.get_home_dir(), '.cache', 'welcome', 'weather']));
        const w = t?.trim().replace(/^\+/, '');
        if (!w)
            return;
        const lw = w.toLowerCase();
        const icon = lw.includes('rain') || lw.includes('drizzle') ? 'weather-showers-symbolic'
            : lw.includes('snow') ? 'weather-snow-symbolic'
            : lw.includes('thunder') ? 'weather-storm-symbolic'
            : lw.includes('fog') || lw.includes('mist') || lw.includes('haze') ? 'weather-fog-symbolic'
            : lw.includes('partly') ? 'weather-few-clouds-symbolic'
            : lw.includes('cloud') || lw.includes('overcast') ? 'weather-overcast-symbolic'
            : 'weather-clear-symbolic';
        this._set('weather', icon, w);
    }

    _notes() {
        let n = 0;
        try {
            for (const s of Main.messageTray.getSources())
                n += s.notifications?.length ?? s.count ?? 0;
        } catch (e) {}
        this._set('notes', 'preferences-system-notifications-symbolic',
            n ? `${n} notification${n > 1 ? 's' : ''}` : null);
    }

    destroy() {
        this._timers.forEach(id => GLib.source_remove(id));
        this._proxies = null;
        this.box.destroy();
    }
}

// =====================================================================================
// login screen: drifting background, clock block, signature
// =====================================================================================
class DriftingBackground {
    constructor(group) {
        const m = Main.layoutManager.primaryMonitor;
        const W = Math.round(m.width * 1.12), H = Math.round(m.height * 1.12);
        this.actor = new St.Widget({style_class: 'ls-drift', width: W, height: H, reactive: false,
            x: m.x - Math.round((W - m.width) / 2), y: m.y - Math.round((H - m.height) / 2)});
        this.actor.set_pivot_point(0.5, 0.5);
        group.insert_child_at_index(this.actor, 0);
        this._step = 0;
        this.actor.opacity = 0;
        this.actor.ease({opacity: 255, duration: 900, mode: EASE.EASE_OUT_QUAD});
        this._drift();
    }

    _drift() {  // very slow Ken Burns: alternate between two framings, 45 s each
        if (!this.actor)
            return;
        const poses = [{scale: 1.0, x: -18, y: 6}, {scale: 1.07, x: 22, y: -10}];
        const p = poses[this._step++ % 2];
        this.actor.ease({scale_x: p.scale, scale_y: p.scale, translation_x: p.x, translation_y: p.y,
            duration: 45000, mode: EASE.EASE_IN_OUT_SINE, onComplete: () => this._drift()});
    }

    destroy() {
        const a = this.actor;
        this.actor = null;
        a?.destroy();
    }
}

class LoginClock {
    constructor(group) {
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this.box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'ls-clock', reactive: false});
        this._time = noEllipsize(new St.Label({style_class: 'ls-time', x_align: Clutter.ActorAlign.CENTER}));
        this._date = noEllipsize(new St.Label({style_class: 'ls-date', x_align: Clutter.ActorAlign.CENTER}));
        this._line = new St.Widget({style_class: 'ls-line', x_align: Clutter.ActorAlign.CENTER});
        this._greet = noEllipsize(new St.Label({style_class: 'ls-greet', x_align: Clutter.ActorAlign.CENTER}));
        this._chips = new Chips(['battery', 'network']);
        this._quote = noEllipsize(new St.Label({style_class: 'ls-quote', x_align: Clutter.ActorAlign.CENTER}), true);
        [this._time, this._date, this._line, this._greet, this._chips.box, this._quote].forEach(a => this.box.add_child(a));
        this.sign = noEllipsize(new St.Label({style_class: 'ls-sign', text: 'i   f o u n d   y o u', reactive: false}));
        group.insert_child_above(this.box, null);
        group.insert_child_above(this.sign, null);
        // keep them below the dialog so clicks reach it
        const dialog = Main.screenShield?._dialog;
        if (dialog?.get_parent() === group) {
            group.set_child_below_sibling(this.box, dialog);
            group.set_child_below_sibling(this.sign, dialog);
        }
        this._ids = [this.box.connect('notify::width', () => this._place()),
            this.box.connect('notify::height', () => this._place()),
            this.sign.connect('notify::width', () => this._place())];
        this._monId = Main.layoutManager.connect('monitors-changed', () => this._place());
        this._fmtId = this._iface.connect('changed::clock-format', () => this._update());
        this._pickQuote();
        this._update();
        this._schedule();
        this._enter();
    }

    _enter() {  // staggered entrance
        const parts = [this._time, this._date, this._line, this._greet, this._chips.box, this._quote];
        parts.forEach((a, i) => {
            a.opacity = 0;
            a.translation_y = -14;
            a.ease({opacity: 255, translation_y: 0, duration: 650, delay: 120 + i * 90, mode: EASE.EASE_OUT_CUBIC});
        });
        this._line.set_pivot_point(0.5, 0.5);
        this._line.scale_x = 0;
        this._line.ease({scale_x: 1, duration: 700, delay: 380, mode: EASE.EASE_OUT_CUBIC});
        this.sign.opacity = 0;
        this.sign.ease({opacity: 255, duration: 1200, delay: 900, mode: EASE.EASE_OUT_QUAD});
    }

    _pickQuote() {
        const lines = (readText(QUOTES) ?? '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        if (!lines.length) {
            this._quote.visible = false;
            return;
        }
        const q = lines[Math.floor(Math.random() * lines.length)];
        const [text, author] = q.split(/\s+[—–-]\s+(?=[^—–-]+$)/);
        this._quote.text = author ? `“${text}”  — ${author}` : `“${q}”`;
    }

    _place() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const panelH = Main.panel?.visible ? Main.panel.height : 0;
        this.box.set_position(Math.round(m.x + (m.width - this.box.width) / 2), Math.round(m.y + panelH + m.height * 0.045));
        this.sign.set_position(Math.round(m.x + (m.width - this.sign.width) / 2), Math.round(m.y + m.height - 46));
    }

    _update() {
        const now = GLib.DateTime.new_now_local();
        const h24 = this._iface.get_string('clock-format') === '24h';
        this._time.text = now.format(h24 ? '%H:%M' : '%-I:%M');
        this._date.text = now.format('%A, %-d %B');
        const h = now.get_hour();
        this._greet.text = h < 5 ? 'Up late?' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon'
            : h < 22 ? 'Good evening' : 'Good night';
        this._place();
    }

    _schedule() {
        const secs = 60 - GLib.DateTime.new_now_local().get_second();
        this._tick = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
            this._update();
            this._schedule();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._tick)
            GLib.source_remove(this._tick);
        Main.layoutManager.disconnect(this._monId);
        this._iface.disconnect(this._fmtId);
        this._chips.destroy();
        this.box.destroy();
        this.sign.destroy();
    }
}

// profile card: avatar above the name, entrance pop
function cardify(item) {
    if (item._lsCard || !item._userWidget)
        return;
    const layout = item.get_child();
    const old = item._userWidget;
    const card = new UserWidget.UserWidget(item.user, Clutter.Orientation.VERTICAL);
    layout.replace_child(old, card);
    old.destroy();
    item._userWidget = card;
    card.bind_property('label-actor', item, 'label-actor', 2 /* SYNC_CREATE */);
    item.x_expand = false;
    item.add_style_class_name('ls-card');
    item._lsCard = true;
    item.set_pivot_point(0.5, 0.5);
    item.opacity = 0;
    item.set_scale(0.9, 0.9);
    item.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 600, delay: 500, mode: EASE.EASE_OUT_BACK});
}

// =====================================================================================
export default class LoginStyleExtension extends Extension {
    enable() {
        this._greeter = Main.sessionMode.isGreeter;
        const proto = AuthPrompt.AuthPrompt.prototype;
        const orig = this._orig = {
            init: proto._initInputRow,
            update: proto._updateEntry,
            failed: proto._onVerificationFailed,
            complete: proto._onVerificationComplete,
        };
        const guard = (fn, ...a) => {
            try {
                fn(...a);
            } catch (e) {
                console.error(`login-style: ${e}`);
            }
        };
        proto._initInputRow = function (...args) {
            const r = orig.init.apply(this, args);
            guard(setupPin, this);
            return r;
        };
        proto._updateEntry = function (...args) {
            const r = orig.update.apply(this, args);
            guard(syncPin, this);
            return r;
        };
        proto._onVerificationFailed = function (...args) {
            const r = orig.failed.apply(this, args);
            guard(pinFailed, this);
            return r;
        };
        proto._onVerificationComplete = function (...args) {
            const r = orig.complete.apply(this, args);
            guard(pinSucceeded, this);
            return r;
        };
        if (this._greeter) {
            const cardProto = LoginDialog.UserListItem.prototype;
            const origCard = this._origCardInit = cardProto._init;
            cardProto._init = function (...args) {
                const r = origCard.apply(this, args);
                guard(cardify, this);
                return r;
            };
        }
        this._tries = 0;
        this._waitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => this._attach() ? GLib.SOURCE_REMOVE
            : (++this._tries < 120 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE));
        this._attach();
    }

    _attach() {
        const shield = Main.screenShield;
        const dialog = shield?._dialog;
        const group = shield?._lockDialogGroup;
        if (!dialog || !group)
            return false;
        if (this._waitId) {
            GLib.source_remove(this._waitId);
            this._waitId = 0;
        }
        try {
            this._dialog = dialog;
            if (dialog._authPrompt)
                setupPin(dialog._authPrompt);
            if (this._greeter)
                this._decorateLogin(dialog, group);
            else
                this._decorateLock(group);
        } catch (e) {
            console.error(`login-style: ${e}`);
        }
        return true;
    }

    _decorateLogin(dialog, group) {
        // drifting background behind everything
        this._bg ??= new DriftingBackground(group);
        // profile cards side by side
        const list = dialog._userList;
        if (list?._box) {
            list._box.orientation = Clutter.Orientation.HORIZONTAL;
            list._box.x_align = Clutter.ActorAlign.CENTER;
            list._box.get_children().forEach(cardify);
            this._listBox = list._box;
            this._listId = list._box.connect('child-added', (_b, child) => cardify(child));
        }
        // single-user laptop: no "Not listed?"
        const nl = dialog._notListedButton;
        if (nl) {
            nl.hide();
            this._nl = nl;
            this._nlId = nl.connect('show', () => nl.hide());
        }
        // the big clock replaces the small top-bar one
        this._dateMenu = Main.panel?.statusArea?.dateMenu?.container ?? null;
        this._dateMenu?.hide();
        this._clock ??= new LoginClock(group);
    }

    _decorateLock(group) {
        if (this._lockChips)
            return;
        this._lockChips = new Chips(['weather', 'notes', 'battery']);
        const box = this._lockChips.box;
        box.add_style_class_name('ls-lock-chips');
        group.insert_child_above(box, null);
        const place = () => {
            const m = Main.layoutManager.primaryMonitor;
            if (m)
                box.set_position(Math.round(m.x + (m.width - box.width) / 2), Math.round(m.y + m.height - 74));
        };
        box.connect('notify::width', place);
        place();
        box.opacity = 0;
        box.ease({opacity: 255, duration: 700, delay: 300, mode: EASE.EASE_OUT_QUAD});
    }

    disable() {
        const proto = AuthPrompt.AuthPrompt.prototype;
        proto._initInputRow = this._orig.init;
        proto._updateEntry = this._orig.update;
        proto._onVerificationFailed = this._orig.failed;
        proto._onVerificationComplete = this._orig.complete;
        if (this._origCardInit)
            LoginDialog.UserListItem.prototype._init = this._origCardInit;
        this._origCardInit = null;
        if (this._waitId)
            GLib.source_remove(this._waitId);
        this._waitId = 0;
        if (this._listId)
            this._listBox?.disconnect(this._listId);
        this._listId = 0;
        if (this._nlId)
            this._nl?.disconnect(this._nlId);
        this._nlId = 0;
        this._dateMenu?.show();
        this._dateMenu = null;
        this._clock?.destroy();
        this._clock = null;
        this._bg?.destroy();
        this._bg = null;
        this._lockChips?.destroy();
        this._lockChips = null;
        teardownPin(this._dialog?._authPrompt);
        teardownPin(Main.screenShield?._dialog?._authPrompt);
        this._dialog = null;
    }
}
