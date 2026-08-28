"""Shared JSON persistence for Simple Preset."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from copy import deepcopy
from pathlib import Path


class PresetValidationError(ValueError):
    """Raised when preset data is invalid."""


class PresetNotFoundError(KeyError):
    """Raised when a requested preset does not exist."""


class PresetStore:
    """Thread-safe, atomically-written preset storage."""

    VERSION = 1
    MAX_PRESETS = 500
    MAX_NAME_LENGTH = 120
    MAX_PROMPT_LENGTH = 100_000

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._presets: list[dict[str, str]] = []
        self._file_signature: tuple[int, int] | None = None
        self._load(create_if_missing=True)

    @staticmethod
    def _signature(path: Path) -> tuple[int, int] | None:
        try:
            stat = path.stat()
        except FileNotFoundError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    @classmethod
    def _validate_name(cls, name: object) -> str:
        if not isinstance(name, str):
            raise PresetValidationError("Preset name must be a string.")
        name = name.strip()
        if not name:
            raise PresetValidationError("Preset name cannot be empty.")
        if len(name) > cls.MAX_NAME_LENGTH:
            raise PresetValidationError(
                f"Preset name must be {cls.MAX_NAME_LENGTH} characters or fewer."
            )
        return name

    @classmethod
    def _validate_prompt(cls, prompt: object) -> str:
        if not isinstance(prompt, str):
            raise PresetValidationError("Prompt must be a string.")
        if len(prompt) > cls.MAX_PROMPT_LENGTH:
            raise PresetValidationError(
                f"Prompt must be {cls.MAX_PROMPT_LENGTH} characters or fewer."
            )
        return prompt

    @classmethod
    def _validate_document(cls, document: object) -> list[dict[str, str]]:
        if not isinstance(document, dict):
            raise PresetValidationError("Preset JSON root must be an object.")
        if document.get("version") != cls.VERSION:
            raise PresetValidationError("Unsupported preset JSON version.")
        raw_presets = document.get("presets")
        if not isinstance(raw_presets, list):
            raise PresetValidationError("The presets field must be an array.")
        if len(raw_presets) > cls.MAX_PRESETS:
            raise PresetValidationError(f"At most {cls.MAX_PRESETS} presets are allowed.")

        presets: list[dict[str, str]] = []
        seen_ids: set[str] = set()
        for raw in raw_presets:
            if not isinstance(raw, dict):
                raise PresetValidationError("Each preset must be an object.")
            preset_id = raw.get("id")
            if not isinstance(preset_id, str) or not preset_id or preset_id in seen_ids:
                raise PresetValidationError("Every preset must have a unique string id.")
            seen_ids.add(preset_id)
            presets.append(
                {
                    "id": preset_id,
                    "name": cls._validate_name(raw.get("name")),
                    "prompt": cls._validate_prompt(raw.get("prompt")),
                }
            )
        return presets

    def _load(self, *, create_if_missing: bool = False) -> None:
        with self._lock:
            if not self.path.exists():
                self._presets = []
                self._file_signature = None
                if create_if_missing:
                    self._write()
                return
            try:
                with self.path.open("r", encoding="utf-8") as handle:
                    document = json.load(handle)
                self._presets = self._validate_document(document)
            except json.JSONDecodeError as error:
                raise PresetValidationError(
                    f"Preset JSON is not valid: {error.msg} (line {error.lineno})."
                ) from error
            self._file_signature = self._signature(self.path)

    def _reload_if_changed(self) -> None:
        if self._signature(self.path) != self._file_signature:
            self._load(create_if_missing=True)

    def _write(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        document = {"version": self.VERSION, "presets": self._presets}
        file_descriptor, temp_path = tempfile.mkstemp(
            dir=self.path.parent, prefix=f".{self.path.name}.", suffix=".tmp"
        )
        try:
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
                json.dump(document, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, self.path)
        finally:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
        self._file_signature = self._signature(self.path)

    def list(self) -> list[dict[str, str]]:
        with self._lock:
            self._reload_if_changed()
            return deepcopy(self._presets)

    def create(self, name: object, prompt: object) -> dict[str, str]:
        with self._lock:
            self._reload_if_changed()
            if len(self._presets) >= self.MAX_PRESETS:
                raise PresetValidationError(f"At most {self.MAX_PRESETS} presets are allowed.")
            preset = {
                "id": uuid.uuid4().hex,
                "name": self._validate_name(name),
                "prompt": self._validate_prompt(prompt),
            }
            self._presets.append(preset)
            self._write()
            return deepcopy(preset)

    def update(self, preset_id: str, name: object, prompt: object) -> dict[str, str]:
        with self._lock:
            self._reload_if_changed()
            for preset in self._presets:
                if preset["id"] == preset_id:
                    preset["name"] = self._validate_name(name)
                    preset["prompt"] = self._validate_prompt(prompt)
                    self._write()
                    return deepcopy(preset)
            raise PresetNotFoundError(preset_id)

    def delete(self, preset_id: str) -> None:
        with self._lock:
            self._reload_if_changed()
            for index, preset in enumerate(self._presets):
                if preset["id"] == preset_id:
                    del self._presets[index]
                    self._write()
                    return
            raise PresetNotFoundError(preset_id)

    def reorder(self, ordered_ids: object) -> list[dict[str, str]]:
        if not isinstance(ordered_ids, list) or not all(
            isinstance(item, str) for item in ordered_ids
        ):
            raise PresetValidationError("Order must be an array of preset ids.")
        with self._lock:
            self._reload_if_changed()
            current_ids = [preset["id"] for preset in self._presets]
            if len(set(ordered_ids)) != len(ordered_ids) or set(ordered_ids) != set(current_ids):
                raise PresetValidationError("Order must contain every preset id exactly once.")
            by_id = {preset["id"]: preset for preset in self._presets}
            self._presets = [by_id[preset_id] for preset_id in ordered_ids]
            self._write()
            return deepcopy(self._presets)

    @staticmethod
    def parse_selection(selected: object) -> list[str]:
        if isinstance(selected, str):
            try:
                selected = json.loads(selected)
            except (json.JSONDecodeError, TypeError):
                return []
        if not isinstance(selected, list):
            return []
        result: list[str] = []
        seen: set[str] = set()
        for item in selected:
            if isinstance(item, str) and item not in seen:
                seen.add(item)
                result.append(item)
        return result

    def join_selected(self, selected: object) -> str:
        selected_ids = set(self.parse_selection(selected))
        with self._lock:
            self._reload_if_changed()
            # The shared list is the display order and therefore the join order.
            return ", ".join(
                preset["prompt"]
                for preset in self._presets
                if preset["id"] in selected_ids and preset["prompt"]
            )

    def change_token(self, selected: object) -> tuple[tuple[int, int] | None, tuple[str, ...]]:
        selected_ids = tuple(self.parse_selection(selected))
        with self._lock:
            self._reload_if_changed()
            return (self._file_signature, selected_ids)


PACKAGE_PRESET_FILE = Path(__file__).resolve().parent / "data" / "presets.json"


def resolve_preset_file() -> Path:
    """Use ComfyUI's persistent user area when it is available."""
    try:
        import folder_paths
    except ImportError:
        return PACKAGE_PRESET_FILE

    get_user_directory = getattr(folder_paths, "get_user_directory", None)
    if callable(get_user_directory):
        return Path(get_user_directory()) / "simple_preset" / "presets.json"

    base_path = getattr(folder_paths, "base_path", None)
    if base_path:
        return Path(base_path) / "user" / "simple_preset" / "presets.json"
    return PACKAGE_PRESET_FILE


PRESET_FILE = resolve_preset_file()
PRESET_STORE = PresetStore(PRESET_FILE)
