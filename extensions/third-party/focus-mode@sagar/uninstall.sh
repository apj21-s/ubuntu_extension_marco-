#!/usr/bin/env bash
set -e

UUID="focus-mode@sagar"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "==> Disabling $UUID"
gnome-extensions disable "$UUID" || true

echo "==> Removing extension directory: $EXT_DIR"
rm -rf "$EXT_DIR"

echo "==> Note: the org.sagar.ambient schema was only ever installed"
echo "    locally inside the extension's own schemas/ directory, which"
echo "    has just been deleted along with the extension. No system-wide"
echo "    schema files were touched, so there is nothing further to"
echo "    recompile at the system level."
echo ""
echo "If you ever installed the schema system-wide manually, remove it with:"
echo "  sudo rm /usr/share/glib-2.0/schemas/org.sagar.ambient.gschema.xml"
echo "  sudo glib-compile-schemas /usr/share/glib-2.0/schemas/"
echo ""
echo "✅ Focus Mode extension uninstalled."
