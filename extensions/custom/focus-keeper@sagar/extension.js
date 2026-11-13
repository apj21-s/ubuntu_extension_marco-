// Focus Keeper: remember the last focused window on each workspace and give it focus back when
// you return to that workspace (keyboard, touchpad swipe, overview). GNOME on its own focuses the
// top window of the stacking order, which apps that raise themselves (Telegram, Spotify) and
// always-on-top windows can change while you're away.
//
// Only Meta.Workspace.activate() is wrapped - the plain "go to this workspace" call. Switching by
// activating a specific window (dock, Alt+Tab, notifications) goes through activate_with_focus()
// and is left alone, so that window keeps the focus it asked for.
import Meta from 'gi://Meta';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

function trackable(w) {
    return w && w.get_window_type() === Meta.WindowType.NORMAL && !w.is_on_all_workspaces() &&
        !w.is_skip_taskbar() && !w.minimized;
}

export default class FocusKeeperExtension extends Extension {
    enable() {
        this._last = new WeakMap();   // workspace -> window
        this._restoring = false;
        this._focusId = global.display.connect('notify::focus-window', () => {
            if (this._restoring)
                return;
            const w = global.display.focus_window;
            if (trackable(w) && w.get_workspace())
                this._last.set(w.get_workspace(), w);
        });
        const self = this;
        this._origActivate = Meta.Workspace.prototype.activate;
        const orig = this._origActivate;
        Meta.Workspace.prototype.activate = function (timestamp) {
            const want = self._last?.get(this);   // read BEFORE GNOME picks its own window
            self._restoring = true;
            try {
                orig.call(this, timestamp);
            } finally {
                self._restoring = false;
            }
            try {
                if (want && !want.minimized && want.get_compositor_private() &&
                    want.located_on_workspace(this) && global.display.focus_window !== want)
                    want.activate(timestamp);
            } catch (e) {}
        };
    }

    disable() {
        Meta.Workspace.prototype.activate = this._origActivate;
        global.display.disconnect(this._focusId);
        this._last = null;
    }
}
