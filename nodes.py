"""ComfyUI node definition for Simple Preset."""

from __future__ import annotations

from .preset_store import PRESET_STORE


class SimplePreset:
    """Join prompts belonging to the presets selected in this workflow."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "selected_presets": (
                    "SIMPLE_PRESET_SELECTION",
                    {"default": "[]"},
                ),
                "separator": (
                    "SIMPLE_PRESET_SEPARATOR",
                    {"default": "comma"},
                ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "build_prompt"
    CATEGORY = "text/presets"
    DESCRIPTION = "Select shared named presets and join their prompts in applied order."

    def build_prompt(self, selected_presets="[]", separator="comma"):
        return (PRESET_STORE.join_selected(selected_presets, separator),)

    @classmethod
    def IS_CHANGED(cls, selected_presets="[]", separator="comma"):
        # Shared JSON changes must invalidate ComfyUI's execution cache.
        return PRESET_STORE.change_token(selected_presets, separator)


NODE_CLASS_MAPPINGS = {"SimplePreset": SimplePreset}
NODE_DISPLAY_NAME_MAPPINGS = {"SimplePreset": "Simple Preset"}
