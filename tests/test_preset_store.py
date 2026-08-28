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

    def test_multi_select_joins_in_display_order(self):
        first = self.store.create("First", "one")
        second = self.store.create("Second", "two")
        third = self.store.create("Third", "three")

        # Click/selection order is deliberately different from display order.
        selected = json.dumps([third["id"], first["id"], second["id"]])
        self.assertEqual(self.store.join_selected(selected), "one, two, three")

        self.store.reorder([third["id"], first["id"], second["id"]])
        self.assertEqual(self.store.join_selected(selected), "three, one, two")

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
        workflow_one_selection = json.dumps([first["id"]])
        workflow_two_selection = json.dumps([second["id"]])

        reloaded_shared_store = PresetStore(self.path)
        self.assertEqual(reloaded_shared_store.join_selected(workflow_one_selection), "alpha")
        self.assertEqual(reloaded_shared_store.join_selected(workflow_two_selection), "beta")
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

if __name__ == "__main__":
    unittest.main()
