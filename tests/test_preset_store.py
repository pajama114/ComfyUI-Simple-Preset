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
    resolve_preset_file,
)


class PresetStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.path = Path(self.temp_directory.name) / "presets.json"
        self.store = PresetStore(self.path)

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
