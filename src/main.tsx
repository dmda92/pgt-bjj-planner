import {durationSeconds,durationError} from './application/duration-input.ts';
import {competitionDateErrors} from './application/competition-dates.ts';
import {syncPresentation} from "./application/sync-presentation.ts";
import type {TrainerView,TrainerSection} from "./application/trainer-cache.ts";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { client, type Snapshot } from "./application/client.ts";
import { db, type LocalEntry } from "./infrastructure/local.ts";
import {
  now,
  validatePriority,
  initialVersion,
  type Profile,
  type Techniques,
  type Comments,
  type TrainingPlan,
  type Competition,
  type Catalog,
} from "./domain/models.ts";
import { tabata } from "./domain/planner.ts";
import { planCoverage } from "./domain/coverage.ts";
import { exportPlan } from "./infrastructure/pdf.ts";
import {
  profileDraft,
  refreshProfileDraft,
} from "./application/profile-draft.ts";
import "./app.css";
const format = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
function SectionIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    techniques: "M5 4h14v16H5z M9 8h6 M9 12h6 M9 16h4",
    plans: "M4 6h16v14H4z M8 3v6 M16 3v6 M4 11h16 M8 15h2 M14 15h2",
    profile: "M16 7a4 4 0 1 1-8 0a4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2",
    trainer: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
