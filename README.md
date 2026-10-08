# ComfyUI Simple Preset

Simple Preset is a small, dependency-free ComfyUI custom node for managing named
prompt presets. A shared library makes presets available across workflows. Each
saved workflow also includes a copy of its selected presets, so another Simple
Preset installation can run it without receiving a separate preset file.

The node interface, settings, and messages are in English by default. Preset and
profile names and prompt text support Unicode, including Japanese.

## Features

- One node with one `STRING` output
- Create, edit, delete, search, and sort named presets in the node
- Organize presets into shared profiles and filter the list by profile
- Select multiple presets, drag the applied preset chips into order, and join their prompts in that order
- Shared, human-readable JSON storage
- Independent selection state for every workflow
- Portable workflows with selected preset contents and their separator included
- JSON export/import with preserved preset IDs and a conflict review
- Live refresh across nodes and open browser tabs
- Save only changed preset fields, with a review when the same field was edited elsewhere

## Install

Clone or copy this directory into `ComfyUI/custom_nodes/`, restart ComfyUI, and
refresh the browser. Add **Simple Preset** from `text / presets`.

No additional Python or frontend packages are required.

## Data and workflow storage

Shared profiles and presets are stored outside the custom-node package in
`ComfyUI/user/simple_preset/presets.json`. This keeps them in place if the custom
node is removed or reinstalled. Writes are atomic, and manually edited valid JSON
is reloaded automatically.

A workflow stores selected preset IDs, their order, the separator, and a `bundle`
of the selected presets (names, prompts, and referenced profiles) in the node
widget. The last displayed profile ID is stored in the node properties.
Unselected presets are not included. The same contents are also included when
exporting an API-format workflow.

When a saved workflow is loaded, its bundled presets take priority over shared
presets with the same IDs. They have a **Workflow** badge in the list. Loading a
workflow does not import anything into the shared library. Editing a bundled
preset changes that node's copy, and its remove button removes it from that
node's selection. Other workflows and shared presets are unaffected.

New selections from the shared library follow shared edits while the node is
open. Saving captures their current contents; reopening the saved workflow uses
those captured versions. **Use shared versions** in the node's right-click menu
switches selected presets back to the available library versions. Bundled
presets that have no matching library ID are retained.

Shared preset edits save only the fields you changed: name, prompt, or profile.
Edits to different fields from two tabs are combined. If a field you changed was
also changed elsewhere, saving stops and your draft stays in the editor. Compare
the latest value with your changes, choose **Use latest** or **Keep my changes**
for each conflicting field, then save again. Saving checks for further changes
each time; no fields are saved until all conflicts are resolved. Identical edits
do not conflict. Bundled workflow presets are edited locally as described above.

Older workflows containing only IDs still use the shared library. Open and save
them once while their selected presets are available to make them portable.

If a selected preset is absent from both the bundle and the shared library, its
ID and position are kept. The node shows a warning and a `Missing` chip, and execution fails
with a clear error instead of producing an incomplete prompt. Restore the preset
with the same ID and reload to recover the selection automatically, or click the
missing chip's × to remove that selection from this node. Creating a new preset
with the same name does not restore it because new presets receive new IDs.

Changing profiles filters the visible list without clearing selections in other
profiles. Select-all follows the current search results, while clear-selection
only clears presets belonging to the current profile. With all profiles displayed,
clear-selection also removes missing selections. Deleting a shared profile also
deletes its shared presets after confirmation; bundled copies remain available.
The built-in `Default` profile is selected initially and cannot be renamed or
deleted, and every preset belongs to a profile. New presets are assigned to the
currently displayed profile automatically. Other profiles can be renamed or
deleted.

Selected non-empty prompts are joined in the order shown by the applied preset
chips at the bottom of the node. Click the separator button immediately to the
left of reload to cycle through `,` → `↩` → `.` → `,↩`: comma and space, newline,
period and space, or comma and space followed by newline. Spaces are implicit and
are not shown on the button. Each node saves its own separator in the workflow.
**Settings > Simple Preset > Output > Default preset separator** controls only the
initial separator for newly created nodes.

Period mode joins natural-language fragments with `. `, or just a space when
the previous fragment already ends in `.`, `!`, or `?`. Whitespace at joined
boundaries is normalized, and whitespace-only fragments are skipped in this mode.
It does not add a final period to the last fragment.

Drag a rounded preset-name chip to change the order for that workflow only.
The sort menu changes the shared list order within the displayed profile without
changing a workflow's applied order or other profiles' ordering. Choose all
profiles to sort the entire shared list.

## Sharing and importing presets

To share a workflow, save it and send the workflow file. The recipient installs
Simple Preset and loads it; no separate preset import is needed for this node.
Models and any other custom nodes used by the workflow still need to be available.

Open **Settings > Simple Preset > Preset library > Manage presets…** to manage
the shared library. These actions work even without a Simple Preset node in the
current workflow:

- **Import JSON…**: choose a preset JSON file and review it before adding its
  contents to the library.
- **Export all presets**: download the entire shared library as JSON, including
  empty profiles.
- **Export profile**: choose a profile in the management dialog and download its
  shared presets as JSON.

Right-click a Simple Preset node and open its **Simple Preset** submenu for
actions concerning that node's selection:

- **Export selected presets**: download the versions used by this node, in the
  selected order. This includes bundled versions when present.
- **Save workflow presets to library**: review and import this node's selected
  preset contents so they can also be used in other workflows.
- **Use shared versions**: replace available bundled versions with the shared
  library's current versions. Save the workflow to capture those versions.

Imports add to the existing library. Preset IDs are preserved: identical IDs and
contents are skipped, while different contents with the same ID appear in the
review. For each conflict choose **Keep existing** (the default) or **Update with
imported**. A changed name, prompt, or profile counts as a conflict; timestamp
differences alone do not. Different IDs remain separate even if names match.
Importing does not change node selections or replace their bundled copies.

Existing profiles are reused by ID first, then by name (case-insensitive).
Existing profile names are retained; unmatched profiles are added with their
original IDs. If the library changes while reviewing an import, the review is
refreshed and choices must be confirmed again.

Exports and workflow bundles use the same version 3 document shape:

```json
{
  "version": 3,
  "profiles": [{ "id": "default", "name": "Default" }],
  "presets": [
    { "id": "example-id", "name": "Lighting", "prompt": "soft light", "profile_id": "default" }
  ]
}
```

Exports also retain creation/update timestamps when available. Version 1 preset
files can be imported into the built-in Default profile. Importing a preset
file does not apply a selection order or separator to a node; workflows carry
those separately.

## Development checks

```bash
python -m unittest discover -s tests -v
npm test
```

HTTP integration tests run when `aiohttp` is available, as in ComfyUI's Python
environment. They are skipped when running with standalone Python without it.
