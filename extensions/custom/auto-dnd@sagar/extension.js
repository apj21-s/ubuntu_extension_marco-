// Auto Do Not Disturb: silence notification banners while
//   - the microphone is recording (ignores recordings of speaker output, e.g. music visualizers)
//   - a camera (/dev/video*) is open
//   - the screen is being shared or recorded
//   - an app is fullscreen (video, game, presentation)
// It only turns DND back off if it was the one that turned it on.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const CAMERA_POLL_S = 6;
const STATE = GLib.build_filenamev([GLib.get_user_state_dir(), 'auto-dnd-active']);

function runAsync(argv, cb) {
    try {
        const p = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        p.communicate_utf8_async(null, null, (_p, res) => {
            try {
                const [, out] = p.communicate_utf8_finish(res);
                cb(out ?? '', p.get_successful());
            } catch (e) {
                cb('', false);
            }
        });
    } catch (e) {
        cb('', false);
    }
}

export default class AutoDndExtension extends Extension {
    enable() {
        this._notif = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._reasons = {mic: false, camera: false, sharing: false, fullscreen: false};
        this._weTurnedOn = GLib.file_test(STATE, GLib.FileTest.EXISTS);
        this._handles = new Set();

        // fullscreen
        this._fsId = global.display.connect('in-fullscreen-changed', () => this._checkFullscreen());
        this._checkFullscreen();

        // screen sharing / recording
        try {
            this._rac = global.backend.get_remote_access_controller();
            this._racId = this._rac.connect('new-handle', (_c, handle) => {
                this._handles.add(handle);
                handle.connect('stopped', () => {
                    this._handles.delete(handle);
                    this._set('sharing', this._handles.size > 0);
                });
                this._set('sharing', true);
            });
        } catch (e) {
            this._rac = null;
        }

        // microphone: re-check whenever PulseAudio/PipeWire reports a source-output change
        this._startMicWatch();
        this._checkMic();

        // camera
        this._checkCamera();
        this._camId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, CAMERA_POLL_S, () => {
            this._checkCamera();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        global.display.disconnect(this._fsId);
        if (this._rac)
            this._rac.disconnect(this._racId);
        if (this._camId)
            GLib.source_remove(this._camId);
        this._camId = 0;
        this._stopped = true;
        this._sub?.force_exit();
        this._sub = null;
        if (this._micTimer)
            GLib.source_remove(this._micTimer);
        this._micTimer = 0;
        // leave the user's notifications as they were before we touched them
        for (const k of Object.keys(this._reasons))
            this._reasons[k] = false;
        this._apply();
        this._notif = null;
    }

    _set(reason, on) {
        if (this._reasons[reason] === on)
            return;
        this._reasons[reason] = on;
        this._apply();
    }

    _apply() {
        const want = Object.values(this._reasons).some(v => v);
        const banners = this._notif.get_boolean('show-banners');
        if (want && banners) {  // DND off -> turn it on, and remember we did
            this._notif.set_boolean('show-banners', false);
            this._weTurnedOn = true;
            GLib.file_set_contents(STATE, '1');
        } else if (!want && this._weTurnedOn) {
            if (!banners)
                this._notif.set_boolean('show-banners', true);
            this._weTurnedOn = false;
            GLib.unlink(STATE);
        }
    }

    _checkFullscreen() {
        const n = global.display.get_n_monitors();
        let fs = false;
        for (let i = 0; i < n; i++)
            fs ||= global.display.get_monitor_in_fullscreen(i);
        this._set('fullscreen', fs);
    }

    _startMicWatch() {
        if (this._stopped)
            return;
        try {
            this._sub = Gio.Subprocess.new(['pactl', 'subscribe'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            return;
        }
        const stream = new Gio.DataInputStream({base_stream: this._sub.get_stdout_pipe()});
        const readLine = () => {
            stream.read_line_async(GLib.PRIORITY_LOW, null, (_s, res) => {
                let line;
                try {
                    [line] = stream.read_line_finish_utf8(res);
                } catch (e) {
                    line = null;
                }
                if (line === null) {  // pactl exited (audio restarted): reconnect shortly
                    if (!this._stopped)
                        GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 3, () => {
                            this._startMicWatch();
                            return GLib.SOURCE_REMOVE;
                        });
                    return;
                }
                if (line.includes('source-output') || line.includes("'new' on source") || line.includes("'remove' on source")) {
                    if (this._micTimer)
                        GLib.source_remove(this._micTimer);
                    this._micTimer = GLib.timeout_add(GLib.PRIORITY_LOW, 300, () => {
                        this._micTimer = 0;
                        this._checkMic();
                        return GLib.SOURCE_REMOVE;
                    });
                }
                readLine();
            });
        };
        readLine();
    }

    _checkMic() {
        runAsync(['pactl', '-f', 'json', 'list', 'source-outputs'], outs => {
            runAsync(['pactl', '-f', 'json', 'list', 'sources'], srcs => {
                if (this._stopped)
                    return;
                try {
                    const monitors = new Set(JSON.parse(srcs || '[]')
                        .filter(s => (s.name ?? '').endsWith('.monitor') || s.monitor_of_sink !== undefined && s.monitor_of_sink !== 'n/a')
                        .map(s => s.index));
                    const real = JSON.parse(outs || '[]').filter(o => !monitors.has(o.source) &&
                        !(o.properties?.['application.id'] ?? '').match(/pavucontrol|VolumeControl/));
                    this._set('mic', real.length > 0);
                } catch (e) {}
            });
        });
    }

    _checkCamera() {
        const dev = Gio.File.new_for_path('/dev');
        let cams = [];
        try {
            const e = dev.enumerate_children('standard::name', 0, null);
            let info;
            while ((info = e.next_file(null)))
                if (/^video\d+$/.test(info.get_name()))
                    cams.push(`/dev/${info.get_name()}`);
        } catch (e) {}
        if (!cams.length) {
            this._set('camera', false);
            return;
        }
        // fuser exits 0 if any process has one of them open
        runAsync(['fuser', '-s', ...cams], (_out, inUse) => {
            if (!this._stopped)
                this._set('camera', inUse);
        });
    }
}
