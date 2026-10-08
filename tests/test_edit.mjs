import assert from "node:assert/strict";
import test from "node:test";
import { deferred, flush, frontendHarness, response } from "./helpers/frontend_harness.js";

const profiles = [{ id: "default", name: "Default" }, { id: "photo", name: "Photo" }];
const original = { id: "a", name: "Before", prompt: "old", profile_id: "default" };
const payload = (preset = original, revision = 1) => ({ profiles, presets: [preset], store_id: "server", revision });
const openEditor = (node) => { node.button("Edit preset").click(); return node.root.querySelector(".sp-form"); };
const writes = (harness) => harness.calls.filter((call) => call.options.method === "PUT");
const conflict = (current, fields, revision = 2) => response({
    error: "Changed elsewhere", current, fields, snapshot: payload(current, revision),
}, 409);

test("two open editors save only changed fields and retain independent selections", async () => {
    const harness = frontendHarness(payload());
    const first = harness.createNode();
    const second = harness.createNode();
    await flush();
    first.widget.value = '["a"]';
    const firstForm = openEditor(first);
    const secondForm = openEditor(second);
    firstForm.querySelector("textarea").value = "from A";
    secondForm.querySelector(".sp-input").value = "from B";
    const withPrompt = { ...original, prompt: "from A" };
    harness.setFetch(async (_path, options) => {
        assert.deepEqual(JSON.parse(options.body), { changes: { prompt: "from A" }, expected: { prompt: "old" } });
        return response(payload(withPrompt, 2));
    });
    first.button("Save preset").click();
    await flush();
    assert.equal(secondForm.querySelector("textarea").value, "old");
    assert.equal(secondForm.querySelector(".sp-input").value, "from B");
    harness.setFetch(async (_path, options) => {
        assert.deepEqual(JSON.parse(options.body), { changes: { name: "from B" }, expected: { name: "Before" } });
        return response(payload({ ...withPrompt, name: "from B" }, 3));
    });
    second.button("Save preset").click();
    await flush();
    assert.equal(JSON.parse(first.widget.value).bundle.presets[0].prompt, "from A");
    assert.equal(JSON.parse(first.widget.value).bundle.presets[0].name, "from B");
    assert.deepEqual(first.selection(), ["a"]);
    assert.deepEqual(second.selection(), []);
    assert.equal(writes(harness).length, 2);
    assert.deepEqual(harness.errors, []);
});

test("conflicting fields need individual choices and a later save rechecks reviewed values", async () => {
    const harness = frontendHarness(payload());
    const node = harness.createNode();
    await flush();
    const form = openEditor(node);
    form.querySelector(".sp-input").value = "my name";
    form.querySelector("textarea").value = "my prompt";
    const latest = { ...original, name: "latest name", prompt: "latest prompt" };
    harness.setFetch(async () => conflict(latest, ["name", "prompt"]));
    node.button("Save preset").click();
    await flush();
    assert.equal(form.querySelector(".sp-input").value, "my name");
    assert.equal(form.querySelector("textarea").value, "my prompt");
    assert.equal(node.button("Save preset").disabled, true);
    assert.equal(node.root.querySelector(".sp-name").textContent, "latest name");
    const comparison = form.querySelectorAll(".sp-edit-conflict");
    assert.match(comparison[0].textContent, /latest name/);
    assert.match(comparison[1].textContent, /latest prompt/);
    node.button("Use latest: Name").click();
    assert.equal(form.querySelector(".sp-input").value, "latest name");
    assert.equal(node.button("Save preset").disabled, true);
    form.querySelector("textarea").fire("keydown", { key: "Enter", ctrlKey: true });
    assert.equal(writes(harness).length, 1);
    node.button("Keep my changes: Prompt").click();
    assert.equal(form.querySelector("textarea").value, "my prompt");
    assert.equal(node.button("Save preset").disabled, false);
    assert.equal(writes(harness).length, 1); // Reviewing never writes automatically.
    const newer = { ...latest, prompt: "another edit during review" };
    harness.setFetch(async (_path, options) => {
        assert.deepEqual(JSON.parse(options.body), {
            changes: { prompt: "my prompt" }, expected: { prompt: "latest prompt" },
        });
        return conflict(newer, ["prompt"], 3);
    });
    node.button("Save preset").click();
    await flush();
    assert.match(form.querySelector(".sp-edit-conflict").textContent, /another edit during review/);
    assert.equal(form.querySelector("textarea").value, "my prompt");
    node.button("Keep my changes: Prompt").click();
    harness.setFetch(async (_path, options) => {
        assert.deepEqual(JSON.parse(options.body), {
            changes: { prompt: "my prompt" }, expected: { prompt: "another edit during review" },
        });
        return response(payload({ ...newer, prompt: "my prompt" }, 4));
    });
    node.button("Save preset").click();
    await flush();
    assert.equal(form.classList.contains("sp-hidden"), true);
    assert.equal(writes(harness).length, 3);
    assert.deepEqual(harness.errors, []);
});

