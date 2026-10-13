#!/usr/bin/env bash
# Copia las sesiones completas de Claude Code (Antigravity) de este proyecto a claude-code/.
# Ejecutar al terminar el desarrollo: bash submission/ai-sessions/collect-claude-code.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dest="$here/claude-code"
projects="$HOME/.claude/projects"
# Carpetas de sesiones de Claude Code relacionadas con el reto. Añade otras si hace falta.
sources=(
  "$projects/-Users-user-Antigravity-projects-Hackaton-Tdots")

mkdir -p "$dest"
for src in "${sources[@]}"; do
  [ -d "$src" ] || { echo "No existe: $src" >&2; continue; }
  for f in "$src"/*.jsonl; do
    [ -e "$f" ] || continue
    cp -p "$f" "$dest/"
    echo "Copiado: $(basename "$f") ($(du -h "$f" | cut -f1))"
    # Subagentes y resultados de herramientas guardados aparte por la sesión.
    if [ -d "${f%.jsonl}" ]; then cp -Rp "${f%.jsonl}" "$dest/"; fi
  done
done

# Las exportaciones no deben contener la clave de OpenAI.
if grep -lE 'sk-(proj-)?[A-Za-z0-9_-]{20,}' "$dest"/*.jsonl 2>/dev/null; then
  echo "AVISO: los archivos anteriores parecen contener una clave de API. Revísalos antes de entregar." >&2
  exit 1
fi
