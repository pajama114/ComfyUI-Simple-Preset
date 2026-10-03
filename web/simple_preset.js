import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import {
    ALL_PROFILES,
    DEFAULT_PROFILE_ID,
    moveSelection,
    resolveProfileId,
    samePresetData,
    storedProfileId,
    storeProfileId,
} from "./profile_state.js";
import {
    DEFAULT_SEPARATOR,
    SEPARATOR_OPTIONS,
    SEPARATOR_SETTING_ID,
    executionSelectionValue,
    normalizeSeparator,
    removeLegacyInternalInputs,
} from "./separator_state.js";

const controllers = new Set();
const scrollRegions = new Set();
const popupMenus = new Set();
let profileControlId = 0;
const channel = typeof BroadcastChannel === "function"
    ? new BroadcastChannel("simple-preset")
    : null;

function installStyles() {
    if (document.getElementById("simple-preset-styles")) return;
    const style = document.createElement("style");
    style.id = "simple-preset-styles";
    style.textContent = `
        .sp-root {
            --sp-bg: color-mix(in srgb, var(--comfy-menu-bg, #202226) 92%, #15171a);
            --sp-panel: color-mix(in srgb, var(--comfy-input-bg, #15171a) 88%, transparent);
            --sp-border: color-mix(in srgb, var(--border-color, #555) 76%, transparent);
            --sp-muted: var(--descrip-text, #a5a8ad);
            --sp-text: var(--input-text, #eee);
            --sp-accent: var(--primary-bg, #5e63d8);
            --sp-row-bg: var(--sp-panel);
            --sp-row-hover: color-mix(in srgb, var(--sp-accent) 8%, var(--sp-panel));
            box-sizing: border-box;
            width: 100%; height: 100%; min-height: 0;
            display: flex; flex-direction: column; gap: 8px;
            padding: 4px 2px; overflow: hidden;
            color: var(--sp-text); background: transparent;
            font: 12px/1.4 Inter, system-ui, sans-serif;
        }
        :root:not(.dark-theme) .sp-root {
            --sp-bg: #fbfbfc;
            --sp-panel: #ffffff;
            --sp-border: #d4d7dc;
            --sp-muted: #626873;
            --sp-text: #202328;
            --sp-accent: var(--p-primary-color, var(--comfy-accent, #5b61d6));
            --sp-row-bg: #eceef2;
            --sp-row-hover: #e2e5ea;
        }
        .sp-root *, .sp-root *::before, .sp-root *::after { box-sizing: border-box; }
        .sp-header, .sp-profile-toolbar, .sp-toolbar, .sp-summary, .sp-row, .sp-actions,
        .sp-form-header, .sp-form-actions {
            display: flex; align-items: center;
        }
        .sp-header { gap: 7px; padding-top: 8px; border-top: 1px solid var(--sp-border); }
        .sp-title { font-size: 13px; font-weight: 700; letter-spacing: .01em; }
        .sp-count {
            margin-right: auto; padding: 2px 7px; border-radius: 999px;
            color: var(--sp-muted); background: var(--sp-panel);
        }
        .sp-icon-button {
            appearance: none; border: 1px solid var(--sp-border); border-radius: 6px;
            color: var(--sp-text); background: var(--sp-panel); cursor: pointer;
            font: inherit; transition: border-color .12s, background .12s, transform .08s;
        }
        .sp-icon-button {
            width: 28px; height: 28px; padding: 5px; line-height: 1;
            display: inline-flex; align-items: center; justify-content: center; flex: none;
        }
        .sp-icon-button svg, .sp-inline-icon svg { width: 100%; height: 100%; display: block; }
        .sp-icon-button:hover { border-color: var(--sp-accent); }
        .sp-icon-button:active { transform: translateY(1px); }
        .sp-icon-button:disabled { opacity: .35; cursor: default; }
        .sp-icon-button.sp-loading svg { animation: sp-spin .8s linear infinite; }
        .sp-primary { border-color: var(--sp-accent); background: var(--sp-accent); color: white; }
        .sp-danger { color: #ff8d8d; }
        :root:not(.dark-theme) .sp-danger { color: #c43f47; }
        .sp-profile-section {
            display: flex; flex-direction: column; gap: 6px;
        }
        .sp-profile-toolbar { gap: 6px; }
        .sp-profile-label { flex: none; color: var(--sp-muted); font-weight: 650; }
        .sp-profile-control { position: relative; min-width: 0; flex: 1; }
        .sp-profile-button {
            min-width: 0; height: 29px; padding: 4px 7px;
            border: 1px solid var(--sp-border); border-radius: 6px;
            outline: none; color: var(--sp-text); background: var(--sp-panel); font: inherit;
        }
        .sp-profile-button {
            appearance: none; width: 100%; display: flex; align-items: center; gap: 7px;
            cursor: pointer; text-align: left;
        }
        .sp-profile-button-text {
            min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .sp-profile-button svg {
            width: 15px; height: 15px; flex: none; color: var(--sp-muted);
            transition: transform .12s;
        }
        .sp-profile-button[aria-expanded="true"] svg { transform: rotate(180deg); }
        .sp-profile-button:hover, .sp-profile-button:focus {
            border-color: var(--sp-accent);
        }
        .sp-profile-button:disabled { opacity: .35; cursor: default; }
        .sp-profile-form { display: flex; align-items: center; gap: 6px; }
        .sp-profile-form .sp-input { min-width: 0; flex: 1; }
        .sp-toolbar { gap: 6px; }
        .sp-sort-control { position: relative; flex: none; }
        .sp-sort-menu, .sp-profile-menu {
            position: absolute; top: calc(100% + 5px); right: 0; z-index: 30;
            min-width: 172px; padding: 5px;
            border: 1px solid var(--sp-border); border-radius: 8px;
            color: var(--sp-text); background: var(--sp-panel);
            box-shadow: 0 7px 20px rgba(0, 0, 0, .22);
        }
        .sp-sort-menu { width: 172px; }
        .sp-profile-menu {
            left: 0; right: auto; width: 100%; max-height: 240px; overflow-y: auto;
        }
        :root:not(.dark-theme) .sp-sort-menu,
        :root:not(.dark-theme) .sp-profile-menu {
            box-shadow: 0 7px 20px rgba(30, 35, 45, .14);
        }
        .sp-sort-option, .sp-profile-option, .sp-sort-direction-button {
            appearance: none; border: 0; color: var(--sp-text); background: transparent;
            font: inherit; cursor: pointer;
        }
        .sp-sort-option, .sp-profile-option {
            width: 100%; min-height: 30px; display: flex; align-items: center; gap: 8px;
            padding: 5px 7px; border-radius: 5px; text-align: left;
        }
        .sp-profile-option-label {
            min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .sp-profile-option-check { width: 16px; flex: none; text-align: center; }
        .sp-sort-option svg, .sp-sort-direction-button svg { width: 16px; height: 16px; flex: none; }
        .sp-sort-option:hover, .sp-sort-option.sp-active,
        .sp-profile-option:hover, .sp-profile-option.sp-active { background: var(--sp-row-hover); }
        .sp-sort-option.sp-active, .sp-profile-option.sp-active {
            color: var(--sp-accent); font-weight: 650;
        }
        .sp-sort-direction {
            display: grid; grid-template-columns: 1fr 1fr; gap: 4px;
            margin-top: 5px; padding-top: 5px; border-top: 1px solid var(--sp-border);
        }
        .sp-sort-direction-button {
            min-height: 29px; display: flex; align-items: center; justify-content: center; gap: 5px;
            padding: 4px 6px; border: 1px solid transparent; border-radius: 5px;
            color: var(--sp-muted);
        }
        .sp-sort-direction-button:hover { background: var(--sp-row-hover); }
        .sp-sort-direction-button.sp-active {
            border-color: var(--sp-accent); color: var(--sp-accent);
            background: color-mix(in srgb, var(--sp-accent) 10%, transparent);
        }
        .sp-sort-option:disabled, .sp-sort-direction-button:disabled { opacity: .4; cursor: default; }
        .sp-search, .sp-input, .sp-textarea {
            width: 100%; border: 1px solid var(--sp-border); border-radius: 6px;
            outline: none; color: var(--sp-text); background: var(--sp-panel); font: inherit;
        }
        .sp-search, .sp-input { height: 29px; padding: 4px 8px; }
        .sp-search { min-width: 40px; }
        .sp-search::placeholder, .sp-input::placeholder, .sp-textarea::placeholder { color: var(--sp-muted); }
        .sp-search:focus, .sp-input:focus, .sp-textarea:focus { border-color: var(--sp-accent); }
        .sp-list {
            min-height: 0; height: 0; flex: 1 1 0; overflow-y: auto; overflow-x: hidden;
            position: relative; display: flex; contain: size layout;
            flex-direction: column; gap: 3px; padding-right: 2px;
            scrollbar-width: auto; scrollbar-color: var(--sp-border) transparent;
            overscroll-behavior: contain; touch-action: pan-y; pointer-events: auto;
        }
        .sp-list::-webkit-scrollbar { width: 10px; }
        .sp-list::-webkit-scrollbar-track { background: transparent; }
        .sp-list::-webkit-scrollbar-thumb {
            background: var(--sp-border); border: 2px solid transparent;
            border-radius: 999px; background-clip: padding-box;
        }
        .sp-row {
            gap: 7px; min-height: 38px; flex: 0 0 38px; padding: 1px 6px 1px 8px;
            border: 1px solid var(--sp-border); border-radius: 7px;
            background: var(--sp-row-bg); cursor: pointer;
        }
        .sp-row:hover {
            border-color: color-mix(in srgb, var(--sp-accent) 62%, var(--sp-border));
            background: var(--sp-row-hover);
        }
        .sp-row.sp-selected {
            border-color: var(--sp-accent);
            background: color-mix(in srgb, var(--sp-accent) 15%, var(--sp-row-bg));
        }
        .sp-check { width: 16px; height: 16px; accent-color: var(--sp-accent); flex: none; }
        .sp-order { width: 20px; flex: none; text-align: right; color: var(--sp-muted); font-variant-numeric: tabular-nums; }
        .sp-copy { min-width: 0; flex: 1; }
        .sp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; }
        .sp-prompt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--sp-muted); font-size: 11px; }
        .sp-actions { flex: none; gap: 3px; }
        .sp-form {
            display: flex; flex-direction: column; gap: 7px; padding: 8px; min-height: 0;
            border: 1px solid var(--sp-accent); border-radius: 8px;
            background: var(--sp-panel);
        }
        .sp-root.sp-form-open .sp-form { flex: 1 1 0; }
        .sp-root.sp-form-open .sp-list,
        .sp-root.sp-form-open .sp-selection-notice,
        .sp-root.sp-form-open .sp-summary { display: none; }
        .sp-form-header { min-height: 28px; gap: 8px; }
        .sp-form-title { min-width: 0; flex: 1; font-weight: 700; }
        .sp-form-field { display: flex; align-items: center; gap: 7px; }
        .sp-form-label { flex: none; color: var(--sp-muted); }
        .sp-textarea {
            height: auto; min-height: 0; flex: 1 1 0; resize: none;
            overflow-y: auto; padding: 7px 8px;
        }
        .sp-form-actions { flex: none; gap: 6px; }
        .sp-empty {
            margin: auto; padding: 20px; max-width: 270px; text-align: center;
            color: var(--sp-muted); border: 1px dashed var(--sp-border); border-radius: 8px;
        }
        .sp-summary {
            gap: 7px; min-height: 34px; max-height: 92px; padding: 5px 7px;
            align-items: flex-start; overflow-y: auto;
            border-radius: 7px; background: var(--sp-panel);
            scrollbar-width: thin; scrollbar-color: var(--sp-border) transparent;
        }
        .sp-summary-label {
            width: 17px; height: 17px; margin-top: 2px; flex: none; color: var(--sp-muted);
        }
        .sp-summary-chips {
            min-width: 0; flex: 1; display: flex; flex-wrap: wrap; gap: 4px;
        }
        .sp-summary-empty { min-height: 22px; display: flex; align-items: center; color: var(--sp-muted); }
        .sp-preset-chip {
            appearance: none; min-width: 0; max-width: 100%; height: 24px;
            display: inline-flex; align-items: center; padding: 2px 8px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            border: 1px solid var(--sp-border); border-radius: 7px;
            color: var(--sp-text); background: var(--sp-row-bg); font: inherit;
            cursor: grab; user-select: none;
            transition: border-color .12s, background .12s, opacity .12s, transform .12s;
        }
        .sp-preset-chip:hover, .sp-preset-chip:focus-visible {
            outline: none; border-color: var(--sp-accent);
            background: color-mix(in srgb, var(--sp-accent) 12%, var(--sp-row-bg));
        }
        .sp-preset-chip:active { cursor: grabbing; }
        .sp-preset-chip.sp-dragging {
            opacity: .38; border-style: dashed; cursor: grabbing;
        }
        .sp-summary.sp-drag-active {
            box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sp-accent) 65%, transparent);
        }
        .sp-selection-notice {
            min-height: 18px; color: var(--sp-muted); font-size: 11px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .sp-hidden { display: none !important; }
        @keyframes sp-spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
}

function element(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
}

const ICONS = {
    add: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 5"/>',
    selectAll: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/>',
    clear: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m9 9 6 6m0-6-6 6"/>',
    sort: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    name: '<path d="m4 19 5-14 5 14M6 14h6"/><path d="M17 7h4M17 12h4M17 17h4"/>',
    prompt: '<path d="M5 6h14M5 10h14M5 14h9M5 18h6"/>',
    created: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 13v5M9.5 15.5h5"/>',
    updated: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    save: '<path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
    cancel: '<path d="m6 6 12 12M18 6 6 18"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    delete: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    output: '<path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z"/>',
};

function icon(name) {
    const result = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    result.setAttribute("viewBox", "0 0 24 24");
    result.setAttribute("fill", "none");
    result.setAttribute("stroke", "currentColor");
    result.setAttribute("stroke-width", "2");
    result.setAttribute("stroke-linecap", "round");
    result.setAttribute("stroke-linejoin", "round");
    result.setAttribute("aria-hidden", "true");
    result.innerHTML = ICONS[name];
    return result;
}

function iconButton(iconName, title, className = "sp-icon-button") {
    const result = element("button", className);
    result.type = "button";
    result.title = title;
    result.setAttribute("aria-label", title);
    result.append(icon(iconName));
    return result;
}

function labeledIconButton(iconName, label, className) {
    const result = element("button", className);
    result.type = "button";
    result.append(icon(iconName), element("span", "", label));
    return result;
}

function closePopupMenus(except = null) {
    for (const entry of popupMenus) {
        if (entry === except) continue;
        entry.menu.classList.add("sp-hidden");
        entry.button?.setAttribute("aria-expanded", "false");
    }
}

function bindProfileMenu(button, menu, entry) {
    button.addEventListener("click", () => {
        if (menu.classList.contains("sp-hidden")) {
            closePopupMenus(entry);
            menu.classList.remove("sp-hidden");
            button.setAttribute("aria-expanded", "true");
        } else {
            menu.classList.add("sp-hidden");
            button.setAttribute("aria-expanded", "false");
        }
    });
    button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        closePopupMenus(entry);
        menu.classList.remove("sp-hidden");
        button.setAttribute("aria-expanded", "true");
        menu.querySelector(".sp-active")?.focus();
    });
    menu.addEventListener("keydown", (event) => {
        const options = [...menu.querySelectorAll(".sp-profile-option")];
        const index = options.indexOf(document.activeElement);
        if (event.key === "Escape") {
            event.preventDefault();
            menu.classList.add("sp-hidden");
            button.setAttribute("aria-expanded", "false");
            button.focus();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const offset = event.key === "ArrowDown" ? 1 : -1;
            options[(index + offset + options.length) % options.length]?.focus();
        }
    });
}

function renderProfileChoices(menu, choices, selectedId, onSelect) {
    menu.replaceChildren();
    for (const choice of choices) {
        const option = element("button", "sp-profile-option");
        option.type = "button";
        option.setAttribute("role", "option");
        option.dataset.profileId = choice.id;
        const active = choice.id === selectedId;
        option.classList.toggle("sp-active", active);
        option.setAttribute("aria-selected", String(active));
        option.append(
            element("span", "sp-profile-option-check", active ? "✓" : ""),
            element("span", "sp-profile-option-label", choice.label),
        );
        option.addEventListener("click", () => onSelect(choice.id));
        menu.append(option);
    }
}

function parseSelection(value) {
    try {
        let parsed = typeof value === "string" ? JSON.parse(value) : value;
        if (parsed && !Array.isArray(parsed) && typeof parsed === "object") parsed = parsed.ids;
        if (!Array.isArray(parsed)) return [];
        return [...new Set(parsed.filter((item) => typeof item === "string"))];
    } catch (_error) {
        return [];
    }
}

function separatorSettingValue() {
    const currentSettings = app.extensionManager?.setting;
    if (typeof currentSettings?.get === "function") {
        return normalizeSeparator(currentSettings.get(SEPARATOR_SETTING_ID));
    }
    return normalizeSeparator(app.ui?.settings?.getSettingValue?.(SEPARATOR_SETTING_ID));
}

function scrollByWheel(element, event) {
    const unit = event.deltaMode === 1
        ? 32
        : event.deltaMode === 2
            ? element.clientHeight
            : 1;
    element.scrollTop += event.deltaY * unit;
}

function isNodeSelected(node) {
    const canvases = [app.canvas, globalThis.LGraphCanvas?.active_canvas];
    for (const canvas of canvases) {
        if (!canvas) continue;
        if (typeof canvas.selectedItems?.has === "function" && canvas.selectedItems.has(node)) {
            return true;
        }

        const legacy = canvas.selected_nodes;
        if (typeof legacy?.has === "function"
            && (legacy.has(node) || legacy.has(node.id) || legacy.has(String(node.id)))) {
            return true;
        }
        if (Array.isArray(legacy) && (legacy.includes(node) || legacy.includes(node.id))) {
            return true;
        }
        if (legacy && typeof legacy === "object" && legacy[node.id]) {
            return true;
        }
    }
    return node.is_selected === true || node.selected === true;
}

function selectNodeFromWidget(node, event) {
    if (isNodeSelected(node)) return;
    const canvas = globalThis.LGraphCanvas?.active_canvas ?? app.canvas;
    if (!canvas) return;

    if (typeof canvas.processNodeSelected === "function") {
        canvas.processNodeSelected(node, event);
        return;
    }

    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (typeof canvas.selectNode === "function") {
        canvas.selectNode(node, additive);
    } else if (typeof canvas.selectItems === "function") {
        canvas.selectItems([node], additive);
    }
    canvas.setDirty?.(true, true);
}

function captureNodeWheel(event) {
    for (const region of scrollRegions) {
        const rect = region.root.getBoundingClientRect();
        const inside = event.clientX >= rect.left
            && event.clientX <= rect.right
            && event.clientY >= rect.top
            && event.clientY <= rect.bottom;
        if (!inside) continue;
        if (!isNodeSelected(region.node)) continue;

        const eventTarget = event.target instanceof Element ? event.target : null;
        const nestedScroller = eventTarget?.closest(".sp-textarea, .sp-summary, .sp-profile-menu");
        const scrollTarget = nestedScroller && region.root.contains(nestedScroller)
            && nestedScroller.scrollHeight > nestedScroller.clientHeight
            ? nestedScroller
            : region.list;
        if (scrollTarget.scrollHeight > scrollTarget.clientHeight) {
            scrollByWheel(scrollTarget, event);
        }

        // Window capture runs before LiteGraph receives the event on its canvas.
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
    }
}

async function request(path, options = {}) {
    const response = await api.fetchApi(path, {
        ...options,
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
    });
    let payload = {};
    try {
        payload = await response.json();
    } catch (_error) {
        // Keep the status-based fallback below.
    }
    if (!response.ok) {
        throw new Error(payload.error || `Request failed (${response.status})`);
    }
    return payload;
}

function notifyLocal(payload) {
    for (const controller of controllers) controller.applyPayload(payload);
    channel?.postMessage(payload);
}

function showError(message) {
    const detail = message || "不明なエラーが発生しました。";
    const toast = app.extensionManager?.toast;
    if (toast?.add) {
        toast.add({
            severity: "error",
            summary: "Simple Preset",
            detail,
            life: 5000,
        });
        return;
    }
    window.alert(`Simple Preset\n\n${detail}`);
}

async function confirmDelete(name) {
    const dialog = app.extensionManager?.dialog;
    if (dialog?.confirm) {
        return Boolean(await dialog.confirm({
            title: "プリセットを削除",
            message: `「${name}」を削除します。この操作は元に戻せません。`,
        }));
    }
    return window.confirm(`「${name}」を削除しますか？`);
}

async function confirmProfileDelete(name, presetCount) {
    const message = `「${name}」と所属するプリセット${presetCount}件をすべて削除します。`
        + "この操作は元に戻せません。";
    const dialog = app.extensionManager?.dialog;
    if (dialog?.confirm) {
        return Boolean(await dialog.confirm({
            title: "プロファイルを削除",
            message,
        }));
    }
    return window.confirm(message);
}

function createPresetWidget(node, inputName, inputData) {
    installStyles();
    const root = element("div", "sp-root");
    root.addEventListener("pointerdown", (event) => {
        selectNodeFromWidget(node, event);
    }, { capture: true });
    let profiles = [];
    let presets = [];
    let selectedIds = parseSelection(inputData?.[1]?.default ?? "[]");
    let currentProfileId = storedProfileId(node);
    let presetFormProfileId = DEFAULT_PROFILE_ID;
    let editingId = null;
    let editingProfileId = null;
    let formVisible = false;
    let profileFormVisible = false;
    let loading = false;
    let searchText = "";
    let sortKey = null;
    let sortDirectionValue = "asc";
    let syncToken = 0;
    let active = true;
    let activation = 0;
    let snapshotRevision = null;
    let widget;
    const sortCollator = new Intl.Collator(undefined, {
        numeric: true,
        sensitivity: "base",
    });

    const header = element("div", "sp-header");
    const title = element("div", "sp-title", "プリセット");
    const count = element("div", "sp-count", "0 / 0");
    const reloadButton = iconButton("refresh", "共有プリセットを再読込");
    const addButton = iconButton("add", "新しいプリセットを追加", "sp-icon-button sp-primary");
    header.append(title, count, reloadButton, addButton);

    const profileSection = element("div", "sp-profile-section");
    const profileToolbar = element("div", "sp-profile-toolbar");
    const profileLabel = element("label", "sp-profile-label", "プロファイル");
    const profileControl = element("div", "sp-profile-control");
    const profileButton = element("button", "sp-profile-button");
    profileButton.type = "button";
    profileButton.setAttribute("aria-haspopup", "listbox");
    profileButton.setAttribute("aria-expanded", "false");
    const profileButtonText = element("span", "sp-profile-button-text", "Default (0)");
    profileButton.append(profileButtonText, icon("down"));
    const profileMenu = element("div", "sp-profile-menu sp-hidden");
    profileMenu.setAttribute("role", "listbox");
    profileControl.append(profileButton, profileMenu);
    // ComfyUI has not assigned node IDs yet when custom widgets are created.
    profileButton.id = `sp-profile-${++profileControlId}`;
    profileLabel.htmlFor = profileButton.id;
    const addProfileButton = iconButton("add", "新しいプロファイルを追加");
    const editProfileButton = iconButton("edit", "現在のプロファイル名を変更");
    const deleteProfileButton = iconButton(
        "delete", "現在のプロファイルと所属プリセットを削除", "sp-icon-button sp-danger"
    );
    profileToolbar.append(
        profileLabel,
        profileControl,
        addProfileButton,
        editProfileButton,
        deleteProfileButton,
    );
    const profileMenuEntry = {
        control: profileControl,
        menu: profileMenu,
        button: profileButton,
    };
    popupMenus.add(profileMenuEntry);
    const profileForm = element("div", "sp-profile-form sp-hidden");
    const profileNameInput = element("input", "sp-input");
    profileNameInput.type = "text";
    profileNameInput.maxLength = 120;
    profileNameInput.placeholder = "プロファイル名";
    const cancelProfileButton = iconButton("cancel", "プロファイル編集を取り消す");
    const saveProfileButton = iconButton("save", "プロファイルを保存", "sp-icon-button sp-primary");
    profileForm.append(profileNameInput, cancelProfileButton, saveProfileButton);
    profileSection.append(profileToolbar, profileForm);

    const toolbar = element("div", "sp-toolbar");
    const search = element("input", "sp-search");
    search.type = "search";
    search.placeholder = "名前・プロンプトを検索";
    const sortControl = element("div", "sp-sort-control");
    const sortButton = iconButton("sort", "並べ替え");
    sortButton.setAttribute("aria-haspopup", "menu");
    sortButton.setAttribute("aria-expanded", "false");
    const sortMenu = element("div", "sp-sort-menu sp-hidden");
    const sortByNameButton = labeledIconButton("name", "名前", "sp-sort-option");
    const sortByPromptButton = labeledIconButton("prompt", "プロンプト", "sp-sort-option");
    const sortByCreatedButton = labeledIconButton("created", "追加順", "sp-sort-option");
    const sortByUpdatedButton = labeledIconButton("updated", "更新順", "sp-sort-option");
    const sortDirectionControl = element("div", "sp-sort-direction");
    const ascendingButton = labeledIconButton("up", "昇順", "sp-sort-direction-button");
    const descendingButton = labeledIconButton("down", "降順", "sp-sort-direction-button");
    sortDirectionControl.append(ascendingButton, descendingButton);
    sortMenu.append(
        sortByNameButton,
        sortByPromptButton,
        sortByCreatedButton,
        sortByUpdatedButton,
        sortDirectionControl,
    );
    sortControl.append(sortButton, sortMenu);
    const sortMenuEntry = { control: sortControl, menu: sortMenu, button: sortButton };
    popupMenus.add(sortMenuEntry);
    const selectAllButton = iconButton("selectAll", "表示中のプリセットをすべて選択");
    const clearButton = iconButton("clear", "現在のプロファイルの選択を解除");
    toolbar.append(search, sortControl, selectAllButton, clearButton);

    const form = element("div", "sp-form sp-hidden");
    const formHeader = element("div", "sp-form-header");
    const formTitle = element("div", "sp-form-title", "プリセットを追加");
    const nameInput = element("input", "sp-input");
    nameInput.type = "text";
    nameInput.maxLength = 120;
    nameInput.placeholder = "プリセット名";
    const promptInput = element("textarea", "sp-textarea");
    promptInput.maxLength = 100000;
    promptInput.placeholder = "プロンプト本文";
    const presetProfileControl = element("div", "sp-profile-control");
    const presetProfileButton = element("button", "sp-profile-button");
    presetProfileButton.type = "button";
    presetProfileButton.setAttribute("aria-label", "所属プロファイル");
    presetProfileButton.setAttribute("aria-haspopup", "listbox");
    presetProfileButton.setAttribute("aria-expanded", "false");
    const presetProfileButtonText = element(
        "span", "sp-profile-button-text", "Default"
    );
    presetProfileButton.append(presetProfileButtonText, icon("down"));
    const presetProfileMenu = element("div", "sp-profile-menu sp-hidden");
    presetProfileMenu.setAttribute("role", "listbox");
    presetProfileControl.append(presetProfileButton, presetProfileMenu);
    const presetProfileMenuEntry = {
        control: presetProfileControl,
        menu: presetProfileMenu,
        button: presetProfileButton,
    };
    popupMenus.add(presetProfileMenuEntry);
    const presetProfileField = element("div", "sp-form-field");
    presetProfileField.append(
        element("span", "sp-form-label", "所属プロファイル"),
        presetProfileControl,
    );
    const formActions = element("div", "sp-form-actions");
    const cancelButton = iconButton("cancel", "編集を取り消す");
    const saveButton = iconButton("save", "プリセットを保存", "sp-icon-button sp-primary");
    formActions.append(cancelButton, saveButton);
    formHeader.append(formTitle, formActions);
    form.append(formHeader, nameInput, presetProfileField, promptInput);

    const list = element("div", "sp-list");
    list.tabIndex = 0;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "プリセット一覧");
    list.addEventListener("wheel", (event) => {
        if (!isNodeSelected(node)) return;
        if (list.scrollHeight <= list.clientHeight) return;
        scrollByWheel(list, event);
        event.preventDefault();
        event.stopPropagation();
    }, { passive: false });
    list.addEventListener("pointerdown", (event) => event.stopPropagation());
    list.addEventListener("mousedown", (event) => event.stopPropagation());
    list.addEventListener("touchmove", (event) => event.stopPropagation(), { passive: true });
    list.addEventListener("keydown", (event) => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
            event.stopPropagation();
        }
    });
    const summary = element("div", "sp-summary");
    const summaryLabel = element("span", "sp-summary-label sp-inline-icon");
    summaryLabel.title = "選択中のプリセット";
    summaryLabel.append(icon("output"));
    const summaryChips = element("div", "sp-summary-chips");
    summaryChips.setAttribute("role", "listbox");
    summaryChips.setAttribute("aria-label", "適用プリセット（ドラッグで順序変更）");
    summary.append(summaryLabel, summaryChips);
    const selectionNotice = element("div", "sp-selection-notice sp-hidden");
    root.append(profileSection, header, toolbar, form, list, selectionNotice, summary);
    const scrollRegion = { root, list, node };
    scrollRegions.add(scrollRegion);

    const selectedSet = () => new Set(selectedIds);
    const profilePresets = () => {
        if (currentProfileId === ALL_PROFILES) return presets;
        return presets.filter((preset) => preset.profile_id === currentProfileId);
    };
    const visiblePresets = () => {
        const query = searchText.trim().toLocaleLowerCase();
        const scoped = profilePresets();
        if (!query) return scoped;
        return scoped.filter((preset) =>
            preset.name.toLocaleLowerCase().includes(query)
            || preset.prompt.toLocaleLowerCase().includes(query)
        );
    };

    function rebuildProfileOptions() {
        const resolvedProfileId = resolveProfileId(currentProfileId, profiles);
        if (resolvedProfileId !== currentProfileId) {
            currentProfileId = storeProfileId(node, resolvedProfileId);
            markChanged();
        }

        const choices = [
            { id: ALL_PROFILES, label: `すべてのプリセット (${presets.length})` },
            ...profiles.map((profile) => ({
                id: profile.id,
                label: `${profile.name} (${presets.filter(
                    (preset) => preset.profile_id === profile.id
                ).length})`,
            })),
        ];
        renderProfileChoices(profileMenu, choices, currentProfileId, selectProfile);
        profileButtonText.textContent = choices.find(
            (choice) => choice.id === currentProfileId
        )?.label ?? "プロファイルを選択";

        rebuildPresetProfileOptions();
    }

    function rebuildPresetProfileOptions() {
        const availableProfiles = new Set(profiles.map((profile) => profile.id));
        if (!availableProfiles.has(presetFormProfileId)) {
            presetFormProfileId = availableProfiles.has(DEFAULT_PROFILE_ID)
                ? DEFAULT_PROFILE_ID
                : profiles[0]?.id ?? "";
        }
        const choices = profiles.map((profile) => ({
            id: profile.id,
            label: profile.name,
        }));
        renderProfileChoices(
            presetProfileMenu,
            choices,
            presetFormProfileId,
            selectPresetFormProfile,
        );
        presetProfileButtonText.textContent = profiles.find(
            (profile) => profile.id === presetFormProfileId
        )?.name ?? "プロファイルを選択";
    }

    function selectProfile(profileId) {
        currentProfileId = storeProfileId(node, profileId);
        profileMenu.classList.add("sp-hidden");
        profileButton.setAttribute("aria-expanded", "false");
        sortMenu.classList.add("sp-hidden");
        sortButton.setAttribute("aria-expanded", "false");
        markChanged();
        rebuildProfileOptions();
        render();
    }

    function selectPresetFormProfile(profileId) {
        if (!profiles.some((profile) => profile.id === profileId)) return;
        presetFormProfileId = profileId;
        presetProfileMenu.classList.add("sp-hidden");
        presetProfileButton.setAttribute("aria-expanded", "false");
        rebuildPresetProfileOptions();
    }

    function markChanged() {
        node.graph?.setDirtyCanvas?.(true, true);
    }

    function setLoading(value) {
        loading = value;
        reloadButton.disabled = value;
        reloadButton.classList.toggle("sp-loading", value);
        addButton.disabled = value;
        saveButton.disabled = value;
        render();
    }

    function setSelection(nextIds) {
        selectedIds = parseSelection(nextIds);
        markChanged();
        render();
    }

    function commitChipOrder() {
        const nextIds = [...summaryChips.querySelectorAll(".sp-preset-chip")]
            .map((chip) => chip.dataset.presetId);
        if (nextIds.length !== selectedIds.length) return render();
        if (nextIds.every((id, index) => id === selectedIds[index])) return;
        setSelection(nextIds);
    }

    function chipInsertionTarget(dragging, event) {
        const chips = [...summaryChips.querySelectorAll(".sp-preset-chip")]
            .filter((chip) => chip !== dragging);
        return chips.find((chip) => {
            const rect = chip.getBoundingClientRect();
            if (event.clientY < rect.top) return true;
            return event.clientY <= rect.bottom
                && event.clientX < rect.left + rect.width / 2;
        }) ?? null;
    }

    function openForm(preset = null) {
        editingProfileId = null;
        profileFormVisible = false;
        profileNameInput.value = "";
        editingId = preset?.id ?? null;
        formVisible = true;
        formTitle.textContent = preset ? "プリセットを編集" : "プリセットを追加";
        nameInput.value = preset?.name ?? "";
        promptInput.value = preset?.prompt ?? "";
        presetFormProfileId = preset?.profile_id
            ?? (profiles.some((profile) => profile.id === currentProfileId)
                ? currentProfileId
                : profiles.find((profile) => profile.id === DEFAULT_PROFILE_ID)?.id
                    ?? profiles[0]?.id
                    ?? "");
        rebuildPresetProfileOptions();
        render();
        requestAnimationFrame(() => nameInput.focus());
    }

    function closeForm() {
        editingId = null;
        formVisible = false;
        nameInput.value = "";
        promptInput.value = "";
        presetProfileMenu.classList.add("sp-hidden");
        presetProfileButton.setAttribute("aria-expanded", "false");
        render();
    }

    function openProfileForm(profile = null) {
        editingId = null;
        formVisible = false;
        nameInput.value = "";
        promptInput.value = "";
        editingProfileId = profile?.id ?? null;
        profileFormVisible = true;
        profileNameInput.value = profile?.name ?? "";
        profileNameInput.placeholder = profile ? "新しいプロファイル名" : "プロファイル名";
        render();
        requestAnimationFrame(() => profileNameInput.focus());
    }

    function closeProfileForm() {
        editingProfileId = null;
        profileFormVisible = false;
        profileNameInput.value = "";
        profileNameInput.setCustomValidity("");
        render();
    }

    async function mutate(path, options) {
        if (loading || !active) return null;
        const requestActivation = activation;
        syncToken += 1;
        setLoading(true);
        try {
            const payload = await request(path, options);
            notifyLocal(payload);
            return active && activation === requestActivation ? payload : null;
        } catch (error) {
            if (active && activation === requestActivation) showError(error.message || String(error));
            return null;
        } finally {
            if (activation === requestActivation) setLoading(false);
        }
    }

    async function saveForm() {
        if (loading || !active) return;
        const name = nameInput.value.trim();
        const prompt = promptInput.value;
        if (!editingId && currentProfileId === ALL_PROFILES) {
            showError("プリセットを追加するプロファイルを選択してください。");
            return;
        }
        if (!name) {
            nameInput.setCustomValidity("プリセット名を入力してください。");
            nameInput.reportValidity();
            nameInput.focus();
            return;
        }
        nameInput.setCustomValidity("");
        const path = editingId
            ? `/simple-preset/presets/${encodeURIComponent(editingId)}`
            : "/simple-preset/presets";
        const ok = await mutate(path, {
            method: editingId ? "PUT" : "POST",
            body: JSON.stringify({
                name,
                prompt,
                profile_id: editingId
                    ? presetFormProfileId
                    : currentProfileId,
            }),
        });
        if (ok) closeForm();
    }

    async function saveProfile() {
        if (loading || !active) return;
        const name = profileNameInput.value.trim();
        if (!name) {
            profileNameInput.setCustomValidity("プロファイル名を入力してください。");
            profileNameInput.reportValidity();
            profileNameInput.focus();
            return;
        }
        profileNameInput.setCustomValidity("");
        const path = editingProfileId
            ? `/simple-preset/profiles/${encodeURIComponent(editingProfileId)}`
            : "/simple-preset/profiles";
        const payload = await mutate(path, {
            method: editingProfileId ? "PUT" : "POST",
            body: JSON.stringify({ name }),
        });
        if (!payload) return;
        if (payload.created_profile_id) {
            currentProfileId = storeProfileId(node, payload.created_profile_id);
            markChanged();
            rebuildProfileOptions();
        }
        closeProfileForm();
    }

    async function removePreset(preset) {
        if (!await confirmDelete(preset.name)) return;
        await mutate(`/simple-preset/presets/${encodeURIComponent(preset.id)}`, {
            method: "DELETE",
        });
    }

    async function removeProfile(profile) {
        const presetCount = presets.filter((preset) => preset.profile_id === profile.id).length;
        if (!await confirmProfileDelete(profile.name, presetCount)) return;
        const payload = await mutate(
            `/simple-preset/profiles/${encodeURIComponent(profile.id)}`,
            { method: "DELETE" },
        );
        if (payload) closeProfileForm();
    }

    function updateSortControls() {
        sortByNameButton.classList.toggle("sp-active", sortKey === "name");
        sortByPromptButton.classList.toggle("sp-active", sortKey === "prompt");
        sortByCreatedButton.classList.toggle("sp-active", sortKey === "created_at");
        sortByUpdatedButton.classList.toggle("sp-active", sortKey === "updated_at");
        ascendingButton.classList.toggle("sp-active", sortDirectionValue === "asc");
        descendingButton.classList.toggle("sp-active", sortDirectionValue === "desc");
        sortByNameButton.setAttribute("aria-pressed", String(sortKey === "name"));
        sortByPromptButton.setAttribute("aria-pressed", String(sortKey === "prompt"));
        sortByCreatedButton.setAttribute("aria-pressed", String(sortKey === "created_at"));
        sortByUpdatedButton.setAttribute("aria-pressed", String(sortKey === "updated_at"));
        ascendingButton.setAttribute("aria-pressed", String(sortDirectionValue === "asc"));
        descendingButton.setAttribute("aria-pressed", String(sortDirectionValue === "desc"));
    }

    async function sortPresets(key = sortKey) {
        if (!key || loading || !active) return;
        sortKey = key;
        updateSortControls();
        const scoped = profilePresets();
        if (scoped.length < 2) return;

        const multiplier = sortDirectionValue === "asc" ? 1 : -1;
        const sorted = [...scoped]
            .sort((left, right) => multiplier * sortCollator.compare(left[key], right[key]))
            .map((preset) => preset.id);
        const scopedIds = new Set(sorted);
        let sortedIndex = 0;
        const ids = presets.map((preset) => scopedIds.has(preset.id)
            ? sorted[sortedIndex++] : preset.id);
        if (ids.every((id, index) => id === presets[index].id)) return;
        await mutate("/simple-preset/order", {
            method: "POST",
            body: JSON.stringify({ ids }),
        });
    }

    function render() {
        summary.classList.remove("sp-drag-active");
        root.classList.toggle("sp-form-open", formVisible);
        form.classList.toggle("sp-hidden", !formVisible);
        presetProfileField.classList.toggle("sp-hidden", !editingId);
        profileForm.classList.toggle("sp-hidden", !profileFormVisible);
        const selected = selectedSet();
        const scoped = profilePresets();
        const visible = visiblePresets();
        const selectedInProfile = scoped.filter((preset) => selected.has(preset.id)).length;
        const selectedOutsideProfile = selected.size - selectedInProfile;
        const currentProfile = profiles.find((profile) => profile.id === currentProfileId);
        const canEditCurrentProfile = Boolean(currentProfile)
            && currentProfile.id !== DEFAULT_PROFILE_ID;
        const canDeleteCurrentProfile = Boolean(currentProfile)
            && currentProfile.id !== DEFAULT_PROFILE_ID
            && profiles.length > 1;
        count.textContent = `${selectedInProfile} / ${scoped.length}`;
        count.title = `全体では${selected.size}件選択中`;
        const canAddPreset = currentProfileId !== ALL_PROFILES;
        addButton.disabled = loading || !canAddPreset;
        const addPresetTitle = canAddPreset
            ? "現在のプロファイルに新しいプリセットを追加"
            : "プリセットを追加するプロファイルを選択してください";
        addButton.title = addPresetTitle;
        addButton.setAttribute("aria-label", addPresetTitle);
        saveButton.disabled = loading || (!editingId && currentProfileId === ALL_PROFILES);
        presetProfileButton.disabled = loading || profiles.length === 0;
        profileButton.disabled = loading;
        addProfileButton.disabled = loading;
        editProfileButton.disabled = loading || !canEditCurrentProfile;
        deleteProfileButton.disabled = loading || !canDeleteCurrentProfile;
        const editProfileTitle = currentProfile?.id === DEFAULT_PROFILE_ID
            ? "Defaultプロファイルは名前変更できません"
            : "現在のプロファイル名を変更";
        const deleteProfileTitle = currentProfile?.id === DEFAULT_PROFILE_ID
            ? "Defaultプロファイルは削除できません"
            : profiles.length <= 1 && currentProfile
                ? "最後のプロファイルは削除できません"
                : "現在のプロファイルと所属プリセットを削除";
        editProfileButton.title = editProfileTitle;
        editProfileButton.setAttribute("aria-label", editProfileTitle);
        deleteProfileButton.title = deleteProfileTitle;
        deleteProfileButton.setAttribute("aria-label", deleteProfileTitle);
        saveProfileButton.disabled = loading;
        cancelButton.disabled = loading;
        nameInput.disabled = loading;
        promptInput.disabled = loading;
        profileNameInput.disabled = loading;
        cancelProfileButton.disabled = loading;
        clearButton.disabled = loading || selectedInProfile === 0;
        selectAllButton.disabled = loading || visible.length === 0
            || visible.every((preset) => selected.has(preset.id));
        sortButton.disabled = loading || scoped.length < 2;
        sortByNameButton.disabled = loading || scoped.length < 2;
        sortByPromptButton.disabled = loading || scoped.length < 2;
        sortByCreatedButton.disabled = loading || scoped.length < 2;
        sortByUpdatedButton.disabled = loading || scoped.length < 2;
        ascendingButton.disabled = loading || scoped.length < 2;
        descendingButton.disabled = loading || scoped.length < 2;
        if (loading) {
            profileMenu.classList.add("sp-hidden");
            profileButton.setAttribute("aria-expanded", "false");
            presetProfileMenu.classList.add("sp-hidden");
            presetProfileButton.setAttribute("aria-expanded", "false");
        }
        if (scoped.length < 2 || loading) {
            sortMenu.classList.add("sp-hidden");
            sortButton.setAttribute("aria-expanded", "false");
        }
        updateSortControls();

        selectionNotice.classList.toggle(
            "sp-hidden",
            currentProfileId === ALL_PROFILES || selectedOutsideProfile === 0,
        );
        selectionNotice.textContent = `他のプロファイルで${selectedOutsideProfile}件選択中`;

        list.replaceChildren();
        if (!presets.length) {
            list.append(element("div", "sp-empty", "プリセットはまだありません。上部の＋アイコンから登録できます。"));
        } else if (!scoped.length) {
            list.append(element("div", "sp-empty", "このプロファイルにはプリセットがありません。"));
        } else if (!visible.length) {
            list.append(element("div", "sp-empty", "検索条件に一致するプリセットがありません。"));
        } else {
            for (const [index, preset] of visible.entries()) {
                const row = element("div", `sp-row${selected.has(preset.id) ? " sp-selected" : ""}`);
                const checkbox = element("input", "sp-check");
                checkbox.type = "checkbox";
                checkbox.checked = selected.has(preset.id);
                checkbox.setAttribute("aria-label", `${preset.name}を選択`);
                const order = element("span", "sp-order", String(index + 1));
                const copy = element("div", "sp-copy");
                const presetName = element("div", "sp-name", preset.name);
                const presetPrompt = element("div", "sp-prompt", preset.prompt || "（空のプロンプト）");
                presetName.title = preset.name;
                presetPrompt.title = preset.prompt;
                copy.append(presetName, presetPrompt);
                const actions = element("div", "sp-actions");
                const edit = iconButton("edit", "編集");
                const remove = iconButton("delete", "削除", "sp-icon-button sp-danger");
                edit.disabled = loading;
                remove.disabled = loading;
                actions.append(edit, remove);
                row.append(checkbox, order, copy, actions);

                const toggle = () => {
                    const next = selectedSet();
                    if (next.has(preset.id)) next.delete(preset.id);
                    else next.add(preset.id);
                    setSelection([...next]);
                };
                row.addEventListener("click", (event) => {
                    if (event.target.closest("button") || event.target === checkbox) return;
                    toggle();
                });
                checkbox.addEventListener("change", toggle);
                edit.addEventListener("click", () => openForm(preset));
                remove.addEventListener("click", () => removePreset(preset));
                list.append(row);
            }
        }

        const presetsById = new Map(presets.map((preset) => [preset.id, preset]));
        summaryChips.replaceChildren();
        if (!selectedIds.length) {
            summaryChips.append(element("span", "sp-summary-empty", "（未選択）"));
        } else {
            for (const [index, presetId] of selectedIds.entries()) {
                const preset = presetsById.get(presetId);
                if (!preset) continue;
                const chip = element("button", "sp-preset-chip", preset.name);
                chip.type = "button";
                chip.draggable = true;
                chip.dataset.presetId = preset.id;
                chip.title = `${preset.name}\nドラッグで適用順を変更`;
                chip.setAttribute("role", "option");
                chip.setAttribute("aria-selected", "true");
                chip.setAttribute(
                    "aria-label",
                    `${preset.name}、適用順 ${index + 1} / ${selectedIds.length}`,
                );
                chip.addEventListener("dragstart", (event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", preset.id);
                    chip.classList.add("sp-dragging");
                    summary.classList.add("sp-drag-active");
                });
                chip.addEventListener("dragend", () => {
                    chip.classList.remove("sp-dragging");
                    summary.classList.remove("sp-drag-active");
                    // Only dropping inside the summary commits the previewed order.
                    render();
                });
                chip.addEventListener("keydown", (event) => {
                    if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const offset = event.key === "ArrowLeft" ? -1 : 1;
                    const nextIds = moveSelection(selectedIds, preset.id, offset);
                    if (nextIds.every((id, itemIndex) => id === selectedIds[itemIndex])) return;
                    setSelection(nextIds);
                    requestAnimationFrame(() => {
                        [...summaryChips.querySelectorAll(".sp-preset-chip")]
                            .find((item) => item.dataset.presetId === preset.id)
                            ?.focus();
                    });
                });
                summaryChips.append(chip);
            }
        }
    }

    summary.addEventListener("dragover", (event) => {
        const dragging = summaryChips.querySelector(".sp-dragging");
        if (!dragging) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        summaryChips.insertBefore(dragging, chipInsertionTarget(dragging, event));
    });
    summary.addEventListener("drop", (event) => {
        if (!summaryChips.querySelector(".sp-dragging")) return;
        event.preventDefault();
        event.stopPropagation();
        summary.classList.remove("sp-drag-active");
        commitChipOrder();
    });
    summary.addEventListener("pointerdown", (event) => event.stopPropagation());
    summary.addEventListener("mousedown", (event) => event.stopPropagation());

    const controller = {
        applyPayload(payload) {
            if (!active || !Array.isArray(payload?.presets)) return;
            if (typeof payload.store_id === "string" && Number.isSafeInteger(payload.revision)) {
                if (snapshotRevision?.storeId === payload.store_id
                    && snapshotRevision.revision > payload.revision) return;
                snapshotRevision = { storeId: payload.store_id, revision: payload.revision };
            }
            const nextProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
            const nextPresets = payload.presets;
            const dataChanged = !samePresetData(
                profiles,
                presets,
                nextProfiles,
                nextPresets,
            );
            const available = new Set(nextPresets.map((preset) => preset.id));
            const retained = selectedIds.filter((id) => available.has(id));
            const selectionChanged = retained.length !== selectedIds.length;
            if (!dataChanged && !selectionChanged) return;

            if (dataChanged) {
                profiles = nextProfiles;
                presets = nextPresets;
                syncToken += 1;
            }
            if (selectionChanged) {
                selectedIds = retained;
                markChanged();
            }
            if (dataChanged) rebuildProfileOptions();
            render();
        },
        async refresh({ quiet = false } = {}) {
            if (!active || loading) return;
            const requestActivation = activation;
            const requestToken = ++syncToken;
            if (!quiet) setLoading(true);
            try {
                const payload = await request("/simple-preset/presets");
                if (syncToken !== requestToken) return;
                controller.applyPayload(payload);
            } catch (error) {
                if (!quiet && active && activation === requestActivation) {
                    showError(error.message || String(error));
                }
            } finally {
                if (!quiet && activation === requestActivation) setLoading(false);
            }
        },
    };
    controllers.add(controller);

    reloadButton.addEventListener("click", () => controller.refresh());
    addButton.addEventListener("click", () => openForm());
    bindProfileMenu(profileButton, profileMenu, profileMenuEntry);
    bindProfileMenu(
        presetProfileButton,
        presetProfileMenu,
        presetProfileMenuEntry,
    );
    addProfileButton.addEventListener("click", () => openProfileForm());
    editProfileButton.addEventListener("click", () => {
        const profile = profiles.find((item) => item.id === currentProfileId);
        if (profile) openProfileForm(profile);
    });
    deleteProfileButton.addEventListener("click", () => {
        const profile = profiles.find((item) => item.id === currentProfileId);
        if (profile) removeProfile(profile);
    });
    cancelProfileButton.addEventListener("click", closeProfileForm);
    saveProfileButton.addEventListener("click", saveProfile);
    profileNameInput.addEventListener("input", () => profileNameInput.setCustomValidity(""));
    profileNameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            saveProfile();
        }
    });
    cancelButton.addEventListener("click", closeForm);
    saveButton.addEventListener("click", saveForm);
    nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            promptInput.focus();
        }
    });
    nameInput.addEventListener("input", () => nameInput.setCustomValidity(""));
    promptInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            saveForm();
        }
    });
    search.addEventListener("input", () => {
        searchText = search.value;
        render();
    });
    sortButton.addEventListener("click", () => {
        if (sortMenu.classList.contains("sp-hidden")) {
            closePopupMenus(sortMenuEntry);
            sortMenu.classList.remove("sp-hidden");
            sortButton.setAttribute("aria-expanded", "true");
        } else {
            sortMenu.classList.add("sp-hidden");
            sortButton.setAttribute("aria-expanded", "false");
        }
    });
    sortByNameButton.addEventListener("click", () => sortPresets("name"));
    sortByPromptButton.addEventListener("click", () => sortPresets("prompt"));
    sortByCreatedButton.addEventListener("click", () => sortPresets("created_at"));
    sortByUpdatedButton.addEventListener("click", () => sortPresets("updated_at"));
    ascendingButton.addEventListener("click", () => {
        sortDirectionValue = "asc";
        updateSortControls();
        if (sortKey) sortPresets();
    });
    descendingButton.addEventListener("click", () => {
        sortDirectionValue = "desc";
        updateSortControls();
        if (sortKey) sortPresets();
    });
    selectAllButton.addEventListener("click", () => {
        const next = selectedSet();
        for (const preset of visiblePresets()) next.add(preset.id);
        setSelection([...next]);
    });
    clearButton.addEventListener("click", () => {
        const scopedIds = new Set(profilePresets().map((preset) => preset.id));
        setSelection(selectedIds.filter((id) => !scopedIds.has(id)));
    });

    widget = node.addDOMWidget(inputName, "simple_preset_selection", root, {
        serialize: true,
        getValue: () => JSON.stringify(selectedIds),
        setValue: (value) => {
            selectedIds = parseSelection(value);
            currentProfileId = storedProfileId(node);
            if (profiles.length) {
                const available = new Set(presets.map((preset) => preset.id));
                selectedIds = selectedIds.filter((id) => available.has(id));
                rebuildProfileOptions();
            }
            render();
        },
        getMinHeight: () => 480,
        getMaxHeight: () => 480,
        getHeight: () => 480,
        hideOnZoom: false,
        socketless: true,
    });
    widget.serializeValue = () => executionSelectionValue(
        selectedIds,
        separatorSettingValue(),
    );
    widget.computeSize = (width) => [width, 480];

    function deactivate() {
        active = false;
        activation += 1;
        syncToken += 1;
        setLoading(false);
        controllers.delete(controller);
        scrollRegions.delete(scrollRegion);
        for (const entry of [profileMenuEntry, presetProfileMenuEntry, sortMenuEntry]) {
            entry.menu.classList.add("sp-hidden");
            entry.button?.setAttribute("aria-expanded", "false");
            popupMenus.delete(entry);
        }
    }

    const onRemove = widget.onRemove;
    widget.onRemove = function (...args) {
        deactivate();
        return onRemove?.apply(this, args);
    };
    const onRemoved = node.onRemoved;
    node.onRemoved = function (...args) {
        deactivate();
        return onRemoved?.apply(this, args);
    };
    const onAdded = node.onAdded;
    node.onAdded = function (...args) {
        const result = onAdded?.apply(this, args);
        if (!active) {
            active = true;
            controllers.add(controller);
            scrollRegions.add(scrollRegion);
            for (const entry of [profileMenuEntry, presetProfileMenuEntry, sortMenuEntry]) {
                popupMenus.add(entry);
            }
            controller.refresh();
        }
        return result;
    };

    render();
    controller.refresh();
    return { widget };
}

channel?.addEventListener("message", (event) => {
    for (const controller of controllers) controller.applyPayload(event.data);
});

app.registerExtension({
    name: "simple-preset.manager",
    settings: [
        {
            id: SEPARATOR_SETTING_ID,
            name: "プリセット間の区切り",
            type: "combo",
            defaultValue: DEFAULT_SEPARATOR,
            options: SEPARATOR_OPTIONS,
            category: ["Simple Preset", "出力", "プリセット間の区切り"],
            tooltip: "選択したプリセットのプロンプトを結合するときの区切り文字です。",
        },
    ],
    getCustomWidgets() {
        return {
            SIMPLE_PRESET_SELECTION: createPresetWidget,
        };
    },
    nodeCreated(node) {
        if (node.comfyClass !== "SimplePreset" && node.constructor?.comfyClass !== "SimplePreset") return;
        removeLegacyInternalInputs(node);
        const [width, height] = node.size;
        node.setSize([Math.max(width, 430), Math.max(height, 560)]);
    },
    loadedGraphNode(node) {
        if (node.comfyClass !== "SimplePreset" && node.constructor?.comfyClass !== "SimplePreset") return;
        removeLegacyInternalInputs(node);
    },
    setup() {
        window.addEventListener("pointerdown", (event) => {
            const target = event.target instanceof Node ? event.target : null;
            for (const entry of popupMenus) {
                if (!target || !entry.control.contains(target)) {
                    entry.menu.classList.add("sp-hidden");
                    entry.button?.setAttribute("aria-expanded", "false");
                }
            }
        }, { capture: true });
        window.addEventListener("wheel", captureNodeWheel, {
            capture: true,
            passive: false,
        });
        api.addEventListener("simple_preset.changed", (event) => {
            for (const controller of controllers) controller.applyPayload(event.detail);
        });
        window.addEventListener("focus", () => {
            for (const controller of controllers) controller.refresh({ quiet: true });
        });
    },
});
