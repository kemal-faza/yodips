#!/usr/bin/env bash
# Launch Microsoft Edge (Flatpak) so Playwright can open a visible Edge window
# as the interactive SSO-login browser.
#
# Your Edge is installed via Flatpak (com.microsoft.Edge), so the raw binary
# lives at a per-version hashed path and cannot be launched directly by
# Playwright (SUID sandbox). Wrapping `flatpak run` forwards ALL Playwright
# flags to Edge and survives Edge updates.
#
# Wire it up:  CHROME_PATH=/mnt/DATA/Documents/Code/sso/tools/edge-flatpak.sh
exec /usr/bin/flatpak run com.microsoft.Edge "$@"
