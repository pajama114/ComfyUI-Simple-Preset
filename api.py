"""HTTP routes used by the Simple Preset frontend."""

from __future__ import annotations

from .preset_store import (
    PRESET_STORE,
    PresetImportConflictError,
    PresetNotFoundError,
    PresetValidationError,
    ProfileNotFoundError,
)


def register_routes() -> bool:
    """Register routes when imported by ComfyUI; remain importable in plain Python."""
    try:
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return False

    if getattr(PromptServer, "instance", None) is None:
        return False

    if getattr(PromptServer.instance, "_simple_preset_routes_registered", False):
        return True

    routes = PromptServer.instance.routes

    def response_payload():
        return PRESET_STORE.snapshot()

    def notify_clients(payload):
        try:
            PromptServer.instance.send_sync("simple_preset.changed", payload)
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
        if isinstance(error, PresetImportConflictError):
            return web.json_response({"error": str(error), "preview": error.preview}, status=409)
        if isinstance(error, OSError):
            detail = error.strerror or str(error)
            return web.json_response(
                {"error": f"Could not read or write shared presets: {detail}"}, status=500
            )
        if isinstance(error, PresetNotFoundError):
            return web.json_response({"error": "Preset not found."}, status=404)
        if isinstance(error, ProfileNotFoundError):
            return web.json_response({"error": "Profile not found."}, status=404)
        return web.json_response({"error": str(error)}, status=400)

    @routes.get("/simple-preset/presets")
    async def get_presets(_request):
        try:
            return web.json_response(response_payload())
        except (PresetValidationError, OSError) as error:
            return error_response(error)

    @routes.post("/simple-preset/presets")
    async def create_preset(request):
        try:
            payload = await read_json(request)
            PRESET_STORE.create(
                payload.get("name"), payload.get("prompt"), payload.get("profile_id")
            )
            result = response_payload()
            notify_clients(result)
            return web.json_response(result, status=201)
        except (PresetValidationError, ProfileNotFoundError, OSError) as error:
            return error_response(error)

    @routes.put("/simple-preset/presets/{preset_id}")
    async def update_preset(request):
        try:
            payload = await read_json(request)
            PRESET_STORE.update(
                request.match_info["preset_id"],
                payload.get("name"),
                payload.get("prompt"),
                payload.get("profile_id"),
            )
            result = response_payload()
            notify_clients(result)
            return web.json_response(result)
        except (PresetValidationError, PresetNotFoundError, ProfileNotFoundError, OSError) as error:
            return error_response(error)

    @routes.delete("/simple-preset/presets/{preset_id}")
    async def delete_preset(request):
        try:
            PRESET_STORE.delete(request.match_info["preset_id"])
            result = response_payload()
            notify_clients(result)
            return web.json_response(result)
        except (PresetValidationError, PresetNotFoundError, OSError) as error:
            return error_response(error)

    @routes.post("/simple-preset/order")
    async def reorder_presets(request):
        try:
            payload = await read_json(request)
            PRESET_STORE.reorder(payload.get("ids"))
            result = response_payload()
            notify_clients(result)
            return web.json_response(result)
        except (PresetValidationError, OSError) as error:
            return error_response(error)

    @routes.post("/simple-preset/profiles")
    async def create_profile(request):
        try:
            payload = await read_json(request)
            profile = PRESET_STORE.create_profile(payload.get("name"))
            result = response_payload()
            result["created_profile_id"] = profile["id"]
            notify_clients(result)
            return web.json_response(result, status=201)
        except (PresetValidationError, OSError) as error:
            return error_response(error)

    @routes.put("/simple-preset/profiles/{profile_id}")
    async def update_profile(request):
        try:
            payload = await read_json(request)
            PRESET_STORE.update_profile(request.match_info["profile_id"], payload.get("name"))
            result = response_payload()
            notify_clients(result)
            return web.json_response(result)
        except (PresetValidationError, ProfileNotFoundError, OSError) as error:
            return error_response(error)

    @routes.delete("/simple-preset/profiles/{profile_id}")
    async def delete_profile(request):
        try:
            deleted_presets = PRESET_STORE.delete_profile(request.match_info["profile_id"])
            result = response_payload()
            result["deleted_presets"] = deleted_presets
            notify_clients(result)
            return web.json_response(result)
        except (PresetValidationError, ProfileNotFoundError, OSError) as error:
            return error_response(error)

    @routes.get("/simple-preset/export")
    async def export_presets(request):
        try:
            return web.json_response(PRESET_STORE.export_document(request.query.get("profile_id")))
        except (PresetValidationError, ProfileNotFoundError, OSError) as error:
            return error_response(error)

    @routes.post("/simple-preset/import/preview")
    async def preview_import(request):
        try:
            payload = await read_json(request)
            return web.json_response(PRESET_STORE.preview_import(payload.get("document")))
        except (PresetValidationError, OSError) as error:
            return error_response(error)

    @routes.post("/simple-preset/import")
    async def import_presets(request):
        try:
            payload = await read_json(request)
            summary = PRESET_STORE.import_document(
                payload.get("document"), payload.get("resolutions"), payload.get("expected")
            )
            result = response_payload()
            result["import_result"] = summary
            notify_clients(result)
            return web.json_response(result)
        except (PresetValidationError, OSError) as error:
            return error_response(error)

    PromptServer.instance._simple_preset_routes_registered = True
    return True
