export const DEFAULT_SEPARATOR = "comma";
export const SEPARATOR_SETTING_ID = "SimplePreset.OutputSeparator";

export const SEPARATOR_OPTIONS = [
    { text: "コンマ", value: "comma" },
    { text: "改行", value: "newline" },
    { text: "コンマ＋改行", value: "comma_newline" },
];

const separatorValues = new Set(SEPARATOR_OPTIONS.map((option) => option.value));

export function normalizeSeparator(value) {
    return separatorValues.has(value) ? value : DEFAULT_SEPARATOR;
}

export function executionSelectionValue(selectedIds, separator) {
    return JSON.stringify({
        ids: selectedIds,
        separator: normalizeSeparator(separator),
    });
}

export function removeLegacyInternalInputs(node) {
    if (!Array.isArray(node?.inputs) || typeof node.removeInput !== "function") return 0;
    const internalNames = new Set(["selected_presets", "separator"]);
    let removed = 0;
    for (let index = node.inputs.length - 1; index >= 0; index -= 1) {
        if (!internalNames.has(node.inputs[index]?.name)) continue;
        node.removeInput(index);
        removed += 1;
    }
    return removed;
}
