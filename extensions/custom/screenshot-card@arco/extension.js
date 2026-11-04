// Screenshot Card: after a screenshot, a thumbnail card slides into the bottom-right
// corner with Save / Open / Copy / Delete. The screenshot is only kept if you press
// Save - otherwise it's thrown away when the card leaves (it stays in the clipboard).
//
// GNOME always writes ~/Pictures/Screenshots/<name>.png and then posts a
// "Screenshot captured" notification. We catch that notification, hide its banner,
// and move the new file into ~/.cache/screenshot-card/ until you decide.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gettext from 'gettext';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SHOW_S = 6;          // card stays this long (paused while hovered)
const CARD_W = 248;
const MARGIN = 16;
const FRESH_US = 4 * GLib.USEC_PER_SEC;  // "new" screenshot file = written in the last 4 s

const shellText = s => Gettext.dgettext('gnome-shell', s);

function screenshotsDir() {
    const pics = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ||
        GLib.get_home_dir();
    return Gio.File.new_for_path(GLib.build_filenamev([pics, shellText('Screenshots')]));
}

function newestFreshPng(dir) {
    let best = null, bestT = 0;
    try {
        const en = dir.enumerate_children('standard::name,time::modified,time::modified-usec',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null))) {
            if (!info.get_name().endsWith('.png'))
                continue;
            const t = info.get_modification_date_time()?.to_unix_usec() ?? 0;
            if (t > bestT) {
                bestT = t;
                best = dir.get_child(info.get_name());
            }
        }
        en.close(null);
    } catch {
        return null;
    }
    return best && GLib.get_real_time() - bestT < FRESH_US ? best : null;
}

function animationsOn() {
    return St.Settings.get().enable_animations;
}

