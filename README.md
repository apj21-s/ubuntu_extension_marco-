# ubuntu_extension_marco

My complete Ubuntu desktop setup, **"I Found You"**: dark obsidian with crimson accents, custom GNOME extensions, desktop effects, helper scripts, background services and system tweaks. One script rebuilds it on another laptop.

Made for **Ubuntu 26.04 · GNOME Shell 50 · Wayland** (built on an HP 250 G9).

---

## Install

```bash
git clone https://github.com/apj21-s/ubuntu_extension_marco-.git
cd ubuntu_extension_marco-
./install.sh
```

To see everything it would do without changing anything, run `./install.sh --dry-run` first.

1. The **user part** runs without a password. It installs the extensions, scripts, services, launchers, default apps, themes, all desktop settings and shortcuts, and optionally Telegram, uv, Rust and Claude Code. It asks for one private thing, your VPN connection name, and keeps the answer only on the laptop.
2. Then it offers the **system part** (password popup):
   - apps: Brave, Google Chrome, Spotify, Proton VPN, Claude Desktop, ChatGPT, Antigravity, VS Code, Android Studio, Docker, Outlook, GitHub CLI
   - packages: VLC, Okular, LibreOffice, PyMOL, Node.js, the Bengali Avro keyboard and more (see `packages.txt`)
   - memory tuning, hotspot guard, weekly cleanup, kdump off, and the rounded-blur library
3. **Log out and back in.** Restart once if you ran the system part.

Everything that gets replaced is backed up first to `~/.ubuntu_extension_marco-backup-<date>/`. That includes a full copy of your settings (`dconf-full.ini`), which you can restore with `dconf load / < dconf-full.ini`.

### Install only one person's features

Every feature is tagged with who made it (arco, sagar, ...). The full list is in **[FEATURES.md](FEATURES.md)**.

```bash
./install.sh --list                    # who made which feature
./install.sh --only arco               # only arco's features
./install.sh --only arco --dry-run     # preview that first
./install.sh --skip sagar              # everything except sagar's
./install.sh --only arco,sagar         # several people
```

The shared base is always installed: themes, cursor, sounds, desktop settings, packages and apps. The filter also applies to the system part, which skips the boot animation, lock screen and other steps made by people you left out.

FEATURES.md and `features.tsv` update themselves. The pre-commit hook regenerates them on every commit, and `.github/workflows/features.yml` regenerates them on every push. The owner of a piece is the `@name` at the end of an extension folder; otherwise it is whoever first committed it. To add a new person, add one line to `tools/authors.txt`. To correct a wrong owner, add a line to `tools/owners-override.txt`.

Things you add yourself (deliberately not in the repo):
- **Wallpaper**: set your own in Settings → Appearance
- **Ambient mode video**: a looping video at `~/Ambient/wallpaper.mp4`
- **Logins**: Wi-Fi, VPN (Proton + your college/work VPN connection), hotspot, and browser and app sign-ins
- **MATLAB**: licensed, so install it yourself from mathworks.com
- Timezone and world clocks stay as you set them

---

## What's inside

