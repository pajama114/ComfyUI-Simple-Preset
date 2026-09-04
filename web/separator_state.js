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

export function createSeparatorTransportWidget(node, inputName, getSeparator) {
    const widget = {
        name: inputName,
        type: "simple_preset_separator",
        value: DEFAULT_SEPARATOR,
        options: {},
        serialize: false,
        draw() {},
        computeSize: () => [0, 0],
        serializeValue: () => normalizeSeparator(getSeparator()),
    };
    node.addCustomWidget(widget);
    return { widget };
}