class Card {
    constructor(ext, {content, held, savedName}) {
        this._ext = ext;
        this._held = held;          // Gio.File in ~/.cache/screenshot-card, or null
        this._savedName = savedName;
        this._pinned = false;       // after Open: stay until Save / Delete
        this._timerId = 0;

        this.actor = new St.BoxLayout({
            style_class: 'ssc-card', orientation: Clutter.Orientation.VERTICAL,
            reactive: true, track_hover: true, width: CARD_W, opacity: 0,
        });
        // thumbnail with a small x in its corner (dismiss now, not saved)
        const thumbH = Math.round((CARD_W - 20) * 9 / 16);
        const top = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
        let thumb;
        if (content instanceof Clutter.Content) {
            thumb = new St.Widget({style_class: 'ssc-thumb', x_expand: true, height: thumbH,
                content, content_gravity: Clutter.ContentGravity.RESIZE_ASPECT});
        } else {
            thumb = new St.Bin({style_class: 'ssc-thumb', x_expand: true, height: thumbH,
                child: new St.Icon({gicon: content ?? null, icon_name: content ? null : 'image-x-generic-symbolic',
                    icon_size: 48})});
        }
        top.add_child(thumb);
        const close = new St.Button({style_class: 'ssc-close', can_focus: true,
            x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START,
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 12})});
        close.connect('clicked', () => this.dismiss(true));
        top.add_child(close);
        this.actor.add_child(top);

        this._status = new St.Label({style_class: 'ssc-status', text: '', visible: false,
            x_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this._status);

        const row = new St.BoxLayout({style_class: 'ssc-row', x_expand: true});
        if (held) {
            row.add_child(this._button('Save', 'ssc-save', () => this._save()));
            row.add_child(this._button('Open', '', () => this._open()));
        }
        row.add_child(this._button('Copy', '', () => this._copy()));
        row.add_child(this._button('Delete', 'ssc-delete', () => this.dismiss(true)));
        this.actor.add_child(row);

        this.actor.connect('notify::hover', () => this._restartTimer());
        Main.layoutManager.addTopChrome(this.actor);
        this._place();
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._place());
        this._show();
    }

    _button(label, cls, cb) {
        const b = new St.Button({label, style_class: `ssc-btn ${cls}`, x_expand: true,
            can_focus: true});
        b.connect('clicked', cb);
        return b;
    }

    _place() {
        const i = Main.layoutManager.primaryIndex;
        const wa = Main.layoutManager.getWorkAreaForMonitor(i);
        const [, h] = this.actor.get_preferred_height(CARD_W);
        this.actor.set_position(wa.x + wa.width - CARD_W - MARGIN, wa.y + wa.height - h - MARGIN);
    }

    _show() {
        const anim = animationsOn();
        this.actor.translation_x = anim ? CARD_W * 0.6 : 0;
        this.actor.ease({
            opacity: 255, translation_x: 0, duration: anim ? 260 : 120,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        this._restartTimer();
    }

    _restartTimer() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        if (this._pinned || this.actor.hover || this._gone)
            return;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SHOW_S, () => {
            this._timerId = 0;
            this.dismiss(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _flash(text, then) {
        this._status.text = text;
        this._status.show();
        this._place();
        if (then) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
                then();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _save() {
        if (!this._held)
            return;
        try {
            const dir = screenshotsDir();
            try {
                dir.make_directory_with_parents(null);
            } catch {}
            let dest = dir.get_child(this._savedName);
            for (let i = 1; dest.query_exists(null); i++)
                dest = dir.get_child(this._savedName.replace(/\.png$/, `-${i}.png`));
            this._held.move(dest, Gio.FileCopyFlags.NONE, null, null);
            this._held = null;
            this._pinned = true;
            this._flash('Saved to Screenshots  ✓', () => this.dismiss(false));
        } catch (e) {
            this._flash(`Couldn't save: ${e.message}`);
        }
    }

    _open() {
        if (!this._held)
            return;
        this._pinned = true;  // keep the card so they can still Save after looking
        this._restartTimer();
        try {
            Gio.AppInfo.launch_default_for_uri(this._held.get_uri(),
                global.create_app_launch_context(0, -1));
        } catch (e) {
            this._flash(`Couldn't open: ${e.message}`);
        }
    }

    _copy() {
        try {
            if (this._held) {
                const [, bytes] = this._held.load_contents(null);
                St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png',
                    new GLib.Bytes(bytes));
            }
            this._flash('Copied to clipboard');
        } catch (e) {
            this._flash(`Couldn't copy: ${e.message}`);
        }
    }

    // discard=true deletes the held file (the default: not saved unless asked)
    dismiss(discard, instant = false) {
        if (this._gone)
            return;
        this._gone = true;
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        if (discard && this._held) {
            try {
                this._held.delete(null);
            } catch {}
        }
        this._held = null;
        Main.layoutManager.disconnect(this._monitorsId);
        const done = () => {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
        };
        if (instant) {
            done();
            return;
        }
        this.actor.ease({
            opacity: 0, translation_x: animationsOn() ? CARD_W * 0.5 : 0, duration: 200,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC, onStopped: done,
        });
        this._ext.cardGone(this);
    }
}

export default class ScreenshotCardExtension extends Extension {
    enable() {
        this._title = shellText('Screenshot captured');
        this._holdDir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'screenshot-card']));
        this._emptyHoldDir();
        this._sources = new Map();
        this._trayId = Main.messageTray.connect('source-added', (_t, s) => this._watch(s));
        for (const s of Main.messageTray.getSources())
            this._watch(s);
        // never leave a card over the lock screen
        this._modeId = Main.sessionMode.connect('updated', () => {
            if (Main.sessionMode.isLocked) {
                this._card?.dismiss(true, true);
                this._card = null;
            }
        });
    }

    disable() {
        Main.messageTray.disconnect(this._trayId);
        Main.sessionMode.disconnect(this._modeId);
        for (const [s, id] of this._sources)
            s.disconnect(id);
        this._sources = null;
        this._card?.dismiss(true, true);
        this._card = null;
    }

    cardGone(card) {
        if (this._card === card)
            this._card = null;
    }

    _watch(source) {
        if (this._sources.has(source))
            return;
        const id = source.connect('notification-added', (_s, n) => this._onNotification(n));
        this._sources.set(source, id);
        source.connect('destroy', () => {
            this._sources?.delete(source);
        });
    }

    _onNotification(n) {
        if (n.title !== this._title)
            return;
        n.acknowledged = true;  // no GNOME banner: the card replaces it
        const content = n.gicon;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            n.destroy();
            return GLib.SOURCE_REMOVE;
        });

        let held = null, savedName = null;
        const file = newestFreshPng(screenshotsDir());
        if (file) {
            savedName = file.get_basename();
            try {
                this._holdDir.make_directory_with_parents(null);
            } catch {}
            const dest = this._holdDir.get_child(savedName);
            try {
                file.move(dest, Gio.FileCopyFlags.OVERWRITE, null, null);
                held = dest;
            } catch (e) {
                console.error(`screenshot-card: could not hold ${savedName}: ${e.message}`);
            }
        }

        this._card?.dismiss(true);  // a new shot replaces an undecided one
        try {
            this._card = new Card(this, {content, held, savedName});
        } catch (e) {
            // never lose a screenshot because the card failed: put it back where GNOME saved it
            console.error(`screenshot-card: ${e.message}`);
            this._card = null;
            if (held) {
                try {
                    held.move(file, Gio.FileCopyFlags.NONE, null, null);
                } catch {}
            }
        }
    }

    _emptyHoldDir() {
        try {
            const en = this._holdDir.enumerate_children('standard::name',
                Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = en.next_file(null)))
                this._holdDir.get_child(info.get_name()).delete(null);
            en.close(null);
        } catch {}
    }
}
