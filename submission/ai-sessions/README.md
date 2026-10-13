# Sesiones de IA

Exportaciones originales y completas (no resúmenes) de las conversaciones usadas durante el reto, tal como pide el README del proyecto.

| Carpeta | Herramienta | Formato | Cómo se obtiene |
|---|---|---|---|
| `claude-code/` | Claude Code dentro de Antigravity | `.jsonl` nativo, una sesión por archivo | `bash submission/ai-sessions/collect-claude-code.sh` |
| `claude-ai/` | Claude (claude.ai) | Exportación de datos de claude.ai | claude.ai → Settings → Privacy → Export data; copiar aquí el ZIP o las conversaciones del reto |

## Estado

- [ ] `claude-code/`: ejecutar el script al terminar el desarrollo (la sesión actual sigue creciendo).
- [ ] `claude-ai/`: exportar y copiar las conversaciones del reto.
- [ ] Comprobar que ninguna exportación contiene `OPENAI_API_KEY` ni otras credenciales.
