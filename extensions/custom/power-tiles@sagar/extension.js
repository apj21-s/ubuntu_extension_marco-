// Power Tiles
//  - Battery 80%: Lenovo conservation mode (ideapad_acpi). "Charge to 100% once" turns it off
//    until the next unplug, then it switches itself back on.
//  - Mode: Quiet / Balanced / Performance (power-profiles-daemon = the Fn+Q platform profiles).
//  - GPU: a small top-bar icon while the NVIDIA GPU is awake (it sleeps when idle).
// Reads sysfs / D-Bus only; changing the battery cap goes through `sudo -n battery-cap`.
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const POLL_S = 5;
const STATE_DIR = GLib.build_filenamev([GLib.get_user_state_dir(), 'power-tiles']);
const FULL_ONCE = GLib.build_filenamev([STATE_DIR, 'full-once']);
const PROFILES = [
    ['power-saver', 'Quiet', 'power-profile-power-saver-symbolic'],
    ['balanced', 'Balanced', 'power-profile-balanced-symbolic'],
    ['performance', 'Performance', 'power-profile-performance-symbolic'],
];

function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch (e) {
        return null;
    }
}

function capFile() {
    const dir = '/sys/bus/platform/drivers/ideapad_acpi';
    try {
        const e = Gio.File.new_for_path(dir).enumerate_children('standard::name', 0, null);
        let info;
        while ((info = e.next_file(null))) {
            const p = `${dir}/${info.get_name()}/conservation_mode`;
            if (GLib.file_test(p, GLib.FileTest.EXISTS))
                return p;
        }
    } catch (e) {}
    return null;
}

function nvidiaDevice() {
    const dir = '/sys/bus/pci/devices';
    try {
        const e = Gio.File.new_for_path(dir).enumerate_children('standard::name', 0, null);
        let info;
        while ((info = e.next_file(null))) {
            const d = `${dir}/${info.get_name()}`;
            if (readFile(`${d}/vendor`) === '0x10de' && (readFile(`${d}/class`) ?? '').startsWith('0x03'))
                return d;
        }
    } catch (e) {}
    return null;
}

function spawn(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch (e) {
        console.error(`power-tiles: ${e.message}`);
    }
}

