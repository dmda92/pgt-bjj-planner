export interface Version {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
}
export interface Technique {
  id: string;
  tipo: string;
  descripcion_del_alumno: string;
}
export interface Position {
  id: string;
  posicion: string;
  prioridad: number;
  tecnicas: Technique[];
}
export interface Techniques extends Version {
  descriptionUpdates?: Record<string, string>;
  positions: Position[];
}
export interface Template extends Version {
  positions: {
    posicion: string;
    prioridad: number;
    tecnicas: { tipo: string; descripcion_del_alumno: string }[];
  }[];
}
export interface Profile extends Version {
  mail: string;
  nombre: string;
  apellidos: string;
  fecha_nacimiento: string | null;
  peso: number | null;
  cinturon: "Blanco" | "Azul" | "Morado" | "Marrón" | "Negro";
  perfil: "alumno" | "entrenador";
  pwd?: string;
  probeOnly?: boolean;
}
export interface Comments extends Version {
  commentUpdates?: Record<string, string>;
  comments: { techniqueId: string; comment: string }[];
}
export interface Index extends Version {
  planIds: string[];
}
export interface Competition {
  planId: string;
  fecha_comienzo: string;
  fecha_torneo: string;
  alumnos: string[];
  dias_de_entrenamiento: number[];
  ejercicios_por_sesion: number;
  tiempo_por_tecnica_segundos: number;
  descanso_entre_ciclos_segundos: number;
  descanso_entre_tecnicas_segundos: number;
}
export interface Catalog extends Version {
  plans: Competition[];
  deletedPlanIds: string[];
}
export interface Exercise {
  positionId: string;
  techniqueId: string;
  posicion: string;
  prioridad: number;
  tipo: string;
  descripcion_del_alumno: string;
  comment: string;
  pass: number;
  positionComplete: boolean;
}
export interface TrainingPlan extends Version, Competition {
  appliedDescriptionUpdates?: Record<string, string>;
  appliedCommentUpdates?: Record<string, string>;
  mail: string;
  generatedAt: string;
  sessions: { date: string; exercises: Exercise[] }[];
}
export type Document =
  Techniques | Profile | Comments | Index | Catalog | TrainingPlan;