test("using a latest conflicting value leaves other draft fields to be saved", async () => {
    const harness = frontendHarness(payload());
    const node = harness.createNode();
    await flush();
    const form = openEditor(node);
    form.querySelector(".sp-input").value = "my name";
    form.querySelector("textarea").value = "my prompt";
    const latest = { ...original, prompt: "from A" };
    harness.setFetch(async () => conflict(latest, ["prompt"]));
    node.button("Save preset").click();
    await flush();
    node.button("Use latest: Prompt").click();
    harness.setFetch(async (_path, options) => {
        assert.deepEqual(JSON.parse(options.body), { changes: { name: "my name" }, expected: { name: "Before" } });
        return response(payload({ ...latest, name: "my name" }, 3));
    });
    node.button("Save preset").click();
    await flush();
    assert.equal(node.root.querySelector(".sp-name").textContent, "my name");
});

test("profile-only edits send only the changed profile and its original value", async () => {
    const harness = frontendHarness(payload());
    const node = harness.createNode();
    await flush();
    const form = openEditor(node);
    node.button("Preset profile").click();
    form.querySelectorAll(".sp-profile-option").find((button) => button.textContent.includes("Photo")).click();
    harness.setFetch(async (_path, options) => {
        assert.deepEqual(JSON.parse(options.body), {
            changes: { profile_id: "photo" }, expected: { profile_id: "default" },
        });
        return response(payload({ ...original, profile_id: "photo" }, 2));
    });
    node.button("Save preset").click();
    await flush();
    assert.equal(writes(harness).length, 1);
    assert.deepEqual(harness.errors, []);
});

test("saving an untouched stale editor does not overwrite newer shared values", async () => {
    const harness = frontendHarness(payload());
    const node = harness.createNode();
    await flush();
    const form = openEditor(node);
    harness.push(payload({ ...original, name: "Renamed", prompt: "new" }, 2));
    node.button("Save preset").click();
    await flush();
    assert.equal(writes(harness).length, 0);
    assert.equal(form.classList.contains("sp-hidden"), true);
    assert.equal(node.root.querySelector(".sp-name").textContent, "Renamed");
});

test("a cancelled editor ignores its late conflict without disturbing a new form", async () => {
    const harness = frontendHarness(payload());
    const node = harness.createNode();
    await flush();
    const form = openEditor(node);
    form.querySelector("textarea").value = "draft";
    const pending = deferred();
    harness.setFetch(() => pending.promise);
    node.button("Save preset").click();
    node.button("Cancel editing").click();
    pending.resolve(conflict({ ...original, prompt: "latest" }, ["prompt"]));
    await flush();
    node.button("Add preset to current profile").click();
    assert.equal(form.classList.contains("sp-hidden"), false);
    assert.equal(form.querySelector("textarea").value, "");
    assert.equal(form.querySelector(".sp-edit-review").classList.contains("sp-hidden"), true);
    assert.deepEqual(harness.errors, []);
});
