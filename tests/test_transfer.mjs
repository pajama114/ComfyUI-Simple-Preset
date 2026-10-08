import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { readBundle } from "../web/transfer_state.js";
import { deferred, flush, frontendHarness, response } from "./helpers/frontend_harness.js";

const defaultProfile = { id: "default", name: "Default" };
const preset = (id, prompt, name = id, profile_id = "default") => ({ id, name, prompt, profile_id });
const document = (presets, profiles = [defaultProfile]) => ({ version: 3, profiles, presets });
const payload = (presets = [], revision = 1, profiles = [defaultProfile]) => ({ ...document(presets, profiles), store_id: "server", revision });
const workflow = (presets, separator = "period", profiles = [defaultProfile]) => JSON.stringify({
    ids: presets.map((p) => p.id), separator, bundle: document(presets, profiles),
});
const preview = (overrides = {}) => ({ store_id: "server", revision: 1,
    added: [], unchanged: [], conflicts: [], profiles_added: [], ...overrides });
function chooseFile(node, contents) {
    const input = node.querySelector("input");
    input.files = [{ text: async () => contents }];
    input.fire("change");
}
function promptTexts(node) { return node.root.querySelectorAll(".sp-prompt").map((p) => p.textContent); }

test("a saved workflow loads selected contents into an empty installation without importing them", async () => {
    const source = frontendHarness(payload([preset("a", "A quiet room."), preset("b", "Sunlight enters"), preset("c", "private")]));
    const original = source.createNode();
    await flush();
    original.widget.value = '{"ids":["b","a"],"separator":"period"}';
    const saved = original.widget.serializeValue();
    const destination = frontendHarness(payload());
    const restored = destination.createNode();
    restored.widget.value = saved;
    assert.deepEqual(restored.selection(), ["b", "a"]);
    assert.deepEqual(promptTexts(restored), ["Sunlight enters", "A quiet room."]);
    await flush();
    assert.equal(restored.root.querySelector(".sp-missing"), null);
    assert.equal(restored.separator(), "period");
    assert.equal(restored.root.querySelectorAll(".sp-workflow-badge").length, 2);
    assert.ok(!saved.includes("private"));
    assert.ok(destination.calls.every((call) => !call.options.method));

    // Use the actual serialized frontend value as the installed Python node input.
    const recipient = mkdtempSync(join(tmpdir(), "simple-preset-recipient-"));
    try {
        const script = `
import importlib.util, json, sys, types
from pathlib import Path
folder_paths = types.ModuleType('folder_paths')
folder_paths.get_user_directory = lambda: sys.argv[2]
sys.modules['folder_paths'] = folder_paths
root = Path.cwd()
spec = importlib.util.spec_from_file_location('portable_node', root / '__init__.py', submodule_search_locations=[str(root)])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
node = module.NODE_CLASS_MAPPINGS['SimplePreset']()
assert module.WEB_DIRECTORY == './web'
print(json.dumps(node.build_prompt(sys.argv[1])))
assert not (Path(sys.argv[2]) / 'simple_preset' / 'presets.json').exists()
`;
        const result = spawnSync("python3", ["-c", script, saved, recipient], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), ["Sunlight enters. A quiet room."]);
    } finally {
        rmSync(recipient, { recursive: true, force: true });
    }
});

test("bundled contents remain visible and serializable when shared storage cannot be fetched", async () => {
    const harness = frontendHarness(payload());
    harness.setFetch(async () => response({ error: "Corrupt shared JSON" }, 400));
    const node = harness.createNode();
    node.widget.value = workflow([preset("a", "embedded")]);
    await flush();
    assert.deepEqual(promptTexts(node), ["embedded"]);
    assert.equal(node.root.querySelector(".sp-missing"), null);
    assert.equal(JSON.parse(node.widget.value).bundle.presets[0].prompt, "embedded");
});

