#!/bin/bash

BACKUP="$HOME/Ambient/shortcut_backup"

if [[ -f "$BACKUP" ]]; then
    exit 0
fi

> "$BACKUP"
KEYBINDINGS=$(gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings)

echo "$KEYBINDINGS" | grep -o "/org[^']*/" | while read -r KB_PATH
do
    SCHEMA="org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:$KB_PATH"
    COMMAND=$(gsettings get "$SCHEMA" command)

    # Keep Ambient shortcut enabled
    BINDING=$(gsettings get "$SCHEMA" binding)

# Never disable Alt+Q
if [[ "$BINDING" == "'<Alt>q'" ]]; then
    continue
fi
    BINDING=$(gsettings get "$SCHEMA" binding)

    echo "$SCHEMA|binding|$BINDING" >> "$BACKUP"

    gsettings set "$SCHEMA" binding "''"
done

# =========================
# Disable common GNOME shortcuts
# =========================

backup_setting() {
    local SCHEMA="$1"
    local KEY="$2"
    local VALUE="$3"

    echo "$SCHEMA|$KEY|$(gsettings get "$SCHEMA" "$KEY")" >> "$BACKUP"
    gsettings set "$SCHEMA" "$KEY" "$VALUE"
}

# Super key (Activities)
backup_setting org.gnome.mutter overlay-key "''"

# Overview
backup_setting org.gnome.shell.keybindings toggle-overview "[]"

# App grid
backup_setting org.gnome.shell.keybindings toggle-application-view "[]"

# Notification shortcuts
backup_setting org.gnome.shell.keybindings toggle-message-tray "[]"
backup_setting org.gnome.shell.keybindings toggle-quick-settings "[]"
backup_setting org.gnome.shell.keybindings focus-active-notification "[]"

# Alt+Tab
backup_setting org.gnome.desktop.wm.keybindings switch-applications "[]"
backup_setting org.gnome.desktop.wm.keybindings switch-applications-backward "[]"

# Super+1 ... Super+9
for i in {1..9}; do
    backup_setting org.gnome.shell.keybindings switch-to-application-$i "[]"
    backup_setting org.gnome.shell.keybindings open-new-window-application-$i "[]"
done

# Ubuntu Dock (Super+1 etc.)
backup_setting org.gnome.shell.extensions.dash-to-dock hot-keys false
backup_setting org.gnome.shell.extensions.dash-to-dock shortcut "[]"
