# PowerZoid Todo — GNOME Shell Extension

Muestra tu tarea pendiente de **mayor prioridad para hoy** (Todoist) en la barra superior. Al pasar el mouse por encima se despliega el resto de tus tareas de hoy, ordenadas por prioridad, con una casilla para marcarlas como hechas.

```
🔴  Enviar informe mensual   +2      ← tarea de mayor prioridad + cuántas más hay
✅  Sin pendientes hoy                ← agenda del día despejada
📋  Configurar cuenta                 ← falta el token de Todoist
```

- **Hover** sobre el indicador → dropdown con todas tus tareas de hoy, ordenadas por prioridad (🔴 P1 · 🟠 P2 · 🔵 P3 · ⚪ P4). Cada fila tiene una casilla ☐ para marcarla como hecha (desaparece de la lista) y el título es clicable para abrirla en Todoist.
- **Clic derecho** → menú con actualización manual, alineación en la barra y tamaño de letra.

---

## Arquitectura

```
Todoist REST API (api.todoist.com) ──────── extensión GNOME
                                                    │
                                      ~/.config/powerzoid-todo/config
                                              (token de API)
```

Sin daemon ni systemd: la extensión llama directo a la API de Todoist con tu token personal (autenticación `Bearer`), sondeando cada 45 segundos.

---

## Instalación

### Paso 0 — Obtener tu token de API de Todoist

1. Entra a **https://todoist.com/app/settings/integrations/developer** (o Ajustes → Integraciones → Desarrollador dentro de la app).
2. Copia el **Token de API** que aparece ahí (es personal, no requiere crear ninguna "app" ni pasar por OAuth).

### Paso 1 — Instalar

```bash
cd ~/Proyectos/powerzoid-todo
bash install.sh
```

### Paso 2 — Configurar el token

1. Clic derecho en **📋** en la barra superior → **Configuración…**
2. Pega el token del Paso 0 → **💾 Guardar**

En un momento (máximo 45s, o al instante con "🔄 Actualizar ahora") verás tu tarea más urgente en la barra.

---

## Menú de clic derecho

```
🔄  Actualizar ahora
─────────────────────────────
Posición en barra ▸
─────────────────────────────
Tamaño: 13 px
A+   Aumentar letra
A−   Reducir letra
↺    Restablecer tamaño
─────────────────────────────
⚙  Configuración…
```

## Dropdown de hover

```
☐  🔴  Enviar informe mensual              10:00
☐  🟠  Llamar al proveedor
☐  🔵  Revisar propuesta de diseño
```

Marcar la casilla completa la tarea en Todoist y la quita de la lista. Si falla la conexión, la extensión se autocorrige en el siguiente sondeo (la tarea vuelve a aparecer si en realidad no se completó).

---

## ¿Qué cuenta como "de hoy"?

Se usa el filtro `today` de Todoist: tareas con fecha de vencimiento **hoy** (no incluye tareas vencidas de días anteriores). La prioridad más alta (🔴 P1) siempre aparece primero.

---

## Resolución de problemas

### Ver el estado en bruto

```bash
curl -s -H "Authorization: Bearer TU_TOKEN" \
  "https://api.todoist.com/api/v1/tasks?filter=today" | python3 -m json.tool
```

### "Token inválido" en el menú

El token se guardó mal o fue revocado — vuelve a copiarlo desde Ajustes de Todoist → Integraciones → Desarrollador y pégalo en Configuración.

### No detecta las tareas nuevas

Espera hasta 45 segundos (intervalo de sondeo) o usa "🔄 Actualizar ahora" desde el menú de clic derecho.

---

## Desinstalar

```bash
bash uninstall.sh
```

El token guardado se conserva por seguridad; elimínalo manualmente si quieres borrar todo rastro:

```bash
rm -rf ~/.config/powerzoid-todo
```

---

## Requisitos

- Fedora 44 / GNOME Shell 45–50
- Cuenta de Todoist con un token de API personal (Paso 0 — gratis)

---

## Privacidad

- El token se guarda localmente en `~/.config/powerzoid-todo/config` con permisos `600` (solo tu usuario).
- Ninguna llamada sale de tu equipo salvo hacia `api.todoist.com`.
- Marcar una tarea como hecha desde el dropdown la completa de verdad en tu cuenta de Todoist (acción irreversible desde la extensión — puedes reabrirla desde la app de Todoist si te equivocas).

---

## Licencia

GPL-2.0
