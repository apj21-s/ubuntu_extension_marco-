import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/shell/extensions/prefs.js';

export default class FocusModePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Focus Mode',
            icon_name: 'selection-mode-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Ambient Automation',
            description: 'Controls the focus-mode key read by idle_monitor.py',
        });

        const row = new Adw.SwitchRow({
            title: 'Focus Mode',
            subtitle: 'Enable automatic Ambient Mode triggering gate',
        });

        group.add(row);
        page.add(group);
        window.add(page);

        settings.bind(
            'focus-mode',
            row,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        window.set_default_size(480, 260);
    }
}
