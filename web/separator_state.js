export const DEFAULT_SEPARATOR = "comma";
export const SEPARATOR_SETTING_ID = "SimplePreset.OutputSeparator";

export const SEPARATOR_OPTIONS = [
    { text: "Comma", value: "comma" },
    { text: "Newline", value: "newline" },
    { text: "Period", value: "period" },
    { text: "Comma + newline", value: "comma_newline" },
];

export const SEPARATOR_SYMBOLS = {
    comma: ",",
    newline: "↩",
    period: ".",
    comma_newline: ",↩",
};

const separatorValues = new Set(SEPARATOR_OPTIONS.map((option) => option.value));

export function normalizeSeparator(value) {
    return separatorValues.has(value) ? value : DEFAULT_SEPARATOR;
}

export function nextSeparator(value) {
    const values = [...separatorValues];
    return values[(values.indexOf(normalizeSeparator(value)) + 1) % values.length];
}

export function selectionSeparator(value, fallback = DEFAULT_SEPARATOR) {
    try {
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        return normalizeSeparator(parsed?.separator ?? fallback);
    } catch (_error) {
        return normalizeSeparator(fallback);
    }
}

export function selectionValue(selectedIds, separator, bundle) {
    return JSON.stringify({
        ids: selectedIds,
        separator: normalizeSeparator(separator),
        ...(bundle ? { bundle } : {}),
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
