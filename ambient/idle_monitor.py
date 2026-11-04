#!/usr/bin/env python3

import subprocess
from pathlib import Path

from gi.repository import Gio, GLib

# ------------------------------------------------------------
# Configuration
# ------------------------------------------------------------

AMBIENT_DIR = Path.home() / "Ambient"

SCRIPT = str(AMBIENT_DIR / "toggle-ambient.sh")
LOCK_FILE = AMBIENT_DIR / ".ambient_running"

# Idle timeout in milliseconds
# 45000 = 45 seconds
IDLE_TIMEOUT = 60000
# ------------------------------------------------------------
# DBus
# ------------------------------------------------------------

BUS = Gio.bus_get_sync(Gio.BusType.SESSION, None)

proxy = Gio.DBusProxy.new_sync(
    BUS,
    Gio.DBusProxyFlags.NONE,
    None,
    "org.gnome.Mutter.IdleMonitor",
    "/org/gnome/Mutter/IdleMonitor/Core",
    "org.gnome.Mutter.IdleMonitor",
    None,
)

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

def ambient_running():
    if not LOCK_FILE.exists():
        return False
    # Clear a stale lock left behind if the video player is no longer running.
    if subprocess.run(["pgrep", "-f", "mpv.*wallpaper.mp4"],
                      stdout=subprocess.DEVNULL).returncode != 0:
        LOCK_FILE.unlink(missing_ok=True)
        return False
    return True


def media_is_playing():
    """
    Returns True if any MPRIS media player is currently playing.
    """

    try:
        output = subprocess.check_output(
            ["busctl", "--user", "list"],
            text=True,
        )

        for line in output.splitlines():

            if "org.mpris.MediaPlayer2." not in line:
                continue

            service = line.split()[0]

            try:
                status = subprocess.check_output(
                    [
                        "busctl",
                        "--user",
                        "get-property",
                        service,
                        "/org/mpris/MediaPlayer2",
                        "org.mpris.MediaPlayer2.Player",
                        "PlaybackStatus",
                    ],
                    text=True,
                ).strip()

                if "Playing" in status:
                    print(f"Media playing: {service}", flush=True)
                    return True

            except subprocess.CalledProcessError:
                continue

    except Exception as e:
        print(f"MPRIS detection failed: {e}", flush=True)

    return False


def add_idle_watch():
    result = proxy.call_sync(
        "AddIdleWatch",
        GLib.Variant("(t)", (IDLE_TIMEOUT,)),
        Gio.DBusCallFlags.NONE,
        -1,
        None,
    )
    return result.unpack()[0]

# ------------------------------------------------------------
# Callback
# ------------------------------------------------------------

def on_idle(connection, sender, path, interface, signal, params):

    # Mutter idle watches are persistent (they fire every time you go idle),
    # so never add another one here. Only react to our own watch.
    if params.unpack()[0] != WATCH_ID:
        return

    if ambient_running():
        print("Ambient Mode already running.", flush=True)
        return

    if media_is_playing():
        print("Media is playing. Skipping Ambient Mode.", flush=True)
        return

    print("Starting Ambient Mode...", flush=True)

    subprocess.Popen([SCRIPT])

# ------------------------------------------------------------
# Subscribe
# ------------------------------------------------------------

BUS.signal_subscribe(
    "org.gnome.Mutter.IdleMonitor",
    "org.gnome.Mutter.IdleMonitor",
    "WatchFired",
    "/org/gnome/Mutter/IdleMonitor/Core",
    None,
    Gio.DBusSignalFlags.NONE,
    on_idle,
)

WATCH_ID = add_idle_watch()

print("Ambient Idle Monitor started.", flush=True)

GLib.MainLoop().run()
