#!/usr/bin/env bash
# ══════════════════════════════════════════════════════
#  PowerZoid Todo — Instalador para Fedora / GNOME 45-50
#  Uso: bash install.sh
# ══════════════════════════════════════════════════════
set -euo pipefail

UUID="powerzoid-todo@cleal.cl"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$HOME/.config/powerzoid-todo"

G='\033[0;32m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

echo -e "\n${BOLD}=== PowerZoid Todo — Instalador ===${NC}\n"

mkdir -p "$DEST" "$CONFIG_DIR"
cp "$DIR/extension/metadata.json"  "$DEST/"
cp "$DIR/extension/extension.js"   "$DEST/"
cp "$DIR/extension/prefs.js"       "$DEST/"
cp "$DIR/extension/stylesheet.css" "$DEST/"
echo -e "  ${G}✓${NC}  Archivos instalados en $DEST"

echo ""
echo -e "${BOLD}Cierra sesión y vuelve a entrar${NC} para que GNOME la detecte."
echo -e "${DIM}(necesario la primera vez: el shell no descubre UUIDs nuevos en caliente)${NC}"
echo ""
echo -e "Después, habilítala:"
echo -e "  gnome-extensions enable $UUID"
echo ""
echo -e "Luego, configura tu token de Todoist:"
echo -e "  Clic derecho en '📋' en la barra → Configuración…"
echo -e "  ${DIM}(el token se obtiene en Ajustes de Todoist → Integraciones → Desarrollador)${NC}"
echo ""
echo -e "Verifica:  gnome-extensions info $UUID"
echo ""
