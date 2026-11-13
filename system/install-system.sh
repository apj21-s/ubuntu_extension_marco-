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

step "File index for the Super+F file finder (plocate)"
# Refreshed every 15 minutes on the charger, hourly on battery, and right after every
# apt install/remove. The finder itself watches home and USB drives live in between.
put "$SRC/sbin/file-index-due" /usr/local/sbin/file-index-due 755
put "$SRC/file-finder/often.conf" /etc/systemd/system/plocate-updatedb.timer.d/often.conf 644
put "$SRC/file-finder/battery.conf" /etc/systemd/system/plocate-updatedb.service.d/battery.conf 644
rm -f /etc/systemd/system/plocate-updatedb.service.d/battery-too.conf   # older version of battery.conf
put "$SRC/file-finder/99file-finder-index" /etc/apt/apt.conf.d/99file-finder-index 644
# "Protected files" mode: a root helper the finder starts with one password popup.
put "$SRC/sbin/file-finder-root" /usr/local/sbin/file-finder-root 755
put "$SRC/file-finder/io.arco.file-finder.policy" /usr/share/polkit-1/actions/io.arco.file-finder.policy 644
systemctl daemon-reload
systemctl enable --now plocate-updatedb.timer
systemctl start --no-block plocate-updatedb.service

step "Phone Drop: let phones on your hotspot / Wi-Fi reach it (TCP 47800 on $WIFI)"
# The hotspot and Wi-Fi share the Wi-Fi card, so one rule covers both. The port only
# listens while the Phone Drop window is open, and every link needs its random secret.
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow in on "$WIFI" to any port 47800 proto tcp comment "Phone Drop" >/dev/null
  echo "   firewall rule added"
else
  echo "   firewall is off - nothing to do"
fi

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

step "Touchpad reload helper (used by fix-touchpad and Super+F5 Refresh)"
put "$SRC/sbin/touchpad-reload" /usr/local/sbin/touchpad-reload 755
put "$SRC/system-sleep/touchpad-reload" /usr/lib/systemd/system-sleep/touchpad-reload 755   # also after waking from sleep

step "Lock screen and login screen (frosted background, big clock, quotes, 4-circle PIN)"
E=/usr/share/gnome-shell/extensions/login-style@sagar
rm -rf "$E"; install -d "$E"; install -m 644 "$SRC/login-style/extension/"* "$E/"
install -D -m 644 "$REPO/config/welcome/quotes.txt" /usr/share/login-style/quotes.txt
[ -d /usr/share/icons/IFoundYou-Premium ] || cp -r "$REPO/themes/icons/IFoundYou-Premium" /usr/share/icons/   # login-screen cursor
chmod -R a+rX /usr/share/icons/IFoundYou-Premium
[ -e /etc/dconf/profile/gdm ] || put "$SRC/login-style/gdm-profile" /etc/dconf/profile/gdm 644
put "$SRC/login-style/90-sagar-login" /etc/dconf/db/gdm.d/90-sagar-login 644
dconf update
# Background: a blurred, darkened copy of your wallpaper (the wallpaper itself isn't in the repo).
WP="$T_HOME/.config/background"
[ -f "$WP" ] || WP=$(ls /usr/share/backgrounds/*.jpg /usr/share/backgrounds/*.png 2>/dev/null | grep -v sagar-login | head -1)
if [ -n "$WP" ] && command -v ffmpeg >/dev/null; then
  ffmpeg -loglevel error -y -i "$WP" -frames:v 1 -vf \
    "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=45,eq=brightness=-0.25" \
    /usr/share/backgrounds/sagar-login.jpg && echo "   background made from $WP"
fi
echo "   The lock screen picks it up after you log out and back in."

step "Boot and restart animation (Plymouth theme 'I Found You')"
P=/usr/share/plymouth/themes/i-found-you
install -d "$P"; install -m 644 "$SRC/plymouth/i-found-you/"* "$P/"
update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth "$P/i-found-you.plymouth" 200 >/dev/null
update-alternatives --set default.plymouth "$P/i-found-you.plymouth" >/dev/null
echo "   rebuilding the boot image (30-60 s)..."
update-initramfs -u >/dev/null 2>&1 && echo "   done" || echo "   update-initramfs failed - the old boot animation stays"

step "Battery 80% cap helper (Power Tiles tile; Lenovo laptops only)"
put "$SRC/sbin/battery-cap" /usr/local/sbin/battery-cap 755

step "NVIDIA GPU sleeps when idle (saves battery on hybrid-graphics laptops)"
if lspci -d 10de: 2>/dev/null | grep -q .; then
  put "$SRC/udev/80-nvidia-runtime-pm.rules" /etc/udev/rules.d/80-nvidia-runtime-pm.rules 644
  udevadm control --reload
  for d in /sys/bus/pci/devices/*; do
    [ "$(cat "$d/vendor" 2>/dev/null)" = 0x10de ] && echo auto > "$d/power/control" 2>/dev/null
  done
  echo "   applied"
else
  echo "   skipped (no NVIDIA GPU)"
fi

step "Wi-Fi region: India (all Indian Wi-Fi channels; change IN in system/modprobe/cfg80211.conf elsewhere)"
put "$SRC/modprobe/cfg80211.conf" /etc/modprobe.d/cfg80211.conf 644

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
[ -n "${MARCO_STATE:-}" ] && cp "$B/src/build/meson-logs/install-log.txt" "$MARCO_STATE/rounded-blur-install-log.txt" 2>/dev/null
rm -rf "$B"

echo
echo "System part done. Restart the laptop once so memory and sound settings apply."
