"""Shared JSON persistence for Simple Preset."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path


class PresetValidationError(ValueError):
    """Raised when preset data is invalid."""


class PresetNotFoundError(KeyError):
    """Raised when a requested preset does not exist."""


class ProfileNotFoundError(KeyError):
    """Raised when a requested profile does not exist."""


class PresetStore:
    """Thread-safe, atomically-written preset storage."""

    VERSION = 3
    DEFAULT_PROFILE_ID = "default"
    DEFAULT_PROFILE_NAME = "Default"
    MAX_PRESETS = 500
    MAX_PROFILES = 100
    MAX_NAME_LENGTH = 120
    MAX_PROMPT_LENGTH = 100_000

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._profiles: list[dict[str, str]] = [self._default_profile()]
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
    def _default_profile(cls) -> dict[str, str]:
        return {"id": cls.DEFAULT_PROFILE_ID, "name": cls.DEFAULT_PROFILE_NAME}

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
    def _validate_profile_name(cls, name: object) -> str:
        if not isinstance(name, str):
            raise PresetValidationError("Profile name must be a string.")
        name = name.strip()
        if not name:
            raise PresetValidationError("Profile name cannot be empty.")
        if len(name) > cls.MAX_NAME_LENGTH:
            raise PresetValidationError(
                f"Profile name must be {cls.MAX_NAME_LENGTH} characters or fewer."
            )
        return name

    @staticmethod
    def _format_timestamp(value: datetime) -> str:
        return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace(
            "+00:00", "Z"
        )

    @classmethod
    def _timestamp(cls) -> str:
        return cls._format_timestamp(datetime.now(timezone.utc))

    @classmethod
    def _validate_timestamp(cls, value: object, fallback: str) -> str:
        if value is None:
            return fallback
        if not isinstance(value, str):
            raise PresetValidationError("Preset timestamps must be strings.")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise PresetValidationError("Preset timestamps must be valid ISO 8601 values.") from error
        if parsed.tzinfo is None:
            raise PresetValidationError("Preset timestamps must include a timezone.")
        return cls._format_timestamp(parsed)

    @classmethod
    def _validate_document(
        cls, document: object
    ) -> tuple[list[dict[str, str]], list[dict[str, str]], bool]:
        if not isinstance(document, dict):
            raise PresetValidationError("Preset JSON root must be an object.")
        version = document.get("version")
        if version not in (1, cls.VERSION):
            raise PresetValidationError("Unsupported preset JSON version.")

        raw_profiles = document.get("profiles", []) if version == cls.VERSION else []
        if not isinstance(raw_profiles, list):
            raise PresetValidationError("The profiles field must be an array.")
        if len(raw_profiles) > cls.MAX_PROFILES:
            raise PresetValidationError(f"At most {cls.MAX_PROFILES} profiles are allowed.")

        profiles: list[dict[str, str]] = []
        profile_ids: set[str] = set()
        profile_names: set[str] = set()
        for raw_profile in raw_profiles:
            if not isinstance(raw_profile, dict):
                raise PresetValidationError("Each profile must be an object.")
            profile_id = raw_profile.get("id")
            if (
                not isinstance(profile_id, str)
                or not profile_id
                or profile_id in profile_ids
            ):
                raise PresetValidationError("Every profile must have a unique string id.")
            name = cls._validate_profile_name(raw_profile.get("name"))
            normalized_name = name.casefold()
            if normalized_name in profile_names:
                raise PresetValidationError("Profile names must be unique.")
            profile_ids.add(profile_id)
            profile_names.add(normalized_name)
            profiles.append({"id": profile_id, "name": name})

        if version == 1:
            profiles = [cls._default_profile()]
            profile_ids = {cls.DEFAULT_PROFILE_ID}
        elif not profiles:
            raise PresetValidationError("At least one profile is required.")

        raw_presets = document.get("presets")
        if not isinstance(raw_presets, list):
            raise PresetValidationError("The presets field must be an array.")
        if len(raw_presets) > cls.MAX_PRESETS:
            raise PresetValidationError(f"At most {cls.MAX_PRESETS} presets are allowed.")

        presets: list[dict[str, str]] = []
        seen_ids: set[str] = set()
        fallback_base = datetime.now(timezone.utc)
        for index, raw in enumerate(raw_presets):
            if not isinstance(raw, dict):
                raise PresetValidationError("Each preset must be an object.")
            preset_id = raw.get("id")
            if not isinstance(preset_id, str) or not preset_id or preset_id in seen_ids:
                raise PresetValidationError("Every preset must have a unique string id.")
            seen_ids.add(preset_id)
            fallback_created_at = cls._format_timestamp(
                fallback_base + timedelta(microseconds=index)
            )
            created_at = cls._validate_timestamp(
                raw.get("created_at"), fallback_created_at
            )
            profile_id = (
                cls.DEFAULT_PROFILE_ID if version == 1 else raw.get("profile_id")
            )
            if not isinstance(profile_id, str):
                raise PresetValidationError("Preset profile_id must be a string.")
            if profile_id not in profile_ids:
                raise PresetValidationError("Preset profile_id must reference a profile.")
            presets.append(
                {
                    "id": preset_id,
                    "name": cls._validate_name(raw.get("name")),
                    "prompt": cls._validate_prompt(raw.get("prompt")),
                    "created_at": created_at,
                    "updated_at": cls._validate_timestamp(
                        raw.get("updated_at"), created_at
                    ),
                    "profile_id": profile_id,
                }
            )
        return profiles, presets, version == 1

    def _load(self, *, create_if_missing: bool = False) -> None:
        with self._lock:
            if not self.path.exists():
                self._profiles = [self._default_profile()]
                self._presets = []
                self._file_signature = None
                if create_if_missing:
                    self._write()
                return
            try:
                with self.path.open("r", encoding="utf-8") as handle:
                    document = json.load(handle)
                self._profiles, self._presets, migrated = self._validate_document(document)
            except json.JSONDecodeError as error:
                raise PresetValidationError(
                    f"Preset JSON is not valid: {error.msg} (line {error.lineno})."
                ) from error
            if migrated:
                self._write()
            else:
                self._file_signature = self._signature(self.path)

    def _reload_if_changed(self) -> None:
        if self._signature(self.path) != self._file_signature:
            self._load(create_if_missing=True)

    def _write(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        document = {
            "version": self.VERSION,
            "profiles": self._profiles,
            "presets": self._presets,
        }
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

    def list_profiles(self) -> list[dict[str, str]]:
        with self._lock:
            self._reload_if_changed()
            return deepcopy(self._profiles)

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            self._reload_if_changed()
            return {
                "version": self.VERSION,
                "profiles": deepcopy(self._profiles),
                "presets": deepcopy(self._presets),
            }

    def _validated_profile_id(self, profile_id: object) -> str:
        if profile_id is None:
            default = next(
                (
                    profile["id"]
                    for profile in self._profiles
                    if profile["id"] == self.DEFAULT_PROFILE_ID
                ),
                None,
            )
            return default or self._profiles[0]["id"]
        if not isinstance(profile_id, str):
            raise PresetValidationError("profile_id must be a string.")
        if not any(profile["id"] == profile_id for profile in self._profiles):
            raise ProfileNotFoundError(profile_id)
        return profile_id

    def create(
        self, name: object, prompt: object, profile_id: object = None
    ) -> dict[str, str]:
        with self._lock:
            self._reload_if_changed()
            if len(self._presets) >= self.MAX_PRESETS:
                raise PresetValidationError(f"At most {self.MAX_PRESETS} presets are allowed.")
            timestamp = self._timestamp()
            preset = {
                "id": uuid.uuid4().hex,
                "name": self._validate_name(name),
                "prompt": self._validate_prompt(prompt),
                "created_at": timestamp,
                "updated_at": timestamp,
                "profile_id": self._validated_profile_id(profile_id),
            }
            self._presets.append(preset)
            self._write()
            return deepcopy(preset)

    def update(
        self, preset_id: str, name: object, prompt: object, profile_id: object = None
    ) -> dict[str, str]:
        with self._lock:
            self._reload_if_changed()
            validated_name = self._validate_name(name)
            validated_prompt = self._validate_prompt(prompt)
            validated_profile_id = self._validated_profile_id(profile_id)
            for preset in self._presets:
                if preset["id"] == preset_id:
                    preset["name"] = validated_name
                    preset["prompt"] = validated_prompt
                    preset["profile_id"] = validated_profile_id
                    preset["updated_at"] = self._timestamp()
                    self._write()
                    return deepcopy(preset)
            raise PresetNotFoundError(preset_id)

    def create_profile(self, name: object) -> dict[str, str]:
        with self._lock:
            self._reload_if_changed()
            if len(self._profiles) >= self.MAX_PROFILES:
                raise PresetValidationError(
                    f"At most {self.MAX_PROFILES} profiles are allowed."
                )
            validated_name = self._validate_profile_name(name)
            if any(
                profile["name"].casefold() == validated_name.casefold()
                for profile in self._profiles
            ):
                raise PresetValidationError("Profile names must be unique.")
            profile = {"id": uuid.uuid4().hex, "name": validated_name}
            self._profiles.append(profile)
            self._write()
            return deepcopy(profile)

    def update_profile(self, profile_id: str, name: object) -> dict[str, str]:
        with self._lock:
            self._reload_if_changed()
            if profile_id == self.DEFAULT_PROFILE_ID:
                raise PresetValidationError("The Default profile cannot be renamed.")
            target = next(
                (profile for profile in self._profiles if profile["id"] == profile_id),
                None,
            )
            if target is None:
                raise ProfileNotFoundError(profile_id)
            validated_name = self._validate_profile_name(name)
            if any(
                profile["id"] != profile_id
                and profile["name"].casefold() == validated_name.casefold()
                for profile in self._profiles
            ):
                raise PresetValidationError("Profile names must be unique.")
            target["name"] = validated_name
            self._write()
            return deepcopy(target)

    def delete_profile(self, profile_id: str) -> int:
        with self._lock:
            self._reload_if_changed()
            if profile_id == self.DEFAULT_PROFILE_ID:
                raise PresetValidationError("The Default profile cannot be deleted.")
            if len(self._profiles) <= 1:
                raise PresetValidationError("The last profile cannot be deleted.")
            for index, profile in enumerate(self._profiles):
                if profile["id"] == profile_id:
                    del self._profiles[index]
                    before = len(self._presets)
                    self._presets = [
                        preset
                        for preset in self._presets
                        if preset["profile_id"] != profile_id
                    ]
                    deleted_presets = before - len(self._presets)
                    self._write()
                    return deleted_presets
            raise ProfileNotFoundError(profile_id)

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
