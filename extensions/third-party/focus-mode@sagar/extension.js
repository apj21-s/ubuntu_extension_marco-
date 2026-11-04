import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SERVICE_NAME = 'ambient.service';

function runSystemctl(commands) {
    const command = commands.join(' && ');

    let proc;

    try {
        proc = Gio.Subprocess.new(
            ['bash', '-c', command],
            Gio.SubprocessFlags.STDOUT_PIPE |
            Gio.SubprocessFlags.STDERR_PIPE
        );
    } catch (e) {
        console.error(`[FocusMode] Failed to spawn command: ${e.message}`);
        return;
    }

    proc.communicate_utf8_async(null, null, (source, res) => {
        try {
            const [, stdout, stderr] = source.communicate_utf8_finish(res);

            if (source.get_successful()) {
                console.log(`[FocusMode] ${command}`);
            } else {
                console.error(
                    `[FocusMode] Failed (${source.get_exit_status()})\n${stderr}`
                );
            }
        } catch (e) {
            console.error(`[FocusMode] ${e.message}`);
        }
    });
}

function applyFocusModeState(enabled) {

    if (enabled) {

        runSystemctl([
            'systemctl --user stop ambient.service',
            'systemctl --user disable ambient.service'
        ]);

    } else {

        runSystemctl([
            'systemctl --user enable ambient.service',
            'systemctl --user start ambient.service'
        ]);

    }
}

const FocusModeToggle = GObject.registerClass(
class FocusModeToggle extends QuickSettings.QuickToggle {

    _init(settings) {

        super._init({
            title: 'Focus Mode',
            subtitle: 'Ambient Automation',
            iconName: 'selection-mode-symbolic',
            toggleMode: true,
        });

        this._settings = settings;

        this._settings.bind(
            'focus-mode',
            this,
            'checked',
            Gio.SettingsBindFlags.DEFAULT
        );
    }
});

const FocusModeIndicator = GObject.registerClass(
class FocusModeIndicator extends QuickSettings.SystemIndicator {

    _init(settings) {

        super._init();

        this._settings = settings;

        this._indicator = this._addIndicator();
        this._indicator.iconName = 'selection-mode-symbolic';

        this._settings.bind(
            'focus-mode',
            this._indicator,
            'visible',
            Gio.SettingsBindFlags.DEFAULT
        );

        this._toggle = new FocusModeToggle(this._settings);

        this.quickSettingsItems.push(this._toggle);

        this._settingsChangedId = this._settings.connect(
            'changed::focus-mode',
            () => {
                applyFocusModeState(
                    this._settings.get_boolean('focus-mode')
                );
            }
        );
    }

    destroy() {

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        this.quickSettingsItems.forEach(item => item.destroy());

        this.quickSettingsItems = [];

        super.destroy();
    }
});

export default class FocusModeExtension extends Extension {

    enable() {
        
        this._settings = this.getSettings();

        this._indicator = new FocusModeIndicator(this._settings);

        Main.panel.statusArea.quickSettings.addExternalIndicator(
            this._indicator
        );

        applyFocusModeState(
            this._settings.get_boolean('focus-mode')
        );
    }

    disable() {

        this._indicator?.destroy();

        this._indicator = null;

        this._settings = null;
    }
}
