import json
import importlib.util
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_NAME = "simple_preset_test_package"
spec = importlib.util.spec_from_file_location(
    PACKAGE_NAME,
    PACKAGE_ROOT / "__init__.py",
    submodule_search_locations=[str(PACKAGE_ROOT)],
)
package = importlib.util.module_from_spec(spec)
sys.modules[PACKAGE_NAME] = package
assert spec.loader is not None
spec.loader.exec_module(package)
nodes = sys.modules[f"{PACKAGE_NAME}.nodes"]


class SimplePresetNodeTests(unittest.TestCase):
    def test_node_import_survives_corrupt_shared_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = Path(directory) / "simple_preset" / "presets.json"
            storage.parent.mkdir()
            storage.write_text("{broken", encoding="utf-8")
            script = """
import importlib.util, sys, types
from pathlib import Path
folder_paths = types.ModuleType('folder_paths')
folder_paths.get_user_directory = lambda: sys.argv[1]
sys.modules['folder_paths'] = folder_paths
root = Path(sys.argv[2])
spec = importlib.util.spec_from_file_location('isolated_preset', root / '__init__.py', submodule_search_locations=[str(root)])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
assert module.NODE_CLASS_MAPPINGS['SimplePreset'].RETURN_TYPES == ('STRING',)
assert module.WEB_DIRECTORY == './web'
"""
            result = subprocess.run(
                [sys.executable, "-c", script, directory, str(PACKAGE_ROOT)],
                text=True, capture_output=True, timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(storage.read_text(encoding="utf-8"), "{broken")

    def test_node_registration_and_output_contract(self):
        self.assertIs(nodes.NODE_CLASS_MAPPINGS["SimplePreset"], nodes.SimplePreset)
        self.assertEqual(nodes.SimplePreset.RETURN_TYPES, ("STRING",))
        self.assertEqual(nodes.SimplePreset.FUNCTION, "build_prompt")

    def test_node_passes_execution_selection_to_store(self):
        selected = json.dumps({"ids": ["first", "second"], "separator": "newline"})
        with patch.object(nodes.PRESET_STORE, "join_selected", return_value="a\nb") as join:
            result = nodes.SimplePreset().build_prompt(selected)
        self.assertEqual(result, ("a\nb",))
        join.assert_called_once_with(selected)
        self.assertEqual(list(nodes.SimplePreset.INPUT_TYPES()["required"]), ["selected_presets"])

    def test_real_node_execution_and_cache_invalidation_share_presets_between_workflows(self):
        store_class = sys.modules[f"{PACKAGE_NAME}.preset_store"].PresetStore
        with tempfile.TemporaryDirectory() as directory:
            store = store_class(Path(directory) / "presets.json")
            first = store.create("First", "one")
            second = store.create("Second", "two")
            workflow_one = json.dumps({"ids": [first["id"], second["id"]], "separator": "newline"})
            workflow_two = json.dumps([second["id"], first["id"]])
            with patch.object(nodes, "PRESET_STORE", store):
                node = nodes.SimplePreset()
                self.assertEqual(node.build_prompt(workflow_one), ("one\ntwo",))
                self.assertEqual(node.build_prompt(workflow_two), ("two, one",))
                before = node.IS_CHANGED(workflow_one)
                store.update(first["id"], {"prompt": "updated"}, {"prompt": "one"})
                self.assertNotEqual(node.IS_CHANGED(workflow_one), before)
                self.assertEqual(node.build_prompt(workflow_one), ("updated\ntwo",))
                self.assertEqual(node.build_prompt(workflow_two), ("two, updated",))

    def test_saved_separators_execute_independently_and_invalidate_the_node_cache(self):
        store_class = sys.modules[f"{PACKAGE_NAME}.preset_store"].PresetStore
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "presets.json"
            store = store_class(path)
            first = store.create("First", "A quiet room.")
            second = store.create("Second", "Sunlight enters")
            ids = [first["id"], second["id"]]
            comma = json.dumps({"ids": ids, "separator": "comma"})
            period = json.dumps({"ids": ids, "separator": "period"})
            with patch.object(nodes, "PRESET_STORE", store_class(path)):
                node = nodes.SimplePreset()
                self.assertEqual(node.build_prompt(comma), ("A quiet room., Sunlight enters",))
                self.assertEqual(node.build_prompt(period), ("A quiet room. Sunlight enters",))
                self.assertNotEqual(node.IS_CHANGED(comma), node.IS_CHANGED(period))

    def test_change_token_receives_execution_selection(self):
        selected = '{"ids":["first"],"separator":"comma_newline"}'
        with patch.object(nodes.PRESET_STORE, "change_token", return_value="token") as token:
            result = nodes.SimplePreset.IS_CHANGED(selected)

        self.assertEqual(result, "token")
        token.assert_called_once_with(selected)

    def test_node_rejects_missing_presets_instead_of_outputting_a_partial_prompt(self):
        store_module = sys.modules[f"{PACKAGE_NAME}.preset_store"]
        with tempfile.TemporaryDirectory() as directory:
            store = store_module.PresetStore(Path(directory) / "presets.json")
            preset = store.create("Available", "one")
            selection = json.dumps({"ids": [preset["id"], "missing"], "separator": "newline"})
            with patch.object(nodes, "PRESET_STORE", store):
                with self.assertRaisesRegex(store_module.PresetValidationError, "missing"):
                    nodes.SimplePreset().build_prompt(selection)
                self.assertEqual(nodes.SimplePreset().build_prompt("[]"), ("",))

    def test_http_routes_register_with_comfy_server_contract(self):
        registered = []

        class FakeRoutes:
            @staticmethod
            def _decorator(method, path):
                def register(function):
                    registered.append((method, path, function.__name__))
                    return function

                return register

            def get(self, path):
                return self._decorator("GET", path)

            def post(self, path):
                return self._decorator("POST", path)

            def put(self, path):
                return self._decorator("PUT", path)

            def delete(self, path):
                return self._decorator("DELETE", path)

        fake_instance = types.SimpleNamespace(routes=FakeRoutes(), send_sync=lambda *_args: None)
        fake_server = types.ModuleType("server")
        fake_server.PromptServer = types.SimpleNamespace(instance=fake_instance)
        fake_aiohttp = types.ModuleType("aiohttp")
        fake_aiohttp.web = types.SimpleNamespace(json_response=lambda *args, **kwargs: (args, kwargs))

        with patch.dict(sys.modules, {"server": fake_server, "aiohttp": fake_aiohttp}):
            self.assertTrue(package.api.register_routes())
            self.assertTrue(package.api.register_routes())

        self.assertEqual(
            [(method, path) for method, path, _name in registered],
            [
                ("GET", "/simple-preset/presets"),
                ("POST", "/simple-preset/presets"),
                ("PUT", "/simple-preset/presets/{preset_id}"),
                ("DELETE", "/simple-preset/presets/{preset_id}"),
                ("POST", "/simple-preset/order"),
                ("POST", "/simple-preset/profiles"),
                ("PUT", "/simple-preset/profiles/{profile_id}"),
                ("DELETE", "/simple-preset/profiles/{profile_id}"),
                ("GET", "/simple-preset/export"),
                ("POST", "/simple-preset/import/preview"),
                ("POST", "/simple-preset/import"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
