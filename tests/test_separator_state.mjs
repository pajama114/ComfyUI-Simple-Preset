import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_SEPARATOR,
    SEPARATOR_OPTIONS,
    createSeparatorTransportWidget,
    normalizeSeparator,
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

test("separator transport is sent to execution but omitted from workflow state", () => {
    let currentSeparator = "newline";
    const widgets = [];
    const node = { addCustomWidget: (widget) => widgets.push(widget) };
    const { widget } = createSeparatorTransportWidget(
        node,
        "separator",
        () => currentSeparator,
    );

    assert.equal(widgets[0], widget);
    assert.equal(widget.serialize, false);
    assert.notEqual(widget.options.serialize, false);
    assert.equal(widget.serializeValue(), "newline");

    currentSeparator = "comma_newline";
    assert.equal(widget.serializeValue(), "comma_newline");
});
