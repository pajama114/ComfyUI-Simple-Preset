import assert from "node:assert/strict";
import test from "node:test";
import { deferred, flush, frontendHarness, response } from "./helpers/frontend_harness.js";

const profiles = [{ id: "default", name: "Default" }, { id: "photo", name: "Photo" }];
const preset = (id, name, profile_id = "default") => ({ id, name, prompt: `prompt-${id}`, profile_id });
const payload = (presets, revision = 1) => ({ profiles, presets, store_id: "server", revision });

test("profile labels target their own control before ComfyUI assigns node ids", async () => {
    const harness = frontendHarness(payload([]));
    const first = harness.createNode({}, -1);
    const second = harness.createNode({}, -1);
    await flush();
    const firstButton = first.root.querySelector(".sp-profile-button");
    const secondButton = second.root.querySelector(".sp-profile-button");
    assert.notEqual(firstButton.id, secondButton.id);
    assert.equal(first.root.querySelector(".sp-profile-label").htmlFor, firstButton.id);
    assert.equal(second.root.querySelector(".sp-profile-label").htmlFor, secondButton.id);
});

test("workflow selections and separators round-trip independently without storing shared content", async () => {
    const harness = frontendHarness(payload([preset("a", "A"), preset("b", "B")]));
    const first = harness.createNode();
    const second = harness.createNode();
    first.widget.value = '{"ids":["b","a"],"separator":"period"}';
    second.widget.value = '{"ids":["a"],"separator":"comma"}';
    await flush();
    assert.deepEqual(first.selection(), ["b", "a"]);
    assert.deepEqual(second.selection(), ["a"]);
    assert.deepEqual(JSON.parse(first.widget.value), { ids: ["b", "a"], separator: "period" });
    assert.equal(first.widget.serializeValue(), first.widget.value);
    const restored = harness.createNode();
    restored.widget.value = first.widget.value;
    await flush();
    assert.deepEqual(restored.selection(), ["b", "a"]);
    assert.equal(restored.separator(), "period");
    harness.push(payload([preset("a", "Renamed"), preset("b", "B")], 2));
    assert.equal(first.root.querySelector(".sp-preset-chip").textContent, "B");
    assert.equal(second.root.querySelector(".sp-preset-chip").textContent, "Renamed");
    assert.equal(first.separator(), "period");
    assert.equal(second.separator(), "comma");
});

test("selection accepts execution-format values when a workflow is restored", async () => {
    const harness = frontendHarness(payload([preset("a", "A")]));
    const node = harness.createNode();
    node.widget.value = '{"ids":["a"],"separator":"newline"}';
    await flush();
    assert.deepEqual(node.selection(), ["a"]);
    assert.equal(node.separator(), "newline");
});

test("the separator button sits before reload and cycles locally without changing selections", async () => {
    const harness = frontendHarness(payload([preset("a", "A")]));
    harness.app.extensionManager.setting.get = () => "comma";
    const first = harness.createNode();
    const second = harness.createNode();
    await flush();
    first.widget.value = '["a"]';
    const button = first.root.querySelector(".sp-separator-button");
    const header = first.root.querySelector(".sp-header");
    const reload = first.button("Reload shared presets");
    assert.equal(header.children.indexOf(button) + 1, header.children.indexOf(reload));
    const requestCount = harness.calls.length;
    for (const [value, symbol, name] of [
        ["comma", ",", "Comma"],
        ["newline", "↩", "Newline"],
        ["period", ".", "Period"],
        ["comma_newline", ",↩", "Comma + newline"],
    ]) {
        assert.equal(button.textContent, symbol);
        assert.equal(first.separator(), value);
        assert.ok(button.title.includes(`Separator: ${name}`));
        assert.match(button.getAttribute("aria-label"), /Click to cycle/);
        assert.deepEqual(JSON.parse(first.widget.serializeValue()), { ids: ["a"], separator: value });
        button.click();
    }
    assert.equal(first.separator(), "comma");
    assert.equal(second.separator(), "comma");
    assert.deepEqual(first.selection(), ["a"]);
    assert.equal(harness.calls.length, requestCount);
});

