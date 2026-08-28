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
                )
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "build_prompt"
    CATEGORY = "text/presets"
    DESCRIPTION = "Select shared named presets and join their prompts in list order."

    def build_prompt(self, selected_presets="[]"):
        return (PRESET_STORE.join_selected(selected_presets),)

    @classmethod
    def IS_CHANGED(cls, selected_presets="[]"):
        # Shared JSON changes must invalidate ComfyUI's execution cache.
        return PRESET_STORE.change_token(selected_presets)


NODE_CLASS_MAPPINGS = {"SimplePreset": SimplePreset}
NODE_DISPLAY_NAME_MAPPINGS = {"SimplePreset": "Simple Preset"}
