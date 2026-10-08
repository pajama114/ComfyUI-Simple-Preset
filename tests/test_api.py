import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from test_node import package
from test_transfer import document, expected, preset

PresetStore = sys.modules[f"{package.__name__}.preset_store"].PresetStore

try:
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
except ImportError:
    web = None


@unittest.skipIf(web is None, "aiohttp is only installed with ComfyUI or the integration test environment")
class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "presets.json"
        self.store = PresetStore(self.path)
        self.messages = []
        self.instance = types.SimpleNamespace(
            routes=web.RouteTableDef(),
            send_sync=lambda event, payload: self.messages.append((event, payload)),
        )
        fake_server = types.ModuleType("server")
        fake_server.PromptServer = types.SimpleNamespace(instance=self.instance)
        self.server_patch = patch.dict(sys.modules, {"server": fake_server})
        self.store_patch = patch.object(package.api, "PRESET_STORE", self.store)
        self.server_patch.start()
        self.store_patch.start()
        self.addCleanup(self.server_patch.stop)
        self.addCleanup(self.store_patch.stop)
        self.addCleanup(self.directory.cleanup)
        self.assertTrue(package.api.register_routes())
        app = web.Application()
        app.add_routes(self.instance.routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_preset_and_profile_crud_order_join_and_shared_reload(self):
        response = await self.client.post("/simple-preset/profiles", json={"name": "Photo"})
        self.assertEqual(response.status, 201)
        profile_id = (await response.json())["created_profile_id"]
        ids = []
        for name, prompt in (("First", "one"), ("Second", "two")):
            response = await self.client.post("/simple-preset/presets", json={
                "name": name, "prompt": prompt, "profile_id": profile_id,
            })
            self.assertEqual(response.status, 201)
            ids.append((await response.json())["presets"][-1]["id"])
        response = await self.client.put(f"/simple-preset/presets/{ids[0]}", json={
            "changes": {"name": "Updated", "prompt": "changed"},
            "expected": {"name": "First", "prompt": "one"},
        })
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["presets"][0]["profile_id"], profile_id)
        response = await self.client.post("/simple-preset/order", json={"ids": ids[::-1]})
        self.assertEqual(response.status, 200)
        self.assertEqual([item["id"] for item in (await response.json())["presets"]], ids[::-1])
        self.assertEqual(PresetStore(self.path).join_selected(ids), "changed, two")
        self.assertEqual(PresetStore(self.path).join_selected(ids[::-1]), "two, changed")
        response = await self.client.put(f"/simple-preset/profiles/{profile_id}", json={"name": "Portraits"})
        self.assertEqual(response.status, 200)
        response = await self.client.delete(f"/simple-preset/presets/{ids[1]}")
        self.assertEqual(response.status, 200)
        response = await self.client.delete(f"/simple-preset/profiles/{profile_id}")
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["deleted_presets"], 1)
        self.assertEqual(PresetStore(self.path).list(), [])
        self.assertEqual(len(self.messages), 8)
        self.assertTrue(all(event == "simple_preset.changed" for event, _ in self.messages))
        self.assertEqual(len({data["revision"] for _, data in self.messages}), 8)

    async def test_invalid_requests_return_json_without_changing_presets(self):
        cases = [
            ("POST", "/presets", None),
            ("POST", "/presets", []),
            ("POST", "/presets", {"name": " ", "prompt": "x"}),
            ("POST", "/presets", {"name": "x", "prompt": 42}),
            ("POST", "/presets", {"name": "x", "prompt": "\ud800"}),
            ("POST", "/profiles", {"name": "default"}),
            ("POST", "/order", {"ids": ["unknown"]}),
            ("PUT", "/profiles/default", {"name": "Renamed"}),
            ("DELETE", "/profiles/default", {}),
        ]
        for method, path, payload in cases:
            with self.subTest(path=path, payload=payload):
                response = await self.client.request(method, f"/simple-preset{path}", data=json.dumps(payload))
                self.assertEqual(response.status, 400)
                self.assertIn("error", await response.json())
        response = await self.client.post("/simple-preset/presets", data="{broken")
        self.assertEqual(response.status, 400)
        self.assertIn("error", await response.json())
        self.assertEqual(self.store.list(), [])
        self.assertEqual(self.messages, [])

    async def test_field_edits_merge_across_tabs_and_conflicts_do_not_broadcast_or_partially_save(self):
        original = self.store.create("Before", "old")
        path = f"/simple-preset/presets/{original['id']}"
        response = await self.client.put(path, json={
            "changes": {"prompt": "from A"}, "expected": {"prompt": "old"},
        })
        self.assertEqual(response.status, 200)
        response = await self.client.put(path, json={
            "changes": {"name": "from B"}, "expected": {"name": "Before"},
        })
        self.assertEqual(response.status, 200)
        merged = (await response.json())["presets"][0]
        self.assertEqual((merged["name"], merged["prompt"]), ("from B", "from A"))
        before = self.store.snapshot()
        disk_before = self.path.read_bytes()
        response = await self.client.put(path, json={
            "changes": {"name": "unsaved", "prompt": "from B"},
            "expected": {"name": "from B", "prompt": "old"},
        })
        self.assertEqual(response.status, 409)
        conflict = await response.json()
        self.assertEqual(conflict["fields"], ["prompt"])
        self.assertEqual(conflict["current"], merged)
        self.assertEqual(conflict["snapshot"], before)
        self.assertEqual(self.store.snapshot(), before)
        self.assertEqual(self.path.read_bytes(), disk_before)
        self.assertEqual(len(self.messages), 2)
        response = await self.client.put(path, json={
            "changes": {"prompt": "from B"}, "expected": {"prompt": "from A"},
        })
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["presets"][0]["prompt"], "from B")
        self.assertEqual(len(self.messages), 3)

    async def test_field_edits_require_original_values_for_all_changed_fields(self):
        original = self.store.create("Before", "old")
        path = f"/simple-preset/presets/{original['id']}"
        for payload in (
            {"name": "Renamed", "prompt": "new"},
            {"changes": {"name": "Renamed"}},
            {"changes": {"name": "Renamed"}, "expected": {}},
            {"changes": {"updated_at": "fake"}, "expected": {"updated_at": original["updated_at"]}},
        ):
            with self.subTest(payload=payload):
                response = await self.client.put(path, json=payload)
                self.assertEqual(response.status, 400)
                self.assertIn("error", await response.json())
        self.assertEqual(self.store.list(), [original])
        self.assertEqual(self.messages, [])

    async def test_missing_resources_return_404(self):
        for path in ("presets/missing", "profiles/missing"):
            for method in ("PUT", "DELETE"):
                response = await self.client.request(method, f"/simple-preset/{path}", json={"name": "x", "prompt": "x"})
                self.assertEqual(response.status, 404)
                self.assertIn("error", await response.json())
        response = await self.client.post("/simple-preset/presets", json={
            "name": "x", "prompt": "x", "profile_id": "missing",
        })
        self.assertEqual(response.status, 404)

    async def test_disk_failure_is_json_and_does_not_broadcast_or_commit(self):
        before = self.store.snapshot()
        with patch.object(sys.modules[PresetStore.__module__].os, "replace", side_effect=OSError("disk full")):
            response = await self.client.post("/simple-preset/presets", json={"name": "x", "prompt": "x"})
        self.assertEqual(response.status, 500)
        self.assertIn("disk full", (await response.json())["error"])
        self.assertEqual(self.store.snapshot(), before)
        self.assertEqual(PresetStore(self.path).list(), [])
        self.assertEqual(self.messages, [])

    async def test_corrupt_storage_is_reported_and_recovers_after_repair(self):
        original = self.path.read_bytes()
        for invalid in (b"{broken", b"\xff\xfe"):
            self.path.write_bytes(invalid)
            response = await self.client.get("/simple-preset/presets")
            self.assertEqual(response.status, 400)
            self.assertIn("error", await response.json())
            self.assertEqual(self.path.read_bytes(), invalid)
        self.path.write_bytes(original)
        response = await self.client.get("/simple-preset/presets")
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["presets"], [])

    async def test_notification_failure_does_not_fail_a_successful_save(self):
        def fail(*_args):
            raise RuntimeError("websocket disconnected")
        self.instance.send_sync = fail
        response = await self.client.post("/simple-preset/presets", json={"name": "x", "prompt": "saved"})
        self.assertEqual(response.status, 201)
        self.assertEqual(PresetStore(self.path).list()[0]["prompt"], "saved")

    async def test_export_and_additive_import_preview_then_commit(self):
        old = self.store.create("Local", "one")
        profile = self.store.create_profile("Photo")
        incoming = document(preset("foreign", "持ち込み", profile_id="photo"),
                            profiles=[{"id": "photo", "name": "Photo"}])
        response = await self.client.post("/simple-preset/import/preview", json={"document": incoming})
        self.assertEqual(response.status, 200)
        preview = await response.json()
        self.assertEqual(preview["added"][0]["profile_id"], profile["id"])
        self.assertEqual(self.store.list(), [old])
        self.assertEqual(self.messages, [])
        response = await self.client.post("/simple-preset/import", json={
            "document": incoming, "resolutions": {}, "expected": expected(preview),
        })
        self.assertEqual(response.status, 200)
        result = await response.json()
        self.assertEqual(result["import_result"]["added"], 1)
        self.assertEqual([p["id"] for p in result["presets"]], [old["id"], "foreign"])
        self.assertEqual(self.messages, [("simple_preset.changed", result)])
        response = await self.client.get("/simple-preset/export")
        full = await response.json()
        self.assertEqual(full, self.store.export_document())
        response = await self.client.get("/simple-preset/export", params={"profile_id": profile["id"]})
        scoped = await response.json()
        self.assertEqual([p["id"] for p in scoped["presets"]], ["foreign"])
        response = await self.client.get("/simple-preset/export?profile_id=missing")
        self.assertEqual(response.status, 404)

    async def test_import_conflicts_and_stale_reviews_return_409_with_fresh_preview(self):
        self.store.import_document(document(preset("a", "existing")))
        incoming = document(preset("a", "imported"))
        response = await self.client.post("/simple-preset/import", json={"document": incoming})
        self.assertEqual(response.status, 409)
        preview = (await response.json())["preview"]
        self.assertEqual(preview["conflicts"][0]["existing"]["prompt"], "existing")
        self.store.update("a", {"prompt": "edited during review"}, {"prompt": "existing"})
        response = await self.client.post("/simple-preset/import", json={
            "document": incoming, "resolutions": {"a": "overwrite"}, "expected": expected(preview),
        })
        self.assertEqual(response.status, 409)
        fresh = (await response.json())["preview"]
        self.assertEqual(fresh["conflicts"][0]["existing"]["prompt"], "edited during review")
        self.assertEqual(self.messages, [])
        response = await self.client.post("/simple-preset/import", json={
            "document": incoming, "resolutions": {"a": "overwrite"}, "expected": expected(fresh),
        })
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())["import_result"]["updated"], 1)
        self.assertEqual(self.store.list()[0]["prompt"], "imported")
        self.assertEqual(len(self.messages), 1)

    async def test_invalid_import_and_failed_disk_write_do_not_commit_or_broadcast(self):
        before = self.store.snapshot()
        for route in ("/simple-preset/import/preview", "/simple-preset/import"):
            for payload in ({}, {"document": []}, {"document": document(preset("a", "\ud800"))}):
                response = await self.client.post(route, json=payload)
                self.assertEqual(response.status, 400)
                self.assertIn("error", await response.json())
        with patch.object(sys.modules[PresetStore.__module__].os, "replace", side_effect=OSError("disk full")):
            response = await self.client.post("/simple-preset/import", json={"document": document(preset("a", "one"))})
        self.assertEqual(response.status, 500)
        self.assertEqual(self.store.snapshot(), before)
        self.assertEqual(self.messages, [])