test("global separator changes affect only newly created nodes", async () => {
    const harness = frontendHarness(payload([preset("a", "A")]));
    harness.app.extensionManager.setting.get = () => "comma";
    const existing = harness.createNode();
    existing.widget.value = '["a"]';
    const saved = existing.widget.value;
    harness.app.extensionManager.setting.get = () => "period";
    const fresh = harness.createNode();
    const restored = harness.createNode();
    restored.widget.value = saved;
    await flush();
    assert.equal(existing.separator(), "comma");
    assert.equal(fresh.separator(), "period");
    assert.equal(restored.separator(), "comma");
    assert.equal(existing.widget.serializeValue(), saved);
    fresh.root.querySelector(".sp-separator-button").click();
    assert.equal(fresh.separator(), "comma_newline");
    assert.equal(existing.separator(), "comma");
    harness.push(payload([preset("a", "Updated")], 2));
    assert.equal(fresh.separator(), "comma_newline");
    assert.equal(restored.separator(), "comma");
});

test("restoring a workflow after presets were loaded retains missing ids and their positions", async () => {
    const harness = frontendHarness(payload([preset("a", "A")]));
    const node = harness.createNode();
    await flush();
    node.widget.value = '["deleted","a"]';
    assert.deepEqual(node.selection(), ["deleted", "a"]);
    assert.deepEqual(
        node.root.querySelectorAll(".sp-preset-chip").map((chip) => chip.dataset.presetId),
        ["deleted", "a"],
    );
    assert.equal(node.root.querySelector(".sp-missing-notice").classList.contains("sp-hidden"), false);
    assert.match(node.root.querySelector(".sp-missing-notice").textContent, /Execution blocked/);
    assert.match(node.root.querySelector(".sp-missing").title, /deleted/);
    assert.equal(node.root.querySelector(".sp-selection-notice").classList.contains("sp-hidden"), true);
    assert.deepEqual(JSON.parse(node.widget.serializeValue()).ids, ["deleted", "a"]);
});

test("missing selections are only marked after the initial shared snapshot arrives", async () => {
    const harness = frontendHarness(payload([]));
    const pending = deferred();
    harness.setFetch(() => pending.promise);
    const node = harness.createNode();
    node.widget.value = '["a","missing"]';
    assert.equal(node.root.querySelector(".sp-missing"), null);
    assert.equal(node.root.querySelector(".sp-missing-notice").classList.contains("sp-hidden"), true);
    pending.resolve(response(payload([preset("a", "A")])));
    await flush();
    assert.deepEqual(node.selection(), ["a", "missing"]);
    assert.equal(node.root.querySelectorAll(".sp-missing").length, 1);
});

test("deleting and restoring shared presets recovers independent workflow selections in place", async () => {
    const initial = [preset("a", "A"), preset("b", "B"), preset("c", "C", "photo")];
    const harness = frontendHarness(payload(initial));
    const first = harness.createNode();
    const second = harness.createNode({ simple_preset_profile_id: "photo" });
    await flush();
    first.widget.value = '["a","b","c"]';
    second.widget.value = '["b","a"]';
    harness.push(payload([initial[0], initial[2]], 2));
    assert.deepEqual(first.selection(), ["a", "b", "c"]);
    assert.deepEqual(second.selection(), ["b", "a"]);
    assert.equal(first.root.querySelector(".sp-selection-notice").textContent, "Selected in other profiles: 1");
    harness.setFetch(async () => response(payload([initial[0], initial[2]], 2)));
    const restored = harness.createNode();
    restored.widget.value = first.widget.value;
    await flush();
    assert.deepEqual(restored.selection(), ["a", "b", "c"]);
    assert.equal(restored.root.querySelector(".sp-missing").dataset.presetId, "b");
    harness.push(payload(initial, 3));
    for (const node of [first, second, restored]) {
        assert.equal(node.root.querySelector(".sp-missing"), null);
        assert.equal(node.root.querySelector(".sp-missing-notice").classList.contains("sp-hidden"), true);
    }
    assert.deepEqual(first.selection(), ["a", "b", "c"]);
    assert.deepEqual(second.selection(), ["b", "a"]);
    assert.deepEqual(
        first.root.querySelectorAll(".sp-preset-chip").map((chip) => chip.textContent),
        ["A", "B", "C"],
    );
});

