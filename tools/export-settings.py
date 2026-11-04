#!/usr/bin/python3 -I
"""Export ALL desktop settings from dconf into config/dconf/settings.ini,
except private data and per-machine state.

Everything is taken (theme, dock, shortcuts, extension settings, app folders,
keyboard layouts, Files / Text Editor / Calculator preferences, notifications...)
and then these are removed:
  - private: Wi-Fi certificate settings, recent folders, file-dialog history,
    emoji/command/song history, location (world clocks, weather), key manager
  - per-machine state: window sizes and positions, "last opened" values,
    update checks, one-time hints, live on/off toggles
The home folder is written as @HOME@ so install.sh can fill in the new user's.
Afterwards the result is checked with tools/check-leaks.py.

Run from the repo root:  python3 tools/export-settings.py
"""
import configparser
import os
import re
import subprocess
import sys

HOME = os.path.expanduser("~")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "config", "dconf", "settings.ini")

# Whole sections (and everything under them) that are never exported.
SKIP_SECTION = re.compile(r"^(" + "|".join([
    r"org/gnome/nm-applet/eap",                 # Wi-Fi enterprise certificate settings
    r"org/gnome/portal/filechooser",            # last folders per app
    r"org/gtk/(gtk4/)?settings/file-chooser",   # file dialog history
    r"apps/seahorse",                           # passwords & keys manager
    r"org/gnome/evolution-data-server",         # accounts / calendars
    r"org/gnome/control-center",                # last opened panel
    r"apps/update-manager", r"com/ubuntu/update-notifier",
    r"org/gnome/shell/world-clocks", r"org/gnome/clocks", r"org/gnome/Weather",
    r"org/gnome/shell/weather", r"org/gnome/GWeather4?",
    r"org/gnome/epiphany", r"org/gnome/online-accounts", r"system/proxy",
    r"desktop/ibus/panel/emoji",                # recently used emoji
    # leftovers from extensions that are no longer installed
    r"org/gnome/shell/extensions/(azclock|coverflowalttab|o-tiling|app-grid-sorter)",
]) + r")(/|$)")
SKIP_SECTION_PART = re.compile(r"(^|/)(window-state|state/window|window)(/|$)")

# Keys that are never exported, in any section.
SKIP_KEY = re.compile(r"^(" + "|".join([
    r"playback-history", r"recently-used", r"recent-.*", r".*-history", r"history",
    r"last-.*", r".*-last-.*", r"welcome-dialog-last-shown-version",
    r"window-(size|width|height|maximized|state|position)", r"(window|sidebar)-width",
    r"width", r"height", r"maximized", r"is-maximized", r"location-data", r"location", r"locations",
    r"selected-player-bus", r"togglestate[0-9]*-setting", r"has-seen-.*", r"first-run",
    r"support-notifier-showed-version", r"update-notifier-project-version",
    r"prefs-visible-page", r"command-history", r"lockscreen-wallpaper-path",
]) + r")$")

# Wallpaper is not part of the copy (user's choice); lock screen too.
SKIP_PAIR = {("org/gnome/desktop/background", "picture-uri"),
             ("org/gnome/desktop/background", "picture-uri-dark"),
             ("org/gnome/desktop/screensaver", "picture-uri")}

# From org/gnome/shell only these keys (the rest is per-machine state).
SHELL_KEYS = {"enabled-extensions", "disabled-extensions", "favorite-apps", "app-picker-layout"}


def installed_extensions():
    found = set()
    for d in (os.path.join(HOME, ".local/share/gnome-shell/extensions"), "/usr/share/gnome-shell/extensions"):
        if os.path.isdir(d):
            found.update(os.listdir(d))
    return found


def main():
    raw = subprocess.run(["dconf", "dump", "/"], capture_output=True, text=True, check=True).stdout
    cp = configparser.RawConfigParser(strict=False, interpolation=None)
    cp.optionxform = str
    cp.read_string(raw)

    have = installed_extensions()
    out = configparser.RawConfigParser(strict=False, interpolation=None)
    out.optionxform = str
    for section in cp.sections():
        name = section.strip("/")
        if SKIP_SECTION.match(name) or SKIP_SECTION_PART.search(name):
            continue
        for key, value in cp.items(section):
            if SKIP_KEY.match(key) or (name, key) in SKIP_PAIR:
                continue
            if name == "org/gnome/shell":
                if key not in SHELL_KEYS:
                    continue
                if key.endswith("extensions"):
                    uuids = [u for u in re.findall(r"'([^']+)'", value) if u in have]
                    value = "[" + ", ".join(f"'{u}'" for u in uuids) + "]"
            if not out.has_section(name):
                out.add_section(name)
            out.set(name, key, value.replace(HOME, "@HOME@"))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("# All desktop settings for this setup (private data removed). install.sh loads it.\n")
        out.write(f, space_around_delimiters=False)
    print(f"wrote {OUT} ({len(out.sections())} sections)")

    # Never leave a leak behind.
    r = subprocess.run([sys.executable, "-I", os.path.join(REPO, "tools", "check-leaks.py")], cwd=REPO)
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
