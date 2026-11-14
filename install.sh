#!/bin/bash
# Install the whole "I Found You" desktop setup for the current user.
#
#   ./install.sh             everything: user part, then the system part (password popup)
#   ./install.sh --user      user part only
#   ./install.sh --dry-run   only print what would be done, change nothing
#   ./install.sh --list      show who made which feature (FEATURES.md has the details)
#   ./install.sh --only arco only features made by arco (comma list: --only arco,sagar)
#   ./install.sh --skip sagar everything except sagar's features
# The shared base (themes, sounds, desktop settings, packages, apps) is always installed.
#
# Made for Ubuntu 26.04 / GNOME Shell 50 (Wayland). Run as your normal user, not root.
# Everything it replaces is backed up first to ~/.ubuntu_extension_marco-backup-<date>/.
# Not included on purpose: the wallpaper, the Ambient video, passwords and personal history.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
DRY=0; USER_ONLY=0; LIST=0
. "$REPO/tools/owners.sh"
parse_owner_args "$@"
for a in "${REST[@]}"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --user) USER_ONLY=1 ;;
    --list) LIST=1 ;;
    *) echo "Unknown option: $a"; exit 2 ;;
  esac
done
if [ $LIST = 1 ]; then
  awk -F'\t' '!/^#/ && $2!="system-step" {f[$1]=f[$1] (index(" " f[$1] " ", " " $4 " ") ? "" : " " $4)}
    !/^#/ && $2=="system-step" {s[$1]++}
    END {for (o in f) {print o ":"; print "  features:" f[o]; if (s[o]) print "  system steps: " s[o]; print ""}}' \
    "$FEATURES_TSV"
  echo "Details: FEATURES.md   Install a subset: ./install.sh --only <name>  or  --skip <name>"
  exit 0
