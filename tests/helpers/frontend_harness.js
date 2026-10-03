import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as profileState from "../../web/profile_state.js";
import * as separatorState from "../../web/separator_state.js";

// Exercise the actual extension with the DOM and ComfyUI boundary stubbed out.
class Element {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.dataset = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.className = "";
        this.value = "";
        this.disabled = false;
        this.classList = {
            contains: (name) => this.className.split(/\s+/).includes(name),
            toggle: (name, force) => {
                const names = new Set(this.className.split(/\s+/).filter(Boolean));
                const enabled = force ?? !names.has(name);
                if (enabled) names.add(name);
                else names.delete(name);
                this.className = [...names].join(" ");
                return enabled;
            },
            add: (name) => this.classList.toggle(name, true),
            remove: (name) => this.classList.toggle(name, false),
        };
    }
    append(...children) {
        for (const child of children) {
            child.parentElement = this;
            this.children.push(child);
        }
    }
    appendChild(child) { this.append(child); return child; }
    insertBefore(child, target) {
        this.children = this.children.filter((item) => item !== child);
        const index = target === null ? this.children.length : this.children.indexOf(target);
        this.children.splice(index, 0, child);
        child.parentElement = this;
    }
    replaceChildren(...children) {
        this.children = [];
        this.append(...children);
    }
    set textContent(value) { this.text = String(value); }
    get textContent() { return this.text ?? this.children.map((child) => child.textContent).join(""); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name); }
    addEventListener(name, callback) {
        if (!this.listeners.has(name)) this.listeners.set(name, []);
        this.listeners.get(name).push(callback);
    }
    fire(name, detail = {}) {
        const event = {
            target: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
            ...detail,
        };
        for (const callback of this.listeners.get(name) ?? []) callback(event);
    }
    click() { if (!this.disabled) this.fire("click"); }
    matches(selector) {
        if (selector.includes(",")) return selector.split(",").some((part) => this.matches(part.trim()));
        return selector.startsWith(".")
            ? this.classList.contains(selector.slice(1))
            : this.tagName === selector;
    }
    querySelectorAll(selector) {
        return this.children.flatMap((child) => [
            ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
        ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
    getBoundingClientRect() { return this.rect ?? { left: 0, top: 0, right: 430, bottom: 480 }; }
    focus() {}
    setCustomValidity(value) { this.validityMessage = value; }
    reportValidity() {}
}

export function response(payload, status = 200) {
    return { ok: status < 400, status, json: async () => payload };
}

export function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

export async function flush() {
    await new Promise((done) => setImmediate(done));
}

export function frontendHarness(initialPayload) {
    const window = new Element("window");
    const api = new Element("api");
    const calls = [];
    const errors = [];
    let fetch = async () => response(initialPayload);
    api.fetchApi = (path, options) => {
        calls.push({ path, options });
        return fetch(path, options);
    };
    const app = {
        extensionManager: {
            toast: { add: (message) => errors.push(message.detail) },
            dialog: { confirm: async () => true },
            setting: { get: () => "newline" },
        },
        registerExtension(extension) { this.extension = extension; },
    };
    const head = new Element("head");
    const document = {
        head,
        getElementById: (id) => head.children.find((child) => child.id === id),
        createElement: (tag) => new Element(tag),
        createElementNS: (_namespace, tag) => new Element(tag),
    };
    const source = readFileSync(new URL("../../web/simple_preset.js", import.meta.url), "utf8")
        .replace(/^import[\s\S]*?from "[^"]+";\r?\n/gm, "");
    vm.runInNewContext(source, {
        app, api, document, window, Element, Node: Element,
        BroadcastChannel: undefined,
        requestAnimationFrame: (callback) => callback(),
        ...profileState, ...separatorState,
    }, { filename: "web/simple_preset.js" });
    app.extension.setup();
    return {
        app, api, window, calls, errors,
        setFetch(handler) { fetch = handler; },
        push(payload) { api.fire("simple_preset.changed", { detail: payload }); },
        createNode(properties = {}, id = calls.length + 1) {
            const node = {
                id, properties,
                graph: { setDirtyCanvas() {} },
                addDOMWidget(_name, _type, root, options) {
                    const widget = { root, options, onRemove() { this.removed = true; } };
                    Object.defineProperty(widget, "value", { get: options.getValue, set: options.setValue });
                    this.onRemoved = () => widget.onRemove();
                    return widget;
                },
            };
            const { widget } = app.extension.getCustomWidgets().SIMPLE_PRESET_SELECTION(
                node, "selected_presets", ["SIMPLE_PRESET_SELECTION", { default: "[]" }],
            );
            return {
                node, widget, root: widget.root,
                button: (label) => widget.root.querySelectorAll("button")
                    .find((button) => button.title === label || button.getAttribute("aria-label") === label),
                rows: () => widget.root.querySelectorAll(".sp-row"),
                selection: () => JSON.parse(widget.value),
            };
        },
    };
}
