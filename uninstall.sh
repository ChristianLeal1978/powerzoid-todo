#!/usr/bin/env bash
# ══════════════════════════════════════════════════════
#  PowerZoid Todo — Desinstalador
#  Uso: bash uninstall.sh
# ══════════════════════════════════════════════════════
set -euo pipefail

UUID="powerzoid-todo@cleal.cl"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

echo -e "\n${BOLD}=== PowerZoid Todo — Desinstalador ===${NC}\n"

gnome-extensions disable "$UUID" 2>/dev/null || true
rm -rf "$DEST"

echo -e "  ✓  Extensión eliminada de $DEST"
echo ""
echo -e "${DIM}Conservado (elimínalo manualmente si quieres):${NC}"
echo -e "${DIM}  ~/.config/powerzoid-todo/${NC}"
echo ""
