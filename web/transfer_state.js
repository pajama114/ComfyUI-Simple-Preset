import { DEFAULT_PROFILE_ID } from "./profile_state.js";

export function readBundle(value) {
    let parsed;
    try {
        parsed = typeof value === "string" ? JSON.parse(value) : value;
    } catch (_error) {
        return null;
    }
    if (!parsed || !Object.hasOwn(parsed, "bundle")) return null;
    const bundle = parsed.bundle;
    const fail = () => { throw new Error("The workflow's bundled presets are invalid."); };
    if (bundle?.version !== 3 || !Array.isArray(bundle.profiles) || !Array.isArray(bundle.presets)
        || bundle.profiles.length > 100 || bundle.presets.length > 500) fail();
    const profileIds = new Set();
    for (const profile of bundle.profiles) {
        if (typeof profile?.id !== "string" || !profile.id || profile.id === "__all_profiles__"
            || profileIds.has(profile.id) || typeof profile.name !== "string"
            || !profile.name.trim() || profile.name.length > 120) fail();
        profileIds.add(profile.id);
    }
    if (!bundle.profiles.some((p) => p.id === DEFAULT_PROFILE_ID && p.name === "Default")) fail();
    const presetIds = new Set();
    for (const preset of bundle.presets) {
        if (typeof preset?.id !== "string" || !preset.id || presetIds.has(preset.id)
            || typeof preset.name !== "string" || !preset.name.trim() || preset.name.length > 120
            || typeof preset.prompt !== "string" || preset.prompt.length > 100000
            || !profileIds.has(preset.profile_id)) fail();
        presetIds.add(preset.id);
    }
    return makeBundle(bundle.profiles, bundle.presets);
}

export function makeBundle(profiles, presets) {
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const usedProfiles = new Map([[DEFAULT_PROFILE_ID, { id: DEFAULT_PROFILE_ID, name: "Default" }]]);
    const copies = presets.map((preset) => {
        const profile = profileMap.get(preset.profile_id) ?? usedProfiles.get(DEFAULT_PROFILE_ID);
        usedProfiles.set(profile.id, { id: profile.id, name: profile.name });
        const copy = { id: preset.id, name: preset.name, prompt: preset.prompt, profile_id: profile.id };
        for (const key of ["created_at", "updated_at"]) {
            if (typeof preset[key] === "string") copy[key] = preset[key];
        }
        return copy;
    });
    return { version: 3, profiles: [...usedProfiles.values()], presets: copies };
}

export function effectivePresets(shared, bundle) {
    const copies = new Map((bundle?.presets ?? []).map((p) => [p.id, p]));
    const result = shared.map((p) => {
        const preset = copies.get(p.id) ?? p;
        copies.delete(p.id);
        return preset;
    });
    return [...result, ...copies.values()];
}

export function effectiveProfiles(shared, bundle) {
    const profiles = new Map(shared.map((p) => [p.id, p]));
    for (const profile of bundle?.profiles ?? []) {
        if (!profiles.has(profile.id)) profiles.set(profile.id, profile);
    }
    return [...profiles.values()];
}

export function downloadDocument(document, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2) + "\n"], { type: "application/json" }));
    const link = globalThis.document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
