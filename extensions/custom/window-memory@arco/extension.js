// Window Memory: remembers where every app window was (position, size, workspace,
// maximized, minimized) and puts it back when the app reopens right after login, which
// is when session-keeper's "Restore your last session?" reopens your apps.
//
// Saving is event-driven: a window opening, moving, resizing or changing workspace
// schedules one write a few seconds later. Closing windows does not erase the saved
// layout straight away, so logging out (which closes everything) keeps it intact.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SAVE_DELAY_S = 3;        // after a change
const CLOSE_SAVE_DELAY_S = 15; // after a window closes (longer: logout closes everything)
const RESTORE_WINDOW_S = 240;  // after login, new windows of saved apps are put back
const STATE = GLib.build_filenamev([GLib.get_user_state_dir(), 'session-keeper', 'windows.json']);

function appId(w) {
    const app = Shell.WindowTracker.get_default().get_window_app(w);
    const id = app?.get_id();
    // apps without a .desktop file get a throwaway "window:N" id: use the window class
    if (!id || id.startsWith('window:'))
        return w.get_wm_class() || '';
    return id.replace(/\.desktop$/, '');
}

function wanted(w) {
    return w && w.get_window_type() === Meta.WindowType.NORMAL && !w.is_skip_taskbar() &&
        !w.get_transient_for() && !!appId(w);
}

export default class WindowMemoryExtension extends Extension {
    enable() {
        this._saved = this._load();         // the last session's layout, used for restoring
        this._restoreUntil = GLib.get_monotonic_time() + RESTORE_WINDOW_S * GLib.USEC_PER_SEC;
        this._tracked = new Map();          // window -> signal ids
        this._saveId = 0;
        this._applyIds = new Set();
        this._createdId = global.display.connect('window-created', (_d, w) => this._onCreated(w));
        this._wsId = global.workspace_manager.connect('workspace-switched', () => this._queueSave());
        for (const a of global.get_window_actors())
            this._track(a.meta_window);
    }

    disable() {
        global.display.disconnect(this._createdId);
        global.workspace_manager.disconnect(this._wsId);
        if (this._saveId)
            GLib.source_remove(this._saveId);
        this._saveId = 0;
        this._applyIds.forEach(id => GLib.source_remove(id));
        this._applyIds.clear();
        for (const [w, ids] of this._tracked)
            ids.forEach(id => w.disconnect(id));
        this._tracked = null;
    }

    // ---------- file ----------
    _load() {
        try {
            const [, bytes] = GLib.file_get_contents(STATE);
            const data = JSON.parse(new TextDecoder().decode(bytes));
            return Array.isArray(data.windows) ? data.windows : [];
        } catch {
            return [];
        }
    }

    _queueSave(delay = SAVE_DELAY_S) {
        if (this._saveId)
            GLib.source_remove(this._saveId);
        this._saveId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, delay, () => {
            this._saveId = 0;
            this._write();
            return GLib.SOURCE_REMOVE;
        });
    }

    _write() {
        const windows = [];
        for (const w of this._tracked.keys()) {
            if (!wanted(w))
                continue;
            const r = w.get_frame_rect();
            const mon = w.get_monitor();
            const wa = w.get_work_area_for_monitor(mon);
            windows.push({
                app: appId(w), title: w.get_title() || '',
                workspace: w.get_workspace()?.index() ?? 0,
                sticky: w.is_on_all_workspaces(),
                x: r.x - wa.x, y: r.y - wa.y, w: r.width, h: r.height,
                max: w.get_maximize_flags(),
                fullscreen: w.is_fullscreen(), minimized: w.minimized,
            });
        }
        if (!windows.length)
            return;  // nothing open (logging out): keep the last good layout
        const json = JSON.stringify({time: Math.floor(Date.now() / 1000), windows}, null, 1);
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(STATE), 0o700);
            GLib.file_set_contents(STATE, json);
        } catch (e) {
            console.error(`window-memory: could not save: ${e.message}`);
        }
    }

    // ---------- tracking ----------
    _track(w) {
        if (!w || this._tracked.has(w))
            return;
        const ids = [
            w.connect('position-changed', () => this._queueSave()),
            w.connect('size-changed', () => this._queueSave()),
            w.connect('workspace-changed', () => this._queueSave()),
            w.connect('notify::minimized', () => this._queueSave()),
            w.connect('unmanaged', () => {
                this._tracked?.get(w)?.forEach(id => w.disconnect(id));
                this._tracked?.delete(w);
                this._queueSave(CLOSE_SAVE_DELAY_S);
            }),
        ];
        this._tracked.set(w, ids);
    }

    _onCreated(w) {
        this._track(w);
        if (GLib.get_monotonic_time() > this._restoreUntil || !this._saved.length) {
            this._queueSave();
            return;
        }
        // let the app finish mapping and sizing itself, then put it where it was;
        // apply twice because some apps (browsers) resize themselves once more
        for (const ms of [250, 1200]) {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._applyIds.delete(id);
                this._restore(w, ms === 250);
                return GLib.SOURCE_REMOVE;
            });
            this._applyIds.add(id);
        }
    }

    // ---------- restoring ----------
    _match(w) {
        if (w._windowMemory)
            return w._windowMemory;
        if (!wanted(w))
            return null;
        const app = appId(w);
        const title = w.get_title() || '';
        let i = this._saved.findIndex(s => s.app === app && s.title && s.title === title);
        if (i < 0)
            i = this._saved.findIndex(s => s.app === app);
        if (i < 0)
            return null;
        const [entry] = this._saved.splice(i, 1);  // each saved window is used once
        w._windowMemory = entry;
        return entry;
    }

    _restore(w, first) {
        if (!this._tracked?.has(w))
            return;
        const s = this._match(w);
        if (!s)
            return;
        const wm = global.workspace_manager;
        if (first) {
            if (s.sticky) {
                w.stick();
            } else {
                while (wm.get_n_workspaces() <= s.workspace)
                    wm.append_new_workspace(false, global.get_current_time());
                w.change_workspace_by_index(s.workspace, false);
            }
        }
        if (s.fullscreen) {
            w.make_fullscreen();
        } else {
            // GNOME 49+: maximize()/unmaximize() take no flags; partial uses set_maximize_flags()
            if (w.get_maximize_flags())
                w.unmaximize();
            const wa = w.get_work_area_for_monitor(w.get_monitor());
            w.move_resize_frame(true, wa.x + s.x, wa.y + s.y, s.w, s.h);
            if (s.max === Meta.MaximizeFlags.BOTH)
                w.maximize();
            else if (s.max)
                w.set_maximize_flags(s.max);
        }
        if (!first && s.minimized)
            w.minimize();
        if (!first)
            this._queueSave();
    }
}
