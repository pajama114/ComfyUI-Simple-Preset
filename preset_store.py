"""Shared JSON persistence for Simple Preset."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import uuid
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path


class PresetValidationError(ValueError):
    """Raised when preset data is invalid."""


class PresetImportConflictError(PresetValidationError):
    """An import needs review before it can be committed."""

    def __init__(self, message: str, preview: dict):
        super().__init__(message)
        self.preview = preview


class PresetEditConflictError(PresetValidationError):
    """Fields being edited have changed since the editor was opened."""

    def __init__(self, current: dict, fields: list[str], snapshot: dict):
        super().__init__("This preset changed elsewhere. Review the conflicting fields before saving.")
        self.current = deepcopy(current)
        self.fields = fields
        self.snapshot = snapshot


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
    DEFAULT_SEPARATOR = "comma"
    SEPARATORS = {
        "comma": ", ",
        "newline": "\n",
        "period": ". ",
        "comma_newline": ", \n",
    }

    def __init__(self, path: str | Path, *, load_on_init: bool = True):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._profiles: list[dict[str, str]] = [self._default_profile()]
        self._presets: list[dict[str, str]] = []
        self._file_signature: tuple[int, int, str] | None = None
        self._loaded = False
        self._store_id = uuid.uuid4().hex
        self._revision = 0
        if load_on_init:
            self._load(create_if_missing=True)

    @staticmethod
    def _signature(path: Path) -> tuple[int, int, str] | None:
        try:
            with path.open("rb") as handle:
                stat = os.fstat(handle.fileno())
                digest = hashlib.sha256()
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
        except FileNotFoundError:
            return None
        # On WSL/Windows, ctime can be the creation time. Neither it nor mtime
        # reliably detects same-size edits made by tools that preserve timestamps.
        return (stat.st_mtime_ns, stat.st_size, digest.hexdigest())

    @classmethod
    def _default_profile(cls) -> dict[str, str]:
        return {"id": cls.DEFAULT_PROFILE_ID, "name": cls.DEFAULT_PROFILE_NAME}

    @staticmethod
    def _validate_utf8(value: str) -> None:
        try:
            value.encode("utf-8")
        except UnicodeEncodeError as error:
            raise PresetValidationError("Preset data must contain valid Unicode text.") from error

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
        cls._validate_utf8(name)
        return name

    @classmethod
    def _validate_prompt(cls, prompt: object) -> str:
        if not isinstance(prompt, str):
            raise PresetValidationError("Prompt must be a string.")
        if len(prompt) > cls.MAX_PROMPT_LENGTH:
            raise PresetValidationError(
                f"Prompt must be {cls.MAX_PROMPT_LENGTH} characters or fewer."
            )
        cls._validate_utf8(prompt)
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
        cls._validate_utf8(name)
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
        try:
            return cls._format_timestamp(parsed)
        except (ValueError, OverflowError) as error:
            raise PresetValidationError("Preset timestamps must be within the supported date range.") from error

    @classmethod
    def _validate_document(
        cls, document: object, *, portable: bool = False
    ) -> tuple[list[dict[str, str]], list[dict[str, str]], bool]:
        if not isinstance(document, dict):
            raise PresetValidationError("Preset JSON root must be an object.")
        version = document.get("version")
        if type(version) is not int or version not in (1, cls.VERSION):
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
                or profile_id == "__all_profiles__"
            ):
                raise PresetValidationError("Every profile must have a unique string id.")
            name = cls._validate_profile_name(raw_profile.get("name"))
            normalized_name = name.casefold()
            if normalized_name in profile_names and not portable:
                raise PresetValidationError("Profile names must be unique.")
            profile_ids.add(profile_id)
            cls._validate_utf8(profile_id)
            profile_names.add(normalized_name)
            profiles.append({"id": profile_id, "name": name})

        if version == 1:
            profiles = [cls._default_profile()]
            profile_ids = {cls.DEFAULT_PROFILE_ID}
        elif not profiles:
            raise PresetValidationError("At least one profile is required.")
        if cls._default_profile() not in profiles:
            raise PresetValidationError("The built-in Default profile must be present and named Default.")

        raw_presets = document.get("presets")
        if not isinstance(raw_presets, list):
            raise PresetValidationError("The presets field must be an array.")
        if len(raw_presets) > cls.MAX_PRESETS:
            raise PresetValidationError(f"At most {cls.MAX_PRESETS} presets are allowed.")

        presets: list[dict[str, str]] = []
        seen_ids: set[str] = set()
        migrated = version == 1
        fallback_base = datetime.now(timezone.utc)
        for index, raw in enumerate(raw_presets):
            if not isinstance(raw, dict):
                raise PresetValidationError("Each preset must be an object.")
            preset_id = raw.get("id")
            if not isinstance(preset_id, str) or not preset_id or preset_id in seen_ids:
                raise PresetValidationError("Every preset must have a unique string id.")
            seen_ids.add(preset_id)
            cls._validate_utf8(preset_id)
            fallback_created_at = cls._format_timestamp(
                fallback_base + timedelta(microseconds=index)
            )
            if raw.get("created_at") is None or raw.get("updated_at") is None:
                migrated = True
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
        return profiles, presets, migrated

    def _load(self, *, create_if_missing: bool = False) -> None:
        with self._lock:
            signature = self._signature(self.path)
            if signature is None:
                self._profiles = [self._default_profile()]
                self._presets = []
                self._file_signature = None
                if create_if_missing:
                    self._write()
                self._loaded = True
                return
            try:
                with self.path.open("r", encoding="utf-8") as handle:
                    document = json.load(handle)
                self._profiles, self._presets, migrated = self._validate_document(document)
            except json.JSONDecodeError as error:
                raise PresetValidationError(
                    f"Preset JSON is not valid: {error.msg} (line {error.lineno})."
                ) from error
            except UnicodeError as error:
                raise PresetValidationError("Preset JSON must contain valid UTF-8 text.") from error
            if migrated:
                self._write()
            else:
                # A file replaced during this read must be reloaded on the next call.
                self._file_signature = signature
                self._revision += 1
            self._loaded = True

    def _reload_if_changed(self) -> None:
        if not self._loaded or self._signature(self.path) != self._file_signature:
            self._load(create_if_missing=True)

    @contextmanager
    def _transaction(self):
        with self._lock:
            self._reload_if_changed()
            profiles, presets = deepcopy(self._profiles), deepcopy(self._presets)
            try:
                yield
            except Exception:
                self._profiles, self._presets = profiles, presets
                raise

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
            signature = self._signature(Path(temp_path))
            os.replace(temp_path, self.path)
        finally:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
        # Record the file we wrote, so an external edit immediately after replace
        # cannot be mistaken for the in-memory document.
        self._file_signature = signature
        self._revision += 1

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
            return self._snapshot()

    def _snapshot(self) -> dict[str, object]:
        """Capture the current in-memory state while the caller holds the lock."""
        return {
            "version": self.VERSION,
            "profiles": deepcopy(self._profiles),
            "presets": deepcopy(self._presets),
            "store_id": self._store_id,
            "revision": self._revision,
        }

    def export_document(self, profile_id: str | None = None) -> dict:
        with self._lock:
            self._reload_if_changed()
            if profile_id is not None:
                self._validated_profile_id(profile_id)
            presets = [
                preset for preset in self._presets
                if profile_id is None or preset["profile_id"] == profile_id
            ]
            profiles = [
                profile for profile in self._profiles
                if profile_id is None or profile["id"] in (self.DEFAULT_PROFILE_ID, profile_id)
            ]
            return deepcopy({"version": self.VERSION, "profiles": profiles, "presets": presets})

    @staticmethod
    def _preset_content(preset: dict) -> tuple:
        return (preset["name"], preset["prompt"], preset["profile_id"])

    def _prepare_import(self, document: object) -> tuple[dict, list, list]:
        profiles, presets, _ = self._validate_document(document, portable=True)
        profiles_by_id = {p["id"]: p for p in self._profiles}
        profiles_by_name = {p["name"].casefold(): p for p in self._profiles}
        profile_map, added_profiles = {}, []
        for profile in profiles:
            existing = profiles_by_id.get(profile["id"]) or profiles_by_name.get(
                profile["name"].casefold()
            )
            if existing:
                profile_map[profile["id"]] = existing["id"]
            else:
                profile_map[profile["id"]] = profile["id"]
                added_profiles.append(profile)
                profiles_by_id[profile["id"]] = profile
                profiles_by_name[profile["name"].casefold()] = profile
        for preset in presets:
            preset["profile_id"] = profile_map[preset["profile_id"]]
        current = {p["id"]: p for p in self._presets}
        added, unchanged, conflicts = [], [], []
        for preset in presets:
            existing = current.get(preset["id"])
            if existing is None:
                added.append(preset)
            elif self._preset_content(existing) == self._preset_content(preset):
                unchanged.append(preset["id"])
            else:
                conflicts.append({
                    "id": preset["id"], "existing": deepcopy(existing), "incoming": preset,
                })
        if len(self._profiles) + len(added_profiles) > self.MAX_PROFILES:
            raise PresetValidationError(f"Import would exceed {self.MAX_PROFILES} profiles.")
        if len(self._presets) + len(added) > self.MAX_PRESETS:
            raise PresetValidationError(f"Import would exceed {self.MAX_PRESETS} presets.")
        preview = {
            "store_id": self._store_id, "revision": self._revision,
            "added": added, "unchanged": unchanged, "conflicts": conflicts,
            "profiles_added": added_profiles,
        }
        return preview, added_profiles, presets

    def preview_import(self, document: object) -> dict:
        with self._lock:
            self._reload_if_changed()
            preview, _, _ = self._prepare_import(document)
            return deepcopy(preview)

    def import_document(
        self, document: object, resolutions: object = None, expected: object = None
    ) -> dict:
        with self._transaction():
            preview, added_profiles, presets = self._prepare_import(document)
            if expected is not None:
                if (
                    not isinstance(expected, dict)
                    or not isinstance(expected.get("store_id"), str)
                    or type(expected.get("revision")) is not int
                ):
                    raise PresetValidationError("Import revision must include store_id and revision.")
                if expected != {"store_id": self._store_id, "revision": self._revision}:
                    raise PresetImportConflictError(
                        "Shared presets changed. Review the updated import.", preview
                    )
            resolutions = {} if resolutions is None else resolutions
            conflict_ids = {c["id"] for c in preview["conflicts"]}
            if not isinstance(resolutions, dict) or any(
                key not in conflict_ids or value not in ("keep", "overwrite")
                for key, value in resolutions.items()
            ):
                raise PresetValidationError("Import choices must be keep or overwrite for conflicting IDs.")
            if conflict_ids - resolutions.keys():
                raise PresetImportConflictError(
                    "Choose whether to keep or update each conflicting preset.", preview
                )
            by_id = {p["id"]: p for p in self._presets}
            updated = 0
            for preset in presets:
                if preset["id"] not in by_id:
                    self._presets.append(preset)
                elif resolutions.get(preset["id"]) == "overwrite":
                    by_id[preset["id"]].update(preset)
                    updated += 1
            self._profiles.extend(added_profiles)
            added = len(preview["added"])
            if added or updated or added_profiles:
                self._validate_document({
                    "version": self.VERSION, "profiles": self._profiles, "presets": self._presets,
                })
                self._write()
            return {
                "added": added, "updated": updated,
                "skipped": len(presets) - added - updated, "profiles_added": len(added_profiles),
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
        with self._transaction():
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
        self, preset_id: str, changes: object, expected: object
    ) -> dict[str, str]:
        """Apply only edited fields, comparing their original values under the lock."""
        with self._transaction():
            preset = next((p for p in self._presets if p["id"] == preset_id), None)
            if preset is None:
                raise PresetNotFoundError(preset_id)
            if not isinstance(changes, dict) or not set(changes) <= {"name", "prompt", "profile_id"}:
                raise PresetValidationError("changes must contain only name, prompt, or profile_id.")
            if not isinstance(expected, dict) or set(expected) != set(changes):
                raise PresetValidationError("expected must contain the original value of each changed field.")
            if "profile_id" in changes and not isinstance(changes["profile_id"], str):
                raise PresetValidationError("profile_id must be a string.")
            validators = {
                "name": self._validate_name,
                "prompt": self._validate_prompt,
                "profile_id": self._validated_profile_id,
            }
            validated = {field: validators[field](value) for field, value in changes.items()}
            if any(not isinstance(value, str) for value in expected.values()):
                raise PresetValidationError("Original field values must be strings.")
            conflicts = [
                field for field, value in validated.items()
                if preset[field] != expected[field] and preset[field] != value
            ]
            if conflicts:
                raise PresetEditConflictError(preset, conflicts, self._snapshot())
            if any(preset[field] != value for field, value in validated.items()):
                preset.update(validated)
                preset["updated_at"] = self._timestamp()
                self._write()
            return deepcopy(preset)

    def create_profile(self, name: object) -> dict[str, str]:
        with self._transaction():
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
        with self._transaction():
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
        with self._transaction():
            if profile_id == self.DEFAULT_PROFILE_ID:
                raise PresetValidationError("The Default profile cannot be deleted.")
            for index, profile in enumerate(self._profiles):
                if profile["id"] == profile_id:
                    if len(self._profiles) <= 1:
                        raise PresetValidationError("The last profile cannot be deleted.")
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
        with self._transaction():
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
        with self._transaction():
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
        if isinstance(selected, dict):
            selected = selected.get("ids")
        if not isinstance(selected, list):
            return []
        result: list[str] = []
        seen: set[str] = set()
        for item in selected:
            if isinstance(item, str) and item not in seen:
                seen.add(item)
                result.append(item)
        return result

    @classmethod
    def selection_separator(cls, selected: object) -> str:
        if isinstance(selected, str):
            try:
                selected = json.loads(selected)
            except (json.JSONDecodeError, TypeError):
                return cls.DEFAULT_SEPARATOR
        if not isinstance(selected, dict):
            return cls.DEFAULT_SEPARATOR
        return cls.normalize_separator(selected.get("separator"))

    @classmethod
    def normalize_separator(cls, separator: object) -> str:
        if isinstance(separator, str) and separator in cls.SEPARATORS:
            return separator
        return cls.DEFAULT_SEPARATOR

    def _resolve_selection(self, selected: object) -> tuple[list[str], dict, bool]:
        selected_ids = self.parse_selection(selected)
        if isinstance(selected, str):
            try:
                selected = json.loads(selected)
            except (json.JSONDecodeError, TypeError):
                selected = None
        embedded = {}
        if isinstance(selected, dict) and "bundle" in selected:
            _, presets, _ = self._validate_document(selected["bundle"], portable=True)
            embedded = {p["id"]: p for p in presets}
        uses_shared = any(preset_id not in embedded for preset_id in selected_ids)
        if uses_shared:
            self._reload_if_changed()
        by_id = {p["id"]: p for p in self._presets} if uses_shared else {}
        by_id.update(embedded)
        return selected_ids, by_id, uses_shared

    def join_selected(
        self, selected: object, separator: object | None = None
    ) -> str:
        normalized_separator = (
            self.selection_separator(selected)
            if separator is None
            else self.normalize_separator(separator)
        )
        delimiter = self.SEPARATORS[normalized_separator]
        with self._lock:
            selected_ids, by_id, _ = self._resolve_selection(selected)
            missing_ids = [preset_id for preset_id in selected_ids if preset_id not in by_id]
            if missing_ids:
                raise PresetValidationError(
                    f"Selected presets are missing: {', '.join(missing_ids)}. "
                    "Restore them in the shared preset file or remove their missing "
                    "selections from this node before running."
                )
            prompts = [
                by_id[preset_id]["prompt"]
                for preset_id in selected_ids
                if by_id[preset_id]["prompt"]
            ]
            if normalized_separator != "period":
                return delimiter.join(prompts)
            parts: list[str] = []
            for prompt in prompts:
                if not prompt.strip():
                    continue
                if parts:
                    previous = parts[-1].rstrip()
                    parts[-1] = previous
                    parts.append(" " if previous.endswith((".", "!", "?")) else delimiter)
                    prompt = prompt.lstrip()
                parts.append(prompt)
            return "".join(parts)

    def change_token(
        self, selected: object, separator: object | None = None
    ) -> tuple:
        normalized_separator = (
            self.selection_separator(selected)
            if separator is None
            else self.normalize_separator(separator)
        )
        with self._lock:
            selected_ids, by_id, uses_shared = self._resolve_selection(selected)
            contents = [
                (preset_id, self._preset_content(by_id[preset_id]) if preset_id in by_id else None)
                for preset_id in selected_ids
            ]
            digest = hashlib.sha256(json.dumps(contents, ensure_ascii=False).encode("utf-8")).hexdigest()
            return (
                self._file_signature if uses_shared else None,
                tuple(selected_ids), normalized_separator, digest,
            )


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
# Broken or unwritable storage should report an error when used, not hide the node
# by preventing ComfyUI from importing the extension.
PRESET_STORE = PresetStore(PRESET_FILE, load_on_init=False)
