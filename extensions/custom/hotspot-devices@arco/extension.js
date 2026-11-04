// Hotspot Devices: an Android-style "Hotspot" tile in Quick Settings.
// Tap the tile to turn the hotspot on/off; open its menu to see connected devices
// (Kick / Block), blocked devices (Unblock) and trusted devices (Forget).
// Everything goes through /usr/local/sbin/hotspot-guard via a password-free sudo rule.
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const GUARD = '/usr/local/sbin/hotspot-guard';
const BIN = `${GLib.get_home_dir()}/.local/bin`;  // hotspot + stay-awake helpers
const ICON = 'network-wireless-hotspot-symbolic';
const OPEN_POLL_S = 3;   // while the menu is open
const IDLE_POLL_S = 20;  // otherwise, just for the tile's subtitle

async function run(argv) {
    const p = Gio.Subprocess.new(argv,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [out, err] = await p.communicate_utf8_async(null, null);
    if (!p.get_successful())
        throw new Error((err || out || '').trim() || `${argv.join(' ')} failed`);
    return out;
}

const guard = (...args) => run(['sudo', '-n', GUARD, ...args]);

function parse(out) {
    const s = {active: false, connected: [], blocked: [], trusted: []};
    for (const line of out.split('\n')) {
        const [k, mac, name, ip, trusted] = line.split('\t');
        const label = !name || name === 'Unknown-device' ? 'Unknown device' : name;
        if (k === 'active')
            s.active = mac === '1';
        else if (k === 'C')
            s.connected.push({mac, name: label, ip, trusted: trusted === '1'});
        else if (k === 'B')
            s.blocked.push({mac, name: label});
        else if (k === 'T')
            s.trusted.push({mac, name: label});
    }
    return s;
}

const HotspotToggle = GObject.registerClass(
class HotspotToggle extends QuickSettings.QuickMenuToggle {
    _init() {
        super._init({title: 'Hotspot', iconName: ICON, toggleMode: false});
        this.menu.setHeader(ICON, 'Hotspot');
        // keeps the laptop from sleeping (even with the lid closed); turns on by itself
        // with the hotspot, and can be switched by hand here
        this._awake = new PopupMenu.PopupSwitchMenuItem('Stay awake', false);
        this._awake.connect('toggled', (_i, on) => this._setAwake(on));
        this.menu.addMenuItem(this._awake);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        // the device list scrolls, so a long list never runs off the screen
        this._list = new PopupMenu.PopupMenuSection();
        this._scroll = new St.ScrollView({style_class: 'hsd-scroll', overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        this._scroll.child = this._list.actor;
        const holder = new PopupMenu.PopupMenuSection();
        holder.actor.add_child(this._scroll);
        this.menu.addMenuItem(holder);
        this._showTrusted = false;
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Hotspot settings', () => {
            Main.panel.closeQuickSettings?.();
            run(['gnome-control-center', 'wifi']).catch(() => {});
        });

        this._busy = false;
        this._error = null;
        this._state = parse('');
        this.connect('clicked', () => this._toggleHotspot());
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open) {
                this._showTrusted = false;  // always opens compact
                this._fitHeight();
                this.refresh();
            }
            this._schedule(open ? OPEN_POLL_S : IDLE_POLL_S);
        });
        this.connect('destroy', () => {
            this._schedule(0);
            if (this._fitId)
                GLib.source_remove(this._fitId);
            this._layer?.destroy();
            this._layer = null;
        });
        this._schedule(IDLE_POLL_S);
        this.refresh();
    }

    // Float the menu as a card over the tiles instead of opening inline (which pushes
    // the tiles below it down). The card lives in its own layer inside the Quick
    // Settings panel, so it shares the panel's input grab; clicking beside it closes it.
    makeFloating(qsMenu) {
        const overlay = qsMenu._overlay, grid = qsMenu._grid;
        const card = this.menu.actor;
        if (!overlay || !grid || card.get_parent() !== overlay)
            return;  // unexpected GNOME layout: keep the normal inline menu
        this._layer = new St.Widget({reactive: true, visible: false});
        this._layer.add_constraint(new Clutter.BindConstraint({
            coordinate: Clutter.BindCoordinate.POSITION, source: overlay}));
        this._layer.add_constraint(new Clutter.BindConstraint({
            coordinate: Clutter.BindCoordinate.WIDTH, source: overlay}));
        this._layer.add_constraint(new Clutter.BindConstraint({
            coordinate: Clutter.BindCoordinate.HEIGHT, source: grid}));
        qsMenu.actor.add_child(this._layer);

        for (const c of card.get_constraints())
            card.remove_constraint(c);  // drop "sit just below the tile"
        overlay.remove_child(card);
        this._layer.add_child(card);
        card.add_constraint(new Clutter.BindConstraint({
            coordinate: Clutter.BindCoordinate.WIDTH, source: this._layer}));
        this.menu.box.add_style_class_name('hsd-float');

        this._grid = grid;
        this._layer.connect('button-press-event', (_a, ev) => {
            if (ev.get_source() !== this._layer)
                return Clutter.EVENT_PROPAGATE;
            this.menu.close(true);
            return Clutter.EVENT_STOP;
        });
        this._layer.connect('touch-event', (_a, ev) => {
            if (ev.type() !== Clutter.EventType.TOUCH_BEGIN || ev.get_source() !== this._layer)
                return Clutter.EVENT_PROPAGATE;
            this.menu.close(true);
            return Clutter.EVENT_STOP;
        });
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open) {
                this._layer.show();
                this._placeCard();
            }
        });
        this.menu.connect('menu-closed', () => this._layer.hide());
    }

    _placeCard() {
        if (!this._layer)
            return;
        // start level with the tile, slide up only as far as needed to stay on screen
        const card = this.menu.actor;
        const [, cardH] = this.menu.box.get_preferred_height(this._layer.width);
        const [, gy] = this._grid.get_transformed_position();
        const m = Main.layoutManager.findMonitorForActor(this) ?? Main.layoutManager.primaryMonitor;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const bottom = m ? m.y + m.height - gy - 12 * scale : this._grid.height;
        const y = Math.max(0, Math.min(this.y, bottom - cardH));
        card.set_position(0, Math.round(y));
    }

    _fitHeight() {
        // let the list use only the space left between this tile and the bottom of the
        // screen (minus the menu's header, switch and settings rows), so it never overflows
        if (this._fitId)
            return;
        this._fitId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._fitId = 0;
            const m = Main.layoutManager.findMonitorForActor(this) ??
                Main.layoutManager.primaryMonitor;
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            if (!m || !this.menu.isOpen)
                return GLib.SOURCE_REMOVE;
            const [, y] = this._layer ? this._grid.get_transformed_position()
                : this.get_transformed_position();
            const top = this._layer ? y : y + this.height;
            const [, menuH] = this.menu.box.get_preferred_height(-1);
            const [, listH] = this._scroll.get_preferred_height(-1);
            const chrome = menuH - Math.min(listH, this._scroll.height || listH);
            const room = m.y + m.height - top - chrome - 28 * scale;
            const h = Math.max(110, Math.floor(room / scale));
            this._scroll.style = `max-height: ${h}px;`;
            this._placeCard();
            return GLib.SOURCE_REMOVE;
        });
    }

    _schedule(seconds) {
        if (this._pollId)
            GLib.source_remove(this._pollId);
        this._pollId = 0;
        if (seconds)
            this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, seconds, () => {
                this.refresh();
                return GLib.SOURCE_CONTINUE;
            });
    }

    async refresh() {
        if (this._busy)
            return;
        try {
            this._state = parse(await guard('status'));
            this._error = null;
        } catch (e) {
            this._error = e.message;
        }
        this._awakeOn = await run([`${BIN}/stay-awake`, 'status']).then(() => true, () => false);
        this._render();
        if (this.menu.isOpen)
            this._fitHeight();
    }

    async _do(action, mac) {
        this._busy = true;
        try {
            await guard(action, mac);
        } catch (e) {
            Main.notifyError('Hotspot', e.message);
        }
        this._busy = false;
        await this.refresh();
    }

    async _setAwake(on) {
        await run([`${BIN}/stay-awake`, on ? 'on' : 'off']).catch(() => {});
        await this.refresh();
    }

    async _toggleHotspot() {
        const on = !this._state.active;
        this.checked = on;
        this.subtitle = on ? 'Turning on…' : 'Turning off…';
        try {
            // also switches Wi-Fi on first and retries; it shows its own error popup
            await run([`${BIN}/hotspot`, on ? 'on' : 'off']);
        } catch {}
        await this.refresh();
    }

    _render() {
        const s = this._state;
        this.checked = s.active;
        this._awake.setToggleState(!!this._awakeOn);
        const n = s.connected.length, b = s.blocked.length;
        this.subtitle = !s.active ? (b ? `Off · ${b} blocked` : 'Off')
            : `${n} connected${b ? ` · ${b} blocked` : ''}`;

        this._list.removeAll();
        if (this._error) {
            this._heading('Needs setup');
            this._row('Run the repo installer again', 'sudo rule for hotspot-guard is missing', []);
            return;
        }

        this._heading('Connected');
        if (!s.active)
            this._row('Hotspot is off', null, []);
        else if (!n)
            this._row('No devices connected', null, []);
        for (const d of s.connected) {
            this._row(d.name, `${d.ip}${d.trusted ? '  ·  trusted' : ''}`, [
                ['Kick', () => this._do('kick', d.mac)],
                ['Block', () => this._do('block', d.mac), 'danger'],
            ]);
        }

        this._heading('Blocked');
        if (!b)
            this._row('No blocked devices', null, []);
        for (const d of s.blocked)
            this._row(d.name, d.mac, [['Unblock', () => this._do('unblock', d.mac), 'accent']]);

        if (s.trusted.length) {
            // collapsed by default (like Android's "see all"): tap to show or hide
            const t = this._showTrusted;
            this._row(`Trusted devices (${s.trusted.length})`, t ? null : 'Tap Show to see them', [
                [t ? 'Hide' : 'Show', () => {
                    this._showTrusted = !t;
                    this._render();
                    this._fitHeight();
                }],
            ], 'hsd-fold');
            if (t) {
                for (const d of s.trusted)
                    this._row(d.name, d.mac, [['Forget', () => this._do('untrust', d.mac)]]);
            }
        }
    }

    _heading(text) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false, can_focus: false});
        item.add_style_class_name('hsd-heading');
        this._list.addMenuItem(item);
    }

    _row(title, sub, buttons, extraClass) {
        const item = new PopupMenu.PopupBaseMenuItem({can_focus: false, style_class: 'hsd-row'});
        if (extraClass)
            item.add_style_class_name(extraClass);
        item.activate = () => {};  // rows themselves do nothing; only their buttons act
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        text.add_child(new St.Label({text: title, style_class: 'hsd-name'}));
        if (sub)
            text.add_child(new St.Label({text: sub, style_class: 'hsd-sub'}));
        item.add_child(text);
        for (const [label, cb, kind] of buttons) {
            const btn = new St.Button({label, can_focus: true, y_align: Clutter.ActorAlign.CENTER,
                style_class: `hsd-btn${kind ? ` hsd-${kind}` : ''}`});
            btn.connect('clicked', () => {
                if (extraClass !== 'hsd-fold') {
                    btn.reactive = false;
                    btn.label = '…';
                }
                cb();
            });
            item.add_child(btn);
        }
        this._list.addMenuItem(item);
    }
});

const HotspotIndicator = GObject.registerClass(
class HotspotIndicator extends QuickSettings.SystemIndicator {
    _init() {
        super._init();
        this.quickSettingsItems.push(new HotspotToggle());
    }
});

export default class HotspotDevicesExtension extends Extension {
    enable() {
        this._indicator = new HotspotIndicator();
        const qs = Main.panel.statusArea.quickSettings;
        qs.addExternalIndicator(this._indicator);
        // move the tile up next to Wi-Fi / Bluetooth so its menu opens high on the panel
        const tile = this._indicator.quickSettingsItems[0];
        const next = qs._powerProfiles?.quickSettingsItems?.[0];
        const grid = tile.get_parent();
        if (next && next.get_parent() === grid)
            grid.set_child_below_sibling(tile, next);
        tile.makeFloating(qs.menu);
    }

    disable() {
        this._indicator.quickSettingsItems.forEach(i => i.destroy());
        this._indicator.destroy();
        this._indicator = null;
    }
}
