// Wallpaper Mood: when the wallpaper changes, runs ~/.local/bin/wallpaper-mood (a one-shot
// script, ~0.15 s) to work out the new colours; then loads the shell.css it writes on top of
// the other extensions' stylesheets, and reloads it the moment it changes. Watching from
// inside the shell means no extra background process.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SCRIPT = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'wallpaper-mood']);

export default class WallpaperMoodExtension extends Extension {
    enable() {
        this._bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._bgIds = ['changed::picture-uri', 'changed::picture-uri-dark'].map(
            sig => this._bg.connect(sig, () => this._recolorLater()));
        this._ifaceId = this._iface.connect('changed::color-scheme', () => this._recolorLater());
        this._recolorLater();

        this._file = Gio.File.new_for_path(GLib.build_filenamev(
            [GLib.get_user_config_dir(), 'ubuntu_extension_marco', 'mood', 'shell.css']));
        this._loaded = null;
        this._monitor = this._file.get_parent().monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._monitorId = this._monitor.connect('changed', (_m, file, other) => {
            if (this._file.equal(file) || (other && this._file.equal(other)))
                this._later();
        });
        // other extensions load their stylesheets when they are enabled: stay on top of them
        this._stateId = Main.extensionManager.connect('extension-state-changed', () => this._later());
        this._later();
    }

    disable() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        if (this._recolorTimer)
            GLib.source_remove(this._recolorTimer);
        this._recolorTimer = 0;
        this._bgIds.forEach(id => this._bg.disconnect(id));
        this._iface.disconnect(this._ifaceId);
        this._wallMonitor?.cancel();
        this._wallMonitor = this._bg = this._iface = null;
        this._monitor.disconnect(this._monitorId);
        this._monitor.cancel();
        Main.extensionManager.disconnect(this._stateId);
        this._unload();
        this._monitor = this._file = null;
    }

    // ---- wallpaper -> colours ----
    _wallpaperFile() {
        const dark = this._iface.get_string('color-scheme') === 'prefer-dark';
        const uri = this._bg.get_string(dark ? 'picture-uri-dark' : 'picture-uri') ||
            this._bg.get_string('picture-uri');
        return uri ? Gio.File.new_for_uri(uri) : null;
    }

    _recolorLater() {
        if (this._recolorTimer)
            GLib.source_remove(this._recolorTimer);
        this._recolorTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
            this._recolorTimer = 0;
            this._watchWallpaper();
            if (GLib.file_test(SCRIPT, GLib.FileTest.IS_EXECUTABLE)) {
                try {
                    Gio.Subprocess.new([SCRIPT], Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
                } catch (e) {
                    console.error(`wallpaper-mood: ${e.message}`);
                }
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // the wallpaper file is often replaced in place (same name), so watch the file itself
    _watchWallpaper() {
        this._wallMonitor?.cancel();
        this._wallMonitor = null;
        const file = this._wallpaperFile();
        if (!file?.get_path())
            return;
        this._wallMonitor = file.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._wallMonitor.connect('changed', (_m, _f, _o, event) => {
            if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT || event === Gio.FileMonitorEvent.CREATED ||
                event === Gio.FileMonitorEvent.RENAMED || event === Gio.FileMonitorEvent.MOVED_IN)
                this._recolorLater();
        });
    }

    // ---- shell.css ----
    _later() {
        if (this._timer)
            return;
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._timer = 0;
            this._reload();
            return GLib.SOURCE_REMOVE;
        });
    }

    _theme() {
        return St.ThemeContext.get_for_stage(global.stage).get_theme();
    }

    _unload() {
        if (!this._loaded)
            return;
        try {
            this._theme()?.unload_stylesheet(this._loaded);
        } catch (e) {}
        this._loaded = null;
    }

    _reload() {
        this._unload();
        if (!this._file.query_exists(null))
            return;
        // a fresh GFile each time, so St parses the new contents instead of a cached sheet
        const file = Gio.File.new_for_path(this._file.get_path());
        try {
            this._theme()?.load_stylesheet(file);
            this._loaded = file;
        } catch (e) {
            console.error(`wallpaper-mood: ${e.message}`);
        }
    }
}
