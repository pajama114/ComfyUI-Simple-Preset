export const ALL_PROFILES = "__all_profiles__";
export const DEFAULT_PROFILE_ID = "default";
export const PROFILE_PROPERTY = "simple_preset_profile_id";

export function storedProfileId(node) {
    const value = node?.properties?.[PROFILE_PROPERTY];
    return typeof value === "string" && value ? value : DEFAULT_PROFILE_ID;
}

export function storeProfileId(node, profileId) {
    const value = typeof profileId === "string" && profileId
        ? profileId
        : DEFAULT_PROFILE_ID;
    node.properties ??= {};
    node.properties[PROFILE_PROPERTY] = value;
    return value;
}

export function resolveProfileId(profileId, profiles) {
    if (profileId === ALL_PROFILES) return ALL_PROFILES;
    const available = new Set(profiles.map((profile) => profile.id));
    if (available.has(profileId)) return profileId;
    if (available.has(DEFAULT_PROFILE_ID)) return DEFAULT_PROFILE_ID;
    return profiles[0]?.id ?? ALL_PROFILES;
}

export function samePresetData(leftProfiles, leftPresets, rightProfiles, rightPresets) {
    return JSON.stringify([leftProfiles, leftPresets])
        === JSON.stringify([rightProfiles, rightPresets]);
}

export function moveSelection(selectedIds, movedId, offset) {
    if (!Array.isArray(selectedIds) || !Number.isInteger(offset) || offset === 0) {
        return Array.isArray(selectedIds) ? [...selectedIds] : [];
    }
    const currentIndex = selectedIds.indexOf(movedId);
    if (currentIndex < 0) return [...selectedIds];
    const nextIndex = Math.max(
        0,
        Math.min(selectedIds.length - 1, currentIndex + offset),
    );
    if (nextIndex === currentIndex) return [...selectedIds];

    const result = [...selectedIds];
    const [moved] = result.splice(currentIndex, 1);
    result.splice(nextIndex, 0, moved);
    return result;
}
