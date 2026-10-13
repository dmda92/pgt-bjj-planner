import React, { useEffect, useState } from "react";
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
import { tabata, coverage } from "./domain/planner.ts";
import { exportPlan } from "./infrastructure/pdf.ts";
import "./app.css";
const format = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
function App() {
  const [entries, setEntries] = useState<LocalEntry[]>([]),
    [version, setVersion] = useState(0),
    [tab, setTab] = useState("techniques"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
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
    <div className="shell">
      <header>
        <a className="brand" href="/">
          PGT<span>COMPETIDORES</span>
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
          <section className="welcome">
            <p className="eyebrow">PREPARACIÓN DE COMPETICIÓN</p>
            <h1>Construye tu juego.</h1>
            <p>
              Trabaja lo que te funciona. Guarda tus técnicas y llega al torneo
              con un plan.
            </p>
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
          <nav aria-label="Secciones">
            <button
              className={tab === "techniques" ? "selected" : ""}
              onClick={() => setTab("techniques")}
            >
              Mis técnicas
            </button>
            <button
              className={tab === "plans" ? "selected" : ""}
              onClick={() => setTab("plans")}
            >
              Mis planes <b>{plans.length}</b>
            </button>
            <button
              className={tab === "profile" ? "selected" : ""}
              onClick={() => setTab("profile")}
            >
              Perfil
            </button>
            {trainer && (
              <button
                className={tab === "trainer" ? "selected" : ""}
                onClick={() => {
                  setTab("trainer");
                  void run(trainers);
                }}
              >
                Entrenador
              </button>
            )}
          </nav>
          {entries
            .filter((e) => e.conflicts.length)
            .map((e) => (
              <section key={e.key} className="conflict">
                <h2>Conflicto en {e.key}</h2>
                <p>{e.conflicts.join(", ")}</p>
                <button
                  onClick={() => void run(() => client.resolve(e.key, "local"))}
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
                        .filter((t) => t.descripcion_del_alumno.trim()).length
                    }
                    /{techniques.positions.flatMap((p) => p.tecnicas).length}{" "}
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
                                  ? { ...v, prioridad: Number(e.target.value) }
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
                                positions: techniques.positions.map((v) =>
                                  v.id === p.id
                                    ? {
                                        ...v,
                                        tecnicas: v.tecnicas.map((x) =>
                                          x.id === t.id
                                            ? { ...x, tipo: e.target.value }
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
                                positions: techniques.positions.map((v) =>
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
                                positions: techniques.positions.map((v) =>
                                  v.id === p.id
                                    ? {
                                        ...v,
                                        tecnicas: move(v.tecnicas, i, i - 1),
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
                                  positions: techniques.positions.map((v) =>
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
                          if (confirm("¿Eliminar la posición y sus técnicas?"))
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
                    Los planes conservan tus técnicas tal como estaban al
                    generarse.
                  </p>
                </div>
              </div>
              {!plans.length && (
                <div className="empty">
                  Tu entrenador puede asignarte una competición. Sincroniza para
                  recibirla.
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
            <>
              <div className="section-head">
                <h2>Alumnos y competiciones</h2>
                <input
                  aria-label="Buscar alumnos"
                  placeholder="Buscar alumno…"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                />
                <button onClick={() => void run(trainers)}>Actualizar</button>
              </div>
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
                      className="student-card"
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
                      <strong>{s.profile.nombre || s.profile.mail}</strong>
                      <span>
                        {s.profile.cinturon} · {s.profile.perfil}
                      </span>
                    </button>
                  ))}
              </div>
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
              {catalog && (
                <>
                  <CompetitionForm
                    students={students}
                    run={run}
                    sha={catalog.sha}
                    reload={trainers}
                  />
                  {catalog.data.plans.map((c) => (
                    <article key={c.planId} className="card">
                      <h3>Torneo · {c.fecha_torneo}</h3>
                      <p>
                        Inicio {c.fecha_comienzo} · {c.ejercicios_por_sesion}{" "}
                        ejercicios · días {c.dias_de_entrenamiento.join(", ")}
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
                </>
              )}
            </>
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
                          entries: data.map(({ key, data }) => ({ key, data })),
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
    <section className="auth">
      <p className="eyebrow">PGT · TU JUEGO, TU PLAN</p>
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
            <input name="nombre" defaultValue={profile.nombre} />
          </label>
          <label>
            Apellidos
            <input name="apellidos" defaultValue={profile.apellidos} />
          </label>
          <label>
            Fecha de nacimiento
            <input
              name="fecha"
              type="date"
              defaultValue={profile.fecha_nacimiento || ""}
            />
          </label>
          <label>
            Peso (kg)
            <input
              name="peso"
              type="number"
              step="0.1"
              defaultValue={profile.peso ?? ""}
            />
          </label>
          <label>
            Cinturón
            <select name="cinturon" defaultValue={profile.cinturon}>
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
  const [before, setBefore] = useState("");
  const t = tabata(plan),
    stats = coverage(plan, before);
  return (
    <article className="card">
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
      <label>
        Cobertura hasta una fecha
        <input
          type="date"
          value={before}
          onChange={(e) => setBefore(e.target.value)}
        />
      </label>
      <p>
        {stats.touched.size} posiciones practicadas ·{" "}
        {Array.from(stats.completed.values()).reduce((a, b) => a + b, 0)}{" "}
        pasadas completas
      </p>
      <details>
        <summary>Cobertura por posición</summary>
        {[
          ...new Map(
            plan.sessions
              .flatMap((s) => s.exercises)
              .map((e) => [e.positionId, e]),
          ).values(),
        ].map((e) => (
          <p key={e.positionId}>
            {e.posicion}: {stats.completed.get(e.positionId) || 0} pasadas
            completas
            {stats.touched.has(e.positionId) &&
            !stats.completed.has(e.positionId)
              ? " · pasada parcial"
              : ""}
          </p>
        ))}
      </details>
      {plan.sessions.map((session, si) => (
        <details className="session" key={session.date}>
          <summary>
            {new Date(session.date + "T12:00:00").toLocaleDateString("es-ES", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}{" "}
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
  return (
    <section className="card">
      <h3>{p.nombre || p.mail}</h3>
      <p>
        {
          t.positions
            .flatMap((p) => p.tecnicas)
            .filter((t) => t.descripcion_del_alumno.trim()).length
        }
        /{t.positions.flatMap((p) => p.tecnicas).length} técnicas descritas ·{" "}
        {Math.round(
          (t.positions
            .flatMap((p) => p.tecnicas)
            .filter((t) => t.descripcion_del_alumno.trim()).length /
            Math.max(1, t.positions.flatMap((p) => p.tecnicas).length)) *
            100,
        )}{" "}
        %
      </p>
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
    <section className="card">
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
          <legend>Asignar alumnos</legend>
          {students
            .filter((s) => s.profile.perfil === "alumno")
            .map((s) => (
              <label className="check" key={s.profile.mail}>
                <input name="student" type="checkbox" value={s.profile.mail} />
                {s.profile.nombre || s.profile.mail}
              </label>
            ))}
        </fieldset>
        <button>Crear competición con configuración fija</button>
      </form>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
