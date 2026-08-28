# ComfyUI Simple Preset

Simple Preset is a small, dependency-free ComfyUI custom node for managing named
prompt presets. Presets are shared between workflows, while each workflow stores
only its own selected preset IDs.

## Features

- One node with one `STRING` output
- Create, edit, delete, search, and reorder named presets in the node
- Select multiple presets and join their prompts in the displayed order
- Shared, human-readable JSON storage
- Independent selection state for every workflow
- Live refresh across nodes and open browser tabs

## Install

Clone or copy this directory into `ComfyUI/custom_nodes/`, restart ComfyUI, and
refresh the browser. Add **Simple Preset** from `text / presets`.

No additional Python or frontend packages are required.

## Data and workflow storage

Shared presets are stored outside the custom-node package in
`ComfyUI/user/simple_preset/presets.json`. This keeps them in place if the custom
node is removed or reinstalled. Writes are atomic, and manually edited valid JSON
is reloaded automatically.

A workflow stores only a JSON array of selected preset IDs in the node widget.
Names and prompt text remain exclusively in the shared preset file.

Selected non-empty prompts are joined with `, ` in the current displayed order.
Use the sort menu to change that shared order.

## Development checks

```bash
python -m unittest discover -s tests -v
node --check web/simple_preset.js
```