### My own extensions (`extensions/custom/`)
| Extension | What it does |
|---|---|
| **Dust Delete** | Files you move to the Trash crumble into dust and drift away, like deleting a message in Telegram |
| **Click Ripple** | A soft crimson ring ripples out from the pointer on every click (white for right-click) |
| **Dot Badges** | A small glowing red dot replaces notification numbers on dock icons |
| **Terminal Copy on Select** | Selecting text in a terminal copies it to the clipboard |
| **Drop Shelf** | A hidden Mac-style shelf at the top center: rest the cursor at the top edge (or drag something there) and it slides out. Drop files, images or text on it, then drag them into any other window |
| **Drag Switch** | While dragging from any app: hold over a dock icon to bring that app's window forward (even on another workspace), hold at the left/right screen edge to switch workspace, push to the dock edge to reveal a hidden dock |
| **Pop-out** | Picture-in-picture for any window: `Super+P` floats a live mini copy of the focused window above everything (keeps playing while you work). Drag to move (snaps to a corner), scroll to resize, double-click to go back, hover for See-through and Close. `Super+P` again closes it; `> popout` in the File Finder pops out any window |
| **Phone Drop** | AirDrop without an app: `Super+B` (or the Drop Shelf's Phone button, Files > right-click > Scripts > Send to phone, `> phone`, or Shift+Enter on a File Finder result) shows a QR code. The phone's camera opens a page to download the files (or all as a zip) and to upload files back into `~/Downloads/Phone Drop/`. Works over your hotspot or the same Wi-Fi; the secret link only works while the window is open |
| **Timers** | Android-style timers from the File Finder (`> timer 25`, `> timer 10 tea`): a countdown next to the clock (click it to pause, add a minute or cancel), a quiet notification with Pause / +1 min / Cancel while it runs, and when it ends an alarm notification that stays on screen with the alarm sound repeating until Stop (or +1 min). Timers survive restarts and logouts |
| **Wallpaper Mood** | The accent colour follows the wallpaper: change the wallpaper and the dock dots, notification badges, click ripple, charging ring, hotspot and screenshot cards, drag bar, Drop Shelf and File Finder all recolour to its most vivid colour within a second. `wallpaper-mood fixed` goes back to the fixed crimson, `wallpaper-mood auto` follows the wallpaper again |
| **Island** | A pill at the top centre for volume and brightness pop-ups, Bluetooth connects, timers and a stopwatch (`island` command for live activities) |
| **Snap Layouts** | `Super+Z` shows Windows 11-style snap zones for the focused window |
| **Power Menu** | `Alt+F4` on the desktop opens a frosted-glass Lock / Sleep / Restart / Shut down menu (on a window it still closes the window) |
| **Power Tiles** | Quick Settings tiles for the battery 80% cap (Lenovo conservation mode) and Quiet / Balanced / Performance |
| **Auto DND** | Do Not Disturb turns on by itself while the mic or camera is in use or the screen is shared |
| **Focus Keeper** | Going back to a workspace focuses the window you were last using there |
| **Fake Airplane** | Shows Airplane Mode in the top bar without changing your real network (`fake-mode` command) |

### Desktop effects and add-ons (`extensions/third-party/`)
These are exact copies of the installed versions, including my small tweak to Dynamic Music Pill: the visualizer glows in the album cover's color, and the pill also shows on the lock screen. Each one keeps its original license.

| Extension | Version | Source |
|---|---|---|
| Blur my Shell | 77 | https://github.com/aunetx/blur-my-shell |
| Burn My Windows (only "Snap" dust when closing windows) | 49 | https://github.com/Schneegans/Burn-My-Windows |
| Compiz windows effect (wobbly windows) | 33 | https://github.com/hermes83/compiz-windows-effect |
| Compiz alike magic lamp effect (genie minimize) | 25 | https://github.com/hermes83/compiz-alike-magic-lamp-effect |
| Dynamic Music Pill (patched) | 1.5.0 | https://github.com/Andbal23/dynamic-music-pill |
| Clipboard Indicator | 71 | https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator |
| Custom Command Toggle | 15 | https://github.com/StorageB/custom-command-toggle |
| Emoji Copy | 40 | https://github.com/felipeftn/emoji-copy |
| Focus Mode | 1 | https://github.com/sagar/focus-mode-extension |
| Internet Speed Meter | 23 | https://github.com/AlShakib/InternetSpeedMeter |
| Just Perfection | 37 | https://gitlab.gnome.org/jrahmatzadeh/just-perfection |
| Notification Sound | 1 | https://codeberg.org/stephaniebread/gnome-notification-sound |
| Rounded Window Corners Reborn | 25 | https://github.com/flexagoon/rounded-window-corners |
| Vitals | 86 | https://github.com/corecoding/Vitals |
| WACK – Sonoma Lockscreen | 2.1.0 | https://github.com/rinzler69-wastaken/wack-sonoma-lockscreen |
| Apps Menu, User Themes | 50.4 | https://gitlab.gnome.org/GNOME/gnome-shell-extensions |
| Dash to Dock, Media Controls (installed, switched off) | 110 / 2.4.4 | https://micheleg.github.io/dash-to-dock/ · https://github.com/cliffniff/media-controls |

The music pill's blur uses [gnome-rounded-blur](https://github.com/kancko/gnome-rounded-blur) (commit `d0e6aa6`). The system part builds it from source.

### Keyboard shortcuts
| Keys | Action |
|---|---|
| `Super+Shift+T` | Copy text from any area of the screen (OCR) |
| `Super+Shift+C` | Ask ChatGPT about the copied text (explain, summarize, translate, fix grammar…) |
| `Super+Shift+E` | Explain the copied error with ChatGPT |
| `Super+Shift+S` | Ask ChatGPT about a screen area |
| `Super+Shift+V` | VPN quick switch (off → college VPN → Proton → off) |
| `Super+Shift+F` | Fix sound |
| `Super+Shift+H` / `Super+Shift+A` | Hotspot toggle / Stay Awake toggle (quick settings) |
| `Super+F` | File finder: one box for files, apps and commands. Type to search every file and app on the computer (Enter opens, Ctrl+Enter shows in Files, drag a result into any app; about 0.1s per search). Type `>` for the command bar: `> wifi off`, `> vpn college`, `> kill chrome`, `> timer 25`, `> calc 18*42`, `> volume 40`, `> dark`, `> lock`. Tab searches inside PDFs, documents and code in Documents and Downloads |
| `Super+P` | Pop out the focused window (picture-in-picture); again to close it |
| `Super+B` | Phone Drop: send or get files with your phone by QR code |
| `Super+F5` | Windows-style refresh (flash + quick health check) |
| `Super+Z` | Snap layouts |
| `Alt+F4` (on the desktop) | Power menu |
| `Super+V` | Clipboard history |
| `Super+Q` | Show the dock |
| `Super+H` | Minimize |
| `Super+Tab` | Switch apps |
| `Alt+Q` | Ambient mode (fullscreen looping video; it also starts by itself after 60 s idle, unless music is playing) |

### Scripts (`bin/` → `~/.local/bin`)
| Script | What it does |
|---|---|
| `power-auto` | Power Saver on battery, Balanced on charger; on battery it also turns off the music pill's live visualizer |
| `headphone-magic` | Pauses music when headphones are unplugged and resumes it when they're plugged back in (wired and Bluetooth) |
| `organize-downloads` | Sorts new downloads into folders (PDFs, Images, Documents…); old installers go to the Trash after 30 days |
| `session-keeper` | Remembers open apps, folders and terminal tabs, and offers once at login to reopen them after a restart |
| `fix-audio` | Restarts the sound system if it breaks, and checks at login |
| `fix-touchpad` | Reloads the touchpad when multi-finger gestures, scrolling or tap stop working (Super+F5 Refresh does it too, and it runs by itself after waking from sleep) |
| `refresh` / `refresh-flash` | Windows-style refresh with a health report |
| `ocr-copy`, `screen-area` | Copy text from the screen |
| `ask-chatgpt` | ChatGPT helpers for the shortcuts above |
| `notify` | Android-style notifications that hide by themselves |
| `stay-awake` | Keeps the laptop awake, even with the lid closed |
| `hotspot`, `hotspot-devices` | Mobile hotspot on/off, and list or unblock devices |
| `vpn`, `protonvpn-slow` | VPN switcher (college NetworkManager VPN + Proton VPN) |
| `docker-toggle` | Starts and stops Docker on demand to save memory |
| `weekly-tidy` | Weekly cleanup with a report |
| `welcome` | Terminal welcome screen: greeting, status chips, weather, a quote |
| `drop-shelf` | The Drop Shelf app (started and positioned by the Drop Shelf extension) |
| `file-finder` | The Super+F file finder (starts hidden at login). Searches the system file index (refreshed every 15 min on the charger, hourly on battery, and after every apt install), watches the home folder and USB drives live so brand-new files show at once, indexes each USB drive when plugged in, and hides deleted files. The lock button (Ctrl+Shift+A) also searches protected files after one password popup |
| `phone-drop` | Phone Drop: `phone-drop FILE...` shares files with your phone by QR code; on its own it receives |
| `wallpaper-mood` | Works out the accent colours from the wallpaper (the Wallpaper Mood extension runs it when the wallpaper changes) |
| `find-files` | A lighter file finder for your home folder, using `fd` with no background indexing. No shortcut by default (Super+F opens File Finder) |
| `island` | Send live activities (timers, progress) to the Island pill |
| `fake-mode` | Turn Fake Airplane on or off |

### Background services (`systemd/user/`)
`power-auto`, `headphone-magic`, `fix-audio-login`, `organize-downloads` (path + daily timer), `session-keeper` (save every 2 min + restore at login), `weekly-tidy` (Sundays) and `ambient` (idle monitor, off by default). File indexing (localsearch/tracker) is switched off.

### Look
- **Cursor**: `IFoundYou-Premium`, obsidian with crimson accents. The shapes come from [Bibata Modern](https://github.com/ful1e5/Bibata_Cursor) (GPL-3.0). `IFoundYou-cursor` is a simpler generated version (`tools/make_cursor.py`).
- **Sound theme**: `i-found-you`, soft original sounds generated by `tools/make_sounds.py`.
- **Terminal**: Ptyxis with the `I Found You` palette at 83% opacity and frosted blur, a two-line crimson prompt with git branch and error code, `eza`, `bat`, `fzf`, `zoxide`, and fastfetch.
- **Theme**: Yaru-sage-dark, dark mode, auto-hiding translucent dock, Night Light.
- **Lock and login screen** (`login-style@sagar`, installed system-wide by the system part): frosted background made from your wallpaper, big clock with greeting and quotes, profile cards, crimson accents, and a 4-circle PIN that signs in on the 4th digit (a letter or a 5th character brings back the normal password box)
- **Boot and restart animation**: Plymouth theme `I Found You` (faint mask, glowing crimson line, "i found you")
- **Space** in Files previews the selected file (GNOME Sushi)

### System part (`system/`)
- zram swap (1.5× RAM, zstd), earlyoom, and tuned memory settings (swappiness, MGLRU)
- Logs capped at 300 MB; snaps keep only 2 old versions; weekly `apt autoremove` + clean
- **Hotspot guard**: a popup with Allow / Kick / Block when a new device joins your hotspot (the "Blocked" popup has an Unblock button)
- **Hotspot tile** (`hotspot-devices@arco`): Android-style tile in Quick Settings (replaces the old Mobile Hotspot and Stay Awake tiles) - turn the hotspot on/off, Stay awake switch, see connected devices, Kick / Block them, Unblock blocked ones, Forget trusted ones
- **Screenshot card** (`screenshot-card@arco`): after a screenshot a card slides in bottom-right with Save / Open / Copy / Delete; the file is only kept in ~/Pictures/Screenshots if you press Save (the image stays in the clipboard)
- **Charging splash** (`charging-splash@arco`): plugging in sends a crimson glow up from the bottom with the battery %; unplugging gives a short dim pulse
- **Phone Float** (`phone-float@arco` + `bin/phone-float`): while you drag a file or text from any app, a phone floats in at the right edge; drop on it to send it with Phone Drop
- Hotspot automatically turns on Stay Awake
- Sudo rules so `docker-toggle` and `hotspot-devices` don't ask for a password
- Intel SOF sound fix (only applied on Intel laptops that need it)
- Login screen settings (no Ubuntu logo, 12-hour clock, dark mode, red accent, IFoundYou cursor, tap-to-click), lock/login extension and boot animation
- `battery-cap` helper + sudo rule for the Power Tiles 80% battery cap (Lenovo)
- NVIDIA GPU powers down when idle (only applied on laptops with an NVIDIA GPU)
- Wi-Fi region set to India (`system/modprobe/cfg80211.conf`; change `IN` for another country)

---

## Not included (private)
- VPN logins, the hotspot password, Wi-Fi passwords and Spotify login stay on the original laptop. Set up your own VPN connection (`install.sh` asks for its name and keeps it only on your laptop, in `~/.config/ubuntu_extension_marco/local.conf`) and a hotspot named `Hotspot`.
- Personal history and per-machine state: recent folders, file-dialog history, played songs, emoji history, window sizes, Wi-Fi certificate settings, location (timezone, world clocks).
- Browser profiles, keyrings, SSH/GPG keys, and app data (Telegram, Spotify).

## Leak protection
This repo is public, so it guards itself:
- `tools/check-leaks.py` blocks home-folder paths, e-mail addresses, MAC addresses, private keys, API tokens, passwords, private IPs, location data and wallpaper/video files. It also blocks any word you list in `~/.config/ubuntu_extension_marco/private-words`, a file that stays on your laptop only (put your real name, e-mails or college name there). Your git e-mail is added to that list automatically.
- It runs on **every commit** as a git hook (`.githooks/pre-commit`; `install.sh` turns it on in a clone) and on **every push** on GitHub (`.github/workflows/leak-check.yml`, plus gitleaks).
- Commits use GitHub's private noreply e-mail.

## Updating the repo from the laptop
After changing settings, run `python3 tools/export-settings.py`. It refreshes `config/dconf/settings.ini`, strips private data, and runs the leak check.
