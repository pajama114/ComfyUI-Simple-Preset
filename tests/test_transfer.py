import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from preset_store import PresetImportConflictError, PresetStore, PresetValidationError


DEFAULT = {"id": "default", "name": "Default"}


def preset(preset_id, prompt, name="Example", profile_id="default"):
    return {"id": preset_id, "name": name, "prompt": prompt, "profile_id": profile_id}


def document(*presets, profiles=()):
    return {"version": 3, "profiles": [DEFAULT, *profiles], "presets": list(presets)}


def expected(preview):
    return {key: preview[key] for key in ("store_id", "revision")}


class PresetTransferTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "presets.json"
        self.store = PresetStore(self.path)

    def test_exports_preserve_ids_order_and_empty_profiles_without_server_metadata(self):
        photo = self.store.create_profile("写真")
        empty = self.store.create_profile("Empty")
        first = self.store.create("First", "one")
        second = self.store.create("Second", "two", photo["id"])
        full = self.store.export_document()
        self.assertEqual(set(full), {"version", "profiles", "presets"})
        self.assertEqual(full["presets"], [first, second])
        self.assertIn(empty, full["profiles"])
        scoped = self.store.export_document(photo["id"])
        self.assertEqual(scoped["profiles"], [DEFAULT, photo])
        self.assertEqual(scoped["presets"], [second])
        full["presets"][0]["prompt"] = "changed copy"
        self.assertEqual(self.store.list()[0]["prompt"], "one")

    def test_portable_workflow_runs_without_reading_or_writing_shared_storage(self):
        path = Path(self.directory.name) / "recipient" / "presets.json"
        recipient = PresetStore(path, load_on_init=False)
        workflow = json.dumps({"ids": ["b", "a"], "separator": "period",
                               "bundle": document(preset("a", "A quiet room."), preset("b", "Sunlight enters"))})
        with patch.object(recipient, "_reload_if_changed", side_effect=AssertionError("shared read")):
            self.assertEqual(recipient.join_selected(workflow), "Sunlight enters. A quiet room.")
            self.assertEqual(recipient.change_token(workflow), recipient.change_token(workflow))
        self.assertFalse(path.exists())
        path.parent.mkdir()
        path.write_text("{broken", encoding="utf-8")
        self.assertEqual(recipient.join_selected(workflow), "Sunlight enters. A quiet room.")
        self.assertEqual(path.read_text(encoding="utf-8"), "{broken")

    def test_bundle_takes_precedence_and_cache_is_independent_of_shared_changes(self):
        self.store.import_document(document(preset("a", "shared"), preset("b", "second")))
        workflow = {"ids": ["a"], "separator": "comma", "bundle": document(preset("a", "embedded"))}
        token = self.store.change_token(workflow)
        self.assertEqual(self.store.join_selected(workflow), "embedded")
        self.store.update("a", {"name": "Renamed", "prompt": "new shared"},
                          {"name": "Example", "prompt": "shared"})
        self.assertEqual(self.store.change_token(workflow), token)
        self.assertEqual(self.store.join_selected(workflow), "embedded")
        self.assertEqual(self.store.list()[0]["prompt"], "new shared")
        workflow["bundle"]["presets"][0]["prompt"] = "edited embedded"
        self.assertNotEqual(self.store.change_token(workflow), token)
        workflow["ids"].append("b")
        self.assertEqual(self.store.join_selected(workflow), "edited embedded, second")
        self.store.update("b", {"name": "Second", "prompt": "updated second"},
                          {"name": "Example", "prompt": "second"})
        self.assertEqual(self.store.join_selected(workflow), "edited embedded, updated second")

    def test_invalid_or_incomplete_workflow_bundle_never_outputs_partial_text(self):
        workflow = {"ids": ["a", "missing"], "bundle": document(preset("a", "one"))}
        with self.assertRaisesRegex(PresetValidationError, "missing"):
            self.store.join_selected(workflow)
        for invalid in (None, {}, document(preset("a", 42)), document(preset("a", "one", profile_id="unknown"))):
            with self.subTest(bundle=invalid), self.assertRaises(PresetValidationError):
                self.store.join_selected({"ids": ["a"], "bundle": invalid})

    def test_preview_is_read_only_and_additive_import_preserves_ids_and_order(self):
        old = self.store.create("Local", "local")
        incoming = document(preset("b", "two"), preset("a", "one"))
        before = self.path.read_bytes()
        preview = self.store.preview_import(incoming)
        self.assertEqual([p["id"] for p in preview["added"]], ["b", "a"])
        self.assertEqual(self.path.read_bytes(), before)
        summary = self.store.import_document(incoming, expected=expected(preview))
        self.assertEqual(summary, {"added": 2, "updated": 0, "skipped": 0, "profiles_added": 0})
        self.assertEqual([p["id"] for p in PresetStore(self.path).list()], [old["id"], "b", "a"])
        stored = self.store.snapshot()
        self.assertEqual(self.store.preview_import(incoming)["unchanged"], ["b", "a"])
        self.assertEqual(self.store.import_document(incoming)["skipped"], 2)
        self.assertEqual(self.store.snapshot(), stored)

    def test_conflicts_require_explicit_choices_and_keep_or_update_existing_ids(self):
        self.store.import_document(document(preset("a", "old"), preset("b", "old")))
        incoming = document(preset("a", "new"), preset("b", "new"), preset("c", "added"))
        before = self.path.read_bytes()
        with self.assertRaises(PresetImportConflictError) as error:
            self.store.import_document(incoming)
        self.assertEqual(len(error.exception.preview["conflicts"]), 2)
        self.assertEqual(self.path.read_bytes(), before)
        for choices in ({"a": "overwrite"}, {"a": "invalid", "b": "keep"}, {"a": "keep", "b": "keep", "c": "keep"}):
            with self.subTest(choices=choices), self.assertRaises(PresetValidationError):
                self.store.import_document(incoming, choices)
        result = self.store.import_document(incoming, {"a": "keep", "b": "overwrite"})
        self.assertEqual(result, {"added": 1, "updated": 1, "skipped": 1, "profiles_added": 0})
        self.assertEqual([p["prompt"] for p in self.store.list()], ["old", "new", "added"])

    def test_profiles_merge_by_id_then_case_insensitive_name(self):
        photo = self.store.create_profile("Photo")
        incoming = document(preset("same-name", "one", profile_id="foreign-photo"),
                            preset("same-id", "two", profile_id=photo["id"]),
                            preset("new", "three", profile_id="new-profile"), profiles=[
                                {"id": "foreign-photo", "name": "PHOTO"},
                                {"id": photo["id"], "name": "Old profile name"},
                                {"id": "new-profile", "name": "New"},
                            ])
        self.store.import_document(incoming)
        self.assertEqual([p["profile_id"] for p in self.store.list()], [photo["id"], photo["id"], "new-profile"])
        self.assertEqual(self.store.list_profiles(), [DEFAULT, photo, {"id": "new-profile", "name": "New"}])

    def test_portable_profiles_with_same_name_merge_into_one_shared_profile(self):
        profiles = [{"id": "x", "name": "Photo"}, {"id": "y", "name": "Photo"}]
        incoming = document(preset("a", "one", profile_id="x"), preset("b", "two", profile_id="y"), profiles=profiles)
        self.store.import_document(incoming)
        self.assertEqual(self.store.list_profiles(), [DEFAULT, profiles[0]])
        self.assertEqual([p["profile_id"] for p in self.store.list()], ["x", "x"])

    def test_stale_preview_is_rejected_even_if_new_choices_would_overwrite(self):
        self.store.import_document(document(preset("a", "old")))
        incoming = document(preset("a", "incoming"))
        preview = self.store.preview_import(incoming)
        self.store.update("a", {"prompt": "changed while reviewing"}, {"prompt": "old"})
        before = self.path.read_bytes()
        with self.assertRaises(PresetImportConflictError) as error:
            self.store.import_document(incoming, {"a": "overwrite"}, expected(preview))
        fresh = error.exception.preview
        self.assertNotEqual(expected(fresh), expected(preview))
        self.assertEqual(fresh["conflicts"][0]["existing"]["prompt"], "changed while reviewing")
        self.assertEqual(self.path.read_bytes(), before)
        self.store.import_document(incoming, {"a": "overwrite"}, expected(fresh))
        self.assertEqual(self.store.list()[0]["prompt"], "incoming")

    def test_import_validation_and_disk_failures_leave_existing_library_intact(self):
        self.store.import_document(document(preset("a", "one")))
        before = self.store.snapshot()
        invalids = [None, document(preset("a", "one"), preset("a", "two")),
                    document(preset("b", "\ud800")), {"version": 900, "presets": []}]
        for invalid in invalids:
            with self.subTest(document=invalid), self.assertRaises(PresetValidationError):
                self.store.import_document(invalid)
        with patch("preset_store.os.replace", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(OSError, "disk full"):
                self.store.import_document(document(preset("b", "two")))
        self.assertEqual(self.store.snapshot(), before)
        self.assertEqual(PresetStore(self.path).list(), before["presets"])
        with patch.object(self.store, "MAX_PRESETS", 1):
            with self.assertRaisesRegex(PresetValidationError, "exceed"):
                self.store.preview_import(document(preset("b", "two")))

    def test_legacy_exports_can_be_imported_and_reexported_in_current_format(self):
        incoming = {"version": 1, "presets": [{"id": "legacy", "name": "Legacy", "prompt": "saved"}]}
        self.store.import_document(incoming)
        exported = self.store.export_document()
        self.assertEqual(exported["version"], 3)
        self.assertEqual(exported["presets"][0]["id"], "legacy")
        self.assertEqual(exported["presets"][0]["profile_id"], "default")
