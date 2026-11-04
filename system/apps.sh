#!/bin/bash
# Apps from this setup (needs root; run by install-system.sh).
# Adds the official package sources (with their public signing keys) and installs:
#   Brave, Google Chrome, Spotify, Proton VPN, Claude Desktop, ChatGPT, Antigravity
#   snaps: VS Code, Android Studio, GitHub CLI, Docker, Outlook for Linux
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"

echo "==> App sources (Brave, Chrome, Spotify, Proton VPN, Claude, ChatGPT, Antigravity)"
( cd "$SRC/apt/root" && find . -type f | while read -r f; do install -D -m 644 "$f" "/${f#./}"; done )
apt-get update -qq

echo "==> Apps"
apt-get install -y brave-browser google-chrome-stable spotify-client proton-vpn-gnome-desktop \
  claude-desktop chatgpt antigravity

echo "==> Snap apps"
snap install code --classic
snap install android-studio --classic
snap install gh --classic
snap install docker
snap install outlook-for-linux --edge
# Docker starts only when you want it (docker-toggle / quick settings).
snap stop --disable docker.dockerd docker.nvidia-container-toolkit 2>/dev/null || true
