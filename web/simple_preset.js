import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const controllers = new Set();
const scrollRegions = new Set();
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
        .sp-header, .sp-toolbar, .sp-summary, .sp-row, .sp-actions, .sp-form-header, .sp-form-actions {
            display: flex; align-items: center;
        }
        .sp-header { gap: 7px; }
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
        .sp-toolbar { gap: 6px; }
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
            flex-direction: column; gap: 5px; padding-right: 2px;
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
            gap: 7px; min-height: 48px; flex: 0 0 48px; padding: 6px 6px 6px 8px;
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
            display: flex; flex-direction: column; gap: 7px; padding: 8px;
            border: 1px solid var(--sp-accent); border-radius: 8px;
            background: var(--sp-panel);
        }
        .sp-form-header { min-height: 28px; gap: 8px; }
        .sp-form-title { min-width: 0; flex: 1; font-weight: 700; }
        .sp-textarea { height: 108px; min-height: 108px; resize: none; padding: 7px 8px; }
        .sp-form-actions { flex: none; gap: 6px; }
        .sp-empty {
            margin: auto; padding: 20px; max-width: 270px; text-align: center;
            color: var(--sp-muted); border: 1px dashed var(--sp-border); border-radius: 8px;
        }
        .sp-summary {
            gap: 7px; min-height: 31px; padding: 5px 7px;
            border-radius: 7px; background: var(--sp-panel);
        }
        .sp-summary-label { width: 17px; height: 17px; flex: none; color: var(--sp-muted); }
        .sp-summary-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