function App() {
  const techniqueSaves = useRef<Promise<void>>(Promise.resolve());
  const pendingTechniqueSaves = useRef(0);
  const loadSequence = useRef(0);
  const studentSequence = useRef(0);
  const [entries, setEntries] = useState<LocalEntry[]>([]),
    [version, setVersion] = useState(0),
    [tab, setTab] = useState("techniques"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [profileUnsaved,setProfileUnsaved]=useState(false),
    [search, setSearch] = useState(""),
    [trainerSection, setTrainerSection] = useState("team"),
    [studentSearch, setStudentSearch] = useState(""),
    [students, setStudents] = useState<any[]>([]),
    [student, setStudent] = useState<TrainerView | null>(null),
    [studentSection, setStudentSection] = useState<TrainerSection>("techniques"),
    [studentPlanId,setStudentPlanId]=useState(""),
    [studentRefreshing, setStudentRefreshing] = useState(false),
    [selectedStudent, setSelectedStudent] = useState(""),
    [studentLoading, setStudentLoading] = useState(false),
    [studentLoadFailed, setStudentLoadFailed] = useState(false),
    [catalog, setCatalog] = useState<{
      data: Catalog;
      sha: string | null;
    } | null>(null),
    [update, setUpdate] = useState<ServiceWorkerRegistration | null>(null);
  const active = client.identity && !client.locked;
  const profile = entries.find((e) => e.key === "profile")?.data as
    Profile | undefined;
  const techniques = entries.find((e) => e.key === "techniques")?.data as
    Techniques | undefined;
  const comments = entries.find((e) => e.key === "comments")?.data as
    Comments | undefined;
  const trainer = profile?.perfil === "entrenador";
  useEffect(() => {
    client.onChange = () => {
      setVersion((v) => v + 1);
    };
    if (active) void client.sync().catch((e) => setError(e.message));
    return () => {
      client.onChange = () => {};
    };
  }, []);
  useEffect(() => {
    if (active) {
      const mail = client.identity!.mail;
      const sequence = ++loadSequence.current;
      void client
        .load()
        .then((data) => {
          if (client.identity?.mail === mail && !client.locked && pendingTechniqueSaves.current === 0 && sequence === loadSequence.current)
            setEntries(data);
        })
        .catch((e) => setError(e.message));
    } else {
      setEntries([]);
      studentSequence.current++;
      setStudent(null);
      setSelectedStudent("");
      setStudentLoading(false);
      setStudentLoadFailed(false);
      setStudents([]);
      setCatalog(null);
      setTab("techniques");
      setSearch("");
      setStudentSearch("");
      setTrainerSection("team");
    }
  }, [version, Boolean(active)]);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          if (reg.waiting) setUpdate(reg);
          reg.addEventListener("updatefound", () => {
            reg.installing?.addEventListener("statechange", () => {
              if (reg.waiting && navigator.serviceWorker.controller)
                setUpdate(reg);
            });
          });
        })
        .catch(() => {});
  }, []);
  async function run(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await techniqueSaves.current;
      await action();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }
  async function saveTech(next: Techniques) {
    try {
      for (const position of next.positions) validatePriority(position.prioridad);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prioridad no válida");
      return;
    }
    const mail = client.identity?.mail;
    pendingTechniqueSaves.current++;
    loadSequence.current++;
    setEntries((e) =>
      e.map((v) => v.key === "techniques" ? { ...v, data: next, dirty: true } : v),
    );
    const save = techniqueSaves.current.then(async () => {
      if (client.identity?.mail !== mail || client.locked) throw Error("Sesión cerrada o cambiada");
      await client.edit("techniques", next);
    });
    techniqueSaves.current = save.catch((e) => {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    }).finally(() => {
      pendingTechniqueSaves.current--;
      if (pendingTechniqueSaves.current === 0) setVersion((v) => v + 1);
    });
    await techniqueSaves.current;
  }
  const plans = entries
    .filter((e) => e.key.startsWith("plan:"))
    .map((e) => e.data as TrainingPlan);
  function selectStudent(mail:string,section:TrainerSection="techniques",force=false,planId="") {
    const sequence=++studentSequence.current,owner=client.identity?.mail;
    setSelectedStudent(mail);setStudentSection(section);setStudentPlanId(planId);
    setStudent(null);setStudentLoading(true);setStudentLoadFailed(false);
    void (async()=>{
      const current=()=>sequence===studentSequence.current&&client.identity?.mail===owner&&!client.locked;
      let cached:TrainerView|undefined;
      try {
        cached=await client.cachedTrainer(mail,section,planId);
        if(!current())return;
        if(cached){setStudent(cached);setStudentLoading(false);}
        setStudentRefreshing(Boolean(cached)&&navigator.onLine);
        const data=await client.trainerView(mail,section,force,planId);
        if(current())setStudent(data);
      }catch(error){if(current()){if(error instanceof Error && "status" in error && error.status===403){setStudent(null);cached=undefined;}setStudentLoadFailed(!cached);setError(error instanceof Error?error.message:"No se pudo actualizar la ficha");}}
      finally{if(current()){setStudentLoading(false);setStudentRefreshing(false);}}
    })();
  }
  async function trainers() {
    const data = await client.request("/api/app/students");
    setStudents(data.users);
    setCatalog(await client.request("/api/app/catalog"));
  }
  const syncState=syncPresentation(client.status,entries.some(e=>e.dirty)||pendingTechniqueSaves.current>0,entries.some(e=>e.key.startsWith("plan:")&&Boolean((e.data as TrainingPlan).structuralUpdateError)),profileUnsaved);
  return (
    <div className={`shell ${active ? "signed-in" : "signed-out"}`}>
      <a className="skip-link" href="#main-content">
        Ir al contenido
      </a>
      <header>
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M3 13h26v7H3z M21 5l6 1-5 25-6-1z" fill="currentColor" />
            </svg>
          </span>
          <span className="brand-copy">
            PGT<strong>BJJ Planner</strong>
          </span>
        </a>
        <div className="identity">
          {active ? (
            <>
              <span>
                {profile?.nombre || client.identity?.mail}
                <small>{trainer ? "Entrenador" : "Alumno"}</small>
              </span>
              <button
                className="subtle"
                onClick={() => void run(() => client.logout())}
              >
                Salir
              </button>
            </>
          ) : (
            <span>Tu entrenamiento, con intención.</span>
          )}
        </div>
      </header>
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {!active ? (
        <Auth run={run} busy={busy} />
      ) : (
        <>
          <div className="app-layout">
            <nav aria-label="Secciones">
              <button
                aria-current={tab === "techniques" ? "page" : undefined}
                className={tab === "techniques" ? "selected" : ""}
                onClick={() => setTab("techniques")}
              >
                <SectionIcon name="techniques" />
                Mis técnicas
              </button>
              <button
                aria-current={tab === "plans" ? "page" : undefined}
                className={tab === "plans" ? "selected" : ""}
                onClick={() => setTab("plans")}
              >
                <SectionIcon name="plans" />
                Mis planes <b>{plans.length}</b>
              </button>
              <button
                aria-current={tab === "profile" ? "page" : undefined}
                className={tab === "profile" ? "selected" : ""}
                onClick={() => setTab("profile")}
              >
                <SectionIcon name="profile" />
                Perfil
              </button>
              {trainer && (
                <button
                  aria-current={tab === "trainer" ? "page" : undefined}
                  className={tab === "trainer" ? "selected" : ""}
                  onClick={() => {
                    setTab("trainer");
                    void run(trainers);
                  }}
                >
                  <SectionIcon name="trainer" />
                  Entrenador
                </button>
              )}
              <div className="nav-team">
                <strong>Preparación de competición</strong>
                <p>Jiu-jitsu de competición</p>
              </div>
            </nav>
            <main id="main-content">
              <section
                className={`welcome ${tab === "trainer" ? "welcome-trainer" : ""}`}
              >
                <div>
                  <h1>
                    {tab === "trainer"
                      ? "Panel del entrenador"
                      : tab === "plans"
                        ? "Tu preparación"
                        : tab === "profile"
                          ? "Tu perfil"
                          : "Construye tu juego."}
                  </h1>
                  <p>
                    {tab === "trainer"
                      ? "Tu equipo, sus técnicas y la preparación de cada competición."
                      : "Trabaja lo que te funciona. Guarda tus técnicas y llega al torneo con un plan."}
                  </p>
                </div>
                <div className="sync">
                  <span role="status" className={syncState.success ? "sync-success" : undefined}>{syncState.text}</span>
                  <button
                    disabled={busy}
                    onClick={() => void run(() => client.sync())}
                  >
                    Sincronizar
                  </button>
                </div>
              </section>

              {entries
                .filter((e) => e.conflicts.length)
                .map((e) => (
                  <section key={e.key} className="conflict">
                    <h2>Conflicto en {e.key}</h2>
                    <p>
                      {e.key.startsWith("plan:")
                        ? "Este plan es de solo lectura. Exporta tu copia si quieres conservar el borrador anterior y después utiliza la versión sincronizada."
                        : e.conflicts.join(", ")}
                    </p>
                    {!e.key.startsWith("plan:") && (
                      <button
                        onClick={() =>
                          void run(() => client.resolve(e.key, "local"))
                        }
                      >
                        Conservar mi versión
                      </button>
                    )}
                    <button
                      onClick={() =>
                        void run(() => client.resolve(e.key, "remote"))
                      }
                    >
                      Usar remoto en conflictos
                    </button>
                    <p>
                      Exporta una copia antes de escoger si necesitas conservar
                      ambas.
                    </p>
                  </section>
                ))}
              {tab === "techniques" && techniques && (
                <>
                  <section className="section-head">
                    <div>
                      <h2>Tu repertorio</h2>
                      <p>
                        {techniques.positions.length} posiciones ·{" "}
                        {
                          techniques.positions
                            .flatMap((p) => p.tecnicas)
                            .filter((t) => t.descripcion_del_alumno.trim())
                            .length
                        }
                        /
                        {techniques.positions.flatMap((p) => p.tecnicas).length}{" "}
                        técnicas descritas
                      </p>
                    </div>
                    <input
                      aria-label="Buscar posiciones"
                      placeholder="Buscar posición…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </section>
                  <div className="positions-grid">
                    {techniques.positions
                      .filter((p) =>
                        p.posicion.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((p) => (
                        <article className="position" key={p.id}>
                          <div className="position-title">
                            <div>
                              <span className="pill">P{p.prioridad}</span>
                              <input
                                aria-label="Nombre de posición"
                                value={p.posicion}
                                onChange={(e) =>
                                  void saveTech({
                                    ...techniques,
                                    positions: techniques.positions.map((v) =>
                                      v.id === p.id
                                        ? { ...v, posicion: e.target.value }
                                        : v,
                                    ),
                                  })
                                }
                              />
                            </div>
                            <div className="priority" role="group" aria-label={`Prioridad de ${p.posicion}`}>
                              <span>Prioridad</span>
                              <div className="priority-stepper">
                                <button
                                  type="button"
                                  aria-label="Reducir prioridad"
                                  disabled={busy || p.prioridad <= 1}
                                  onClick={() => void saveTech({
                                    ...techniques,
                                    positions: techniques.positions.map((v) => v.id === p.id ? {...v, prioridad: p.prioridad - 1} : v),
                                  })}
                                >−</button>
                                <output aria-label="Prioridad">{p.prioridad}</output>
                                <button
                                  type="button"
                                  aria-label="Aumentar prioridad"
                                  disabled={busy || p.prioridad >= Number.MAX_SAFE_INTEGER}
                                  onClick={() => void saveTech({
                                    ...techniques,
                                    positions: techniques.positions.map((v) => v.id === p.id ? {...v, prioridad: Number.isSafeInteger(p.prioridad) && p.prioridad >= 1 ? p.prioridad + 1 : 1} : v),
                                  })}
                                >+</button>
                              </div>
                            </div>
                          </div>
                          {p.tecnicas.map((t, i) => (
                            <div className="technique" key={t.id}>
                              <span className="number">{i + 1}</span>
                              <div>
                                <input
                                  aria-label="Tipo de técnica"
                                  value={t.tipo}
                                  onChange={(e) =>
                                    void saveTech({
                                      ...techniques,
                                      positions: techniques.positions.map(
                                        (v) =>
                                          v.id === p.id
                                            ? {
                                                ...v,
                                                tecnicas: v.tecnicas.map((x) =>
                                                  x.id === t.id
                                                    ? {
                                                        ...x,
                                                        tipo: e.target.value,
                                                      }
                                                    : x,
                                                ),
                                              }
                                            : v,
                                      ),
                                    })
                                  }
                                />
                                <textarea
                                  aria-label="Descripción de técnica o enlace de vídeo"
                                  placeholder="La técnica que te funciona en combate, o su vídeo…"
                                  value={t.descripcion_del_alumno}
                                  onChange={(e) =>
                                    void saveTech({
                                      ...techniques,
                                      positions: techniques.positions.map(
                                        (v) =>
                                          v.id === p.id
                                            ? {
                                                ...v,
                                                tecnicas: v.tecnicas.map((x) =>
                                                  x.id === t.id
                                                    ? {
                                                        ...x,
                                                        descripcion_del_alumno:
                                                          e.target.value,
                                                      }
                                                    : x,
                                                ),
                                              }
                                            : v,
                                      ),
                                    })
                                  }
                                />
                                {comments?.comments.find(
                                  (c) => c.techniqueId === t.id,
                                )?.comment && (
                                  <p className="note">
                                    Entrenador:{" "}
                                    {
                                      comments.comments.find(
                                        (c) => c.techniqueId === t.id,
                                      )?.comment
                                    }
                                  </p>
                                )}
                              </div>
                              <div className="mini-actions">
                                <button
                                  aria-label="Subir técnica"
                                  disabled={!i}
                                  onClick={() =>
                                    void saveTech({
                                      ...techniques,
                                      positions: techniques.positions.map(
                                        (v) =>
                                          v.id === p.id
                                            ? {
                                                ...v,
                                                tecnicas: move(
                                                  v.tecnicas,
                                                  i,
                                                  i - 1,
                                                ),
                                              }
                                            : v,
                                      ),
                                    })
                                  }
                                >
                                  ↑
                                </button>
                                <button
                                  aria-label="Borrar técnica"
                                  onClick={() => {
                                    if (
                                      confirm(
                                        "¿Eliminar esta técnica? Se recalcularán las sesiones futuras de tus planes activos; el histórico se conserva.",
                                      )
                                    )
                                      void saveTech({
                                        ...techniques,
                                        positions: techniques.positions.map(
                                          (v) =>
                                            v.id === p.id
                                              ? {
                                                  ...v,
                                                  tecnicas: v.tecnicas.filter(
                                                    (x) => x.id !== t.id,
                                                  ),
                                                }
                                              : v,
                                        ),
                                      });
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          ))}
                          <div className="position-footer">
                            <button
                              className="secondary"
                              onClick={() =>
                                void saveTech({
                                  ...techniques,
                                  positions: techniques.positions.map((v) =>
                                    v.id === p.id
                                      ? {
                                          ...v,
                                          tecnicas: [
                                            ...v.tecnicas,
                                            {
                                              id: crypto.randomUUID(),
                                              tipo: "Nueva técnica",
                                              descripcion_del_alumno: "",
                                            },
                                          ],
                                        }
                                      : v,
                                  ),
                                })
                              }
                            >
                              Añadir técnica
                            </button>
                            <button
                              className="subtle"
                              disabled={techniques.positions.indexOf(p) === 0}
                              onClick={() =>
                                void saveTech({
                                  ...techniques,
                                  positions: move(
                                    techniques.positions,
                                    techniques.positions.indexOf(p),
                                    techniques.positions.indexOf(p) - 1,
                                  ),
                                })
                              }
                            >
                              Subir posición
                            </button>
                            <button
                              className="danger"
                              onClick={() => {
                                if (
                                  confirm(
                                    "¿Eliminar la posición y sus técnicas? Se recalcularán las sesiones futuras de tus planes activos; el histórico se conserva.",
                                  )
                                )
                                  void saveTech({
                                    ...techniques,
                                    positions: techniques.positions.filter(
                                      (v) => v.id !== p.id,
                                    ),
                                  });
                              }}
                            >
                              Eliminar posición
                            </button>
                          </div>
                        </article>
                      ))}
                  </div>
                  <button
                    onClick={() =>
                      void saveTech({
                        ...techniques,
                        positions: [
                          ...techniques.positions,
                          {
                            id: crypto.randomUUID(),
                            posicion: "Nueva posición",
                            prioridad: 1,
                            tecnicas: [],
                          },
                        ],
                      })
                    }
                  >
                    Añadir posición
                  </button>
                </>
              )}
              {tab === "plans" && (
                <section>
                  <div className="section-head">
                    <div>
                      <h2>Camino al torneo</h2>
                      <p>
                        Las sesiones pasadas y la de hoy conservan sus textos.
                        Las futuras reciben las descripciones y comentarios
                        actualizados.
                      </p>
                    </div>
                  </div>
                  {!plans.length && (
                    <div className="empty">
                      Tu entrenador puede asignarte una competición. Sincroniza
                      para recibirla.
                    </div>
                  )}
                  {plans.map((plan) => (
                    <PlanView key={plan.planId} plan={plan} run={run} />
                  ))}
                </section>
              )}
              {tab === "profile" && profile && (
                <ProfileView
                  profile={profile}
                  sha={entries.find((e) => e.key === "profile")?.sha || null}
                  trainer={Boolean(trainer)}
                  onDirty={setProfileUnsaved}
                  run={run}
                />
              )}
              {tab === "trainer" && trainer && (
                <section
                  className="trainer-dashboard"
                  aria-label="Dashboard del entrenador"
                >
                  <div className="dashboard-heading">
                    <div>
                      <h2>
                        {trainerSection === "team"
                          ? "Tu equipo"
                          : trainerSection === "competitions"
                            ? "Competiciones"
                            : "Cobertura por fecha"}
                      </h2>
                      <p>
                        Consulta el repertorio de cada alumno y organiza sus
                        próximos torneos.
                      </p>
                    </div>
                    <a
                      className="action-link"
                      href="#competition-create"
                      onClick={() => setTrainerSection("competitions")}
                    >
                      Crear competición
                    </a>
                  </div>
                  <div
                    className="trainer-sections"
                    role="group"
                    aria-label="Áreas del entrenador"
                  >
                    {[
                      ["team", "Equipo"],
                      ["competitions", "Competiciones"],
                      ["coverage", "Cobertura por fecha"],
                    ].map(([key, title]) => (
                      <button
                        key={key}
                        className={
                          trainerSection === key ? "selected" : "secondary"
                        }
                        aria-pressed={trainerSection === key}
                        onClick={() => setTrainerSection(key)}
                      >
                        {title}
                      </button>
                    ))}
                  </div>
                  {trainerSection !== "coverage" && (
                    <dl
                      className="dashboard-overview"
                      aria-label="Resumen del equipo"
                    >
                      <div>
                        <dt>Alumnos registrados</dt>
                        <dd>
                          {catalog
                            ? students.filter(
                                (s) => s.profile.perfil === "alumno",
                              ).length
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Competiciones creadas</dt>
                        <dd>{catalog ? catalog.data.plans.length : "—"}</dd>
                      </div>
                      <div>
                        <dt>Asignaciones a competición</dt>
                        <dd>
                          {catalog
                            ? catalog.data.plans.reduce(
                                (n, c) => n + c.alumnos.length,
                                0,
                              )
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                  )}
                  {trainerSection === "team" && (
                    <div className="team-workspace">
                      <section
                        className="roster"
                        aria-label="Listado de alumnos"
                      >
                        <div className="roster-heading">
                          <h3>Equipo</h3>
                          <button
                            className="subtle"
                            disabled={busy}
                            onClick={() => void run(trainers)}
                          >
                            Actualizar
                          </button>
                        </div>
                        <label className="search-label">
                          Buscar alumnos
                          <input
                            type="search"
                            placeholder="Nombre o correo…"
                            value={studentSearch}
                            onChange={(e) => setStudentSearch(e.target.value)}
                          />
                        </label>
                        <div className="student-grid">
                          {students
                            .filter((s) =>
                              (
                                s.profile.mail +
                                " " +
                                s.profile.nombre +
                                " " +
                                s.profile.apellidos
                              )
                                .toLowerCase()
                                .includes(studentSearch.toLowerCase()),
                            )
                            .map((s) => (
                              <button
                                key={s.profile.mail}
                                className={`student-card ${selectedStudent === s.profile.mail ? "student-selected" : ""}`}
                                aria-pressed={
                                  selectedStudent === s.profile.mail
                                }
                                onClick={() => selectStudent(s.profile.mail)}
                              >
                                <span
                                  className="student-avatar"
                                  aria-hidden="true"
                                >
                                  {(s.profile.nombre || s.profile.mail)
                                    .slice(0, 1)
                                    .toUpperCase()}
                                </span>
                                <span className="student-info">
                                  <strong>
                                    {s.profile.nombre
                                      ? `${s.profile.nombre} ${s.profile.apellidos || ""}`
                                      : s.profile.mail}
                                  </strong>
                                  <span>
                                    {s.profile.cinturon ||
                                      "Sin cinturón indicado"}{" "}
                                    · {s.profile.perfil}
                                  </span>
                                </span>
                              </button>
                            ))}
                        </div>
                        {catalog &&
                          !students.some((s) =>
                            `${s.profile.mail} ${s.profile.nombre} ${s.profile.apellidos}`
                              .toLowerCase()
                              .includes(studentSearch.toLowerCase()),
                          ) && (
                            <p className="roster-empty">
                              {studentSearch
                                ? "No hay coincidencias. Prueba con otro nombre o correo."
                                : "Todavía no hay usuarios registrados."}
                            </p>
                          )}
                        {!catalog && (
                          <p className="roster-empty">
                            {busy
                              ? "Cargando equipo…"
                              : "Pulsa Actualizar para cargar el equipo."}
                          </p>
                        )}
                      </section>
                      <div className="student-workspace">
                        {studentLoading && (
                          <section className="student-placeholder student-loading" role="status" aria-live="polite" aria-label="Cargando alumno">
                            <span className="loading-spinner" aria-hidden="true" />
                            <div className="student-loading-copy"><h3>Cargando alumno</h3><p>Preparando sus técnicas y planes…</p></div>
                          </section>
                        )}
                        {studentLoadFailed && !studentLoading && (
                          <section className="student-placeholder">
                            <h3>No se pudo cargar la información del alumno.</h3>
                            <button onClick={() => selectStudent(selectedStudent)}>Reintentar carga</button>
                          </section>
                        )}
                        {!selectedStudent && (
                          <section className="student-placeholder">
                            <SectionIcon name="techniques" />
                            <h3>Trabaja el juego de cada alumno.</h3>
                            <p>
                              Selecciona a alguien del equipo para consultar sus
                              técnicas, escribir comentarios y revisar sus
                              planes.
                            </p>
                            <p className="placeholder-detail">
                              Las descripciones son del alumno. Tus comentarios
                              se guardan por separado.
                            </p>
                          </section>
                        )}
                        {student && (
                          <TrainerStudent
                            key={student.profile.data.mail}
                            snapshot={student}
                            section={studentSection}
                            refreshing={studentRefreshing}
                            planId={studentPlanId}
                            choosePlan={(id)=>selectStudent(selectedStudent,"plans",false,id)}
                            changeSection={(section) => selectStudent(selectedStudent,section)}
                            run={run}
                            reload={async () => {
                              const sequence=studentSequence.current;
                              const data=await client.trainerView(selectedStudent,studentSection,true,studentPlanId);
                              if(sequence===studentSequence.current&&!client.locked)setStudent(data);
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                  {trainerSection === "coverage" && (
                    <TrainerCoverage
                      students={students}
                      run={run}
                      busy={busy}
                    />
                  )}
                  {catalog && trainerSection === "competitions" && (
                    <div className="competition-workspace">
                      <CompetitionForm
                        students={students}
                        run={run}
                        sha={catalog.sha}
                        reload={trainers}
                      />
                      <section
                        className="competition-list"
                        aria-label="Competiciones creadas"
                      >
                        <h3>Competiciones del equipo</h3>
                        {!catalog.data.plans.length && (
                          <p className="competition-empty">
                            Aún no hay competiciones. Define las fechas y asigna
                            alumnos en el formulario.
                          </p>
                        )}
                        {catalog.data.plans.map((c) => (
                          <CompetitionCard key={c.planId} competition={c} students={students} sha={catalog.sha} run={run} reload={trainers} />
                        ))}
                      </section>
                    </div>
                  )}
                </section>
              )}
              <section className="backup">
                <h3>Copia de seguridad</h3>
                <button
                  className="secondary"
                  onClick={() =>
                    void run(async () => {
                      const data = await client.load();
                      const blob = new Blob(
                        [
                          JSON.stringify(
                            {
                              schemaVersion: 1,
                              mail: client.identity!.mail,
                              entries: data.map(({ key, data }) => ({
                                key,
                                data,
                              })),
                            },
                            null,
                            2,
                          ),
                        ],
                        { type: "application/json" },
                      );
                      download(blob, "PGT_copia.json");
                    })
                  }
                >
                  Exportar mi copia JSON
                </button>
                <label>
                  Restaurar copia propia
                  <input
                    type="file"
                    accept="application/json"
                    onChange={(e) =>
                      void run(async () => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const backup = JSON.parse(await file.text());
                        if (backup.mail !== client.identity!.mail)
                          throw Error("La copia pertenece a otro alumno");
                        if (
                          !confirm(
                            "Se importará como cambios locales pendientes, sin sobrescribir GitHub automáticamente.",
                          )
                        )
                          return;
                        await client.importBackup(backup);
                      })
                    }
                  />
                </label>
              </section>
            </main>
          </div>
        </>
      )}
      {update && (
        <aside className="update">
          Hay una nueva versión.
          <button
            onClick={() =>
              void run(async () => {
                if ((await db.entries.toArray()).some((e) => e.dirty))
                  throw Error(
                    "Sincroniza tus cambios antes de actualizar; puedes exportar una copia",
                  );
                update.waiting?.postMessage("ACTIVATE_UPDATE");
                navigator.serviceWorker.addEventListener(
                  "controllerchange",
                  () => location.reload(),
                  { once: true },
                );
              })
            }
          >
            Actualizar aplicación
          </button>
        </aside>
      )}
      <footer>
        PGT · Jiu-jitsu · {navigator.onLine ? "Con conexión" : "Sin conexión"}
      </footer>
    </div>
  );
}
function move<T>(a: T[], from: number, to: number) {
  const next = [...a];
  const [v] = next.splice(from, 1);
  next.splice(to, 0, v);
  return next;
}
function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function Auth({
  run,
  busy,
}: {
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [register, setRegister] = useState(false);
  const [showPassword,setShowPassword]=useState(false);
  return (
    <section className="auth" id="main-content">
      <p className="auth-team">Portugal Gold Team</p>
      <h1>Prepárate para competir.</h1>
      <p>
        Tu repertorio personal, tus sesiones y los comentarios de tu entrenador.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(() =>
            register
              ? client.register(
                  String(f.get("mail")),
                  String(f.get("password")),
                  String(f.get("confirm")),
                  String(f.get("nombre")),
                  String(f.get("apellidos")),
                )
              : client.login(String(f.get("mail")), String(f.get("password"))),
          );
        }}
      >
        <label>
          Correo
          <input required name="mail" type="email" autoComplete="username" />
        </label>
        {register && (
          <div className="fields">
            <label>
              Nombre
              <input name="nombre" required />
            </label>
            <label>
              Apellidos
              <input name="apellidos" required />
            </label>
          </div>
        )}
        <label>
          Contraseña
          <span className="password-input">
          <input
            aria-label="Contraseña"
            required
            minLength={12}
            maxLength={128}
            name="password"
            type={!register && showPassword ? "text" : "password"}
            autoComplete={register ? "new-password" : "current-password"}
          />
          {!register && <button type="button" className="password-toggle" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{showPassword && <path d="m3 3 18 18"/>}</svg>
          </button>}
          </span>
        </label>
        {register && (
          <label>
            Repetir contraseña
            <input name="confirm" type="password" required />
          </label>
        )}
        <button disabled={busy}>
          {busy
            ? "Procesando…"
            : register
              ? "Crear cuenta de alumno"
              : "Entrar"}
        </button>
      </form>
      <button className="subtle" onClick={() => {setShowPassword(false);setRegister(!register);}}>
        {register ? "Ya tengo cuenta" : "Registrarme"}
      </button>
      <button
        className="subtle"
        onClick={() => alert("Contacte con el administrador")}
      >
        ¿Olvidó su contraseña?
      </button>
    </section>
  );
}
function ProfileView({
  profile,
  sha,
  trainer,
  run,
  onDirty,
}: {
  profile: Profile;
  sha: string | null;
  trainer: boolean;
  onDirty:(dirty:boolean)=>void;
  run: (a: () => Promise<unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => profileDraft(profile));
  const previous = useRef(profileDraft(profile));
  useEffect(() => {
    const incoming = profileDraft(profile);
    const baseline = previous.current;
    setDraft((current) => refreshProfileDraft(current, baseline, incoming));
    previous.current = incoming;
  }, [profile]);
  useEffect(()=>{
    const saved=profileDraft(profile);
    onDirty((Object.keys(saved) as (keyof typeof draft)[]).some(key=>draft[key]!==saved[key]&&!(key==="peso"&&draft[key]!==""&&saved[key]!==""&&Number(draft[key])===Number(saved[key]))));
  },[draft,profile,onDirty]);
  useEffect(()=>()=>onDirty(false),[onDirty]);
  const field = (name: keyof typeof draft) => ({
    value: draft[name],
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    ) => setDraft((current) => ({ ...current, [name]: event.target.value })),
  });
  return (
    <section className="card">
      <h2>Mi perfil</h2>
      <p>
        {profile.mail} · {profile.perfil}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(() =>
            client.edit("profile", {
              ...profile,
              nombre: String(f.get("nombre")),
              apellidos: String(f.get("apellidos")),
              fecha_nacimiento: String(f.get("fecha")) || null,
              peso: f.get("peso") ? Number(f.get("peso")) : null,
              cinturon: String(f.get("cinturon")) as Profile["cinturon"],
            }),
          );
        }}
      >
        <div className="fields">
          <label>
            Nombre
            <input name="nombre" {...field("nombre")} />
          </label>
          <label>
            Apellidos
            <input name="apellidos" {...field("apellidos")} />
          </label>
          <label>
            Fecha de nacimiento
            <input name="fecha" type="date" {...field("fecha")} />
          </label>
          <label>
            Peso (kg)
            <input name="peso" type="number" min="0.1" max="499.9" step="0.1" {...field("peso")} />
          </label>
          <label>
            Cinturón
            <select
              name="cinturon"
              aria-label="Cinturón"
              {...field("cinturon")}
            >
              {["Blanco", "Azul", "Morado", "Marrón", "Negro"].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
        </div>
        <button>Guardar en este dispositivo</button>
      </form>
      <PasswordForm mail={profile.mail} sha={sha} run={run} own />
      {trainer && (
        <p>
          Para restablecer contraseñas de alumnos, abre su ficha en Entrenador.
        </p>
      )}
    </section>
  );
}
function PasswordForm({
  mail,
  sha,
  run,
  own = false,
}: {
  mail: string;
  sha: string | null;
  run: (a: () => Promise<unknown>) => Promise<void>;
  own?: boolean;
}) {
  return (
    <form
      className="password-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(async () => {
          await client.request("/api/app/password", "POST", {
            mail,
            password: f.get("password"),
            confirm: f.get("confirm"),
            sha,
          });
          alert("Contraseña cambiada y sesiones revocadas");
          if (own) await client.logout(true);
        });
      }}
    >
      <h3>
        {own ? "Cambiar mi contraseña" : "Restablecer contraseña del alumno"}
      </h3>
      <label>
        Contraseña nueva
        <input
          name="password"
          type="password"
          minLength={12}
          required
          autoComplete="new-password"
        />
      </label>
      <label>
        Repetir contraseña
        <input
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
        />
      </label>
      <button>Confirmar cambio remoto</button>
    </form>
  );
}
function PlanView({
  plan,
  run,
}: {
  plan: TrainingPlan;
  run: (a: () => Promise<unknown>) => Promise<void>;
}) {
  const t = tabata(plan);
  return (
    <article className="card plan-card">
      <div className="section-head">
        <h3>Torneo · {plan.fecha_torneo}</h3>
        <button onClick={() => void run(() => exportPlan(plan))}>
          Exportar PDF
        </button>
      </div>
      <p>
        Plan de solo lectura. Se actualiza desde las técnicas del participante
        y los comentarios del entrenador.
      </p>
      {plan.structuralUpdateError && <p role="alert">Actualización del plan bloqueada: {plan.structuralUpdateError} El plan anterior se conserva; corrige el catálogo y vuelve a sincronizar.</p>}
      <p className="timer">
        Trabajo {format(t.work)} · Cambio {format(t.rest)} · {t.cycles} ciclos ·{" "}
        {t.sets} sets · Entre técnicas {format(t.betweenSets)} · Total{" "}
        {format(t.duration)}
      </p>
      <div className="plan-sessions">
        {plan.sessions.map((session) => (
          <details className="session" key={session.date}>
            <summary>
              {new Date(session.date + "T12:00:00").toLocaleDateString(
                "es-ES",
                {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                },
              )}{" "}
              · {session.exercises.length} ejercicios
            </summary>
            {session.exercises.map((ex, ei) => (
              <div className="exercise" key={ei}>
                <strong>
                  {ei + 1}. P{ex.prioridad} · {ex.posicion}
                </strong>
                <p><strong>{ex.tipo}</strong></p>
                <p className="plan-description">{ex.descripcion_del_alumno}</p>
                {ex.comment && <p className="note">Entrenador: {ex.comment}</p>}
              </div>
            ))}
          </details>
        ))}
      </div>
    </article>
  );
}
function TrainerStudent({
  snapshot,
  section,
  refreshing,
  planId,
  choosePlan,
  changeSection,
  run,
  reload,
}: {
  snapshot: TrainerView;
  section:TrainerSection;
  refreshing:boolean;
  planId:string;
  choosePlan:(id:string)=>void;
  changeSection:(section:TrainerSection)=>void;
  run: (a: () => Promise<unknown>) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const p = snapshot.profile.data,
    t = snapshot.techniques?.data as Techniques | undefined,
    [search, setSearch] = useState(""),
    [roleDraft,setRoleDraft]=useState(p.perfil),
    [roleSaving,setRoleSaving]=useState(false);
  useEffect(()=>setRoleDraft(p.perfil),[p.mail,p.perfil]);
  const notes = snapshot.comments?.data as Comments | undefined;
  const {total,described}=useMemo(()=>{
    let total=0,described=0;
    for(const p of t?.positions||[])for(const technique of p.tecnicas){total++;if(technique.descripcion_del_alumno.trim())described++;}
    return {total,described};
  },[t]);
  const percent = Math.round((described / Math.max(1, total)) * 100);
  return (
    <section className="card student-detail">
      <div className="student-detail-heading">
        <div>
          <p className="muted">Ficha del alumno</p>
          <h3>{p.nombre ? `${p.nombre} ${p.apellidos || ""}` : p.mail}</h3>
          <p>{p.mail}</p>
        </div>
        <span className="pill">{p.cinturon || "Sin cinturón indicado"}</span>
      </div>
      <div className="student-sections" role="group" aria-label="Información del alumno">
        {[["techniques", "Técnicas"], ["plans", "Planes"], ["administration", "Administración"]].map(([key,label]) => (
          <button key={key} className={section === key ? "selected" : "secondary"} aria-pressed={section === key} onClick={() => changeSection(key as TrainerSection)}>{label}</button>
        ))}
      </div>
      {refreshing && <p className="muted" role="status" aria-label="Actualizando ficha">Actualizando en segundo plano…</p>}
      {section === "techniques" && t && notes && <>
      <div className="repertoire-progress">
        <div>
          <span>
            {described}/{total} técnicas descritas
          </span>
          <strong>{percent} %</strong>
        </div>
        <progress
          value={described}
          max={Math.max(1, total)}
          aria-label="Técnicas con descripción"
        />
      </div>
      <input
        placeholder="Buscar posición del alumno"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Buscar posición del alumno"
      />
      {t.positions
        .filter((p) => p.posicion.toLowerCase().includes(search.toLowerCase()))
        .map((p) => (
          <details key={p.id}>
            <summary>
              P{p.prioridad} · {p.posicion}
            </summary>
            {p.tecnicas.map((tech) => (
              <div key={tech.id} className="exercise">
                <strong>{tech.tipo}</strong>
                <textarea className="student-description" aria-label="Descripción del alumno" readOnly value={tech.descripcion_del_alumno} placeholder="Sin descripción" rows={3} />
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      const comments = [
                        ...notes.comments.filter(
                          (c) => c.techniqueId !== tech.id,
                        ),
                        {
                          techniqueId: tech.id,
                          comment: String(f.get("comment")),
                        },
                      ];
                      await client.request(
                        `/api/app/users/${encodeURIComponent(snapshot.profile.data.mail)}/comments`,
                        "PUT",
                        {
                          data: { ...notes, comments },
                          sha: snapshot.comments!.sha,
                        },
                      );
                      await reload();
                    });
                  }}
                >
                  <label>
                    Comentario
                    <textarea
                      name="comment"
                      defaultValue={
                        notes.comments.find((c) => c.techniqueId === tech.id)
                          ?.comment || ""
                      }
                    />
                  </label>
                  <button>Guardar comentario remoto</button>
                </form>
              </div>
            ))}
          </details>
        ))}
      </>}
      {section === "administration" && <>
      <label>
        Rol
        <select
          aria-label="Rol"
          value={roleDraft}
          disabled={roleSaving}
          onChange={(e) => {
            // Capture before run awaits local saves: React restores a controlled select meanwhile.
            const perfil=e.currentTarget.value as Profile["perfil"];
            setRoleDraft(perfil);setRoleSaving(true);
            void run(async () => {
              try {
                await client.request("/api/app/role", "POST", {mail:p.mail,perfil,sha:snapshot.profile.sha});
                await reload();
              } catch(error) {setRoleDraft(p.perfil);throw error;}
              finally {setRoleSaving(false);}
            });
          }}
        >
          <option value="alumno">Alumno</option>
          <option value="entrenador">Entrenador</option>
        </select>
      </label>
      {roleSaving && <p role="status" aria-label="Guardando rol">Guardando rol…</p>}
        <PasswordForm mail={p.mail} sha={snapshot.profile.sha} run={run} />
      </>}
      {section === "plans" && <>
        {Boolean(snapshot.planSummaries?.length) && <label>Plan del alumno<select aria-label="Plan del alumno" value={planId} onChange={e=>choosePlan(e.target.value)}><option value="">Selecciona un plan</option>{snapshot.planSummaries?.map(p=><option key={p.planId} value={p.planId}>{p.fecha_torneo?`Torneo · ${p.fecha_torneo}`:`Plan · ${p.planId}`}</option>)}</select></label>}

        {snapshot.plans?.length ? snapshot.plans.map((r) => (
          <PlanView key={r.data.planId} plan={r.data} run={run} />
        )) : <p className="muted">{snapshot.planSummaries?.length ? "Selecciona un plan para consultar sus sesiones." : "Este alumno todavía no tiene planes asignados."}</p>}
      </>}
    </section>
  );
}
function TrainerCoverage({
  students,
  run,
  busy,
}: {
  students: any[];
  run: (a: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [mail, setMail] = useState("");
  const [planId, setPlanId] = useState("");
  const [date, setDate] = useState(
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10),
  );
  const [inclusive, setInclusive] = useState(true);
  const [filter, setFilter] = useState("all");
  const plan = snapshot?.plans.find((r) => r.data.planId === planId)?.data;
  const report = plan ? planCoverage(plan, date, inclusive) : null;
  return (
    <section
      className="coverage-area"
      aria-label="Cobertura del plan por fecha"
    >
      <p>
        Trabajo previsto en la instantánea del plan. No registra asistencia ni
        cambia la planificación.
      </p>
      <div className="card coverage-controls">
        <label>
          Alumno para cobertura
          <select
            disabled={busy}
            value={mail}
            onChange={(e) => {
              const selected = e.target.value;
              setMail(selected);
              setSnapshot(null);
              setPlanId("");
              if (selected)
                void run(async () => {
                  const data = (await client.request(
                    `/api/app/users/${encodeURIComponent(selected)}/snapshot`,
                  )) as Snapshot;
                  setSnapshot(data);
                  setPlanId(data.plans[0]?.data.planId || "");
                });
            }}
          >
            <option value="">Selecciona un alumno</option>
            {students.map((s) => (
              <option key={s.profile.mail} value={s.profile.mail}>
                {s.profile.nombre || s.profile.mail}
              </option>
            ))}
          </select>
        </label>
        <label>
          Plan para cobertura
          <select
            value={planId}
            disabled={!snapshot?.plans.length}
            onChange={(e) => setPlanId(e.target.value)}
          >
            <option value="">Selecciona un plan</option>
            {snapshot?.plans.map((r) => (
              <option key={r.data.planId} value={r.data.planId}>
                Torneo {r.data.fecha_torneo} · Desde {r.data.fecha_comienzo}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha de referencia
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={inclusive}
            onChange={(e) => setInclusive(e.target.checked)}
          />
          Incluir entrenamientos de ese día
        </label>
      </div>
      {snapshot && !snapshot.plans.length && (
        <p className="empty">
          Este alumno no tiene planes generados. Si ya tiene una competición
          asignada, debe sincronizar su cuenta para recibir el plan.
        </p>
      )}
      {!mail && (
        <p className="empty">
          Selecciona un alumno y su plan para revisar la preparación hasta una
          fecha.
        </p>
      )}
      {plan && report && (
        <>
          <dl className="coverage-overview">
            <div>
              <dt>Técnicas diferentes</dt>
              <dd>
                {report.unique} <small>/ {report.total}</small>
              </dd>
              <p>Del contenido programado en este plan</p>
            </div>
            <div>
              <dt>Sesiones incluidas</dt>
              <dd>{report.sessions}</dd>
              <p>{report.exercises} ejercicios con repeticiones</p>
            </div>
            <div>
              <dt>Posiciones completas</dt>
              <dd>
                {report.positions.filter((p) => p.complete > 0).length}{" "}
                <small>/ {report.positions.length}</small>
              </dd>
              <p>Al menos una pasada completa</p>
            </div>
            <div>
              <dt>Posiciones sin empezar</dt>
              <dd>{report.positions.filter((p) => !p.touched).length}</dd>
              <p>
                {report.positions.filter((p) => p.partial).length} con alguna
                pasada parcial
              </p>
            </div>
          </dl>
          <div className="section-head">
            <h3>Detalle por posición y técnica</h3>
            <label>
              Filtrar cobertura
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">Todo el plan</option>
                <option value="pending">Con técnicas pendientes</option>
                <option value="partial">Con pasadas parciales</option>
                <option value="untouched">Sin empezar</option>
              </select>
            </label>
          </div>
          <p className="coverage-scope">
            La instantánea conserva las técnicas programadas, no el catálogo
            completo de la fecha de creación. Las técnicas que nunca aparecen en
            este plan no se incluyen en el denominador. Una pasada se cuenta
            completa solo cuando todas sus técnicas programadas han aparecido y
            el plan conserva su marca de finalización.
          </p>
          <div
            className="coverage-table"
            role="region"
            aria-label="Detalle de cobertura"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Posición</th>
                  <th>Técnicas · primera fecha · apariciones</th>
                  <th>Pasadas completas</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {report.positions
                  .filter(
                    (p) =>
                      filter === "all" ||
                      (filter === "pending" &&
                        p.techniques.some((t) => !t.count)) ||
                      (filter === "partial" && p.partial) ||
                      (filter === "untouched" && !p.touched),
                  )
                  .map((p) => (
                    <tr key={p.id}>
                      <th scope="row">
                        <span className="pill">P{p.priority}</span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.techniques.filter((t) => t.count).length} /{" "}
                          {p.techniques.length} técnicas diferentes
                        </small>
                      </th>
                      <td>
                        {p.techniques.map((t) => (
                          <div className="coverage-technique" key={t.id}>
                            <span>{t.type}</span>
                            <small>
                              {t.first || "Pendiente"} · {t.count} veces
                            </small>
                          </div>
                        ))}
                      </td>
                      <td>{p.complete}</td>
                      <td>
                        {!p.touched
                          ? "Sin empezar"
                          : p.techniques.some((t) => !t.count)
                            ? "Técnicas pendientes"
                            : "Todas alcanzadas"}
                        {p.partial && <small>Pasada parcial</small>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!report.positions.length && (
            <p className="empty">Este plan no contiene sesiones.</p>
          )}
        </>
      )}
    </section>
  );
}
function CompetitionCard({competition:c, students, sha, run, reload}: {
  competition: Competition; students: any[]; sha: string | null;
  run: (action: () => Promise<unknown>) => Promise<void>; reload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<{alumnos:string[];base:string[];sha:string|null} | null>(null);
  const [saving,setSaving] = useState(false);
  const [deleting,setDeleting] = useState(false);
  const selected = draft?.alumnos ?? c.alumnos;
  const changed = selected.length !== c.alumnos.length || selected.some(mail => !c.alumnos.includes(mail));
  return <article className="card competition-card">
    <h3>Torneo · {c.fecha_torneo}</h3>
    <p>Inicio {c.fecha_comienzo} · {c.ejercicios_por_sesion} ejercicios · días {c.dias_de_entrenamiento.join(', ')}</p>
    <p>Configuración fijada al crear la competición.</p>
    <p>Al guardar, desasignar un participante elimina su plan individual.</p>
    {students.map(s => <label className="check" key={s.profile.mail}>
      <input type="checkbox" checked={selected.includes(s.profile.mail)} disabled={saving || deleting}
        onChange={e => {
          const checked=e.currentTarget.checked;
          setDraft(previous => {
            const current=previous?.alumnos ?? c.alumnos;
            const alumnos=checked ? [...current,s.profile.mail] : current.filter(mail=>mail!==s.profile.mail);
            const unchanged=alumnos.length===c.alumnos.length && alumnos.every(mail=>c.alumnos.includes(mail));
            return unchanged ? null : {alumnos,base:previous?.base ?? [...c.alumnos],sha:previous?.sha ?? sha};
          });
        }} />{s.profile.nombre || s.profile.mail}
    </label>)}
    <div className="competition-submit">
      <button disabled={!changed || saving || deleting} onClick={() => {
        if(!draft || saving)return;
        const baseUnchanged=draft.base.length===c.alumnos.length && draft.base.every(mail=>c.alumnos.includes(mail));
        const payload={planId:c.planId,alumnos:[...draft.alumnos],sha:baseUnchanged ? sha : draft.sha};
        setSaving(true);
        void run(async()=>{
          try {
            await client.request('/api/app/assignment','POST',payload);
            await reload();
            setDraft(null);
          } finally {setSaving(false);}
        });
      }}>Guardar datos</button>
      {saving && <span role="status" className="competition-loading"><span className="loading-spinner" aria-hidden="true" />Guardando participantes…</span>}
      {changed && !saving && <span className="competition-loading">Cambios sin guardar</span>}
      <button className="danger" disabled={saving || deleting} onClick={()=>{
        if(deleting || saving)return;
        if(!confirm('¿Borrar esta competición y todos sus planes individuales? Para desasignar un alumno, desmarca su casilla y pulsa Guardar datos.'))return;
        setDeleting(true);
        void run(async()=>{
          try {
            await client.request('/api/app/delete-competition','POST',{planId:c.planId,sha});
            await reload();
          } finally {setDeleting(false);}
        });
      }}>Borrar competición completa</button>
      {deleting && <span role="status" aria-label="Borrando competición" className="competition-loading"><span className="loading-spinner" aria-hidden="true" />Borrando competición…</span>}
    </div>
  </article>;
}

function CompetitionForm({
  students,
  sha,
  run,
  reload,
}: {
  students: any[];
  sha: string | null;
  run: (a: () => Promise<unknown>) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [creating,setCreating]=useState(false);
  const [dateErrors,setDateErrors]=useState<{start?:string;end?:string}>({});
  function checkDates(form:HTMLFormElement) {
    const start=form.elements.namedItem('start') as HTMLInputElement;
    const end=form.elements.namedItem('end') as HTMLInputElement;
    const errors=competitionDateErrors(start.value,end.value);
    start.setCustomValidity(errors.start || '');
    end.setCustomValidity(errors.end || '');
    setDateErrors(errors);
    return form.reportValidity();
  }
  return (
    <section className="card competition-create" id="competition-create">
      <h3>Crear competición</h3>
      <form
        onInput={e=>{
          const form=e.currentTarget;
          const start=form.elements.namedItem('start') as HTMLInputElement;
          const end=form.elements.namedItem('end') as HTMLInputElement;
          const errors=competitionDateErrors(start.value,end.value);
          start.setCustomValidity(errors.start || '');
          end.setCustomValidity(errors.end || '');
          setDateErrors(errors);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if(creating || !checkDates(e.currentTarget))return;
          const f = new FormData(e.currentTarget);
          const c: Competition = {
            planId: "",
            fecha_comienzo: String(f.get("start")),
            fecha_torneo: String(f.get("end")),
            alumnos: f.getAll("student").map(String),
            dias_de_entrenamiento: f.getAll("day").map(Number),
            ejercicios_por_sesion: Number(f.get("sets")),
            tiempo_por_tecnica_segundos: durationSeconds(String(f.get("work")))!,
            descanso_entre_ciclos_segundos: Number(f.get("change")),
            descanso_entre_tecnicas_segundos: Number(f.get("rest")),
          };
          setCreating(true);
          void run(async () => {
            try {
              await client.request("/api/app/competition", "POST", {competition:c,sha});
              await reload();
            } finally {setCreating(false);}
          });
        }}
      >
        <div className="fields">
          <label>
            Fecha inicial
            <input name="start" aria-label="Fecha inicial" type="date" required aria-invalid={Boolean(dateErrors.start)} aria-describedby={dateErrors.start ? 'competition-start-error' : undefined} />
            {dateErrors.start && <span className="field-error" id="competition-start-error">{dateErrors.start}</span>}
          </label>
          <label>
            Fecha del torneo
            <input name="end" aria-label="Fecha del torneo" type="date" required aria-invalid={Boolean(dateErrors.end)} aria-describedby={dateErrors.end ? 'competition-end-error' : undefined} />
            {dateErrors.end && <span className="field-error" id="competition-end-error">{dateErrors.end}</span>}
          </label>
          <label>
            Ejercicios por sesión
            <input
              name="sets"
              type="number"
              min="1"
              max="100"
              defaultValue={5}
              required
            />
          </label>
          <label>
            Trabajo por alumno (min:seg)
            <input
              className="duration-input"
              name="work"
              type="text"
              defaultValue="3:00"
              placeholder="3:00"
              maxLength={5}
              pattern="[0-9]{1,2}:[0-5][0-9]"
              title="Minutos y segundos, de 0:01 a 60:00"
              onInput={e=>e.currentTarget.setCustomValidity(durationSeconds(e.currentTarget.value)===null ? durationError : '')}
              required
            />
          </label>
          <label>
            Cambio de roles (s)
            <input
              name="change"
              max="3600"
              type="number"
              min="1"
              defaultValue={10}
              required
            />
          </label>
          <label>
            Entre técnicas (s)
            <input
              name="rest"
              max="3600"
              type="number"
              min="1"
              defaultValue={20}
              required
            />
          </label>
        </div>
        <fieldset>
          <legend>Días de entrenamiento</legend>
          {[
            "Lunes",
            "Martes",
            "Miércoles",
            "Jueves",
            "Viernes",
            "Sábado",
            "Domingo",
          ].map((day, i) => (
            <label className="check" key={day}>
              <input
                type="checkbox"
                name="day"
                value={i + 1}
                defaultChecked={[2, 4].includes(i + 1)}
              />
              {day}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Participantes (alumnos y entrenadores)</legend>
          {students.map((s) => (
            <label className="check" key={s.profile.mail}>
              <input name="student" type="checkbox" value={s.profile.mail} />
              {s.profile.nombre || s.profile.mail} · {s.profile.perfil}
            </label>
          ))}
        </fieldset>
        <div className="competition-submit">
          <button disabled={creating}>Crear competición</button>
          {creating && <span role="status" aria-label="Creando competición" className="competition-loading"><span className="loading-spinner" aria-hidden="true" /><span>Creando competición…</span></span>}
        </div>
      </form>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
