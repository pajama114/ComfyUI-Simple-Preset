# ComfyUI Simple Preset

Simple Preset is a small, dependency-free ComfyUI custom node for managing named
prompt presets. Presets are shared between workflows, while each workflow stores
only its own selected preset IDs and the profile last displayed by that node.

## Features

- One node with one `STRING` output
- Create, edit, delete, search, and sort named presets in the node
- Organize presets into shared profiles and filter the list by profile
- Select multiple presets, drag the applied preset chips into order, and join their prompts in that order
- Shared, human-readable JSON storage
- Independent selection state for every workflow
- Live refresh across nodes and open browser tabs

## Install

Clone or copy this directory into `ComfyUI/custom_nodes/`, restart ComfyUI, and
refresh the browser. Add **Simple Preset** from `text / presets`.

No additional Python or frontend packages are required.

## Data and workflow storage

Shared profiles and presets are stored outside the custom-node package in
`ComfyUI/user/simple_preset/presets.json`. This keeps them in place if the custom
node is removed or reinstalled. Writes are atomic, and manually edited valid JSON
is reloaded automatically.

A workflow stores only a JSON array of selected preset IDs in the node widget and
the last displayed profile ID in the node properties. Names, prompt text, and
profile names remain exclusively in the shared preset file.

Changing profiles filters the visible list without clearing selections in other
profiles. Select-all follows the current search results, while clear-selection
only clears presets belonging to the current profile. Deleting a profile also
deletes all presets assigned to it after confirmation.
The built-in `Default` profile is selected initially and cannot be renamed or
deleted, and every preset belongs to a profile. New presets are assigned to the
currently displayed profile automatically. Other profiles can be renamed or
deleted.

Selected non-empty prompts are joined with `, ` in the order shown by the applied
preset chips at the bottom of the node. Drag a rounded preset-name chip to change
the order for that workflow only. The sort menu continues to change the shared
preset-list order without changing a workflow's applied order.

## Development checks

```bash
python -m unittest discover -s tests -v
npm test
```