test("workflow versions stay pinned until Use shared versions explicitly releases them", async () => {
    const harness = frontendHarness(payload([preset("a", "local")]));
    const node = harness.createNode();
    node.widget.value = workflow([preset("a", "embedded"), preset("orphan", "only in workflow")]);
    await flush();
    harness.push(payload([preset("a", "updated local")], 2));
    assert.deepEqual(promptTexts(node), ["embedded", "only in workflow"]);
    node.menuAction("Use shared versions");
    assert.deepEqual(promptTexts(node), ["updated local", "only in workflow"]);
    assert.equal(node.root.querySelectorAll(".sp-workflow-badge").length, 1);
    assert.deepEqual(node.selection(), ["a", "orphan"]);
    assert.deepEqual(JSON.parse(node.widget.serializeValue()).bundle.presets.map((p) => p.prompt), ["updated local", "only in workflow"]);
    assert.ok(harness.calls.every((call) => !call.options.method));
});

test("editing and removing workflow presets keeps the library and other workflow snapshots intact", async () => {
    const harness = frontendHarness(payload([preset("a", "shared")]));
    const first = harness.createNode();
    const second = harness.createNode();
    first.widget.value = second.widget.value = workflow([preset("a", "embedded")]);
    await flush();
    first.button("Edit preset").click();
    assert.equal(first.root.querySelector(".sp-form-title").textContent, "Edit workflow preset");
    const form = first.root.querySelector(".sp-form");
    form.querySelector(".sp-input").value = "Edited";
    form.querySelector("textarea").value = "edited snapshot";
    first.button("Save preset").click();
    await flush();
    assert.deepEqual(promptTexts(first), ["edited snapshot"]);
    assert.deepEqual(promptTexts(second), ["embedded"]);
    first.button("Remove from workflow").click();
    assert.deepEqual(first.selection(), []);
    assert.deepEqual(promptTexts(first), ["shared"]);
    assert.deepEqual(second.selection(), ["a"]);
    assert.ok(harness.calls.every((call) => !call.options.method));
});

test("Save workflow presets previews conflicts and imports with explicit choices without changing snapshots", async () => {
    const shared = preset("a", "existing");
    const bundled = preset("a", "imported");
    const harness = frontendHarness(payload([shared]));
    const node = harness.createNode();
    node.widget.value = workflow([bundled, preset("b", "new")]);
    await flush();
    const live = harness.createNode();
    await flush();
    const conflict = { id: "a", existing: shared, incoming: bundled };
    harness.setFetch(async (path, options) => {
        if (path.endsWith("/preview")) return response(preview({ added: [preset("b", "new")], conflicts: [conflict] }));
        const body = JSON.parse(options.body);
        assert.deepEqual(body.resolutions, { a: "overwrite" });
        assert.deepEqual(body.expected, { store_id: "server", revision: 1 });
        return response({ ...payload([bundled, preset("b", "new")], 2), import_result: { added: 1, updated: 1, skipped: 0 } });
    });
    node.menuAction("Save workflow presets to library");
    await flush();
    assert.equal(node.root.classList.contains("sp-transfer-open"), true);
    assert.match(node.root.querySelector(".sp-import-summary").textContent, /1 new.*1 conflicts/);
    assert.equal(harness.calls.filter((call) => call.path === "/simple-preset/import").length, 0);
    const choice = node.root.querySelector(".sp-conflict-choice");
    assert.equal(choice.value, "keep");
    choice.value = "overwrite";
    node.button("Import").click();
    await flush();
    assert.equal(node.root.classList.contains("sp-transfer-open"), false);
    assert.deepEqual(node.selection(), ["a", "b"]);
    assert.deepEqual(promptTexts(live), ["imported", "new"]);
    assert.deepEqual(live.selection(), []);
    assert.equal(node.root.querySelectorAll(".sp-workflow-badge").length, 2);
    assert.match(harness.notices.at(-1).detail, /1 added, 1 updated, 0 skipped/);
});

const button = (root, label) => root.querySelectorAll("button").find((item) => item.textContent === label);
async function openLibrary(harness) {
    button(harness.librarySetting(), "Manage presets…").click();
    await flush();
    return harness.libraryDialog();
}

test("library controls remain inside the settings content and Escape stays within the library", async () => {
    const harness = frontendHarness(payload());
    const setting = harness.librarySetting();
    button(setting, "Manage presets…").click();
    await flush();
    const manager = harness.libraryDialog();
    let settingsOpen = true;
    harness.window.addEventListener("pointerdown", (event) => {
        if (!setting.contains(event.target)) settingsOpen = false;
    });
    harness.window.fire("pointerdown", { target: manager.querySelector("select") });
    assert.equal(settingsOpen, true);
    assert.equal(manager.open, true);
    let stopped = false;
    let prevented = false;
    manager.fire("keydown", { key: "Escape", stopPropagation: () => { stopped = true; },
        preventDefault: () => { prevented = true; } });
    assert.equal(stopped, true);
    assert.equal(prevented, false, "the native dialog must still be able to close on Escape");
    button(manager, "Close").click();
    assert.equal(setting.isConnected, true);
    assert.equal(harness.libraryDialog(), null);
});

