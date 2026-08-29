import assert from "node:assert/strict";
import test from "node:test";

import {
    ALL_PROFILES,
    DEFAULT_PROFILE_ID,
    PROFILE_PROPERTY,
    resolveProfileId,
    samePresetData,
    storedProfileId,
    storeProfileId,
} from "../web/profile_state.js";

test("the last displayed profile round-trips through workflow node properties", () => {
    const originalNode = { properties: {} };
    storeProfileId(originalNode, "illustration");

    const workflowNode = JSON.parse(JSON.stringify(originalNode));
    assert.equal(workflowNode.properties[PROFILE_PROPERTY], "illustration");
    assert.equal(storedProfileId(workflowNode), "illustration");
});

test("profile state can be restored after the widget was constructed", () => {
    const node = { properties: {} };
    assert.equal(storedProfileId(node), DEFAULT_PROFILE_ID);

    // LiteGraph restores node properties before assigning the saved widget value.
    node.properties[PROFILE_PROPERTY] = "photo";
    assert.equal(storedProfileId(node), "photo");
});

test("different workflow nodes retain independent displayed profiles", () => {
    const first = { properties: {} };
    const second = { properties: {} };
    storeProfileId(first, "photo");
    storeProfileId(second, ALL_PROFILES);

    assert.equal(storedProfileId(first), "photo");
    assert.equal(storedProfileId(second), ALL_PROFILES);
});

test("missing profiles fall back to Default without affecting valid profiles", () => {
    const profiles = [
        { id: DEFAULT_PROFILE_ID, name: "Default" },
        { id: "photo", name: "Photo" },
    ];
    assert.equal(resolveProfileId("photo", profiles), "photo");
    assert.equal(resolveProfileId("deleted", profiles), DEFAULT_PROFILE_ID);
    assert.equal(resolveProfileId(ALL_PROFILES, profiles), ALL_PROFILES);
});

test("unchanged shared preset data can skip a focus-time redraw", () => {
    const profiles = [{ id: DEFAULT_PROFILE_ID, name: "Default" }];
    const presets = [{ id: "first", name: "First", prompt: "one" }];
    const reloadedProfiles = JSON.parse(JSON.stringify(profiles));
    const reloadedPresets = JSON.parse(JSON.stringify(presets));

    assert.equal(
        samePresetData(profiles, presets, reloadedProfiles, reloadedPresets),
        true,
    );

    reloadedPresets[0].prompt = "updated";
    assert.equal(
        samePresetData(profiles, presets, reloadedProfiles, reloadedPresets),
        false,
    );
});
