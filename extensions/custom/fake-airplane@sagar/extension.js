// Fake Airplane Mode: when the flag file exists, take the network indicator
// (and the network toggles in Quick Settings) out of the UI and show an
// airplane icon + a checked "Airplane Mode" tile instead. Networking itself
// is never touched. Actors are detached/re-attached rather than hidden, so
// GNOME's own visibility logic keeps working and restores cleanly.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'fake-airplane']);
const FLAG = GLib.build_filenamev([DIR, 'on']);

const FakeToggle = GObject.registerClass(
class FakeToggle extends QuickToggle {
    _init() {
        super._init({title: 'Airplane Mode', iconName: 'airplane-mode-symbolic', checked: true});
        // Inert on purpose: only the `fake-mode` command switches it.
        this.connect('clicked', () => (this.checked = true));
    }
});

export default class FakeAirplane extends Extension {
    enable() {
        this._active = false;
        this._detached = [];
        GLib.mkdir_with_parents(DIR, 0o755);
        this._monitor = Gio.File.new_for_path(DIR).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => this._sync());
        this._waitForQs();
    }

    _waitForQs() {
        const qs = Main.panel.statusArea.quickSettings;
        if (qs?._rfkill && qs._network !== undefined) {
            this._sync();
            return;
        }
        this._retry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._retry = 0;
            this._waitForQs();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const want = GLib.file_test(FLAG, GLib.FileTest.EXISTS);
        if (want && !this._active) this._apply();
        else if (!want && this._active) this._restore();
    }

    _detach(actor, isTile = false) {
        const parent = actor?.get_parent();
        if (!parent) return;
        const index = parent.get_children().indexOf(actor);
        parent.remove_child(actor);
        // All network/airplane tiles use GNOME's default 1-column span.
        this._detached.push({actor, parent, index, colSpan: isTile ? 1 : null});
    }

    _apply() {
        const qs = Main.panel.statusArea.quickSettings;
        if (!qs?._rfkill) return;
        this._active = true;

        // Panel: swap the network icons (and the real airplane icon) for ours.
        const box = qs._indicators;
        const anchor = qs._network ?? qs._rfkill;
        const pos = Math.max(0, box.get_children().indexOf(anchor));
        this._detach(qs._network);
        this._detach(qs._rfkill);
        this._icon = new St.Icon({style_class: 'system-status-icon', icon_name: 'airplane-mode-symbolic'});
        box.insert_child_at_index(this._icon, pos);

        // Quick Settings: drop Wi-Fi/Wired/Mobile/Bluetooth-tether/VPN tiles
        // and the real airplane tile; put a checked fake tile where it was.
        const rfTile = qs._rfkill.quickSettingsItems[0];
        const grid = rfTile?.get_parent();
        this._toggle = new FakeToggle();
        if (grid) {
            grid.insert_child_above(this._toggle, rfTile);
            grid.layout_manager.child_set_property(grid, this._toggle, 'column-span', 1);
        }
        for (const item of qs._network?.quickSettingsItems ?? []) this._detach(item, true);
        this._detach(rfTile, true);
    }

    _restore() {
        this._active = false;
        this._icon?.destroy();
        this._icon = null;
        this._toggle?.destroy();
        this._toggle = null;
        // Re-attach in reverse so recorded indices stay valid.
        for (const {actor, parent, index, colSpan} of this._detached.reverse()) {
            if (actor.get_parent()) continue;
            const n = parent.get_n_children();
            parent.insert_child_at_index(actor, Math.min(index, n));
            if (colSpan != null)
                parent.layout_manager.child_set_property(parent, actor, 'column-span', colSpan);
        }
        this._detached = [];
    }

    disable() {
        if (this._retry) GLib.source_remove(this._retry);
        this._retry = 0;
        this._monitor?.cancel();
        this._monitor = null;
        if (this._active) this._restore();
    }
}