test("removing settings content disposes its library and ignores pending responses", async () => {
    const harness = frontendHarness(payload());
    const setting = harness.librarySetting();
    button(setting, "Manage presets…").click();
    await flush();
    const manager = harness.libraryDialog();
    const pending = deferred();
    harness.setFetch(() => pending.promise);
    chooseFile(manager, JSON.stringify(document([preset("a", "one")])));
    await flush();
    setting.remove();
    pending.resolve(response(preview({ added: [preset("a", "one")] })));
    await flush();
    assert.equal(manager.isConnected, false);
    assert.equal(manager.querySelector(".sp-transfer-form").classList.contains("sp-hidden"), true);
    const callCount = harness.calls.length;
    harness.window.fire("focus");
    await flush();
    assert.equal(harness.calls.length, callCount, "removed library must stop refreshing");
});

test("JSON import is available in settings without a node and can be cancelled", async () => {
    const harness = frontendHarness(payload());
    const manager = await openLibrary(harness);
    harness.setFetch(async () => response(preview({ added: [preset("a", "one")] })));
    chooseFile(manager, JSON.stringify(document([preset("a", "one")])));
    await flush();
    const form = manager.querySelector(".sp-transfer-form");
    assert.equal(form.classList.contains("sp-hidden"), false);
    button(manager, "Cancel").click();
    assert.equal(form.classList.contains("sp-hidden"), true);
    const callCount = harness.calls.length;
    chooseFile(manager, "{broken");
    await flush();
    assert.equal(harness.calls.length, callCount);
    assert.equal(harness.errors.length, 1);
    assert.equal(harness.calls.filter((call) => call.path === "/simple-preset/import").length, 0);
});

test("settings imports update the shared library while retaining node snapshots and profile choices", async () => {
    const photo = { id: "photo", name: "Photo" };
    const shared = preset("a", "existing");
    const imported = preset("a", "imported");
    const harness = frontendHarness(payload([shared], 1, [defaultProfile, photo]));
    const pinned = harness.createNode();
    pinned.widget.value = workflow([preset("a", "snapshot")]);
    const live = harness.createNode();
    await flush();
    live.widget.value = '["a"]';
    const manager = await openLibrary(harness);
    manager.querySelector("select").value = "photo";
    harness.setFetch(async (path, options) => {
        if (path.endsWith("/preview")) return response(preview({ conflicts: [{ id: "a", existing: shared, incoming: imported }] }));
        assert.deepEqual(JSON.parse(options.body).resolutions, { a: "overwrite" });
        return response({ ...payload([imported], 2, [defaultProfile, photo]),
            import_result: { added: 0, updated: 1, skipped: 0 } });
    });
    chooseFile(manager, JSON.stringify(document([imported])));
    await flush();
    assert.equal(button(manager, "Export all presets").disabled, false);
    manager.querySelector(".sp-conflict-choice").value = "overwrite";
    button(manager, "Import").click();
    button(manager, "Import").click();
    await flush();
    assert.equal(harness.calls.filter((call) => call.path === "/simple-preset/import").length, 1);
    assert.equal(manager.querySelector(".sp-transfer-form").classList.contains("sp-hidden"), true);
    assert.deepEqual(promptTexts(pinned), ["snapshot"]);
    assert.deepEqual(promptTexts(live), ["imported"]);
    assert.deepEqual(live.selection(), ["a"]);
    assert.equal(manager.querySelector("select").value, "photo");
});

