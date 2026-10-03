import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from test_node import package

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
            "name": "Updated", "prompt": "changed",
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
