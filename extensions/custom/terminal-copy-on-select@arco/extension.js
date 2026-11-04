// Terminal Copy on Select: when text is selected in a terminal window,
// copy it to the normal clipboard so Ctrl+V / Ctrl+Shift+V pastes it.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Window classes of terminal apps where copy-on-select should apply.
const TERMINALS = [
    'org.gnome.Ptyxis',
    'org.gnome.Ptyxis.Devel',
    'gnome-terminal-server',
    'org.gnome.Terminal',
    'org.gnome.Console',
    'kgx',
];

export default class TerminalCopyOnSelect extends Extension {
    enable() {
        this._clipboard = St.Clipboard.get_default();
        this._selection = global.display.get_selection();
        this._timeoutId = 0;
        this._ownerChangedId = this._selection.connect('owner-changed', (_sel, type) => {
            if (type !== Meta.SelectionType.SELECTION_PRIMARY)
                return;
            const win = global.display.focus_window;
            if (!win || !TERMINALS.includes(win.get_wm_class()))
                return;
            // The selection changes many times while dragging: copy once it settles.
            if (this._timeoutId)
                GLib.source_remove(this._timeoutId);
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this._timeoutId = 0;
                this._clipboard.get_text(St.ClipboardType.PRIMARY, (_cb, text) => {
                    if (text && text.trim().length > 0)
                        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
                });
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    disable() {
        if (this._ownerChangedId) {
            this._selection.disconnect(this._ownerChangedId);
            this._ownerChangedId = 0;
        }
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._selection = null;
        this._clipboard = null;
    }
}