test("closing settings ignores late reviews and unregisters the library observer", async () => {
    const harness = frontendHarness(payload());
    const manager = await openLibrary(harness);
    const pending = deferred();
    harness.setFetch(() => pending.promise);
    chooseFile(manager, JSON.stringify(document([preset("a", "one")])));
    await flush();
    button(manager, "Close").click();
    pending.resolve(response(preview({ added: [preset("a", "one")] })));
    await flush();
    assert.equal(harness.libraryDialog(), null);
    assert.equal(manager.querySelector(".sp-transfer-form").classList.contains("sp-hidden"), true);
    const callCount = harness.calls.length;
    const note = manager.querySelector(".sp-library-note").textContent;
    harness.window.fire("focus");
    harness.push(payload([preset("a", "one")], 2));
    await flush();
    assert.equal(harness.calls.length, callCount);
    assert.equal(manager.querySelector(".sp-library-note").textContent, note);
});

test("a committed settings import still refreshes other nodes if its dialog was closed", async () => {
    const harness = frontendHarness(payload());
    const node = harness.createNode();
    await flush();
    const manager = await openLibrary(harness);
    harness.setFetch(async () => response(preview({ added: [preset("a", "one")] })));
    chooseFile(manager, JSON.stringify(document([preset("a", "one")])));
    await flush();
    const pending = deferred();
    harness.setFetch(() => pending.promise);
    button(manager, "Import").click();
    button(manager, "Close").click();
    pending.resolve(response({ ...payload([preset("a", "one")], 2), import_result: { added: 1, updated: 0, skipped: 0 } }));
    await flush();
    assert.equal(harness.libraryDialog(), null);
    assert.deepEqual(promptTexts(node), ["one"]);
    assert.deepEqual(node.selection(), []);
    assert.equal(harness.notices.filter((notice) => notice.severity === "success").length, 0);
});

test("node menu integration preserves existing entries and reflects current selection and lifecycle", async () => {
    const harness = frontendHarness(payload([preset("a", "one")]));
    const node = harness.createNode({}, 1, {
        getExtraMenuOptions(_canvas, options) { options.push({ content: "Existing extension" }); return "existing return"; },
    });
    await flush();
    let options = [];
    assert.equal(node.node.getExtraMenuOptions(null, options), "existing return");
    assert.equal(options[0].content, "Existing extension");
    assert.ok(options.find((item) => item?.content === "Simple Preset").submenu.options.every((item) => item.disabled));
    node.widget.value = workflow([preset("a", "snapshot")]);
    assert.ok(node.menu().find((item) => item?.content === "Simple Preset").submenu.options.every((item) => !item.disabled));
    node.node.onRemoved();
    assert.equal(node.menu().find((item) => item?.content === "Simple Preset"), undefined);
    node.node.onAdded();
    await flush();
    assert.equal(node.menu().filter((item) => item?.content === "Simple Preset").length, 1);
    assert.equal(node.menu()[0].content, "Existing extension");
});

test("a changed library reopens the import review with fresh conflicts and resets choices to keep", async () => {
    const bundled = preset("a", "imported");
    const initialConflict = { id: "a", existing: preset("a", "old"), incoming: bundled };
    const freshConflict = { ...initialConflict, existing: preset("a", "edited meanwhile") };
    const harness = frontendHarness(payload([initialConflict.existing]));
    const node = harness.createNode();
    node.widget.value = workflow([bundled]);
    await flush();
    let commits = 0;
    harness.setFetch(async (path, options) => {
        if (path.endsWith("/preview")) return response(preview({ conflicts: [initialConflict] }));
        const body = JSON.parse(options.body);
        if (++commits === 1) return response({ error: "Shared presets changed", preview: preview({ revision: 2, conflicts: [freshConflict] }) }, 409);
        assert.deepEqual(body.expected, { store_id: "server", revision: 2 });
        assert.deepEqual(body.resolutions, { a: "keep" });
        return response({ ...payload([freshConflict.existing], 2), import_result: { added: 0, updated: 0, skipped: 1 } });
    });
    node.menuAction("Save workflow presets to library");
    await flush();
    node.root.querySelector(".sp-conflict-choice").value = "overwrite";
    node.button("Import").click();
    await flush();
    assert.equal(node.root.classList.contains("sp-transfer-open"), true);
    assert.equal(node.root.querySelector(".sp-conflict-choice").value, "keep");
    assert.match(node.root.querySelector(".sp-import-conflict").textContent, /edited meanwhile/);
    node.button("Import").click();
    await flush();
    assert.equal(node.root.classList.contains("sp-transfer-open"), false);
    assert.deepEqual(promptTexts(node), ["imported"]);
});

