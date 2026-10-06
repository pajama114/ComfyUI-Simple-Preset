import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_SEPARATOR,
    SEPARATOR_OPTIONS,
    SEPARATOR_SYMBOLS,
    nextSeparator,
    normalizeSeparator,
    removeLegacyInternalInputs,
    selectionSeparator,
    selectionValue,
} from "../web/separator_state.js";

test("separator values are normalized to the comma default", () => {
    assert.equal(normalizeSeparator("newline"), "newline");
    assert.equal(normalizeSeparator("period"), "period");
    assert.equal(normalizeSeparator("comma_newline"), "comma_newline");
    assert.equal(normalizeSeparator("unknown"), DEFAULT_SEPARATOR);
    assert.deepEqual(
        SEPARATOR_OPTIONS.map((option) => option.value),
        ["comma", "newline", "period", "comma_newline"],
    );
});

test("workflow and execution selection include the saved separator", () => {
    assert.deepEqual(
        JSON.parse(selectionValue(["first", "second"], "newline")),
        { ids: ["first", "second"], separator: "newline" },
    );
});

test("the separator cycle wraps through four symbols without displaying spaces", () => {
    let separator = "comma";
    const symbols = [];
    for (let index = 0; index < 8; index++) {
        symbols.push(SEPARATOR_SYMBOLS[separator]);
        separator = nextSeparator(separator);
    }
    assert.deepEqual(symbols, [",", "↩", ".", ",↩", ",", "↩", ".", ",↩"]);
    assert.equal(separator, "comma");
});

test("saved separators restore independently of the fallback default", () => {
    assert.equal(selectionSeparator('{"ids":["a"],"separator":"period"}', "newline"), "period");
    assert.equal(selectionSeparator({ ids: [], separator: "comma_newline" }, "period"), "comma_newline");
    assert.equal(selectionSeparator('["a"]', "period"), "period");
    assert.equal(selectionSeparator("not-json", "newline"), "newline");
    assert.equal(selectionSeparator(null), DEFAULT_SEPARATOR);
    assert.equal(selectionSeparator({ separator: "invalid" }), DEFAULT_SEPARATOR);
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
