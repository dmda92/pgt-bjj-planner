import type {Profile} from "../domain/models.ts";

export type ProfileDraft = Record<
    "nombre" | "apellidos" | "fecha" | "peso" | "cinturon",
    string
>;

export function profileDraft(profile: Profile): ProfileDraft {
    return {
        nombre: profile.nombre,
        apellidos: profile.apellidos,
        fecha: profile.fecha_nacimiento || "",
        peso: profile.peso == null ? "" : String(profile.peso),
        cinturon: profile.cinturon,
    };
}

/** Refresh untouched fields while preserving edits not yet saved by the user. */
export function refreshProfileDraft(
    draft: ProfileDraft,
    previous: ProfileDraft,
    incoming: ProfileDraft,
): ProfileDraft {
    const equal = (key: keyof ProfileDraft, a: string, b: string) =>
        a === b ||
        (key === "peso" && a !== "" && b !== "" && Number(a) === Number(b));
    return Object.fromEntries(
        (Object.keys(incoming) as (keyof ProfileDraft)[]).map((key) => [
            key,
            equal(key, draft[key], previous[key]) ||
            equal(key, draft[key], incoming[key])
                ? incoming[key]
                : draft[key],
        ]),
    ) as ProfileDraft;
}