fi
[ "$(id -u)" != 0 ] || { echo "Run this as your normal user (not with sudo)."; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$HOME/.ubuntu_extension_marco-backup-$STAMP"
LOCAL_DIR="$HOME/.config/ubuntu_extension_marco"
LOCAL_CONF="$LOCAL_DIR/local.conf"   # private answers; never part of the repo
WIFI=$(iw dev 2>/dev/null | awk '$1=="Interface"{print $2; exit}')
WIFI=${WIFI:-wlo1}
VPN_NAME=""
[ -f "$LOCAL_CONF" ] && . "$LOCAL_CONF"

step() { echo; echo "==> $*"; }
# Run a command, or just show it in --dry-run.
run() { if [ $DRY = 1 ]; then echo "   would run: $*"; else "$@"; fi; }
# Fill in the placeholders for this user and machine.
render() {
  sed -e "s#@HOME@#$HOME#g" -e "s#@USER@#$USER#g" -e "s#@UID@#$(id -u)#g" \
      -e "s#@WIFI@#$WIFI#g" -e "s#@VPN_NAME@#$(printf '%s' "$VPN_NAME" | sed 's/[#&\\]/\\&/g')#g" "$1"
}
# Copy a file or folder into place, keeping a backup of whatever was there.
put() {  # put SRC DEST
  local src=$1 dest=$2
  if [ $DRY = 1 ]; then echo "   would install: ${dest/#$HOME/~}"; return; fi
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    mkdir -p "$BACKUP$(dirname "$dest")"
    cp -a "$dest" "$BACKUP$dest"
    rm -rf "$dest"
  fi
  mkdir -p "$(dirname "$dest")"
  cp -a "$src" "$dest"
}
# Like put, but fills in placeholders first (for text files that need them).
put_rendered() {  # put_rendered SRC DEST MODE
  local tmp; tmp=$(mktemp); render "$1" > "$tmp"; chmod "$3" "$tmp"
  put "$tmp" "$2"; rm -f "$tmp"
}
ask() {  # ask "question" -> 0 for yes (default yes)
  [ $DRY = 1 ] && { echo "   (would ask) $1"; return 0; }
  local a; read -r -p "$1 [Y/n] " a; [ "${a:-y}" != n ] && [ "${a:-y}" != N ]
}

ver=$(gnome-shell --version 2>/dev/null | awk '{print int($3)}')
if [ "${ver:-0}" != 50 ] && [ "${ver:-0}" != 51 ]; then
  echo "Warning: this setup was made for GNOME Shell 50 (you have ${ver:-unknown})."
  if [ $DRY = 0 ]; then read -r -p "Continue anyway? [y/N] " a; [ "$a" = y ] || exit 1; fi
fi
[ $DRY = 1 ] && echo "DRY RUN: nothing will be changed."
[ -n "$ONLY$SKIP" ] && echo "Owner filter: only=${ONLY:-all} skip=${SKIP:-none} (shared base always installed)"
# put_if KIND REPO_PATH DEST [MODE]: install one owned piece if the owner filter keeps it.
put_if() {
  if ! wanted "$1" "$2"; then echo "   skipped ${2} (made by $(owner_of "$1" "$2"))"; return 0; fi
  if [ $# = 4 ]; then put_rendered "$REPO/$2" "$3" "$4"; else put "$REPO/$2" "$3"; fi
}
SKIPPED_EXT=()

step "Private answers (kept only in ${LOCAL_CONF/#$HOME/~}, never in the repo)"
if [ -z "$VPN_NAME" ] && [ $DRY = 0 ]; then
  read -r -p "   Name of your college/work VPN connection in Wi-Fi settings (Enter to skip): " VPN_NAME
fi
echo "   VPN connection: ${VPN_NAME:-(none)}"
if [ $DRY = 0 ]; then
  mkdir -p "$LOCAL_DIR"; printf 'VPN_NAME=%q\n' "$VPN_NAME" > "$LOCAL_CONF"; chmod 600 "$LOCAL_CONF"
fi

if [ $DRY = 0 ]; then
  step "Backing up your current settings to $BACKUP"
  mkdir -p "$BACKUP"
  dconf dump / > "$BACKUP/dconf-full.ini"
fi

step "GNOME extensions"
for d in "$REPO"/extensions/custom/*/ "$REPO"/extensions/third-party/*/; do
  rel=${d#"$REPO"/}; rel=${rel%/}
  kind=extension; [[ $rel == extensions/third-party/* ]] && kind=third-party
  wanted $kind "$rel" || SKIPPED_EXT+=("$(basename "$rel")")
  put_if $kind "$rel" "$HOME/.local/share/gnome-shell/extensions/$(basename "$rel")"
done

# extensions with their own settings (e.g. Pop-out's shortcut) need their schemas compiled
for s in "$HOME"/.local/share/gnome-shell/extensions/*/schemas; do
  [ -d "$s" ] && run glib-compile-schemas "$s"
done

step "Scripts (~/.local/bin)"
for f in "$REPO"/bin/*; do
  [ -f "$f" ] || continue
  put_if script "bin/$(basename "$f")" "$HOME/.local/bin/$(basename "$f")" 755
done

step "Files right-click scripts (Send to phone)"
for f in "$REPO"/config/nautilus-scripts/*; do
  put_if files-menu "config/nautilus-scripts/$(basename "$f")" "$HOME/.local/share/nautilus/scripts/$(basename "$f")"
done

step "App launchers and default apps"
for f in "$REPO"/applications/*.desktop; do
  put_if launcher "applications/$(basename "$f")" "$HOME/.local/share/applications/$(basename "$f")" 644
done
put "$REPO/config/mime/mimeapps.list" "$HOME/.config/mimeapps.list"

step "Background services"
for f in "$REPO"/systemd/user/*; do
  put_if service "systemd/user/$(basename "$f")" "$HOME/.config/systemd/user/$(basename "$f")"
done
run systemctl --user daemon-reload
for u in fix-audio-login.service headphone-magic.service organize-downloads.path \
  organize-downloads.timer power-auto.service session-keeper-restore.service \
  session-keeper-save.timer weekly-tidy.timer; do
  wanted service "systemd/user/$u" && run systemctl --user enable "$u"
done
# File indexing off (saves CPU and battery).
run systemctl --user mask localsearch-3.service localsearch-control-3.service \
  tracker-miner-fs-3.service tracker-miner-fs-control-3.service

step "Startup items"
put_if startup autostart/login-sound.desktop "$HOME/.config/autostart/login-sound.desktop"
put_if startup autostart/file-finder.desktop "$HOME/.config/autostart/file-finder.desktop" 644
for f in "$REPO"/autostart/disabled/*.desktop; do
  put_if startup "autostart/disabled/$(basename "$f")" "$HOME/.config/autostart/$(basename "$f")"
done

step "Ambient mode (Alt+Q)"
for f in "$REPO"/ambient/*; do put_if ambient "ambient/$(basename "$f")" "$HOME/Ambient/$(basename "$f")" 755; done
[ -f "$HOME/Ambient/wallpaper.mp4" ] || echo "   Add your own looping video at ~/Ambient/wallpaper.mp4 to use Ambient mode."

step "Cursor, sounds, terminal palette, welcome screen, window effects"
put "$REPO/themes/icons/IFoundYou-Premium" "$HOME/.local/share/icons/IFoundYou-Premium"
put "$REPO/themes/icons/IFoundYou-cursor" "$HOME/.local/share/icons/IFoundYou-cursor"
put "$REPO/themes/sounds/i-found-you" "$HOME/.local/share/sounds/i-found-you"
put "$REPO/config/ptyxis/i-found-you.palette" "$HOME/.local/share/org.gnome.Ptyxis/palettes/i-found-you.palette"
put "$REPO/config/fastfetch/config.jsonc" "$HOME/.config/fastfetch/config.jsonc"
put "$REPO/config/welcome/quotes.txt" "$HOME/.config/welcome/quotes.txt"
for f in "$REPO"/config/burn-my-windows/*.conf; do put "$f" "$HOME/.config/burn-my-windows/profiles/$(basename "$f")"; done

step "Bash prompt, welcome screen and terminal tools (~/.bashrc)"
if grep -q ">>> welcome-screen" "$HOME/.bashrc" 2>/dev/null; then
  echo "   already in ~/.bashrc"
elif [ $DRY = 1 ]; then
  echo "   would add the prompt/welcome/terminal-tools blocks to ~/.bashrc"
else
  cp -a "$HOME/.bashrc" "$BACKUP/bashrc" 2>/dev/null || true
  { echo; cat "$REPO/config/shell/bashrc-snippet.sh"; } >> "$HOME/.bashrc"
fi

step "Spotify: cap its cache at 1 GB"
if [ ! -f "$HOME/.config/spotify/prefs" ]; then
  if [ $DRY = 1 ]; then echo "   would write ~/.config/spotify/prefs (storage.size=1024)"
  else mkdir -p "$HOME/.config/spotify"; echo "storage.size=1024" > "$HOME/.config/spotify/prefs"; fi
else
  echo "   Spotify already set up here - left alone"
fi

step "Desktop settings (theme, dock, shortcuts, extensions, app folders, keyboard, app preferences)"
if [ $DRY = 1 ]; then
  echo "   would load $(grep -c '^\[' "$REPO/config/dconf/settings.ini") settings groups into dconf"
else
  # Leave skipped extensions out of the enabled list.
  sk=(-e '')
  for e in "${SKIPPED_EXT[@]}"; do
    q="'${e//./\\.}'"
    sk+=(-e "/^enabled-extensions=/{s/, $q//g;s/$q, //g;s/\\[$q\\]/@as []/g}")
  done
  render "$REPO/config/dconf/settings.ini" | sed "${sk[@]}" | dconf load /
fi

step "Your tools: Telegram, uv (Python), Rust, Claude Code"
if ask "   Install them now (downloads from the official sites)?"; then
  if [ ! -x "$HOME/.local/opt/Telegram/Telegram" ]; then
    if [ $DRY = 1 ]; then echo "   would install Telegram to ~/.local/opt/Telegram"
    else
      T=$(mktemp -d)
      curl -fL -o "$T/tsetup.tar.xz" https://telegram.org/dl/desktop/linux && \
        mkdir -p "$HOME/.local/opt" && tar -xJf "$T/tsetup.tar.xz" -C "$HOME/.local/opt" && \
        echo "   Telegram installed (open it once from ~/.local/opt/Telegram/Telegram to add it to the app list)"
      rm -rf "$T"
    fi
  fi
  command -v uv >/dev/null || run sh -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
  command -v rustup >/dev/null || [ -x "$HOME/.cargo/bin/rustup" ] || run sh -c "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
  command -v claude >/dev/null || run bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
fi

# If this is a git clone, turn on the leak guard for any commits made from it.
if [ -d "$REPO/.git" ]; then run git -C "$REPO" config core.hooksPath .githooks; fi

echo
[ $DRY = 1 ] && { echo "Dry run finished. Nothing was changed."; exit 0; }
echo "User part done. Backup of everything replaced: $BACKUP"

if [ $USER_ONLY = 0 ]; then
  echo
  echo "The system part installs the apps, packages and root helpers (memory tuning, hotspot"
  echo "guard, weekly cleanup, kdump off, rounded blur). It needs your password."
  if ask "Run the system part now?"; then
    mapfile -t OA < <(owner_args)
    if command -v pkexec >/dev/null; then pkexec bash "$REPO/system/install-system.sh" "$USER" "${OA[@]}"
    else sudo bash "$REPO/system/install-system.sh" "$USER" "${OA[@]}"; fi
  else
    echo "Later: sudo bash $REPO/system/install-system.sh $USER $(owner_args | tr '\n' ' ')"
  fi
fi

echo
echo "All done. Log out and back in (needed on Wayland for the extensions to load)."
echo "Still yours to add: a wallpaper at ~/.config/background, your VPN and Wi-Fi logins,"
echo "browser sign-ins, and MATLAB (licensed - install it from mathworks.com)."
