import type { TrainingPlan } from "./models.ts";

/** Read-only report of the exercises actually saved in a plan snapshot. */
export function planCoverage(
  plan: TrainingPlan,
  date: string,
  inclusive = true,
) {
  const positions = new Map<
    string,
    {
      id: string;
      name: string;
      priority: number;
      touched: boolean;
      complete: number;
      partial: boolean;
      techniques: { id: string; type: string; count: number; first: string }[];
      passes: Map<
        number,
        { expected: Set<string>; reached: Set<string>; ended: boolean }
      >;
    }
  >();
  for (const session of plan.sessions)
    for (const ex of session.exercises) {
      let p = positions.get(ex.positionId);
      if (!p) {
        p = {
          id: ex.positionId,
          name: ex.posicion,
          priority: ex.prioridad,
          touched: false,
          complete: 0,
          partial: false,
          techniques: [],
          passes: new Map(),
        };
        positions.set(ex.positionId, p);
      }
      if (!p.techniques.some((t) => t.id === ex.techniqueId))
        p.techniques.push({
          id: ex.techniqueId,
          type: ex.tipo,
          count: 0,
          first: "",
        });
      let pass = p.passes.get(ex.pass);
      if (!pass) {
        pass = { expected: new Set(), reached: new Set(), ended: false };
        p.passes.set(ex.pass, pass);
      }
      pass.expected.add(ex.techniqueId);
    }
  const included = plan.sessions.filter(
    (s) => date && (inclusive ? s.date <= date : s.date < date),
  );
  for (const session of [...included].sort((a, b) =>
    a.date.localeCompare(b.date),
  ))
    for (const ex of session.exercises) {
      const p = positions.get(ex.positionId)!;
      p.touched = true;
      const t = p.techniques.find((t) => t.id === ex.techniqueId)!;
      t.count++;
      if (!t.first) t.first = session.date;
      const pass = p.passes.get(ex.pass)!;
      pass.reached.add(ex.techniqueId);
      if (ex.positionComplete) pass.ended = true;
    }
  for (const p of positions.values())
    for (const pass of p.passes.values()) {
      if (pass.ended && pass.reached.size === pass.expected.size) p.complete++;
      else if (pass.reached.size) p.partial = true;
    }
  const result = [...positions.values()].map(({ passes, ...p }) => p);
  return {
    positions: result,
    total: result.reduce((n, p) => n + p.techniques.length, 0),
    unique: result.reduce(
      (n, p) => n + p.techniques.filter((t) => t.count).length,
      0,
    ),
    sessions: included.length,
    exercises: included.reduce((n, s) => n + s.exercises.length, 0),
  };
}