test("a missing chip can be removed explicitly without changing other workflow selections", async () => {
    const harness = frontendHarness(payload([preset("a", "A")]));
    const first = harness.createNode();
    const second = harness.createNode();
    await flush();
    first.widget.value = '["a","missing","another-missing"]';
    second.widget.value = first.widget.value;
    assert.match(first.root.querySelector(".sp-missing-notice").textContent, /2 selected presets are missing/);
    first.root.querySelector(".sp-missing").click();
    assert.deepEqual(first.selection(), ["a", "another-missing"]);
    assert.deepEqual(second.selection(), ["a", "missing", "another-missing"]);
    first.root.querySelector(".sp-missing").click();
    assert.deepEqual(first.selection(), ["a"]);
    assert.equal(first.root.querySelector(".sp-missing-notice").classList.contains("sp-hidden"), true);
    assert.equal(harness.calls.filter((call) => call.options.method === "DELETE").length, 0);
});

test("missing selections survive profile clearing and can be cleared with all profiles displayed", async () => {
    const harness = frontendHarness(payload([preset("a", "A"), preset("b", "B", "photo")]));
    const node = harness.createNode();
    await flush();
    node.widget.value = '["a","missing","b"]';
    node.button("Clear selection in current profile").click();
    assert.deepEqual(node.selection(), ["missing", "b"]);
    node.root.querySelector(".sp-profile-option").click();
    node.button("Clear selection in current profile").click();
    assert.deepEqual(node.selection(), []);
    assert.equal(node.root.querySelector(".sp-missing-notice").classList.contains("sp-hidden"), true);
    node.widget.value = '["missing"]';
    assert.equal(node.button("Clear selection in current profile").disabled, false);
    node.button("Clear selection in current profile").click();
    assert.deepEqual(node.selection(), []);
});

test("missing chips participate in drag and keyboard ordering without losing ids", async () => {
    const harness = frontendHarness(payload([preset("a", "A"), preset("b", "B")]));
    const node = harness.createNode();
    await flush();
    node.widget.value = '["a","missing","b"]';
    const summary = node.root.querySelector(".sp-summary");
    const dataTransfer = { setData() {} };
    const missing = node.root.querySelector(".sp-missing");
    missing.fire("dragstart", { dataTransfer });
    summary.fire("dragover", { dataTransfer, clientX: 400, clientY: 400 });
    summary.fire("drop", { dataTransfer });
    assert.deepEqual(node.selection(), ["a", "b", "missing"]);
    node.root.querySelector(".sp-missing").fire("keydown", { key: "ArrowLeft", altKey: true });
    assert.deepEqual(node.selection(), ["a", "missing", "b"]);
    harness.push(payload([preset("a", "A"), preset("missing", "Restored"), preset("b", "B")], 2));
    assert.deepEqual(
        node.root.querySelectorAll(".sp-preset-chip").map((chip) => chip.textContent),
        ["A", "Restored", "B"],
    );
});

test("removed nodes stop receiving refreshes and retain the widget cleanup hook", async () => {
    const harness = frontendHarness(payload([preset("a", "A")]));
    const node = harness.createNode();
    await flush();
    node.node.onRemoved();
    harness.calls.length = 0;
    harness.window.fire("focus");
    await flush();
    assert.equal(harness.calls.length, 0);
    assert.equal(node.widget.removed, true);
});

test("a late initial refresh cannot modify a removed workflow node", async () => {
    const harness = frontendHarness(payload([]));
    const pending = deferred();
    harness.setFetch(() => pending.promise);
    const node = harness.createNode();
    node.widget.value = '["a"]';
    node.node.onRemoved();
    pending.resolve(response(payload([])));
    await flush();
    assert.deepEqual(node.selection(), ["a"]);
});

test("repeated save shortcuts send one create request", async () => {
    const harness = frontendHarness(payload([]));
    const node = harness.createNode();
    await flush();
    node.button("Add preset to current profile").click();
    node.root.querySelectorAll(".sp-input")[1].value = "New preset";
    const pending = deferred();
    harness.setFetch(() => pending.promise);
    const textarea = node.root.querySelector("textarea");
    textarea.fire("keydown", { key: "Enter", ctrlKey: true });
    textarea.fire("keydown", { key: "Enter", ctrlKey: true });
    assert.equal(harness.calls.filter((call) => call.options.method === "POST").length, 1);
    pending.resolve(response(payload([preset("new", "New preset")], 2)));
    await flush();
});

