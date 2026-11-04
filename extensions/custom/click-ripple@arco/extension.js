// Click Ripple: draws a short ring animation where you click.
// Rings sit in a non-reactive layer on top of everything, so they never
// catch clicks themselves.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const RING_SIZE = 44;      // final ring diameter (px)
const RING_MS = 420;
const FLASH_SIZE = 18;
const FLASH_MS = 240;
const HOLD_SIZE = 8;
const HOLD_DELAY_MS = 200; // a press longer than this counts as "hold"
const POLL_MS = 16;

const BUTTON_MASKS = [
    [Clutter.ModifierType.BUTTON1_MASK, 1],
    [Clutter.ModifierType.BUTTON2_MASK, 2],
    [Clutter.ModifierType.BUTTON3_MASK, 3],
];

export default class ClickRipple extends Extension {
    enable() {
        this._layer = new St.Widget({reactive: false, x: 0, y: 0});
        Main.layoutManager.uiGroup.add_child(this._layer);
        this._raiseId = Main.layoutManager.uiGroup.connect('child-added', () => this._raise());

        this._hold = null;
        this._holdTimer = 0;
        this._pressed = false;
        this._stageWorks = false;

        // Main path: see input as it passes through the stage.
        this._capId = global.stage.connect('captured-event', (_a, ev) => this._onEvent(ev));

        // Fallback: watch the mouse buttons directly, until the stage path
        // proves it delivers button events (then this stops costing anything).
        this._lastMask = 0;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => this._poll());
    }

    disable() {
        if (this._capId) global.stage.disconnect(this._capId);
        if (this._raiseId) Main.layoutManager.uiGroup.disconnect(this._raiseId);
        if (this._pollId) GLib.source_remove(this._pollId);
        if (this._holdTimer) GLib.source_remove(this._holdTimer);
        this._capId = this._raiseId = this._pollId = this._holdTimer = 0;
        this._layer?.destroy();
        this._layer = null;
        this._hold = null;
    }

    _raise() {
        const parent = this._layer?.get_parent();
        if (parent) parent.set_child_above_sibling(this._layer, null);
    }

    _onEvent(ev) {
        const type = ev.type();
        if (type === Clutter.EventType.BUTTON_PRESS) {
            this._stopPolling();
            const [x, y] = ev.get_coords();
            this._press(x, y, ev.get_button());
        } else if (type === Clutter.EventType.BUTTON_RELEASE) {
            this._stopPolling();
            this._release();
        } else if (type === Clutter.EventType.MOTION && this._hold) {
            const [x, y] = ev.get_coords();
            this._moveHold(x, y);
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _stopPolling() {
        this._stageWorks = true;
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
    }

    _poll() {
        if (this._stageWorks) {
            this._pollId = 0;
            return GLib.SOURCE_REMOVE;
        }
        const [x, y, mask] = global.get_pointer();
        for (const [bit, button] of BUTTON_MASKS) {
            const now = mask & bit, before = this._lastMask & bit;
            if (now && !before) this._press(x, y, button);
            else if (!now && before) this._release();
        }
        if (this._hold) this._moveHold(x, y);
        this._lastMask = mask;
        return GLib.SOURCE_CONTINUE;
    }

    _animationsOn() {
        return St.Settings.get().enable_animations;
    }

    _press(x, y, button) {
        if (!this._layer || !this._animationsOn()) return;
        if (button > 3) return; // ignore extra buttons / scroll
        this._raise();
        const secondary = button !== 1;
        this._ring(x, y, secondary);
        this._flash(x, y, secondary);

        this._pressed = true;
        if (this._holdTimer) GLib.source_remove(this._holdTimer);
        this._holdTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOLD_DELAY_MS, () => {
            this._holdTimer = 0;
            if (this._pressed) this._showHold(x, y);
            return GLib.SOURCE_REMOVE;
        });
    }

    _release() {
        this._pressed = false;
        if (this._holdTimer) {
            GLib.source_remove(this._holdTimer);
            this._holdTimer = 0;
        }
        const hold = this._hold;
        this._hold = null;
        if (hold) {
            hold.ease({
                opacity: 0, scale_x: 0.3, scale_y: 0.3,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: () => hold.destroy(),
            });
        }
    }

    _circle(cls, size, x, y) {
        const w = new St.Widget({
            style_class: cls, reactive: false,
            width: size, height: size,
            x: Math.round(x - size / 2), y: Math.round(y - size / 2),
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
        });
        this._layer.add_child(w);
        return w;
    }

    _ring(x, y, secondary) {
        const ring = this._circle(`click-ripple-ring${secondary ? ' secondary' : ''}`, RING_SIZE, x, y);
        ring.set({scale_x: 0.2, scale_y: 0.2, opacity: 240});
        ring.ease({
            scale_x: 1, scale_y: 1,
            duration: RING_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        ring.ease_property('opacity', 0, {
            duration: RING_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => ring.destroy(),
        });
    }

    _flash(x, y, secondary) {
        const f = this._circle(`click-ripple-flash${secondary ? ' secondary' : ''}`, FLASH_SIZE, x, y);
        f.set({scale_x: 0.4, scale_y: 0.4, opacity: 255});
        f.ease({
            scale_x: 1.15, scale_y: 1.15, opacity: 0,
            duration: FLASH_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => f.destroy(),
        });
    }

    _showHold(x, y) {
        if (this._hold || !this._layer) return;
        const h = this._circle('click-ripple-hold', HOLD_SIZE, x, y);
        h.set({scale_x: 0.2, scale_y: 0.2, opacity: 0});
        h.ease({
            scale_x: 1, scale_y: 1, opacity: 255,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
        this._hold = h;
    }

    _moveHold(x, y) {
        this._hold?.set_position(Math.round(x - HOLD_SIZE / 2), Math.round(y - HOLD_SIZE / 2));
    }
}
