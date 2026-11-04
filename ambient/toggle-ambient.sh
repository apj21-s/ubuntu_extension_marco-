#!/bin/bash
#
# Ambient Mode Toggle
#

set -e

AMBIENT_DIR="$HOME/Ambient"

VIDEO="$AMBIENT_DIR/wallpaper.mp4"

LOCK_FILE="$AMBIENT_DIR/.ambient_running"

DISABLE_SCRIPT="$AMBIENT_DIR/disable-shortcuts.sh"
ENABLE_SCRIPT="$AMBIENT_DIR/enable-shortcuts.sh"

# Backup files
LOCK_ENABLED_BACKUP="$AMBIENT_DIR/.lock_enabled_backup"
LOCK_DELAY_BACKUP="$AMBIENT_DIR/.lock_delay_backup"

# -------------------------------------------------------
# Ambient already running -> Stop
# -------------------------------------------------------

if [[ -f "$LOCK_FILE" ]]; then

    echo "Stopping Ambient Mode..."

    pkill -f "mpv.*$VIDEO" 2>/dev/null || true

    exit 0
fi

# -------------------------------------------------------
# Prevent duplicate launches
# -------------------------------------------------------

touch "$LOCK_FILE"

cleanup() {

    echo "Cleaning up Ambient Mode..."

    # Restore shortcuts
    "$ENABLE_SCRIPT"

    # Restore lock settings
    if [[ -f "$LOCK_ENABLED_BACKUP" ]]; then
        gsettings set org.gnome.desktop.screensaver lock-enabled "$(cat "$LOCK_ENABLED_BACKUP")"
        rm -f "$LOCK_ENABLED_BACKUP"
    fi

    if [[ -f "$LOCK_DELAY_BACKUP" ]]; then
        gsettings set org.gnome.desktop.screensaver lock-delay "$(cat "$LOCK_DELAY_BACKUP")"
        rm -f "$LOCK_DELAY_BACKUP"
    fi

    rm -f "$LOCK_FILE"

    # Lock session after Ambient Mode exits
    loginctl lock-session
}

trap cleanup EXIT

echo "Starting Ambient Mode..."

# Disable shortcuts
"$DISABLE_SCRIPT"

# Backup current lock settings
gsettings get org.gnome.desktop.screensaver lock-enabled > "$LOCK_ENABLED_BACKUP"
gsettings get org.gnome.desktop.screensaver lock-delay > "$LOCK_DELAY_BACKUP"

# Disable automatic lock while Ambient Mode is active
gsettings set org.gnome.desktop.screensaver lock-enabled false

# Run MPV while preventing suspend
systemd-inhibit \
    --what=idle:sleep \
    --who="Ambient Mode" \
    --why="Prevent sleep while Ambient Mode is active" \
    mpv \
        --fs \
        --loop-file=inf \
        --no-border \
        --no-osc \
        --cursor-autohide=0 \
        --force-window=yes \
        --ontop \
        --really-quiet \
        --hwdec=auto-safe \
        --vo=gpu-next \
        --input-conf=/dev/null \
        --no-input-default-bindings \
        "$VIDEO"

exit 0