test("repeated profile save shortcuts send one create request", async () => {
    const harness = frontendHarness(payload([]));
    const node = harness.createNode();
    await flush();
    node.button("Add profile").click();
    const input = node.root.querySelectorAll(".sp-input")[0];
    input.value = "New profile";
    const pending = deferred();
    harness.setFetch(() => pending.promise);
    input.fire("keydown", { key: "Enter" });
    input.fire("keydown", { key: "Enter" });
    assert.equal(harness.calls.filter((call) => call.options.method === "POST").length, 1);
    pending.resolve(response(payload([], 2)));
    await flush();
});

test("an older mutation response cannot roll back a newer websocket snapshot", async () => {
    const harness = frontendHarness(payload([preset("a", "A")]));
    const node = harness.createNode();
    await flush();
    node.rows()[0].querySelectorAll("button")[1].click();
    const pending = deferred();
    harness.setFetch(() => pending.promise);
    await flush();
    harness.push(payload([preset("b", "Newer")], 3));
    node.widget.value = '["b"]';
    pending.resolve(response(payload([], 2)));
    await flush();
    assert.equal(node.rows().length, 1);
    assert.equal(node.root.querySelector(".sp-name").textContent, "Newer");
    assert.deepEqual(node.selection(), ["b"]);
});

test("undoing removal while an old refresh is pending starts a fresh request", async () => {
    const harness = frontendHarness(payload([]));
    const oldRequest = deferred();
    harness.setFetch(() => oldRequest.promise);
    const node = harness.createNode();
    node.widget.value = '["a"]';
    node.node.onRemoved();
    harness.setFetch(async () => response(payload([preset("a", "Restored")], 2)));
    node.node.onAdded();
    await flush();
    oldRequest.resolve(response(payload([])));
    await flush();
    assert.deepEqual(node.selection(), ["a"]);
    assert.equal(node.root.querySelector(".sp-name").textContent, "Restored");
});

test("scrolling applied chips moves their summary instead of the preset list", async () => {
    const harness = frontendHarness(payload([preset("a", "A")]));
    const node = harness.createNode();
    await flush();
    node.node.selected = true;
    const summary = node.root.querySelector(".sp-summary");
    const list = node.root.querySelector(".sp-list");
    for (const scroller of [summary, list]) {
        scroller.scrollHeight = 400;
        scroller.clientHeight = 100;
        scroller.scrollTop = 0;
    }
    harness.window.fire("wheel", {
        target: summary, clientX: 50, clientY: 450, deltaY: 30, deltaMode: 0,
    });
    assert.equal(summary.scrollTop, 30);
    assert.equal(list.scrollTop, 0);
});

test("cancelled chip drags restore the applied order and successful drops clear the drag marker", async () => {
    const harness = frontendHarness(payload([preset("a", "A"), preset("b", "B")]));
    const node = harness.createNode();
    await flush();
    node.widget.value = '["a","b"]';
    const summary = node.root.querySelector(".sp-summary");
    const dataTransfer = { setData() {} };
    let chip = node.root.querySelector(".sp-preset-chip");
    chip.fire("dragstart", { dataTransfer });
    summary.fire("dragover", { dataTransfer, clientX: 400, clientY: 400 });
    chip.fire("dragend", { dataTransfer });
    assert.deepEqual(node.selection(), ["a", "b"]);
    assert.equal(summary.classList.contains("sp-drag-active"), false);
    chip = node.root.querySelector(".sp-preset-chip");
    chip.fire("dragstart", { dataTransfer });
    summary.fire("dragover", { dataTransfer, clientX: 400, clientY: 400 });
    summary.fire("drop", { dataTransfer });
    assert.deepEqual(node.selection(), ["b", "a"]);
    assert.equal(summary.classList.contains("sp-drag-active"), false);
});

test("sorting a profile preserves the order and positions of other profiles", async () => {
    const initial = [preset("z", "Z"), preset("outside-z", "Z", "photo"),
        preset("a", "A"), preset("outside-a", "A", "photo")];
    const harness = frontendHarness(payload(initial));
    const node = harness.createNode();
    await flush();
    node.widget.value = '["z","a"]';
    harness.setFetch(async (_path, options) => {
        const ids = JSON.parse(options.body).ids;
        return response(payload(ids.map((id) => initial.find((item) => item.id === id)), 2));
    });
    node.root.querySelectorAll(".sp-sort-option")[0].click();
    await flush();
    const order = harness.calls.find((call) => call.path === "/simple-preset/order");
    assert.deepEqual(JSON.parse(order.options.body).ids, ["a", "outside-z", "z", "outside-a"]);
    assert.deepEqual(node.selection(), ["z", "a"]);
});
