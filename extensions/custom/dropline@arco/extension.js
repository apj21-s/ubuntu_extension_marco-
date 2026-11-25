// Dropline cards: small floating cards in the bottom-right corner. The Dropline service
// (~/.local/bin/phone-link) decides what deserves a card and sends a finished card over D-Bus
// (title, body, buttons, a key); this extension only draws it. A new card with the same key
// replaces the old one, and the service takes a card back once it is answered elsewhere.
// Close a card with its x button, a swipe to the right, or a middle click.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const BUS = 'io.arco.PhoneLink';
const PATH = '/io/arco/PhoneLink';
const OWN = 'io.arco.DroplineShell';   // the service checks for this name before falling back to notifications
const GAP = 16;
const CARD_W = 360;
const MAX_CARDS = 3;
const SWIPE_CLOSE = 90;                // px dragged to the right that closes a card

export default class DroplineExtension extends Extension {
    enable() {
        this._stack = new St.BoxLayout({style_class: 'dl-stack', orientation: Clutter.Orientation.VERTICAL});
        Main.layoutManager.addTopChrome(this._stack);
        this._stack.connect('notify::height', () => this._place());
        this._place();
        this._monId = Main.layoutManager.connect('monitors-changed', () => this._place());
        this._ownId = Gio.bus_own_name(Gio.BusType.SESSION, OWN, Gio.BusNameOwnerFlags.NONE, null, null, null);
        this._cards = new Map();   // key -> card
        this._sigIds = [
            Gio.DBus.session.signal_subscribe(null, BUS, 'Card', PATH, null, Gio.DBusSignalFlags.NONE,
                (_c, _s, _p, _i, _n, params) => {
                    try {
                        this._fromSpec(JSON.parse(params.deep_unpack()[0]));
                    } catch (e) {
                        console.error(`dropline: bad card: ${e.message}`);
                    }
                }),
            Gio.DBus.session.signal_subscribe(null, BUS, 'Uncard', PATH, null, Gio.DBusSignalFlags.NONE,
                (_c, _s, _p, _i, _n, params) => {
                    const card = this._cards.get(params.deep_unpack()[0]);
                    if (card)
                        this._dismiss(card);
                }),
        ];
    }

    disable() {
        this._sigIds.forEach(id => Gio.DBus.session.signal_unsubscribe(id));
        Gio.bus_unown_name(this._ownId);
        Main.layoutManager.disconnect(this._monId);
        this._cards.clear();
        this._stack.destroy();
        this._stack = null;
    }

    // bottom-right of the work area (above the dock when it is pinned), growing upward
    _place() {
        const i = Main.layoutManager.primaryIndex;
        const wa = Main.layoutManager.getWorkAreaForMonitor(i);
        if (!wa || !this._stack)
            return;
        this._stack.set_position(wa.x + wa.width - CARD_W - GAP, wa.y + wa.height - this._stack.height - GAP);
    }

    _call(method, params) {
        Gio.DBus.session.call(BUS, PATH, BUS, method, params, null, Gio.DBusCallFlags.NONE, 5000, null, null);
    }

    _fromSpec(spec) {
        const old = this._cards.get(spec.key);
        if (old)
            this._dismiss(old, true);
        const actions = (spec.actions || []).map(a => [a.label, a.primary, () => this._call(a.method,
            a.sig ? new GLib.Variant(a.sig, a.args) : null)]);
        const card = this._show(spec.title, spec.body || '', spec.timeout || 5, actions, spec.thumb || null);
        card._key = spec.key;
        this._cards.set(spec.key, card);
        const live = this._stack.get_children().filter(c => !c._gone);
        for (const c of live.slice(0, Math.max(0, live.length - MAX_CARDS)))   // never a wall of cards
            this._dismiss(c, true);
    }