function parseSelection(value) {
    try {
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        if (!Array.isArray(parsed)) return [];
        return [...new Set(parsed.filter((item) => typeof item === "string"))];
    } catch (_error) {
        return [];
    }
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
        const textarea = eventTarget?.closest(".sp-textarea");
        const scrollTarget = textarea && textarea.scrollHeight > textarea.clientHeight
            ? textarea
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

function createPresetWidget(node, inputName, inputData) {
    installStyles();
    const root = element("div", "sp-root");
    root.addEventListener("pointerdown", (event) => {
        selectNodeFromWidget(node, event);
    }, { capture: true });
    let presets = [];
    let selectedIds = parseSelection(inputData?.[1]?.default ?? "[]");
    let editingId = null;
    let formVisible = false;
    let loading = false;
    let searchText = "";
    let widget;

    const header = element("div", "sp-header");
    const title = element("div", "sp-title", "プリセット");
    const count = element("div", "sp-count", "0 / 0");
    const reloadButton = iconButton("refresh", "共有プリセットを再読込");
    const addButton = iconButton("add", "新しいプリセットを追加", "sp-icon-button sp-primary");
    header.append(title, count, reloadButton, addButton);

    const toolbar = element("div", "sp-toolbar");
    const search = element("input", "sp-search");
    search.type = "search";
    search.placeholder = "名前・プロンプトを検索";
    const selectAllButton = iconButton("selectAll", "表示中のプリセットをすべて選択");
    const clearButton = iconButton("clear", "すべての選択を解除");
    toolbar.append(search, selectAllButton, clearButton);

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
    const formActions = element("div", "sp-form-actions");
    const cancelButton = iconButton("cancel", "編集を取り消す");
    const saveButton = iconButton("save", "プリセットを保存", "sp-icon-button sp-primary");
    formActions.append(cancelButton, saveButton);
    formHeader.append(formTitle, formActions);
    form.append(formHeader, nameInput, promptInput);

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
    summaryLabel.title = "結合出力";
    summaryLabel.append(icon("output"));
    const summaryText = element("span", "sp-summary-text", "（未選択）");
    summaryText.title = "選択したプロンプトの結合プレビュー";
    summary.append(summaryLabel, summaryText);
    root.append(header, toolbar, form, list, summary);
    scrollRegions.add({ root, list, node });

    const selectedSet = () => new Set(selectedIds);
    const visiblePresets = () => {
        const query = searchText.trim().toLocaleLowerCase();
        if (!query) return presets;
        return presets.filter((preset) =>
            preset.name.toLocaleLowerCase().includes(query)
            || preset.prompt.toLocaleLowerCase().includes(query)
        );
    };

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

    function openForm(preset = null) {
        editingId = preset?.id ?? null;
        formVisible = true;
        formTitle.textContent = preset ? "プリセットを編集" : "プリセットを追加";
        nameInput.value = preset?.name ?? "";
        promptInput.value = preset?.prompt ?? "";
        render();
        requestAnimationFrame(() => nameInput.focus());
    }

    function closeForm() {
        editingId = null;
        formVisible = false;
        nameInput.value = "";
        promptInput.value = "";
        render();
    }

    async function mutate(path, options) {
        setLoading(true);
        try {
            const payload = await request(path, options);
            notifyLocal(payload);
            return true;
        } catch (error) {
            showError(error.message || String(error));
            return false;
        } finally {
            setLoading(false);
        }
    }

    async function saveForm() {
        const name = nameInput.value.trim();
        const prompt = promptInput.value;
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
            body: JSON.stringify({ name, prompt }),
        });
        if (ok) closeForm();
    }

    async function removePreset(preset) {
        if (!await confirmDelete(preset.name)) return;
        await mutate(`/simple-preset/presets/${encodeURIComponent(preset.id)}`, {
            method: "DELETE",
        });
    }

    async function movePreset(index, offset) {
        const nextIndex = index + offset;
        if (nextIndex < 0 || nextIndex >= presets.length) return;
        const ids = presets.map((preset) => preset.id);
        [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
        await mutate("/simple-preset/order", {
            method: "POST",
            body: JSON.stringify({ ids }),
        });
    }

    function render() {
        form.classList.toggle("sp-hidden", !formVisible);
        const selected = selectedSet();
        const visible = visiblePresets();
        count.textContent = `${selected.size} / ${presets.length}`;
        clearButton.disabled = loading || selected.size === 0;
        selectAllButton.disabled = loading || visible.length === 0
            || visible.every((preset) => selected.has(preset.id));

        list.replaceChildren();
        if (!presets.length) {
            list.append(element("div", "sp-empty", "プリセットはまだありません。上部の＋アイコンから登録できます。"));
        } else if (!visible.length) {
            list.append(element("div", "sp-empty", "検索条件に一致するプリセットがありません。"));
        } else {
            for (const preset of visible) {
                const index = presets.findIndex((item) => item.id === preset.id);
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
                const up = iconButton("up", "上へ移動");
                const down = iconButton("down", "下へ移動");
                const edit = iconButton("edit", "編集");
                const remove = iconButton("delete", "削除", "sp-icon-button sp-danger");
                up.disabled = loading || index === 0;
                down.disabled = loading || index === presets.length - 1;
                edit.disabled = loading;
                remove.disabled = loading;
                actions.append(up, down, edit, remove);
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
                up.addEventListener("click", () => movePreset(index, -1));
                down.addEventListener("click", () => movePreset(index, 1));
                edit.addEventListener("click", () => openForm(preset));
                remove.addEventListener("click", () => removePreset(preset));
                list.append(row);
            }
        }

        const joined = presets
            .filter((preset) => selected.has(preset.id) && preset.prompt)
            .map((preset) => preset.prompt)
            .join(", ");
        summaryText.textContent = joined || "（未選択）";
        summaryText.title = joined || "選択したプリセットはありません";
    }

    const controller = {
        applyPayload(payload) {
            if (!Array.isArray(payload?.presets)) return;
            presets = payload.presets;
            const available = new Set(presets.map((preset) => preset.id));
            const retained = selectedIds.filter((id) => available.has(id));
            if (retained.length !== selectedIds.length) {
                selectedIds = retained;
                markChanged();
            }
            render();
        },
        async refresh({ quiet = false } = {}) {
            setLoading(true);
            try {
                const payload = await request("/simple-preset/presets");
                controller.applyPayload(payload);
            } catch (error) {
                if (!quiet) showError(error.message || String(error));
            } finally {
                setLoading(false);
            }
        },
    };
    controllers.add(controller);

    reloadButton.addEventListener("click", () => controller.refresh());
    addButton.addEventListener("click", () => openForm());
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
    selectAllButton.addEventListener("click", () => {
        const next = selectedSet();
        for (const preset of visiblePresets()) next.add(preset.id);
        setSelection([...next]);
    });
    clearButton.addEventListener("click", () => setSelection([]));

    widget = node.addDOMWidget(inputName, "simple_preset_selection", root, {
        serialize: true,
        getValue: () => JSON.stringify(selectedIds),
        setValue: (value) => {
            selectedIds = parseSelection(value);
            render();
        },
        getMinHeight: () => 430,
        getMaxHeight: () => 430,
        getHeight: () => 430,
        hideOnZoom: false,
    });
    widget.serializeValue = () => JSON.stringify(selectedIds);
    widget.computeSize = (width) => [width, 430];

    render();
    controller.refresh();
    return { widget };
}

channel?.addEventListener("message", (event) => {
    for (const controller of controllers) controller.applyPayload(event.data);
});

app.registerExtension({
    name: "simple-preset.manager",
    getCustomWidgets() {
        return {
            SIMPLE_PRESET_SELECTION: createPresetWidget,
        };
    },
    nodeCreated(node) {
        if (node.comfyClass !== "SimplePreset" && node.constructor?.comfyClass !== "SimplePreset") return;
        const [width, height] = node.size;
        node.setSize([Math.max(width, 430), Math.max(height, 510)]);
    },
    setup() {
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
