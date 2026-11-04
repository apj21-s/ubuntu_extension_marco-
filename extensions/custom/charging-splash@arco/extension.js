// Charging Splash: a minimal charging-ring animation (Pixel / iOS style).
//   plug in  -> a soft ripple pulses outward, a thin crimson ring sweeps round to the
//               battery level, the number counts up inside it, then it all fades.
//   unplug   -> a grey ripple pulls inward, the ring dims, "On battery".
// Listens to UPower's OnBattery over D-Bus: no polling, nothing runs while idle.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const BUS = 'org.freedesktop.UPower';
const RING = 132;          // ring diameter (logical px)
const STROKE = 3;
const BOTTOM_GAP = 110;    // ring sits this far above the bottom edge (clears the dock)
const CRIMSON = [0.82, 0.38, 0.42];   // #d0606a
const CREAM = [0.96, 0.93, 0.90];

function proxy(path, iface) {
    return new Promise((resolve, reject) => {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            BUS, path, iface, null, (_o, res) => {
                try {
                    resolve(Gio.DBusProxy.new_for_bus_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

export default class ChargingSplashExtension extends Extension {
    enable() {
        this._alive = true;
        this._onBattery = null;  // unknown until the first reading (startup: no splash)
        this._connect().catch(e => console.error(`charging-splash: ${e.message}`));
    }

    async _connect() {
        const up = await proxy('/org/freedesktop/UPower', BUS);
        const dev = await proxy('/org/freedesktop/UPower/devices/DisplayDevice',
            `${BUS}.Device`);
        if (!this._alive)
            return;
        this._up = up;
        this._dev = dev;
        this._onBattery = up.get_cached_property('OnBattery')?.unpack() ?? null;
        this._upId = up.connect('g-properties-changed', (_p, changed) => {
            const v = changed.lookup_value('OnBattery', null);
            if (v)
                this._changed(v.unpack());
        });
    }

    disable() {
        this._alive = false;
        if (this._upId)
            this._up.disconnect(this._upId);
        this._upId = 0;
        this._up = this._dev = null;
        this._clear();
    }

    _changed(onBattery) {
        const was = this._onBattery;
        this._onBattery = onBattery;
        if (was === null || was === onBattery || Main.sessionMode.isLocked)
            return;
        const pct = Math.round(this._dev?.get_cached_property('Percentage')?.unpack() ?? 0);
        this._splash(!onBattery, Math.max(0, Math.min(100, pct)));
    }

    _clear() {
        this._timeline?.stop();
        this._timeline = null;
        if (this._group)
            this._group.destroy();
        this._group = null;
    }

    _splash(plugged, pct) {
        this._clear();
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const anim = St.Settings.get().enable_animations;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const size = RING * scale, box = size * 2.2;  // room for the ripples
        const mode = plugged ? 'csp-on' : 'csp-off';

        // whole splash: not reactive, so it never gets in the way of the mouse
        const group = this._group = new St.Widget({
            reactive: false, opacity: 0, width: box, height: box,
            x: Math.round(m.x + (m.width - box) / 2),
            y: Math.round(m.y + m.height - BOTTOM_GAP * scale - box / 2 - size / 2),
            layout_manager: new Clutter.BinLayout(),
        });

        // soft backdrop so the ring reads on any wallpaper
        const halo = new St.Widget({style_class: `csp-halo ${mode}`, width: size * 1.35,
            height: size * 1.35, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        group.add_child(halo);

        // ripples
        const ripples = [0, 1].map(() => {
            const r = new St.Widget({style_class: `csp-ripple ${mode}`, width: size, height: size,
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                pivot_point: new Graphene.Point({x: 0.5, y: 0.5}), opacity: 0});
            group.add_child(r);
            return r;
        });

        // the ring itself
        let progress = anim ? 0 : 1;
        const ring = new St.DrawingArea({width: size, height: size,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        ring.connect('repaint', area => {
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();
            const r = Math.min(w, h) / 2 - STROKE * scale;
            cr.setLineWidth(STROKE * scale);
            cr.setLineCap(1);  // round
            cr.setSourceRGBA(...CREAM, 0.12);
            cr.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
            cr.stroke();
            const level = plugged ? pct / 100 * progress : pct / 100 * (1 - 0.12 * progress);
            if (level > 0.001) {
                const [cr0, cg, cb] = plugged ? CRIMSON : CREAM;
                cr.setSourceRGBA(cr0, cg, cb, plugged ? 1 : 0.55);
                cr.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * level);
                cr.stroke();
            }
            cr.$dispose();
        });
        group.add_child(ring);

        // centre text: number + small caption, no ellipsizing
        const info = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        const numRow = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
        const num = new St.Label({style_class: `csp-number ${mode}`, text: `${anim && plugged ? 0 : pct}`});
        numRow.add_child(num);
        numRow.add_child(new St.Label({style_class: `csp-unit ${mode}`, text: '%',
            y_align: Clutter.ActorAlign.START}));
        info.add_child(numRow);
        const caption = new St.Label({style_class: `csp-caption ${mode}`,
            text: plugged ? 'CHARGING' : 'ON BATTERY', x_align: Clutter.ActorAlign.CENTER});
        caption.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        info.add_child(caption);
        group.add_child(info);

        // above windows and panels, but below the lock screen
        const ui = Main.layoutManager.uiGroup, shield = Main.layoutManager.screenShieldGroup;
        if (shield?.get_parent() === ui)
            ui.insert_child_below(group, shield);
        else
            ui.add_child(group);

        // --- motion ---
        const sweepMs = plugged ? 900 : 500;
        const holdMs = plugged ? 700 : 450;
        group.scale_x = group.scale_y = anim ? 0.92 : 1;
        group.pivot_point = new Graphene.Point({x: 0.5, y: 0.5});

        if (anim) {
            ripples.forEach((r, i) => {
                const [from, to] = plugged ? [0.9, 1.9] : [1.9, 0.95];
                r.set_scale(from, from);
                r.ease({opacity: plugged ? 170 : 120, delay: 120 + i * 220, duration: 140,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => r.ease({opacity: 0, scale_x: to, scale_y: to,
                        duration: 900, mode: Clutter.AnimationMode.EASE_OUT_CUBIC})});
            });

            const tl = this._timeline = new Clutter.Timeline({actor: ring, duration: sweepMs});
            tl.set_progress_mode(Clutter.AnimationMode.EASE_OUT_CUBIC);
            tl.connect('new-frame', () => {
                progress = tl.get_progress();
                if (plugged)
                    num.text = `${Math.round(pct * progress)}`;
                ring.queue_repaint();
            });
            tl.connect('completed', () => {
                progress = 1;
                num.text = `${pct}`;
                ring.queue_repaint();
            });
            tl.start();
        }

        // fade in, hold while the ring sweeps, then fade out (chained so they don't cancel)
        const fadeAfter = Math.max(0, (anim ? sweepMs : 0) + holdMs - 240);
        group.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 240,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => group.ease({opacity: 0, scale_x: anim ? 0.96 : 1,
                scale_y: anim ? 0.96 : 1, delay: fadeAfter, duration: 500,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._group === group)
                        this._clear();
                }})});
    }
}
