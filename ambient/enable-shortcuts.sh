#!/bin/bash

BACKUP="$HOME/Ambient/shortcut_backup"

[ -f "$BACKUP" ] || exit 0

while IFS="|" read -r SCHEMA KEY VALUE
do
    gsettings set "$SCHEMA" "$KEY" "$VALUE"
done < "$BACKUP"

rm -f "$BACKUP"

echo "Ambient shortcuts restored."