    _show(title, body, timeout, actions, thumb) {
        const card = new St.BoxLayout({style_class: 'dl-card', reactive: true, track_hover: true, opacity: 0, translation_x: 40});
        card.set_width(CARD_W);
        if (thumb) {
            const pic = new St.Widget({style_class: 'dl-thumb', y_align: Clutter.ActorAlign.START});
            pic.set_style(`background-image: url("file://${thumb.replace(/"/g, '%22')}"); background-size: cover;`);
            card.add_child(pic);
        } else {
            card.add_child(new St.Icon({style_class: 'dl-icon', y_align: Clutter.ActorAlign.START,
                gicon: Gio.FileIcon.new(Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(), 'icons', 'phone-link.png'])))}));
        }
        const col = new St.BoxLayout({style_class: 'dl-text', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const t = new St.Label({text: title, style_class: 'dl-title'});
        t.clutter_text.ellipsize = 3;
        col.add_child(t);
        if (body) {
            const b = new St.Label({text: body, style_class: 'dl-body'});
            b.clutter_text.ellipsize = 3;
            col.add_child(b);
        }
        if (actions.length) {
            const row = new St.BoxLayout({style_class: 'dl-actions'});
            for (const [label, primary, fn] of actions) {
                const btn = new St.Button({label, style_class: `dl-btn${primary ? ' dl-primary' : ''}`, can_focus: true});
                btn.connect('clicked', () => {
                    fn();
                    this._dismiss(card);
                });
                row.add_child(btn);
            }
            col.add_child(row);
        }
        card.add_child(col);
        const close = new St.Button({style_class: 'dl-close', can_focus: true, y_align: Clutter.ActorAlign.START,
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 12})});
        close.connect('clicked', () => this._dismiss(card));
        card.add_child(close);
        this._swipe(card);

        this._stack.add_child(card);
        card.ease({opacity: 255, translation_x: 0, duration: 240, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        let left = timeout * 1000;
        const tick = 250;
        card._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, tick, () => {
            if (!card.hover)   // stays while the pointer rests on it
                left -= tick;
            if (left > 0)
                return GLib.SOURCE_CONTINUE;
            card._timer = 0;
            this._dismiss(card);
            return GLib.SOURCE_REMOVE;
        });
        card.connect('destroy', () => {
            if (card._timer)
                GLib.source_remove(card._timer);
            card._timer = 0;
        });
        return card;
    }

    // drag to the right to throw a card away; middle click closes it too
    _swipe(card) {
        card.connect('button-press-event', (_a, ev) => {
            if (ev.get_button() === 2) {
                this._dismiss(card);
                return Clutter.EVENT_STOP;
            }
            if (ev.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            card._dragX = ev.get_coords()[0];
            return Clutter.EVENT_PROPAGATE;
        });
        card.connect('motion-event', (_a, ev) => {
            if (card._dragX === undefined || card._gone)
                return Clutter.EVENT_PROPAGATE;
            const dx = Math.max(0, ev.get_coords()[0] - card._dragX);
            card.translation_x = dx;
            card.opacity = Math.max(60, 255 - dx * 1.6);
            return Clutter.EVENT_PROPAGATE;
        });
        card.connect('button-release-event', () => {
            if (card._dragX === undefined)
                return Clutter.EVENT_PROPAGATE;
            card._dragX = undefined;
            if (card.translation_x > SWIPE_CLOSE)
                this._dismiss(card);
            else if (!card._gone)
                card.ease({translation_x: 0, opacity: 255, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            return Clutter.EVENT_PROPAGATE;
        });
        card.connect('leave-event', () => {
            if (card._dragX !== undefined && card.translation_x > SWIPE_CLOSE) {
                card._dragX = undefined;
                this._dismiss(card);
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _dismiss(card, quick = false) {
        if (!card || card._gone)
            return;
        card._gone = true;
        if (card._key && this._cards.get(card._key) === card)
            this._cards.delete(card._key);
        if (quick) {
            card.destroy();
            return;
        }
        card.ease({opacity: 0, translation_x: CARD_W / 2, duration: 180, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => card.destroy()});
    }
}
