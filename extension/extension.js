/**
 * PowerZoid Todo — GNOME Shell Extension
 * UUID: powerzoid-todo@cleal.cl
 *
 * Muestra la tarea pendiente de mayor prioridad para hoy (Todoist).
 * Hover      → despliega hacia abajo el resto de tus tareas de hoy, por prioridad
 * Clic der.  → menú (actualizar, alineación, tamaño de letra, configuración)
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const API_BASE      = 'https://api.todoist.com/api/v1';
const POLL_MS        = 45000;
const VALID_ALIGNS   = ['left', 'center', 'right'];

const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE     = 8;
const MAX_FONT_SIZE     = 20;

const CONFIG_DIR     = `${GLib.get_home_dir()}/.config/powerzoid-todo`;
const CONFIG_PATH    = `${CONFIG_DIR}/config`;
const POSITION_PATH  = `${CONFIG_DIR}/panel-position`;
const FONT_SIZE_PATH = `${CONFIG_DIR}/font-size`;

const HOVER_SHOW_DELAY_MS = 250;
const HOVER_HIDE_DELAY_MS = 300;
const MAX_PANEL_CHARS     = 42;
const MAX_ROW_CHARS       = 56;

const PRIORITY_COLORS = { 4: '#e53935', 3: '#eb8909', 2: '#246fe0', 1: '#9e9e9e' };
const DEFAULT_DOT      = '#9e9e9e';


// ─────────────────────────────────────────────────────────────────────────────
// Helpers de formato
// ─────────────────────────────────────────────────────────────────────────────

function _truncate(text, max) {
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

function _fmtTime(date) {
    return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function _dueTimeLabel(task) {
    const dt = task.due?.datetime;
    if (!dt) return '';
    const d = new Date(dt);
    return Number.isNaN(d.getTime()) ? '' : _fmtTime(d);
}

function _todayStr() {
    const now = new Date();
    const mm  = String(now.getMonth() + 1).padStart(2, '0');
    const dd  = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${mm}-${dd}`;
}

// El filtro `today` de la API de Todoist puede incluir instancias de
// tareas recurrentes u otros bordes que no calzan con "hoy" en la fecha
// local del equipo. Nos quedamos solo con due.date === hoy para no
// mostrar tareas atrasadas ni de otros días.
function _onlyToday(tasks) {
    const today = _todayStr();
    return tasks.filter(t => t.due?.date === today);
}

function _sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        const at = a.due?.datetime, bt = b.due?.datetime;
        if (at && bt) return at.localeCompare(bt);
        if (at) return -1;
        if (bt) return 1;
        return (a.order ?? 0) - (b.order ?? 0);
    });
}


// ─────────────────────────────────────────────────────────────────────────────
// Dropdown flotante e interactivo con la lista de tareas
// ─────────────────────────────────────────────────────────────────────────────

const TaskDropdown = GObject.registerClass(
class TaskDropdown extends St.BoxLayout {

    _init(indicator) {
        super._init({
            style_class: 'pzt-dropdown',
            vertical:    true,
            reactive:    true,
            track_hover: true,
            visible:     false,
        });
        this._indicator = indicator;
        Main.layoutManager.addChrome(this, { trackFullscreen: false });
    }

    setContent(status) {
        this.destroy_all_children();

        const addLine = (text, styleClass = 'pzt-row-msg') => {
            const label = new St.Label({ text, style_class: styleClass });
            label.clutter_text.set_line_wrap(true);
            this.add_child(label);
            return label;
        };

        if (status.state === 'starting') {
            addLine('Cargando…');
            return;
        }
        if (status.state === 'no_config') {
            addLine('⚙  Configura tu token de Todoist en "Configuración…"');
            return;
        }
        if (status.state === 'no_auth') {
            addLine('🔐  Token inválido o sin permisos — revisa "Configuración…"');
            return;
        }
        if (status.state === 'disconnected') {
            addLine('⚠  Sin conexión con Todoist');
            return;
        }
        if (status.state === 'error') {
            addLine(`⚠  Error: ${status.error || 'desconocido'}`);
            return;
        }
        if (!status.tasks || !status.tasks.length) {
            addLine('✅  Sin tareas pendientes para hoy', 'pzt-row-empty');
            return;
        }

        const scroll = new St.ScrollView({
            style_class:       'pzt-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        const list = new St.BoxLayout({ vertical: true, style_class: 'pzt-list' });
        scroll.set_child(list);
        this.add_child(scroll);

        for (const task of status.tasks)
            list.add_child(this._buildRow(task));
    }

    _buildRow(task) {
        const row = new St.BoxLayout({ style_class: 'pzt-row' });

        const checkbox = new St.Button({
            style_class: 'pzt-checkbox',
            label:       '☐',
            y_align:     Clutter.ActorAlign.CENTER,
        });
        checkbox.connect('clicked', () => {
            checkbox.reactive = false;
            checkbox.label = '☑';
            this._indicator.completeTask(task);
        });
        row.add_child(checkbox);

        const dot = new St.Label({
            text:    '●',
            style:   `color: ${PRIORITY_COLORS[task.priority] || DEFAULT_DOT};`,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'pzt-row-dot',
        });
        row.add_child(dot);

        const titleBtn = new St.Button({
            style_class: 'pzt-title',
            label:       _truncate(task.content, MAX_ROW_CHARS),
            x_expand:    true,
            x_align:     Clutter.ActorAlign.START,
            y_align:     Clutter.ActorAlign.CENTER,
        });
        titleBtn.label_actor?.set_x_align(Clutter.ActorAlign.START);
        titleBtn.label_actor?.clutter_text?.set_line_wrap(true);
        if (task.url) {
            titleBtn.connect('clicked', () => {
                Gio.AppInfo.launch_default_for_uri(task.url, null);
            });
        } else {
            titleBtn.reactive = false;
        }
        row.add_child(titleBtn);

        const timeText = _dueTimeLabel(task);
        if (timeText) {
            row.add_child(new St.Label({
                text: timeText, style_class: 'pzt-row-time', y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        return row;
    }

    showBelow(sourceActor) {
        const [srcX, srcY] = sourceActor.get_transformed_position();
        const [, srcH]      = sourceActor.get_transformed_size();

        this.opacity = 0;
        this.visible = true;
        const [, , naturalW, naturalH] = this.get_preferred_size();

        const monitor = Main.layoutManager.findMonitorForActor(sourceActor) || Main.layoutManager.primaryMonitor;
        let x = srcX;
        let y = srcY + srcH + 6;

        if (x + naturalW > monitor.x + monitor.width - 8)
            x = monitor.x + monitor.width - naturalW - 8;
        if (x < monitor.x + 8)
            x = monitor.x + 8;
        if (y + naturalH > monitor.y + monitor.height - 8)
            y = monitor.y + monitor.height - naturalH - 8;

        this.set_position(Math.round(x), Math.round(y));
        this.opacity = 255;
    }

    hide() {
        this.visible = false;
    }

    destroy() {
        Main.layoutManager.removeChrome(this);
        super.destroy();
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// Indicador en el panel
// ─────────────────────────────────────────────────────────────────────────────

const TodoIndicator = GObject.registerClass(
class TodoIndicator extends PanelMenu.Button {

    _init(extension, initialAlign = 'left', initialFontSize = DEFAULT_FONT_SIZE) {
        super._init(0.0, 'PowerZoid Todo');

        this._ext          = extension;
        this._currentAlign = initialAlign;
        this._fontSize     = initialFontSize;
        this._fontSizeItem = null;
        this._session        = new Soup.Session();
        this._session.timeout = 8;
        this._lastState     = 'starting';
        this._lastStatus     = { state: 'starting', tasks: [] };
        this._dropdown        = new TaskDropdown(this);
        this._showTimer        = null;
        this._hideTimer        = null;
        this._currentDotColor  = DEFAULT_DOT;

        // ── Panel: [●] [título] [+n] ───────────────────────────────────────
        this._dot = new St.Label({
            text: '●', y_align: Clutter.ActorAlign.CENTER, style: this._dotStyle(DEFAULT_DOT),
        });
        this._titleLabel = new St.Label({
            text: '📋  Cargando…', y_align: Clutter.ActorAlign.CENTER, style: this._labelStyle(),
        });
        this._countLabel = new St.Label({
            text: '', y_align: Clutter.ActorAlign.CENTER, style: this._countStyle(), visible: false,
        });
        const inner = new St.BoxLayout({ style_class: 'pzt-panel-label' });
        inner.add_child(this._dot);
        inner.add_child(this._titleLabel);
        inner.add_child(this._countLabel);
        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        box.add_child(inner);
        this.add_child(box);

        // PanelMenu.Button abre su menú con cualquier botón apenas se
        // presiona. Registramos el botón real en la fase de captura del
        // stage para poder distinguir clic izquierdo de clic derecho más
        // abajo (el menú de configuración solo debe abrirse con el derecho).
        this._lastPressButton = null;
        this._captureId = global.stage.connect('captured-event', (_stage, ev) => {
            if (ev.type() === Clutter.EventType.BUTTON_PRESS)
                this._lastPressButton = ev.get_button();
            return Clutter.EVENT_PROPAGATE;
        });

        // ── Hover: dropdown de tareas ───────────────────────────────────
        this.connect('enter-event', () => this._onHoverEnter());
        this.connect('leave-event', () => this._onHoverLeave());
        this._dropdown.connect('enter-event', () => this._onHoverEnter());
        this._dropdown.connect('leave-event', () => this._onHoverLeave());

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (!open) return;
            this._hideDropdownNow();
            if (this._lastPressButton === 3) return;
            // Clic izquierdo (u otro): el menú de clic derecho no aplica aquí.
            this._lastPressButton = null;
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this.menu.close();
                return GLib.SOURCE_REMOVE;
            });
        });

        // ── Menú (clic derecho) ───────────────────────────────────────────
        this._buildMenu();

        this._pollTimer = null;
        this._startPolling();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Construcción del menú de clic derecho
    // ─────────────────────────────────────────────────────────────────────

    _buildMenu() {
        this._statusItem = new PopupMenu.PopupMenuItem('', { reactive: false });
        this._statusItem.visible = false;
        this.menu.addMenuItem(this._statusItem);

        const refreshItem = new PopupMenu.PopupMenuItem('🔄  Actualizar ahora');
        refreshItem.connect('activate', () => this._fetchTasks());
        this.menu.addMenuItem(refreshItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Submenú de alineación ─────────────────────────────────────────
        this._posSubMenu = new PopupMenu.PopupSubMenuMenuItem('Posición en barra');
        this.menu.addMenuItem(this._posSubMenu);

        this._alignItems = {};
        [
            ['← Alinear a la izquierda', 'left'],
            ['↔ Alinear al centro',       'center'],
            ['→ Alinear a la derecha',    'right'],
        ].forEach(([label, align]) => {
            const item = new PopupMenu.PopupMenuItem(label);
            this._alignItems[align] = item;
            item.connect('activate', () => this._setAlignment(align));
            this._posSubMenu.menu.addMenuItem(item);
        });
        this._updateAlignMarks(this._currentAlign);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Tamaño de letra ────────────────────────────────────────────
        this._fontSizeItem = new PopupMenu.PopupMenuItem(this._fontSizeLabel(), { reactive: false });
        this._fontSizeItem.label.set_style('color: #aaa; font-style: italic;');
        this.menu.addMenuItem(this._fontSizeItem);

        const increaseItem = new PopupMenu.PopupMenuItem('A+   Aumentar letra');
        increaseItem.connect('activate', () => this._changeFontSize(1));
        this.menu.addMenuItem(increaseItem);

        const decreaseItem = new PopupMenu.PopupMenuItem('A−   Reducir letra');
        decreaseItem.connect('activate', () => this._changeFontSize(-1));
        this.menu.addMenuItem(decreaseItem);

        const resetItem = new PopupMenu.PopupMenuItem('↺    Restablecer tamaño');
        resetItem.connect('activate', () => {
            this._fontSize = DEFAULT_FONT_SIZE;
            this._applyFontSize();
            this._ext.saveFontSize(this._fontSize);
        });
        this.menu.addMenuItem(resetItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefsItem = new PopupMenu.PopupMenuItem('⚙  Configuración…');
        prefsItem.connect('activate', () => this._ext.openPreferences());
        this.menu.addMenuItem(prefsItem);
    }

    _updateStatusItem(status) {
        const messages = {
            no_config:    '⚙  Configura tu token de Todoist',
            no_auth:      '🔐  Token inválido — revisa Configuración',
            disconnected: '⚠  Sin conexión con Todoist',
            error:        `⚠  Error: ${status.error || 'desconocido'}`,
        };
        const msg = messages[status.state];
        if (msg) {
            this._statusItem.label.set_text(msg);
            this._statusItem.visible = true;
        } else {
            this._statusItem.visible = false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Hover: mostrar/ocultar dropdown
    // ─────────────────────────────────────────────────────────────────────

    _onHoverEnter() {
        if (this._hideTimer) { GLib.source_remove(this._hideTimer); this._hideTimer = null; }
        if (this._dropdown.visible) return;
        if (this.menu.isOpen) return;
        if (this._showTimer) return;

        this._showTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOVER_SHOW_DELAY_MS, () => {
            this._showTimer = null;
            this._dropdown.setContent(this._lastStatus);
            this._dropdown.showBelow(this);
            return GLib.SOURCE_REMOVE;
        });
    }

    _onHoverLeave() {
        if (this._showTimer) { GLib.source_remove(this._showTimer); this._showTimer = null; }
        if (this._hideTimer) return;
        this._hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOVER_HIDE_DELAY_MS, () => {
            this._hideTimer = null;
            this._dropdown.hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _hideDropdownNow() {
        if (this._showTimer) { GLib.source_remove(this._showTimer); this._showTimer = null; }
        if (this._hideTimer) { GLib.source_remove(this._hideTimer); this._hideTimer = null; }
        this._dropdown.hide();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Tamaño de letra
    // ─────────────────────────────────────────────────────────────────────

    _fontSizeLabel() {
        return `Tamaño: ${this._fontSize} px`;
    }

    _changeFontSize(delta) {
        this._fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, this._fontSize + delta));
        this._applyFontSize();
        this._ext.saveFontSize(this._fontSize);
    }

    _applyFontSize() {
        this._dot?.set_style(this._dotStyle(this._currentDotColor));
        this._titleLabel?.set_style(this._labelStyle());
        this._countLabel?.set_style(this._countStyle());
        this._fontSizeItem?.label.set_text(this._fontSizeLabel());
    }

    _labelStyle() {
        return `font-size: ${this._fontSize}px;`;
    }

    _countStyle() {
        return `font-size: ${Math.max(MIN_FONT_SIZE, this._fontSize - 2)}px; color: #aaa;`;
    }

    _dotStyle(color) {
        return `font-size: ${this._fontSize}px; color: ${color};`;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Alineación
    // ─────────────────────────────────────────────────────────────────────

    _setAlignment(align) {
        if (align === this._currentAlign) return;
        this._ext.savePanelPosition(align);

        // Reinicio completo de la extensión: evita bugs de rendering al
        // reubicar actores directamente entre boxes del panel.
        const uuid = this._ext.uuid;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            Main.extensionManager.disableExtension(uuid);
            Main.extensionManager.enableExtension(uuid);
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateAlignMarks(activeAlign) {
        Object.entries(this._alignItems).forEach(([align, item]) => {
            item.setOrnament(
                align === activeAlign ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE
            );
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Todoist API
    // ─────────────────────────────────────────────────────────────────────

    _authHeaders(msg) {
        msg.get_request_headers().append('Authorization', `Bearer ${this._ext.getToken()}`);
    }

    _startPolling() {
        this._fetchTasks();
        this._pollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            this._fetchTasks();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _fetchTasks() {
        const token = this._ext.getToken();
        if (!token) {
            this._applyStatus({ state: 'no_config', tasks: [] });
            return;
        }

        let msg;
        try {
            msg = Soup.Message.new('GET', `${API_BASE}/tasks?filter=${encodeURIComponent('today')}`);
            this._authHeaders(msg);
        } catch (_e) {
            this._applyStatus({ state: 'disconnected', tasks: [] });
            return;
        }

        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null,
            (session, result) => {
                let bytes;
                try {
                    bytes = session.send_and_read_finish(result);
                } catch (_e) {
                    this._applyStatus({ state: 'disconnected', tasks: [] });
                    return;
                }

                const code = msg.get_status();
                if (code === 401 || code === 403) {
                    this._applyStatus({ state: 'no_auth', tasks: [] });
                    return;
                }
                if (code < 200 || code >= 300) {
                    this._applyStatus({ state: 'error', tasks: [], error: `HTTP ${code}` });
                    return;
                }

                try {
                    const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    const raw  = Array.isArray(data) ? data : (data.results || []);
                    this._applyStatus({ state: 'ok', tasks: _sortTasks(_onlyToday(raw)) });
                } catch (e) {
                    this._applyStatus({ state: 'error', tasks: [], error: String(e) });
                }
            }
        );
    }

    completeTask(task) {
        // Actualización optimista: la quitamos de la vista ya mismo; si
        // falla, el próximo sondeo la vuelve a traer (auto-corrección).
        const tasks = this._lastStatus.tasks.filter(t => t.id !== task.id);
        this._applyStatus({ ...this._lastStatus, tasks });

        let msg;
        try {
            msg = Soup.Message.new('POST', `${API_BASE}/tasks/${encodeURIComponent(task.id)}/close`);
            this._authHeaders(msg);
        } catch (_e) {
            return;
        }
        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null,
            (session, result) => {
                try { session.send_and_read_finish(result); } catch (_e) {}
                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                    this._fetchTasks();
                    return GLib.SOURCE_REMOVE;
                });
            }
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Actualización de UI
    // ─────────────────────────────────────────────────────────────────────

    _applyStatus(status) {
        this._lastState  = status.state;
        this._lastStatus = status;

        this._applyPanelParts(this._composeStatusParts(status));
        this._updateStatusItem(status);

        if (this._dropdown.visible)
            this._dropdown.setContent(status);
    }

    _composeStatusParts(status) {
        if (status.state === 'ok' && status.tasks.length) {
            const top = status.tasks[0];
            return {
                title: _truncate(top.content, MAX_PANEL_CHARS),
                dot:   PRIORITY_COLORS[top.priority] || DEFAULT_DOT,
                count: status.tasks.length > 1 ? `+${status.tasks.length - 1}` : '',
            };
        }
        const messages = {
            starting:     '📋  Cargando…',
            no_config:    '📋  Configurar cuenta',
            no_auth:      '📋  Token inválido',
            error:        '📋  Error',
            ok:           '✅  Sin pendientes hoy',
            disconnected: '📋  Sin conexión',
        };
        return { title: messages[status.state] || '📋  …', dot: null, count: '' };
    }

    _applyPanelParts({ title, dot, count }) {
        this._currentDotColor = dot || DEFAULT_DOT;
        this._dot.visible = !!dot;
        this._dot.set_style(this._dotStyle(this._currentDotColor));
        this._titleLabel.text = title;
        this._countLabel.text = count;
        this._countLabel.visible = !!count;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Limpieza
    // ─────────────────────────────────────────────────────────────────────

    destroy() {
        if (this._pollTimer) { GLib.source_remove(this._pollTimer); this._pollTimer = null; }
        if (this._showTimer) { GLib.source_remove(this._showTimer); this._showTimer = null; }
        if (this._hideTimer) { GLib.source_remove(this._hideTimer); this._hideTimer = null; }
        if (this._captureId) { global.stage.disconnect(this._captureId); this._captureId = null; }
        this._dropdown?.destroy();
        super.destroy();
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────────────

export default class PowerZoidTodoExtension extends Extension {

    enable() {
        const align    = this._loadPanelPosition();
        const fontSize = this._loadFontSize();
        this._indicator = new TodoIndicator(this, align, fontSize);
        Main.panel.addToStatusArea('powerzoid-todo', this._indicator, -1, align);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }

    // ── Alineación ──────────────────────────────────────────────────────

    _loadPanelPosition() {
        try {
            const file = Gio.File.new_for_path(POSITION_PATH);
            const [, bytes] = file.load_contents(null);
            const val = new TextDecoder().decode(bytes).trim();
            return VALID_ALIGNS.includes(val) ? val : 'left';
        } catch (_e) {}
        return 'left';
    }

    savePanelPosition(align) {
        try {
            Gio.File.new_for_path(CONFIG_DIR).make_directory_with_parents(null);
        } catch (_e) {}
        try {
            const file = Gio.File.new_for_path(POSITION_PATH);
            file.replace_contents(
                new TextEncoder().encode(align),
                null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (_e) {}
    }

    // ── Tamaño de letra ────────────────────────────────────────────────

    _loadFontSize() {
        try {
            const file = Gio.File.new_for_path(FONT_SIZE_PATH);
            const [, bytes] = file.load_contents(null);
            const val = parseInt(new TextDecoder().decode(bytes).trim(), 10);
            if (Number.isInteger(val))
                return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, val));
        } catch (_e) {}
        return DEFAULT_FONT_SIZE;
    }

    saveFontSize(size) {
        try {
            Gio.File.new_for_path(CONFIG_DIR).make_directory_with_parents(null);
        } catch (_e) {}
        try {
            const file = Gio.File.new_for_path(FONT_SIZE_PATH);
            file.replace_contents(
                new TextEncoder().encode(String(size)),
                null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (_e) {}
    }

    // ── Token de Todoist ──────────────────────────────────────────────

    getToken() {
        try {
            const file = Gio.File.new_for_path(CONFIG_PATH);
            const [, bytes] = file.load_contents(null);
            const text = new TextDecoder().decode(bytes);
            for (const raw of text.split('\n')) {
                const line = raw.trim();
                if (line.startsWith('token=')) {
                    const val = line.slice(6).trim();
                    if (val) return val;
                }
            }
        } catch (_e) {}
        return null;
    }
}
