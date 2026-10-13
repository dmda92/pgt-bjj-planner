import {
  initialVersion,
  type Competition,
  type TrainingPlan,
  type Techniques,
  type Comments,
  type Exercise,
  validateCompetition,
  validateTechniques,
} from "./models.ts";
export function* priorityCycle(priorities: number[]): Generator<number> {
  if (!priorities.length) throw Error("No hay prioridades entrenables");
  if (priorities.length === 1) {
    for (;;) yield priorities[0];
  }
  let index = 0;
  yield priorities[index];
  index = 1;
  yield priorities[index];
  let back = true;
  for (;;) {
    index = (index + (back ? -1 : 2) + priorities.length) % priorities.length;
    yield priorities[index];
    back = !back;
  }
}
export function trainingDates(c: Competition): string[] {
  validateCompetition(c);
  const dates: string[] = [];
  for (
    let value = Date.parse(c.fecha_comienzo + "T00:00:00Z");
    value < Date.parse(c.fecha_torneo + "T00:00:00Z");
    value += 86400000
  ) {
    const date = new Date(value);
    if (c.dias_de_entrenamiento.includes(date.getUTCDay() || 7))
      dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}
export function tabata(c: Competition) {
  validateCompetition(c);
  return {
    work: c.tiempo_por_tecnica_segundos,
    rest: c.descanso_entre_ciclos_segundos,
    cycles: 2,
    sets: c.ejercicios_por_sesion,
    betweenSets: c.descanso_entre_tecnicas_segundos,
    duration:
      (2 * c.tiempo_por_tecnica_segundos + c.descanso_entre_ciclos_segundos) *
        c.ejercicios_por_sesion +
      c.descanso_entre_tecnicas_segundos * (c.ejercicios_por_sesion - 1),
  };
}
export function generatePlan(
  c: Competition,
  mail: string,
  techniques: Techniques,
  comments: Comments,
  generatedAt: string,
): TrainingPlan {
  validateTechniques(techniques);
  const positions = techniques.positions.filter((p) => p.tecnicas.length);
  if (!positions.length) throw Error("No hay técnicas entrenables");
  const priorities = [...new Set(positions.map((p) => p.prioridad))].sort(
    (a, b) => a - b,
  );
  const notes = new Map(
    comments.comments.map((c) => [c.techniqueId, c.comment]),
  );
  const passes = new Map<number, number>();
  function* stream(): Generator<Exercise> {
    for (const priority of priorityCycle(priorities)) {
      const pass = (passes.get(priority) || 0) + 1;
      passes.set(priority, pass);
      for (const p of positions.filter((p) => p.prioridad === priority))
        for (let i = 0; i < p.tecnicas.length; i++) {
          const t = p.tecnicas[i];
          yield {
            positionId: p.id,
            techniqueId: t.id,
            posicion: p.posicion,
            prioridad: p.prioridad,
            tipo: t.tipo,
            descripcion_del_alumno: t.descripcion_del_alumno,
            comment: notes.get(t.id) || "",
            pass,
            positionComplete: i === p.tecnicas.length - 1,
          };
        }
    }
  }
  const flow = stream();
  const sessions = trainingDates(c).map((date) => ({
    date,
    exercises: Array.from(
      { length: c.ejercicios_por_sesion },
      () => flow.next().value!,
    ),
  }));
  return {
    ...initialVersion(),
    updatedAt: generatedAt,
    ...structuredClone(c),
    alumnos: [mail],
    mail,
    generatedAt,
    sessions,
  };
}
export function coverage(plan: TrainingPlan, before?: string) {
  const completed = new Map<string, number>();
  const touched = new Set<string>();
  for (const session of plan.sessions) {
    if (before && session.date > before) continue;
    for (const exercise of session.exercises) {
      touched.add(exercise.positionId);
      if (exercise.positionComplete)
        completed.set(
          exercise.positionId,
          (completed.get(exercise.positionId) || 0) + 1,
        );
    }
  }
  return { completed, touched };
}
