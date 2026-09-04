import json
import importlib.util
import sys
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

    def test_change_token_receives_execution_selection(self):
        selected = '{"ids":["first"],"separator":"comma_newline"}'
        with patch.object(nodes.PRESET_STORE, "change_token", return_value="token") as token:
            result = nodes.SimplePreset.IS_CHANGED(selected)

        self.assertEqual(result, "token")
        token.assert_called_once_with(selected)

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
            ],
        )


if __name__ == "__main__":
    unittest.main()
