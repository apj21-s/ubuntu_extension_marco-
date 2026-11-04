#!/usr/bin/env bash
set -e

UUID="focus-mode@sagar"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCHEMA_DIR="$EXT_DIR/schemas"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing $UUID"

mkdir -p "$EXT_DIR"
cp -r "$SRC_DIR"/metadata.json \
      "$SRC_DIR"/extension.js \
      "$SRC_DIR"/prefs.js \
      "$SRC_DIR"/stylesheet.css \
      "$SRC_DIR"/schemas \
      "$EXT_DIR"/

echo "==> Compiling schemas"
glib-compile-schemas "$SCHEMA_DIR"

echo "==> Enabling extension"
gnome-extensions enable "$UUID" || {
    echo "NOTE: 'gnome-extensions enable' failed. If this is the first"
    echo "install in this session, log out/in once, then run:"
    echo "  gnome-extensions enable $UUID"
}

if [ "${XDG_SESSION_TYPE:-}" = "x11" ]; then
    echo "==> X11 session detected, attempting Shell restart"
    busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Restarting…")' >/dev/null 2>&1 || true
else
    echo "==> Wayland session detected."
    echo "    GNOME Shell cannot be restarted in-place on Wayland."
    echo "    Please log out and back in for the tile to appear."
fi

echo ""
echo "✅ Focus Mode installed successfully."
echo "   Schema:    org.sagar.ambient (key: focus-mode, default: false)"
echo "   Toggle at: Quick Settings panel (top-right, next to Dark Style / Night Light)"
echo ""
echo "Check current state anytime with:"
echo "  gsettings get org.sagar.ambient focus-mode"