test("selected exports use node context menus and shared library exports use settings", async () => {
    const photo = { id: "photo", name: "Photo" };
    const harness = frontendHarness(payload([preset("a", "one"), preset("b", "two", "B", "photo")], 1, [defaultProfile, photo]));
    const node = harness.createNode();
    await flush();
    node.widget.value = workflow([preset("a", "snapshot")]);
    assert.equal(node.button("Import / export presets"), undefined);
    assert.equal(node.button("Import JSON…"), undefined);
    assert.equal(node.root.querySelector(".sp-transfer-control"), null);
    const menu = node.menu().find((item) => item?.content === "Simple Preset");
    assert.deepEqual(Array.from(menu.submenu.options, (item) => item.content), [
        "Export selected presets", "Save workflow presets to library", "Use shared versions",
    ]);
    node.menuAction("Export selected presets");
    assert.equal(harness.downloads[0].filename, "simple-preset-selected.json");
    assert.equal(harness.downloads[0].document.presets[0].prompt, "snapshot");
    assert.equal(harness.downloads[0].document.presets.length, 1);
    const manager = await openLibrary(harness);
    const profileSelect = manager.querySelector("select");
    profileSelect.value = "photo";
    harness.setFetch(async (path) => response(path.includes("?profile_id")
        ? document([preset("b", "two", "B", "photo")], [defaultProfile, photo])
        : document([preset("a", "one"), preset("b", "two", "B", "photo")], [defaultProfile, photo])));
    button(manager, "Export profile").click();
    await flush();
    assert.equal(harness.calls.at(-1).path, "/simple-preset/export?profile_id=photo");
    assert.equal(harness.downloads[1].document.presets[0].prompt, "two");
    button(manager, "Export all presets").click();
    await flush();
    assert.equal(harness.calls.at(-1).path, "/simple-preset/export");
    assert.equal(harness.downloads[2].document.presets.length, 2);
    node.widget.value = '["a","missing"]';
    node.menuAction("Export selected presets");
    assert.equal(harness.downloads.length, 3);
    assert.match(harness.errors.at(-1), /missing selections/);
});

test("removed nodes ignore pending import reviews and do not leave popup listeners registered", async () => {
    const harness = frontendHarness(payload());
    const node = harness.createNode();
    await flush();
    node.widget.value = workflow([preset("a", "one")]);
    const pending = deferred();
    harness.setFetch(() => pending.promise);
    node.menuAction("Save workflow presets to library");
    await flush();
    node.node.onRemoved();
    pending.resolve(response(preview({ added: [preset("a", "one")] })));
    await flush();
    assert.equal(node.root.classList.contains("sp-transfer-open"), false);
    assert.equal(harness.calls.filter((call) => call.path === "/simple-preset/import").length, 0);
});

test("invalid bundle restoration fails before changing existing widget state", async () => {
    const harness = frontendHarness(payload([preset("a", "one")]));
    const node = harness.createNode();
    await flush();
    node.widget.value = workflow([preset("a", "snapshot")]);
    const saved = node.widget.value;
    for (const bundle of [null, {}, document([preset("a", 42)]), document([preset("a", "one"), preset("a", "two")])]) {
        assert.throws(() => { node.widget.value = JSON.stringify({ ids: ["other"], bundle }); }, /invalid/);
        assert.equal(node.widget.value, saved);
    }
    assert.equal(readBundle('["a"]'), null);
});

test("shared preset editing cannot select a profile that exists only in a workflow snapshot", async () => {
    const foreignProfile = { id: "foreign", name: "Foreign" };
    const harness = frontendHarness(payload([preset("local", "local")]));
    const node = harness.createNode();
    node.widget.value = workflow([preset("bundled", "bundled", "Bundled", "foreign")], "comma", [defaultProfile, foreignProfile]);
    await flush();
    node.button("Edit preset").click();
    const form = node.root.querySelector(".sp-form");
    assert.deepEqual(form.querySelectorAll(".sp-profile-option").map((p) => p.textContent.replace(/^✓/, "")), ["Default"]);
    node.button("Cancel editing").click();
    node.root.querySelector(".sp-profile-menu").querySelectorAll(".sp-profile-option").at(-1).click();
    node.button("Edit preset").click();
    assert.deepEqual(form.querySelectorAll(".sp-profile-option").map((p) => p.textContent.replace(/^✓/, "")), ["Default", "Foreign"]);
});
