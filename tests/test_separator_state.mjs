import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_SEPARATOR,
    SEPARATOR_OPTIONS,
    executionSelectionValue,
    normalizeSeparator,
    removeLegacyInternalInputs,
} from "../web/separator_state.js";

test("separator values are normalized to the comma default", () => {
    assert.equal(normalizeSeparator("newline"), "newline");
    assert.equal(normalizeSeparator("comma_newline"), "comma_newline");
    assert.equal(normalizeSeparator("unknown"), DEFAULT_SEPARATOR);
    assert.deepEqual(
        SEPARATOR_OPTIONS.map((option) => option.value),
        ["comma", "newline", "comma_newline"],
    );
});

test("execution selection includes the current separator", () => {
    assert.deepEqual(
        JSON.parse(executionSelectionValue(["first", "second"], "newline")),
        { ids: ["first", "second"], separator: "newline" },
    );
});

test("legacy internal sockets are removed from loaded nodes", () => {
    const node = {
        inputs: [
            { name: "model" },
            { name: "selected_presets" },
            { name: "separator" },
        ],
        removeInput(index) {
            this.inputs.splice(index, 1);
        },
    };

    assert.equal(removeLegacyInternalInputs(node), 2);
    assert.deepEqual(node.inputs, [{ name: "model" }]);
    assert.equal(removeLegacyInternalInputs(node), 0);
});
