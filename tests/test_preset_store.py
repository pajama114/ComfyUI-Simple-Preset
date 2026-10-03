import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from preset_store import (
    PresetNotFoundError,
    PresetStore,
    PresetValidationError,
    ProfileNotFoundError,
    resolve_preset_file,
)


class PresetStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.path = Path(self.temp_directory.name) / "presets.json"
        self.store = PresetStore(self.path)
        self.default_profile = {
            "id": PresetStore.DEFAULT_PROFILE_ID,
            "name": PresetStore.DEFAULT_PROFILE_NAME,
        }

    def tearDown(self):
        self.temp_directory.cleanup()

    def test_create_edit_delete_and_json_reload(self):
        first = self.store.create("Quality", "masterpiece")
        second = self.store.create("Lighting", "soft light")

        updated = self.store.update(first["id"], "High quality", "best quality")
        self.assertEqual(updated["name"], "High quality")
        self.assertEqual(PresetStore(self.path).list(), [updated, second])

        self.store.delete(second["id"])
        self.assertEqual(self.store.list(), [updated])
        with self.assertRaises(PresetNotFoundError):
            self.store.delete(second["id"])

    def test_create_and_update_timestamps(self):
        created_at = "2026-01-02T03:04:05.000000Z"
        updated_at = "2026-02-03T04:05:06.000000Z"
        with patch.object(PresetStore, "_timestamp", side_effect=[created_at, updated_at]):
            preset = self.store.create("Timed", "before")
            edited = self.store.update(preset["id"], "Timed", "after")

        self.assertEqual(preset["created_at"], created_at)
        self.assertEqual(preset["updated_at"], created_at)
        self.assertEqual(edited["created_at"], created_at)
        self.assertEqual(edited["updated_at"], updated_at)

    def test_existing_presets_without_timestamps_keep_their_order(self):
        document = {
            "version": PresetStore.VERSION,
            "profiles": [self.default_profile],
            "presets": [
                {
                    "id": "first",
                    "name": "First",
                    "prompt": "one",
                    "profile_id": PresetStore.DEFAULT_PROFILE_ID,
                },
                {
                    "id": "second",
                    "name": "Second",
                    "prompt": "two",
                    "profile_id": PresetStore.DEFAULT_PROFILE_ID,
                },
            ],
        }
        self.path.write_text(json.dumps(document), encoding="utf-8")

        presets = PresetStore(self.path).list()
        self.assertLess(presets[0]["created_at"], presets[1]["created_at"])
        self.assertEqual(presets[0]["updated_at"], presets[0]["created_at"])
        self.assertEqual(presets[0]["profile_id"], PresetStore.DEFAULT_PROFILE_ID)
        self.assertEqual(PresetStore(self.path).list(), presets)

    def test_version_one_json_is_migrated_without_losing_presets(self):
        document = {
            "version": 1,
            "presets": [{"id": "legacy", "name": "Legacy", "prompt": "kept"}],
        }
        self.path.write_text(json.dumps(document), encoding="utf-8")

        migrated = PresetStore(self.path)

        self.assertEqual(migrated.list()[0]["prompt"], "kept")
        self.assertEqual(migrated.list()[0]["profile_id"], PresetStore.DEFAULT_PROFILE_ID)
        saved = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(saved["version"], PresetStore.VERSION)
        self.assertEqual(saved["profiles"], [self.default_profile])

    def test_profile_create_rename_assignment_and_reload(self):
        profile = self.store.create_profile("Anime")
        preset = self.store.create("Quality", "masterpiece", profile["id"])

        renamed = self.store.update_profile(profile["id"], "Illustration")
        self.assertEqual(renamed["name"], "Illustration")
        self.assertEqual(preset["profile_id"], profile["id"])

        reloaded = PresetStore(self.path)
        self.assertEqual(reloaded.list_profiles(), [self.default_profile, renamed])
        self.assertEqual(reloaded.list()[0]["profile_id"], profile["id"])

        moved = reloaded.update(
            preset["id"],
            "Quality",
            "masterpiece",
            PresetStore.DEFAULT_PROFILE_ID,
        )
        self.assertEqual(moved["profile_id"], PresetStore.DEFAULT_PROFILE_ID)

    def test_profile_names_are_unique_and_assignments_must_exist(self):
        profile = self.store.create_profile("Photo")
        with self.assertRaises(PresetValidationError):
            self.store.create_profile(" photo ")
        with self.assertRaises(ProfileNotFoundError):
            self.store.create("Invalid", "prompt", "missing")
        with self.assertRaises(ProfileNotFoundError):
            self.store.update_profile("missing", "Unknown")
        self.assertEqual(self.store.list_profiles(), [self.default_profile, profile])

    def test_default_profile_is_initial_and_cannot_be_changed_or_deleted(self):
        self.assertEqual(self.store.list_profiles(), [self.default_profile])
        preset = self.store.create("Default preset", "prompt")
        self.assertEqual(preset["profile_id"], PresetStore.DEFAULT_PROFILE_ID)
        with self.assertRaises(PresetValidationError):
            self.store.update_profile(PresetStore.DEFAULT_PROFILE_ID, "Renamed")
        with self.assertRaises(PresetValidationError):
            self.store.delete_profile(PresetStore.DEFAULT_PROFILE_ID)

        remaining = self.store.create_profile("Remaining")
        with self.assertRaises(PresetValidationError):
            self.store.delete_profile(PresetStore.DEFAULT_PROFILE_ID)
        self.assertEqual(self.store.list_profiles(), [self.default_profile, remaining])

    def test_profile_delete_also_deletes_its_presets(self):
        anime = self.store.create_profile("Anime")
        photo = self.store.create_profile("Photo")
        deleted_one = self.store.create("A", "alpha", anime["id"])
        deleted_two = self.store.create("B", "beta", anime["id"])
        retained = self.store.create("C", "gamma", photo["id"])

        selected = [deleted_one["id"], retained["id"], deleted_two["id"]]
        self.assertEqual(self.store.delete_profile(anime["id"]), 2)
        self.assertEqual(self.store.list_profiles(), [self.default_profile, photo])
        self.assertEqual(self.store.list(), [retained])
        self.assertEqual(self.store.join_selected(selected), "gamma")
        with self.assertRaises(ProfileNotFoundError):
            self.store.delete_profile(anime["id"])

    def test_multi_select_joins_in_applied_order(self):
        first = self.store.create("First", "one")
        second = self.store.create("Second", "two")
        third = self.store.create("Third", "three")

        # The workflow-local selection order is also the applied/displayed order.
        selected = json.dumps([third["id"], first["id"], second["id"]])
        self.assertEqual(self.store.join_selected(selected), "three, one, two")

        self.store.reorder([third["id"], first["id"], second["id"]])
        self.assertEqual(self.store.join_selected(selected), "three, one, two")

    def test_selected_prompts_support_all_output_separators(self):
        first = self.store.create("First", "one")
        second = self.store.create("Second", "two")
        selected = [first["id"], second["id"]]

        self.assertEqual(self.store.join_selected(selected, "comma"), "one, two")
        self.assertEqual(self.store.join_selected(selected, "newline"), "one\ntwo")
        self.assertEqual(
            self.store.join_selected(selected, "comma_newline"),
            "one,\ntwo",
        )
        self.assertEqual(self.store.join_selected(selected, "invalid"), "one, two")

        execution_selection = json.dumps(
            {"ids": selected, "separator": "comma_newline"}
        )
        self.assertEqual(self.store.join_selected(execution_selection), "one,\ntwo")

    def test_change_token_includes_the_output_separator(self):
        preset = self.store.create("First", "one")
        selected = [preset["id"]]

        comma_token = self.store.change_token(
            {"ids": selected, "separator": "comma"}
        )
        newline_token = self.store.change_token(
            {"ids": selected, "separator": "newline"}
        )

        self.assertNotEqual(comma_token, newline_token)

    def test_reorder_requires_every_id_exactly_once(self):
        first = self.store.create("First", "one")
        second = self.store.create("Second", "two")
        with self.assertRaises(PresetValidationError):
            self.store.reorder([first["id"]])
        with self.assertRaises(PresetValidationError):
            self.store.reorder([first["id"], first["id"]])
        self.assertEqual([item["id"] for item in self.store.list()], [first["id"], second["id"]])

    def test_external_json_change_is_reloaded(self):
        preset = self.store.create("Before", "old")
        document = json.loads(self.path.read_text(encoding="utf-8"))
        document["presets"][0]["name"] = "After external edit"
        document["presets"][0]["prompt"] = "new"
        self.path.write_text(json.dumps(document), encoding="utf-8")

        self.assertEqual(self.store.list()[0]["name"], "After external edit")
        self.assertEqual(self.store.join_selected([preset["id"]]), "new")

    def test_two_workflows_share_content_and_keep_independent_selections(self):
        first = self.store.create("A", "alpha")
        second = self.store.create("B", "beta")
        workflow_one_selection = json.dumps([first["id"], second["id"]])
        workflow_two_selection = json.dumps([second["id"], first["id"]])

        reloaded_shared_store = PresetStore(self.path)
        self.assertEqual(
            reloaded_shared_store.join_selected(workflow_one_selection),
            "alpha, beta",
        )
        self.assertEqual(
            reloaded_shared_store.join_selected(workflow_two_selection),
            "beta, alpha",
        )
        self.assertNotIn("alpha", workflow_one_selection)
        self.assertNotIn("beta", workflow_two_selection)

    def test_validation_and_invalid_selection(self):
        with self.assertRaises(PresetValidationError):
            self.store.create("   ", "prompt")
        with self.assertRaises(PresetValidationError):
            self.store.create("name", 123)
        self.assertEqual(self.store.join_selected("not-json"), "")

    def test_comfy_user_directory_is_used_for_shared_storage(self):
        user_directory = Path(self.temp_directory.name) / "user"
        fake_folder_paths = types.ModuleType("folder_paths")
        fake_folder_paths.get_user_directory = lambda: str(user_directory)

        with patch.dict(sys.modules, {"folder_paths": fake_folder_paths}):
            resolved = resolve_preset_file()

        self.assertEqual(resolved, user_directory / "simple_preset" / "presets.json")

    def test_content_update_keeps_the_existing_profile_when_not_specified(self):
        profile = self.store.create_profile("Photo")
        preset = self.store.create("Portrait", "before", profile["id"])
        updated = self.store.update(preset["id"], "Portrait", "after")
        self.assertEqual(updated["profile_id"], profile["id"])
        self.assertEqual(PresetStore(self.path).list(), [updated])

    def test_failed_writes_leave_memory_and_disk_unchanged(self):
        profile = self.store.create_profile("Photo")
        first = self.store.create("First", "one", profile["id"])
        second = self.store.create("Second", "two")
        operations = {
            "create": lambda: self.store.create("Failed", "unsaved"),
            "update": lambda: self.store.update(first["id"], "Changed", "unsaved"),
            "delete": lambda: self.store.delete(first["id"]),
            "reorder": lambda: self.store.reorder([second["id"], first["id"]]),
            "create_profile": lambda: self.store.create_profile("Unsaved"),
            "update_profile": lambda: self.store.update_profile(profile["id"], "Changed"),
            "delete_profile": lambda: self.store.delete_profile(profile["id"]),
        }
        for name, operation in operations.items():
            with self.subTest(operation=name):
                store = PresetStore(self.path)
                self.store = store
                before = store.snapshot()
                disk_before = self.path.read_bytes()
                with patch("preset_store.os.replace", side_effect=OSError("Disk error")):
                    with self.assertRaises(OSError):
                        operation()
                self.assertEqual(store.snapshot(), before)
                self.assertEqual(self.path.read_bytes(), disk_before)
                self.assertEqual(list(self.path.parent.glob("*.tmp")), [])
                store.create("Successful", "saved")
                self.assertEqual(PresetStore(self.path).list(), store.list())
                # Keep each failure independent of earlier successful writes.
                self.path.write_bytes(disk_before)

    def test_same_size_external_edits_with_preserved_mtime_are_reloaded(self):
        import os

        preset = self.store.create("Name", "old")
        before = self.path.stat()
        token = self.store.change_token([preset["id"]])
        text = self.path.read_text(encoding="utf-8").replace('"old"', '"new"')
        self.path.write_text(text, encoding="utf-8")
        os.utime(self.path, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.assertEqual(self.store.join_selected([preset["id"]]), "new")
        self.assertNotEqual(self.store.change_token([preset["id"]]), token)

    def test_external_edit_immediately_after_atomic_replace_is_not_missed(self):
        import os

        replace = os.replace

        def replace_then_edit(source, destination):
            replace(source, destination)
            document = json.loads(self.path.read_text(encoding="utf-8"))
            document["presets"][0]["prompt"] = "external"
            self.path.write_text(json.dumps(document), encoding="utf-8")

        with patch("preset_store.os.replace", side_effect=replace_then_edit):
            preset = self.store.create("Name", "original")
        self.assertEqual(self.store.join_selected([preset["id"]]), "external")

    def test_snapshot_revisions_increase_for_writes_and_external_reload(self):
        before = self.store.snapshot()
        self.store.create("A", "one")
        after = self.store.snapshot()
        self.assertEqual(before["store_id"], after["store_id"])
        self.assertGreater(after["revision"], before["revision"])
        document = json.loads(self.path.read_text(encoding="utf-8"))
        document["presets"][0]["prompt"] = "external"
        self.path.write_text(json.dumps(document), encoding="utf-8")
        self.assertGreater(self.store.snapshot()["revision"], after["revision"])
        self.assertNotIn("revision", json.loads(self.path.read_text(encoding="utf-8")))

    def test_selection_handles_empty_deleted_duplicate_and_invalid_ids(self):
        first = self.store.create("Unicode 🐱", "猫、é\nline")
        empty = self.store.create("Empty", "")
        second = self.store.create("Second", "two")
        selection = [first["id"], "deleted", first["id"], None, 42, empty["id"], second["id"]]
        self.assertEqual(self.store.join_selected(selection), "猫、é\nline, two")
        self.assertEqual(self.store.join_selected({"ids": selection, "separator": "newline"}), "猫、é\nline\ntwo")
        for invalid in (None, 42, True, {}, '{"ids":null}', "null", '"text"'):
            with self.subTest(selection=invalid):
                self.assertEqual(self.store.join_selected(invalid), "")
        self.assertEqual(PresetStore(self.path).list()[0], first)

    def test_size_limits_are_enforced_without_changing_the_document(self):
        for name, prompt in (("x" * 121, "ok"), ("ok", "x" * 100_001)):
            with self.subTest(name_length=len(name), prompt_length=len(prompt)):
                before = self.store.snapshot()
                with self.assertRaises(PresetValidationError):
                    self.store.create(name, prompt)
                self.assertEqual(self.store.snapshot(), before)
        with patch.object(PresetStore, "MAX_PRESETS", 1):
            self.store.create("Allowed", "one")
            with self.assertRaises(PresetValidationError):
                self.store.create("Too many", "two")
        with patch.object(PresetStore, "MAX_PROFILES", 1):
            with self.assertRaises(PresetValidationError):
                self.store.create_profile("Too many")

    def test_concurrent_writes_do_not_lose_presets(self):
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=4) as executor:
            presets = list(executor.map(lambda i: self.store.create(f"Preset {i}", str(i)), range(20)))
        self.assertEqual({item["id"] for item in self.store.list()}, {item["id"] for item in presets})
        self.assertEqual(PresetStore(self.path).list(), self.store.list())

    def test_corrupt_file_can_be_repaired_without_recreating_the_store(self):
        original = self.path.read_bytes()
        self.path.write_bytes(b"{broken")
        for _ in range(2):
            with self.assertRaises(PresetValidationError):
                self.store.list()
        self.assertEqual(self.path.read_bytes(), b"{broken")
        self.path.write_bytes(original)
        self.assertEqual(self.store.list(), [])

    def test_document_validation_rejects_invalid_versions_and_references(self):
        valid = json.loads(self.path.read_text(encoding="utf-8"))
        for version in (None, True, 1.0, 2, "3", 4):
            with self.subTest(version=version):
                invalid = dict(valid, version=version)
                with self.assertRaises(PresetValidationError):
                    PresetStore._validate_document(invalid)
        for invalid in (
            [], dict(valid, profiles=[]), dict(valid, profiles="wrong"),
            dict(valid, profiles=[self.default_profile, self.default_profile]),
            dict(valid, profiles=[{"id": "photo", "name": "Photo"}]),
            dict(valid, profiles=[dict(self.default_profile, name="Renamed")]),
            dict(valid, profiles=[self.default_profile, {"id": "__all_profiles__", "name": "Reserved"}]),
            dict(valid, presets=[{"id": "a", "name": "A", "prompt": "x", "profile_id": "missing"}]),
        ):
            with self.subTest(document=invalid):
                with self.assertRaises(PresetValidationError):
                    PresetStore._validate_document(invalid)

    def test_unpaired_surrogates_and_out_of_range_timestamps_are_validation_errors(self):
        for operation in (
            lambda: self.store.create("\ud800", "prompt"),
            lambda: self.store.create("Name", "\ud800"),
            lambda: self.store.create_profile("\ud800"),
            lambda: PresetStore._validate_timestamp("0001-01-01T00:00:00+01:00", ""),
            lambda: PresetStore._validate_timestamp("9999-12-31T23:59:59-01:00", ""),
        ):
            with self.subTest(operation=operation):
                with self.assertRaises(PresetValidationError):
                    operation()
        self.assertEqual(self.store.list(), [])

if __name__ == "__main__":
    unittest.main()
