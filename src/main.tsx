import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { client, type Snapshot } from "./application/client.ts";
import { db, type LocalEntry } from "./infrastructure/local.ts";
import {
  now,
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
  const [entries, setEntries] = useState<LocalEntry[]>([]),
    [version, setVersion] = useState(0),
    [tab, setTab] = useState("techniques"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [trainerSection, setTrainerSection] = useState("team"),
    [studentSearch, setStudentSearch] = useState(""),
    [students, setStudents] = useState<any[]>([]),
    [student, setStudent] = useState<Snapshot | null>(null),
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
      void client
        .load()
        .then((data) => {
          if (client.identity?.mail === mail && !client.locked)
            setEntries(data);
        })
        .catch((e) => setError(e.message));
    } else {
      setEntries([]);
      setStudent(null);
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
      await action();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }
  async function saveTech(next: Techniques) {
    setEntries((e) =>
      e.map((v) =>
        v.key === "techniques" ? { ...v, data: next, dirty: true } : v,
      ),
    );
    try {
      await client.edit("techniques", next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    }
  }
  const plans = entries
    .filter((e) => e.key.startsWith("plan:"))
    .map((e) => e.data as TrainingPlan);
  async function trainers() {
    const data = await client.request("/api/app/students");
    setStudents(data.users);
    setCatalog(await client.request("/api/app/catalog"));
  }
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
                  <span role="status">{client.status}</span>
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
                    <p>{e.conflicts.join(", ")}</p>
                    <button
                      onClick={() =>
                        void run(() => client.resolve(e.key, "local"))
                      }
                    >
                      Conservar mi versión
                    </button>
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
                            <label className="priority">
                              Prioridad
                              <input
                                type="number"
                                min="1"
                                value={p.prioridad}
                                onChange={(e) =>
                                  void saveTech({
                                    ...techniques,
                                    positions: techniques.positions.map((v) =>
                                      v.id === p.id
                                        ? {
                                            ...v,
                                            prioridad: Number(e.target.value),
                                          }
                                        : v,
                                    ),
                                  })
                                }
                              />
                            </label>
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
                                        "¿Eliminar esta técnica? Sus planes existentes se conservarán.",
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
                                    "¿Eliminar la posición y sus técnicas?",
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
                    <PlanView
                      key={plan.planId}
                      plan={plan}
                      run={run}
                      edit={(next) => client.edit("plan:" + plan.planId, next)}
                    />
                  ))}
                </section>
              )}
              {tab === "profile" && profile && (
                <ProfileView
                  profile={profile}
                  sha={entries.find((e) => e.key === "profile")?.sha || null}
                  trainer={Boolean(trainer)}
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
                                className={`student-card ${student?.profile.data.mail === s.profile.mail ? "student-selected" : ""}`}
                                aria-pressed={
                                  student?.profile.data.mail === s.profile.mail
                                }
                                onClick={() =>
                                  void run(async () =>
                                    setStudent(
                                      await client.request(
                                        `/api/app/users/${encodeURIComponent(s.profile.mail)}/snapshot`,
                                      ),
                                    ),
                                  )
                                }
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
                        {!student && (
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
                            snapshot={student}
                            run={run}
                            reload={async () =>
                              setStudent(
                                await client.request(
                                  `/api/app/users/${encodeURIComponent(student.profile.data.mail)}/snapshot`,
                                ),
                              )
                            }
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
                          <article
                            key={c.planId}
                            className="card competition-card"
                          >
                            <h3>Torneo · {c.fecha_torneo}</h3>
                            <p>
                              Inicio {c.fecha_comienzo} ·{" "}
                              {c.ejercicios_por_sesion} ejercicios · días{" "}
                              {c.dias_de_entrenamiento.join(", ")}
                            </p>
                            <p>Configuración fijada al crear la competición.</p>
                            {students.map((s) => (
                              <label className="check" key={s.profile.mail}>
                                <input
                                  type="checkbox"
                                  checked={c.alumnos.includes(s.profile.mail)}
                                  onChange={(e) =>
                                    void run(async () => {
                                      await client.request(
                                        "/api/app/assignment",
                                        "POST",
                                        {
                                          planId: c.planId,
                                          alumnos: e.target.checked
                                            ? [...c.alumnos, s.profile.mail]
                                            : c.alumnos.filter(
                                                (m) => m !== s.profile.mail,
                                              ),
                                          sha: catalog.sha,
                                        },
                                      );
                                      await trainers();
                                    })
                                  }
                                />
                                {s.profile.nombre || s.profile.mail}
                              </label>
                            ))}
                            <button
                              className="danger"
                              onClick={() => {
                                if (
                                  confirm(
                                    "¿Borrar esta competición y todos sus planes individuales? Desasignar solo un alumno se hace con su casilla.",
                                  )
                                )
                                  void run(async () => {
                                    await client.request(
                                      "/api/app/delete-competition",
                                      "POST",
                                      { planId: c.planId, sha: catalog.sha },
                                    );
                                    await trainers();
                                  });
                              }}
                            >
                              Borrar competición completa
                            </button>
                          </article>
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
  const [register, setRegister] = useState(false),
    [bootstrap, setBootstrap] = useState(false);
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
          <input
            required
            minLength={12}
            maxLength={128}
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
          />
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
      <button className="subtle" onClick={() => setRegister(!register)}>
        {register ? "Ya tengo cuenta" : "Registrarme"}
      </button>
      <button
        className="subtle"
        onClick={() => alert("Contacte con el administrador")}
      >
        ¿Olvidó su contraseña?
      </button>
      <details>
        <summary>Configuración inicial del propietario</summary>
        <p>
          Registra primero tu cuenta. La clave administrativa existente permite
          crear el primer entrenador una sola vez.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(async () => {
              await client.request(
                "/api/app/bootstrap",
                "POST",
                { mail: String(f.get("mail")) },
                String(f.get("key")),
              );
              setBootstrap(true);
            });
          }}
        >
          <label>
            Correo registrado
            <input name="mail" type="email" required />
          </label>
          <label>
            Clave de configuración
            <input name="key" type="password" required autoComplete="off" />
          </label>
          <button>Crear primer entrenador</button>
        </form>
        {bootstrap && <p>Entrenador creado. Inicia sesión.</p>}
      </details>
    </section>
  );
}
function ProfileView({
  profile,
  sha,
  trainer,
  run,
}: {
  profile: Profile;
  sha: string | null;
  trainer: boolean;
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
            <input name="peso" type="number" step="0.1" {...field("peso")} />
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
  edit,
}: {
  plan: TrainingPlan;
  run: (a: () => Promise<unknown>) => Promise<void>;
  edit?: (p: TrainingPlan) => Promise<void>;
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
      <p className="timer">
        Trabajo {format(t.work)} · Cambio {format(t.rest)} · {t.cycles} ciclos ·{" "}
        {t.sets} sets · Entre técnicas {format(t.betweenSets)} · Total{" "}
        {format(t.duration)}
      </p>
      <div className="plan-sessions">
        {plan.sessions.map((session, si) => (
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
                <p>{ex.tipo}</p>
                {edit ? (
                  <textarea
                    aria-label="Editar descripción del plan"
                    value={ex.descripcion_del_alumno}
                    onChange={(e) =>
                      void edit({
                        ...plan,
                        sessions: plan.sessions.map((s, i) =>
                          i === si
                            ? {
                                ...s,
                                exercises: s.exercises.map((x, j) =>
                                  j === ei
                                    ? {
                                        ...x,
                                        descripcion_del_alumno: e.target.value,
                                      }
                                    : x,
                                ),
                              }
                            : s,
                        ),
                      })
                    }
                  />
                ) : (
                  <p>{ex.descripcion_del_alumno}</p>
                )}
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
  run,
  reload,
}: {
  snapshot: Snapshot;
  run: (a: () => Promise<unknown>) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const p = snapshot.profile.data,
    t = snapshot.techniques.data as Techniques,
    [search, setSearch] = useState("");
  const notes = snapshot.comments.data as Comments;
  const total = t.positions.reduce((n, p) => n + p.tecnicas.length, 0);
  const described = t.positions
    .flatMap((p) => p.tecnicas)
    .filter((t) => t.descripcion_del_alumno.trim()).length;
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
      <label>
        Rol
        <select
          value={p.perfil}
          onChange={(e) =>
            void run(async () => {
              await client.request("/api/app/role", "POST", {
                mail: p.mail,
                perfil: e.target.value,
                sha: snapshot.profile.sha,
              });
              await reload();
            })
          }
        >
          <option value="alumno">Alumno</option>
          <option value="entrenador">Entrenador</option>
        </select>
      </label>
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
                <p>{tech.descripcion_del_alumno || "Sin descripción"}</p>
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
                          sha: snapshot.comments.sha,
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
      <PasswordForm mail={p.mail} sha={snapshot.profile.sha} run={run} />
      {snapshot.plans.map((r) => (
        <PlanView key={r.data.planId} plan={r.data} run={run} />
      ))}
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
  return (
    <section className="card competition-create" id="competition-create">
      <h3>Crear competición</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const c: Competition = {
            planId: "",
            fecha_comienzo: String(f.get("start")),
            fecha_torneo: String(f.get("end")),
            alumnos: f.getAll("student").map(String),
            dias_de_entrenamiento: f.getAll("day").map(Number),
            ejercicios_por_sesion: Number(f.get("sets")),
            tiempo_por_tecnica_segundos: Number(f.get("work")),
            descanso_entre_ciclos_segundos: Number(f.get("change")),
            descanso_entre_tecnicas_segundos: Number(f.get("rest")),
          };
          void run(async () => {
            await client.request("/api/app/competition", "POST", {
              competition: c,
              sha,
            });
            await reload();
          });
        }}
      >
        <div className="fields">
          <label>
            Fecha inicial
            <input name="start" type="date" required />
          </label>
          <label>
            Fecha del torneo
            <input name="end" type="date" required />
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
            Trabajo por alumno (s)
            <input
              name="work"
              type="number"
              min="1"
              defaultValue={180}
              required
            />
          </label>
          <label>
            Cambio de roles (s)
            <input
              name="change"
              type="number"
              min="0"
              defaultValue={10}
              required
            />
          </label>
          <label>
            Entre técnicas (s)
            <input
              name="rest"
              type="number"
              min="0"
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
        <button>Crear competición con configuración fija</button>
      </form>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