// ---------- Battery 80% ----------
const BatteryCapToggle = GObject.registerClass(
class BatteryCapToggle extends QuickSettings.QuickMenuToggle {
    _init(capPath) {
        super._init({title: 'Battery 80%', iconName: 'battery-good-charging-symbolic', toggleMode: false});
        this._cap = capPath;
        this.menu.setHeader('battery-good-charging-symbolic', 'Battery conservation',
            'Stops charging at about 80% to make the battery last longer');
        this._once = new PopupMenu.PopupMenuItem('Charge to 100% once (for a trip)');
        this._once.connect('activate', () => this._fullOnce());
        this.menu.addMenuItem(this._once);
        this.connect('clicked', () => this._set(!this.checked));
        this.refresh();
    }

    get on() {
        return readFile(this._cap) === '1';
    }

    _set(on) {
        if (!on)
            GLib.unlink(FULL_ONCE);
        spawn(['sudo', '-n', '/usr/local/sbin/battery-cap', on ? 'on' : 'off']);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _fullOnce() {
        GLib.mkdir_with_parents(STATE_DIR, 0o700);
        GLib.file_set_contents(FULL_ONCE, '1');
        spawn(['sudo', '-n', '/usr/local/sbin/battery-cap', 'off']);
        Main.notify('Charging to 100% once', 'The 80% limit comes back by itself when you unplug.');
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    onUnplugged() {  // trip charge done: put the cap back on
        if (GLib.file_test(FULL_ONCE, GLib.FileTest.EXISTS)) {
            GLib.unlink(FULL_ONCE);
            spawn(['sudo', '-n', '/usr/local/sbin/battery-cap', 'on']);
        }
    }

    refresh() {
        const on = this.on;
        const once = GLib.file_test(FULL_ONCE, GLib.FileTest.EXISTS);
        this.checked = on;
        this.subtitle = on ? 'Limit on' : (once ? 'Full charge once' : 'Off');
        this._once.visible = on;
    }
});

// ---------- Quiet / Balanced / Performance ----------
const ModeToggle = GObject.registerClass(
class ModeToggle extends QuickSettings.QuickMenuToggle {
    _init(gpuPath) {
        super._init({title: 'Mode', iconName: PROFILES[1][2], toggleMode: false});
        this._gpu = gpuPath;
        this.menu.setHeader(PROFILES[1][2], 'Performance mode', 'Like Fn+Q: tap the tile to cycle');
        this._items = new Map();
        for (const [id, label] of PROFILES) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._setProfile(id));
            this.menu.addMenuItem(item);
            this._items.set(id, item);
        }
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._gpuItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._gpuItem);
        this._proxy = null;
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            'org.freedesktop.UPower.PowerProfiles', '/org/freedesktop/UPower/PowerProfiles',
            'org.freedesktop.UPower.PowerProfiles', null, (_o, res) => {
                try {
                    this._proxy = Gio.DBusProxy.new_for_bus_finish(res);
                    this._proxy.connect('g-properties-changed', () => this.refresh());
                    this.refresh();
                } catch (e) {
                    console.error(`power-tiles: ${e.message}`);
                }
            });
        this.connect('clicked', () => {  // cycle like Fn+Q
            const ids = PROFILES.map(p => p[0]);
            const i = ids.indexOf(this._active());
            this._setProfile(ids[(i + 1) % ids.length]);
        });
    }

    _active() {
        return this._proxy?.get_cached_property('ActiveProfile')?.unpack() ?? 'balanced';
    }

    _setProfile(id) {
        this._proxy?.call('org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', ['org.freedesktop.UPower.PowerProfiles', 'ActiveProfile',
                new GLib.Variant('s', id)]), Gio.DBusCallFlags.NONE, -1, null, null);
    }

    refresh() {
        const id = this._active();
        const p = PROFILES.find(x => x[0] === id) ?? PROFILES[1];
        this.subtitle = p[1];
        this.iconName = p[2];
        this.checked = id !== 'balanced';
        this.menu.setHeader(p[2], 'Performance mode', 'Like Fn+Q: tap the tile to cycle');
        for (const [pid, item] of this._items)
            item.setOrnament(pid === id ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        if (this._gpu) {
            const awake = readFile(`${this._gpu}/power/runtime_status`) === 'active';
            this._gpuItem.label.text = awake ? 'NVIDIA GPU: awake (using extra power)' : 'NVIDIA GPU: sleeping';
        } else {
            this._gpuItem.label.text = 'NVIDIA GPU: not found';
        }
    }
});

const PowerIndicator = GObject.registerClass(
class PowerIndicator extends QuickSettings.SystemIndicator {
    _init(capPath, gpuPath) {
        super._init();
        // top-bar icon: only while the NVIDIA GPU is awake
        this._gpuIcon = this._addIndicator();
        this._gpuIcon.icon_name = 'video-display-symbolic';
        this._gpuIcon.visible = false;
        if (capPath) {
            this.cap = new BatteryCapToggle(capPath);
            this.quickSettingsItems.push(this.cap);
        }
        this.mode = new ModeToggle(gpuPath);
        this.quickSettingsItems.push(this.mode);
        this._gpu = gpuPath;
    }

    tick() {
        if (this._gpu)
            this._gpuIcon.visible = readFile(`${this._gpu}/power/runtime_status`) === 'active';
        this.cap?.refresh();
        this.mode.refresh();
    }
});

export default class PowerTilesExtension extends Extension {
    enable() {
        this._indicator = new PowerIndicator(capFile(), nvidiaDevice());
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        this._indicator.tick();
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, POLL_S, () => {
            this._indicator.tick();
            return GLib.SOURCE_CONTINUE;
        });
        // trip charge: re-enable the cap when unplugged
        this._upower = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            'org.freedesktop.UPower', '/org/freedesktop/UPower', 'org.freedesktop.UPower', null);
        this._upowerId = this._upower.connect('g-properties-changed', () => {
            if (this._upower.get_cached_property('OnBattery')?.unpack())
                this._indicator?.cap?.onUnplugged();
        });
    }

    disable() {
        if (this._pollId)
            GLib.source_remove(this._pollId);
        this._pollId = 0;
        this._upower?.disconnect(this._upowerId);
        this._upower = null;
        this._indicator.quickSettingsItems.forEach(i => i.destroy());
        this._indicator.destroy();
        this._indicator = null;
    }
}
