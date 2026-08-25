/**
 * PowerZoid Todo — Ventana de preferencias (GTK4 / Adwaita)
 * Acceso: clic derecho en el indicador → "Configuración…"
 *
 * NO usa GSettings. Lee y escribe directamente en:
 *   ~/.config/powerzoid-todo/config
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const CONFIG_PATH = GLib.build_filenamev([
    GLib.get_home_dir(), '.config', 'powerzoid-todo', 'config',
]);
const CONFIG_DIR = GLib.build_filenamev([
    GLib.get_home_dir(), '.config', 'powerzoid-todo',
]);


// ─────────────────────────────────────────────────────────────────────────────
// Clase principal de preferencias
// ─────────────────────────────────────────────────────────────────────────────

export default class TodoPreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        window.set_default_size(600, 420);
        window.set_title('PowerZoid Todo — Configuración');
        this._window = window;

        const cfg = this._readConfig();

        // ── Página ────────────────────────────────────────────────────────
        const page = new Adw.PreferencesPage({
            title: 'Configuración',
            icon_name: 'task-due-symbolic',
        });
        window.add(page);

        // ── Grupo: Cuenta de Todoist ─────────────────────────────────────
        const acctGroup = new Adw.PreferencesGroup({
            title: 'Cuenta de Todoist',
            description:
                'Requiere tu token de API personal de Todoist (gratis, en tu propia cuenta).',
        });
        page.add(acctGroup);

        const tokenLinkRow = new Adw.ActionRow({
            title:       'Obtener mi token de API',
            subtitle:    'Ajustes de Todoist → Integraciones → Desarrollador',
            activatable: true,
        });
        tokenLinkRow.add_suffix(new Gtk.Image({
            icon_name: 'external-link-symbolic', valign: Gtk.Align.CENTER, css_classes: ['dim-label'],
        }));
        tokenLinkRow.connect('activated', () => {
            Gio.AppInfo.launch_default_for_uri(
                'https://todoist.com/app/settings/integrations/developer', null);
        });
        acctGroup.add(tokenLinkRow);

        this._tokenRow = new Adw.PasswordEntryRow({
            title: 'Token de API',
            text:  cfg.token || '',
            show_apply_button: true,
        });
        acctGroup.add(this._tokenRow);

        this._statusRow = new Adw.ActionRow({
            title:    'Estado',
            subtitle: this._describeState(cfg),
        });
        acctGroup.add(this._statusRow);

        // ── Botón de guardar ──────────────────────────────────────────────
        const saveGroup = new Adw.PreferencesGroup({
            description: 'La extensión toma el nuevo token en el próximo sondeo '
                + '(hasta 45s), o al instante con "🔄 Actualizar ahora" en el menú.',
        });
        page.add(saveGroup);

        const saveRow = new Adw.ButtonRow({ title: '💾  Guardar' });
        saveRow.add_css_class('suggested-action');
        saveGroup.add(saveRow);
        saveRow.connect('activated', () => this._save());

        this._tokenRow.connect('apply', () => this._save());
    }

    // ─────────────────────────────────────────────────────────────────────
    // Estado
    // ─────────────────────────────────────────────────────────────────────

    _describeState(cfg) {
        return cfg.token
            ? '✓ Token guardado'
            : 'Sin configurar — pega tu token y pulsa "Guardar"';
    }

    // ─────────────────────────────────────────────────────────────────────
    // Guardar
    // ─────────────────────────────────────────────────────────────────────

    _save() {
        const cfg = { token: this._tokenRow.text.trim() };
        const ok  = this._writeConfig(cfg);

        if (ok) {
            this._statusRow.set_subtitle(this._describeState(cfg));
            this._window.add_toast(new Adw.Toast({ title: '✓ Token guardado', timeout: 3 }));
        } else {
            this._window.add_toast(new Adw.Toast({
                title: '❌ Error al guardar la configuración', timeout: 4,
            }));
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Leer / escribir config
    // ─────────────────────────────────────────────────────────────────────

    _readConfig() {
        const result = {};
        try {
            const file = Gio.File.new_for_path(CONFIG_PATH);
            const [ok, bytes] = file.load_contents(null);
            if (ok) {
                const text = new TextDecoder().decode(bytes);
                for (const raw of text.split('\n')) {
                    const line = raw.trim();
                    if (!line || line.startsWith('#')) continue;
                    const idx = line.indexOf('=');
                    if (idx < 0) continue;
                    result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
                }
            }
        } catch (_e) {
            // El archivo aún no existe; se usarán los valores por defecto
        }
        return result;
    }

    _writeConfig(cfg) {
        try {
            const dir = Gio.File.new_for_path(CONFIG_DIR);
            if (!dir.query_exists(null))
                dir.make_directory_with_parents(null);

            const now   = new Date().toLocaleString('es-CL');
            const lines = [
                '# PowerZoid Todo — Configuración',
                `# Guardado: ${now}`,
                '',
            ];

            if (cfg.token) lines.push(`token=${cfg.token}`);
            lines.push('');

            const file = Gio.File.new_for_path(CONFIG_PATH);
            file.replace_contents(
                new TextEncoder().encode(lines.join('\n')),
                null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );

            const info = new Gio.FileInfo();
            info.set_attribute_uint32('unix::mode', 0o600);
            file.set_attributes_from_info(info, Gio.FileQueryInfoFlags.NONE, null);

            return true;
        } catch (e) {
            logError(e);
            return false;
        }
    }
}
