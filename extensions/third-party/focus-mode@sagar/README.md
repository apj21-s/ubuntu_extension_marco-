# Focus Mode (`focus-mode@sagar`)

A native GNOME Shell 50.1 Quick Settings toggle that stores a single
boolean — `focus-mode` — in GSettings. It does **not** launch MPV,
run shell scripts, or start Ambient Mode itself. It only flips a
persisted flag that your existing `idle_monitor.py` reads.

## Directory layout

```
focus-mode@sagar/
├── metadata.json
├── extension.js
├── prefs.js
├── stylesheet.css
├── schemas/
│   └── org.sagar.ambient.gschema.xml
├── install.sh
├── uninstall.sh
└── README.md
```

## Install

```bash
cd ~/focus-mode@sagar
chmod +x install.sh uninstall.sh
./install.sh
```

On **Wayland** (default for GNOME 50.1) you must **log out and back
in** once after the first install for the tile to appear — GNOME
Shell cannot restart in place on Wayland. On subsequent updates to
`extension.js`/`prefs.js` you still need to log out/in (or use
`Alt+F2 r` if you're ever on X11).

## Verify it loaded

```bash
gnome-extensions list | grep focus-mode
gnome-extensions info focus-mode@sagar
```

## Uninstall

```bash
cd ~/focus-mode@sagar
./uninstall.sh
```

## Reading the state manually

```bash
gsettings get org.sagar.ambient focus-mode
gsettings set org.sagar.ambient focus-mode true
```

## Wiring into `idle_monitor.py`

Add this near the top of your existing `idle_monitor.py` and gate
your idle-detection loop with it. Two equivalent options:

**Option A — subprocess call (simplest, no new deps):**

```python
import subprocess

def focus_mode_enabled() -> bool:
    result = subprocess.run(
        ["gsettings", "get", "org.sagar.ambient", "focus-mode"],
        capture_output=True, text=True, check=False
    )
    return result.stdout.strip() == "true"

# inside your main loop, before triggering Ambient Mode:
if not focus_mode_enabled():
    continue  # or return, depending on your loop structure
```

**Option B — Gio.Settings (native, no subprocess overhead):**

```python
import gi
gi.require_version("Gio", "2.0")
from gi.repository import Gio

_settings = Gio.Settings.new("org.sagar.ambient")

def focus_mode_enabled() -> bool:
    return _settings.get_boolean("focus-mode")

# inside your main loop, before triggering Ambient Mode:
if not focus_mode_enabled():
    continue
```

Option B also lets you subscribe to live changes instead of polling:

```python
def on_focus_mode_changed(settings, key):
    print("focus-mode changed:", settings.get_boolean(key))

_settings.connect("changed::focus-mode", on_focus_mode_changed)
```

Note: because this extension's schema lives only inside the
extension's own `schemas/` directory (compiled there by
`install.sh`), `Gio.Settings.new("org.sagar.ambient")` from a
**standalone Python process** will only find it if that schema path
is on `GSETTINGS_SCHEMA_DIR`, e.g.:

```bash
export GSETTINGS_SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/focus-mode@sagar/schemas"
```

Add that `export` line to the top of wherever you launch
`idle_monitor.py` (e.g. its systemd unit or your shell profile), or
just use Option A (`gsettings get`), which resolves the schema
search path itself and requires no extra environment setup.

## UI behavior

- **Tile:** "Focus Mode" / "Ambient Automation", icon
  `selection-mode-symbolic`, sits with Night Light / Dark Style /
  Bluetooth / Do Not Disturb in Quick Settings.
- **OFF:** grey, `focus-mode` = `false`.
- **ON:** accent-colored (same visual treatment as Night Light),
  `focus-mode` = `true`, and a matching icon appears in the top
  panel indicator area.
- State is stored in dconf via GSettings and **persists across
  reboot** automatically — no text/JSON/lock files involved.
