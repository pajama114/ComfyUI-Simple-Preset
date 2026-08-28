"""HTTP routes used by the Simple Preset frontend."""

from __future__ import annotations

from .preset_store import PRESET_STORE, PresetNotFoundError, PresetValidationError


def register_routes() -> bool:
    """Register routes when imported by ComfyUI; remain importable in plain Python."""
    try:
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return False

    if getattr(PromptServer.instance, "_simple_preset_routes_registered", False):
        return True

    routes = PromptServer.instance.routes

    def response_payload():
        return {"version": PRESET_STORE.VERSION, "presets": PRESET_STORE.list()}

    def notify_clients():
        try:
            PromptServer.instance.send_sync("simple_preset.changed", response_payload())
        except (AttributeError, RuntimeError):
            # A response still updates the initiating client; notification is best effort.
            pass

    async def read_json(request):
        try:
            payload = await request.json()
        except Exception as error:
            raise PresetValidationError("Request body must be valid JSON.") from error
        if not isinstance(payload, dict):
            raise PresetValidationError("Request body must be a JSON object.")
        return payload

    def error_response(error):
        if isinstance(error, PresetNotFoundError):
            return web.json_response({"error": "Preset not found."}, status=404)
        return web.json_response({"error": str(error)}, status=400)

    @routes.get("/simple-preset/presets")
    async def get_presets(_request):
        try:
            return web.json_response(response_payload())
        except PresetValidationError as error:
            return error_response(error)

    @routes.post("/simple-preset/presets")
    async def create_preset(request):
        try:
            payload = await read_json(request)
            PRESET_STORE.create(payload.get("name"), payload.get("prompt"))
            result = response_payload()
            notify_clients()
            return web.json_response(result, status=201)
        except PresetValidationError as error:
            return error_response(error)

    @routes.put("/simple-preset/presets/{preset_id}")
    async def update_preset(request):
        try:
            payload = await read_json(request)
            PRESET_STORE.update(
                request.match_info["preset_id"], payload.get("name"), payload.get("prompt")
            )
            result = response_payload()
            notify_clients()
            return web.json_response(result)
        except (PresetValidationError, PresetNotFoundError) as error:
            return error_response(error)

    @routes.delete("/simple-preset/presets/{preset_id}")
    async def delete_preset(request):
        try:
            PRESET_STORE.delete(request.match_info["preset_id"])
            result = response_payload()
            notify_clients()
            return web.json_response(result)
        except (PresetValidationError, PresetNotFoundError) as error:
            return error_response(error)

    @routes.post("/simple-preset/order")
    async def reorder_presets(request):
        try:
            payload = await read_json(request)
            PRESET_STORE.reorder(payload.get("ids"))
            result = response_payload()
            notify_clients()
            return web.json_response(result)
        except PresetValidationError as error:
            return error_response(error)

    PromptServer.instance._simple_preset_routes_registered = True
    return True