export interface RemoteRecord<T = Document> {
  data: T;
  sha: string;
}
export const now = () => new Date().toISOString();
export const initialVersion = (): Version => ({
  schemaVersion: 1,
  revision: 1,
  updatedAt: now(),
});
export function cloneTemplate(
  template: Template,
  uuid: () => string = () => crypto.randomUUID(),
): Techniques {
  return {
    ...initialVersion(),
    positions: template.positions.map((p) => ({
      id: uuid(),
      posicion: p.posicion,
      prioridad: p.prioridad,
      tecnicas: p.tecnicas.map((t) => ({
        id: uuid(),
        tipo: t.tipo,
        descripcion_del_alumno: "",
      })),
    })),
  };
}
export function versioned<T extends Version>(value: T): T {
  return { ...value, revision: value.revision + 1, updatedAt: now() };
}
export function validateVersion(value: unknown): asserts value is Version {
  const v = value as Version;
  if (
    !v ||
    v.schemaVersion !== 1 ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 1 ||
    typeof v.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(v.updatedAt))
  )
    throw Error("Versión de JSON no válida");
}
export function validDate(date: unknown): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return false;
  const parsed = new Date(date + "T00:00:00Z");
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}
export function validateTechniques(
  value: unknown,
): asserts value is Techniques {
  validateVersion(value);
  const v = value as Techniques;
  if (!Array.isArray(v.positions) || v.positions.length > 200)
    throw Error("Posiciones no válidas");
  const ids = new Set<string>();
  const id = (v: unknown) => {
    if (
      typeof v !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v) ||
      ids.has(v)
    )
      throw Error("UUID duplicado o inválido");
    ids.add(v);
  };
  for (const p of v.positions) {
    id(p.id);
    if (
      typeof p.posicion !== "string" ||
      !p.posicion.trim() ||
      p.posicion.length > 500 ||
      !Number.isSafeInteger(p.prioridad) ||
      p.prioridad < 1 ||
      !Array.isArray(p.tecnicas) ||
      p.tecnicas.length > 100
    )
      throw Error("Posición no válida");
    for (const t of p.tecnicas) {
      id(t.id);
      if (
        typeof t.tipo !== "string" ||
        !t.tipo.trim() ||
        t.tipo.length > 500 ||
        typeof t.descripcion_del_alumno !== "string" ||
        t.descripcion_del_alumno.length > 10000
      )
        throw Error("Técnica no válida");
    }
  }
}
export function validateCompetition(c: Competition): void {
  if (
    !validDate(c.fecha_comienzo) ||
    !validDate(c.fecha_torneo) ||
    c.fecha_comienzo >= c.fecha_torneo
  )
    throw Error("Fechas no válidas");
  if (
    !Array.isArray(c.dias_de_entrenamiento) ||
    !c.dias_de_entrenamiento.length ||
    new Set(c.dias_de_entrenamiento).size !== c.dias_de_entrenamiento.length ||
    c.dias_de_entrenamiento.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
  )
    throw Error("Días no válidos");
  for (const [key, min, max] of [
    ["ejercicios_por_sesion", 1, 100],
    ["tiempo_por_tecnica_segundos", 1, 3600],
    ["descanso_entre_ciclos_segundos", 0, 3600],
    ["descanso_entre_tecnicas_segundos", 0, 3600],
  ] as const)
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max)
      throw Error("Ejercicios o tiempos fuera de límites");
  if (
    (Date.parse(c.fecha_torneo) - Date.parse(c.fecha_comienzo)) / 86400000 >
    730
  )
    throw Error("El calendario admite como máximo dos años");
}
export function validateProfile(p: Profile): void {
  validateVersion(p);
  if (
    typeof p.mail !== "string" ||
    typeof p.nombre !== "string" ||
    p.nombre.length > 200 ||
    typeof p.apellidos !== "string" ||
    p.apellidos.length > 200 ||
    !["Blanco", "Azul", "Morado", "Marrón", "Negro"].includes(p.cinturon) ||
    !["alumno", "entrenador"].includes(p.perfil) ||
    !(p.fecha_nacimiento === null || validDate(p.fecha_nacimiento)) ||
    !(
      p.peso === null ||
      (typeof p.peso === "number" && p.peso > 0 && p.peso < 500)
    )
  )
    throw Error("Perfil no válido");
}
export function validatePlan(value: unknown): asserts value is TrainingPlan {
  validateVersion(value);
  const p = value as TrainingPlan;
  validateCompetition(p);
  const uuid = (v: unknown) =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  if (
    !uuid(p.planId) ||
    typeof p.mail !== "string" ||
    !Array.isArray(p.alumnos) ||
    p.alumnos.length !== 1 ||
    p.alumnos[0] !== p.mail ||
    typeof p.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(p.generatedAt)) ||
    !Array.isArray(p.sessions) ||
    p.sessions.length > 730 ||
    new Set(p.sessions.map((s) => s?.date)).size !== p.sessions.length
  )
    throw Error("Plan no válido");
  for (const s of p.sessions) {
    if (
      !s ||
      !validDate(s.date) ||
      s.date < p.fecha_comienzo ||
      s.date >= p.fecha_torneo ||
      !Array.isArray(s.exercises) ||
      s.exercises.length !== p.ejercicios_por_sesion
    )
      throw Error("Sesión no válida");
    for (const e of s.exercises) {
      if (
        !e ||
        !uuid(e.positionId) ||
        !uuid(e.techniqueId) ||
        typeof e.posicion !== "string" ||
        !e.posicion.trim() ||
        e.posicion.length > 500 ||
        typeof e.tipo !== "string" ||
        !e.tipo.trim() ||
        e.tipo.length > 500 ||
        typeof e.descripcion_del_alumno !== "string" ||
        e.descripcion_del_alumno.length > 10000 ||
        typeof e.comment !== "string" ||
        e.comment.length > 10000 ||
        !Number.isSafeInteger(e.prioridad) ||
        e.prioridad < 1 ||
        !Number.isSafeInteger(e.pass) ||
        e.pass < 1 ||
        typeof e.positionComplete !== "boolean"
      )
        throw Error("Ejercicio no válido");
    }
  }
}
