import type { TrainingPlan, Techniques, Comments } from "./models.ts";

export function madridDate(instant: string | Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function descriptionChanges(
  previous: Techniques,
  incoming: Techniques,
): string[] {
  const old = new Map(
    previous.positions
      .flatMap((p) => p.tecnicas)
      .map((t) => [t.id, t.descripcion_del_alumno]),
  );
  return incoming.positions
    .flatMap((p) => p.tecnicas)
    .filter((t) => old.has(t.id) && old.get(t.id) !== t.descripcion_del_alumno)
    .map((t) => t.id);
}
export function commentChanges(
  previous: Comments,
  incoming: Comments,
): string[] {
  const old = new Map(previous.comments.map((c) => [c.techniqueId, c.comment]));
  const next = new Map(
    incoming.comments.map((c) => [c.techniqueId, c.comment]),
  );
  return [...new Set([...old.keys(), ...next.keys()])].filter(
    (id) => (old.get(id) || "") !== (next.get(id) || ""),
  );
}
/** Source version markers are written by the Worker, never accepted from clients. */
export function updateTextVersions(
  previous: Record<string, string> | undefined,
  ids: string[],
  version: string,
) {
  return Object.fromEntries([
    ...Object.entries(previous || {}),
    ...ids.map((id) => [id, version]),
  ]);
}
export function updateFuturePlanText(
  plan: TrainingPlan,
  techniques: Techniques,
  comments: Comments,
  today: string,
): TrainingPlan {
  if (plan.fecha_torneo <= today) return plan;
  const text = new Map(
    techniques.positions
      .flatMap((p) => p.tecnicas)
      .map((t) => [t.id, t.descripcion_del_alumno]),
  );
  const notes = new Map(
    comments.comments.map((c) => [c.techniqueId, c.comment]),
  );
  const descriptions = { ...plan.appliedDescriptionUpdates },
    annotations = { ...plan.appliedCommentUpdates };
  let changed = false;
  const sessions = plan.sessions.map((s) => {
    if (s.date <= today) return s;
    const exercises = s.exercises.map((e) => {
      let result = e;
      const descriptionVersion = techniques.descriptionUpdates?.[e.techniqueId];
      const commentVersion = comments.commentUpdates?.[e.techniqueId];
      // Compare against the original checkpoint for every occurrence in this batch.
      if (
        descriptionVersion &&
        plan.appliedDescriptionUpdates?.[e.techniqueId] !==
          descriptionVersion &&
        text.has(e.techniqueId)
      ) {
        result = {
          ...result,
          descripcion_del_alumno: text.get(e.techniqueId)!,
        };
        descriptions[e.techniqueId] = descriptionVersion;
        changed = true;
      }
      if (
        commentVersion &&
        plan.appliedCommentUpdates?.[e.techniqueId] !== commentVersion &&
        text.has(e.techniqueId)
      ) {
        result = { ...result, comment: notes.get(e.techniqueId) || "" };
        annotations[e.techniqueId] = commentVersion;
        changed = true;
      }
      return result;
    });
    return { ...s, exercises };
  });
  if (!changed) return plan;
  return {
    ...plan,
    sessions,
    appliedDescriptionUpdates: descriptions,
    appliedCommentUpdates: annotations,
  };
}

/** Offline projection; server checkpoints and SHA remain untouched until sync. */
export function projectFutureDescriptions(
  plan: TrainingPlan,
  previous: Techniques,
  incoming: Techniques,
  today: string,
): TrainingPlan {
  const ids = descriptionChanges(previous, incoming);
  if (!ids.length) return plan;
  const projected = updateFuturePlanText(
    plan,
    {
      ...incoming,
      descriptionUpdates: updateTextVersions(undefined, ids, "local-preview"),
    },
    { schemaVersion: 1, revision: 1, updatedAt: "", comments: [] },
    today,
  );
  if (projected === plan) return plan;
  return {
    ...projected,
    appliedDescriptionUpdates: plan.appliedDescriptionUpdates,
    appliedCommentUpdates: plan.appliedCommentUpdates,
  };
}
