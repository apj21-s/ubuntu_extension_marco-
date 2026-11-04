#!/bin/bash
# System part of the setup (needs root). install.sh runs it for you, or:
#   sudo bash system/install-system.sh <your-username>
set -uo pipefail

[ "$(id -u)" = 0 ] || { echo "Run with sudo: sudo bash $0 <your-username>"; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$SRC")"
TARGET=${1:-${SUDO_USER:-}}
[ -n "$TARGET" ] && id "$TARGET" >/dev/null 2>&1 || { echo "Usage: $0 <your-username>"; exit 1; }
T_UID=$(id -u "$TARGET"); T_HOME=$(getent passwd "$TARGET" | cut -d: -f6)
WIFI=$(iw dev 2>/dev/null | awk '$1=="Interface"{print $2; exit}'); WIFI=${WIFI:-wlo1}

step() { echo; echo "==> $*"; }
render() {
  sed -e "s#@HOME@#$T_HOME#g" -e "s#@USER@#$TARGET#g" -e "s#@UID@#$T_UID#g" -e "s#@WIFI@#$WIFI#g" "$1"
}
put() {  # put SRC DEST MODE  (renders placeholders)
  local tmp; tmp=$(mktemp); render "$1" > "$tmp"
  [ -e "$2" ] && cp -a "$2" "$2.before-ubuntu_extension_marco" 2>/dev/null
  install -D -m "$3" "$tmp" "$2"; rm -f "$tmp"
}

step "Packages"
apt-get update -qq
xargs -a <(grep -vE '^\s*(#|$)' "$REPO/packages.txt") apt-get install -y
if lspci 2>/dev/null | grep -qiE "VGA.*Intel"; then
  apt-get install -y intel-media-va-driver-non-free   # Intel video hardware decoding
fi

step "Apps (Brave, Chrome, Spotify, Proton VPN, Claude, ChatGPT, Antigravity, VS Code, Android Studio, Docker, Outlook, GitHub CLI)"
bash "$SRC/apps.sh"

step "kdump off (frees 320-512 MB of RAM reserved for crash dumps)"
[ -f /etc/default/grub.d/kdump-tools.cfg ] && mv /etc/default/grub.d/kdump-tools.cfg /etc/default/grub.d/kdump-tools.cfg.disabled
[ -f /etc/default/kdump-tools ] && sed -i 's/^USE_KDUMP=.*/USE_KDUMP=0/' /etc/default/kdump-tools
systemctl disable kdump-tools 2>/dev/null || true
update-grub 2>/dev/null || true

step "Memory: zram swap (1.5x RAM) + earlyoom + tuned kernel settings"
put "$SRC/zram/zram-generator.conf" /etc/systemd/zram-generator.conf 644
put "$SRC/sysctl/99-zram.conf" /etc/sysctl.d/99-zram.conf 644
put "$SRC/tmpfiles/mglru.conf" /etc/tmpfiles.d/mglru.conf 644
put "$SRC/earlyoom/earlyoom" /etc/default/earlyoom 644
sysctl -q --system
systemd-tmpfiles --create /etc/tmpfiles.d/mglru.conf 2>/dev/null
systemctl daemon-reload
systemctl enable --now earlyoom
systemctl restart systemd-zram-setup@zram0.service 2>/dev/null || true

step "Logs capped at 300 MB, snaps keep 2 old versions"
put "$SRC/journald/size.conf" /etc/systemd/journald.conf.d/size.conf 644
systemctl restart systemd-journald
command -v snap >/dev/null && snap set system refresh.retain=2

step "Weekly system tidy (Sundays)"
put "$SRC/sbin/weekly-tidy-root" /usr/local/sbin/weekly-tidy-root 755
put "$SRC/systemd/weekly-tidy-root.service" /etc/systemd/system/weekly-tidy-root.service 644
put "$SRC/systemd/weekly-tidy-root.timer" /etc/systemd/system/weekly-tidy-root.timer 644
systemctl daemon-reload
systemctl enable --now weekly-tidy-root.timer

step "Hotspot guard (asks before new devices use your hotspot) + Stay Awake link"
put "$SRC/sbin/hotspot-guard" /usr/local/sbin/hotspot-guard 755
put "$SRC/sbin/hotspot-guard-notify" /usr/local/sbin/hotspot-guard-notify 755
put "$SRC/systemd/hotspot-guard.service" /etc/systemd/system/hotspot-guard.service 644
put "$SRC/networkmanager/90-hotspot-stay-awake" /etc/NetworkManager/dispatcher.d/90-hotspot-stay-awake 755
systemctl daemon-reload
systemctl enable --now hotspot-guard.service
if nmcli -t -f NAME connection show | grep -qx Hotspot; then
  nmcli connection modify Hotspot 802-11-wireless.powersave 2
else
  echo "   No 'Hotspot' connection yet: turn on Wi-Fi Hotspot once in Settings (name it 'Hotspot')."
fi

step "Password-free helpers (sudo rules)"
for f in "$SRC"/sudoers/*; do
  dest=/etc/sudoers.d/$(basename "$f")
  put "$f" "$dest" 440
  visudo -c -q -f "$dest" || { echo "   rule $(basename "$f") invalid - removed"; rm -f "$dest"; }
done

step "Intel SOF sound fix"
if lspci 2>/dev/null | grep -qiE "audio.*(Alder|Tiger|Raptor|Jasper|Comet|Meteor)" ; then
  put "$SRC/modprobe/intel-audio.conf" /etc/modprobe.d/intel-audio.conf 644
  echo "   applied (takes effect after a restart)"
else
  echo "   skipped (only for Intel SOF laptops like the HP 250 G9)"
fi

step "Rounded blur library (for the music pill's blur)"
B=$(mktemp -d)
if git clone -q https://github.com/kancko/gnome-rounded-blur "$B/src" && git -C "$B/src" checkout -q d0e6aa6; then
  ( cd "$B/src" && meson setup build --prefix=/usr --libdir=lib >/dev/null && meson compile -C build >/dev/null && meson install -C build >/dev/null ) \
    && echo "   installed" || echo "   build failed - the music pill still works, just without its blur"
fi
rm -rf "$B"

echo
echo "System part done. Restart the laptop once so memory and sound settings apply."
