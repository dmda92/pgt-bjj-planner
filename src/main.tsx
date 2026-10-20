import {onlinePresentation} from './application/online-presentation.ts';
import {OnlineDraft} from './application/online-draft.ts';
import {ownTrainingDay} from "./domain/own-training-day.ts";
import {Notifications} from "./ui-notifications.tsx";
import {TrainerPreparation,TrainerDay,Loading} from "./ui-trainer-reports.tsx";
import {listedCompetitions} from "./domain/trainer-reports.ts";
import {madridDate} from "./domain/plan-text-updates.ts";
import {weightValue,weightError} from "./application/weight-input.ts";
import {planIssueMessage,type PlanIssue} from "./domain/plan-issues.ts";
import {durationSeconds,durationError} from './application/duration-input.ts';
import {competitionDateErrors} from './application/competition-dates.ts';
import {syncPresentation} from "./application/sync-presentation.ts";
import type {TrainerView,TrainerSection} from "./application/trainer-cache.ts";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { client, onlineMode, type Snapshot } from "./application/client.ts";
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
  const onlineDraft=useRef<OnlineDraft<Techniques>|null>(null);
  const loadSequence = useRef(0);
  const studentSequence = useRef(0);
  const [entries, setEntries] = useState<LocalEntry[]>([]),
    [version, setVersion] = useState(0),
    [tab, setTab] = useState("techniques"),
    [ownPlanId, setOwnPlanId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [profileUnsaved,setProfileUnsaved]=useState(false),
    [search, setSearch] = useState(""),
    [trainerSection, setTrainerSection] = useState("team"),
    [competitionSection,setCompetitionSection]=useState("list"),
    [includePast,setIncludePast]=useState(false),
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
  const [notificationTarget,setNotificationTarget]=useState("");
  const [expandedPositions,setExpandedPositions]=useState<Set<string>>(()=>new Set());
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
          if (client.identity?.mail === mail && !client.locked && pendingTechniqueSaves.current === 0 && !onlineDraft.current?.hasDraft && sequence === loadSequence.current)
            setEntries(data);
        })
        .catch((e) => setError(e.message));
    } else {
      setExpandedPositions(new Set());
      setNotificationTarget("");
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
  useEffect(()=>{
    if(!active || tab!=="techniques" || !notificationTarget)return;
    const target=document.getElementById(`technique-${notificationTarget}`);
    if(target){
      const position=target.closest<HTMLDetailsElement>("details.position");
      if(position && !position.open){setExpandedPositions(previous=>new Set([...previous,position.dataset.positionId!]));return;}
      target.scrollIntoView({block:"center"});target.focus({preventScroll:true});setNotificationTarget("");}
  },[notificationTarget,tab,search,techniques,Boolean(active),expandedPositions]);
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
      if(onlineMode&&!onlineDraft.current?.hasFailed)await onlineDraft.current?.flush();
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
    if(onlineMode){
      if(!navigator.onLine){setError('Sin conexión. Las técnicas solo se pueden modificar con conexión.');return;}
      if(!onlineDraft.current){
        const mail=client.identity?.mail;
        onlineDraft.current=new OnlineDraft(async(data,base)=>{
          if(client.identity?.mail!==mail||client.locked)throw Error('Sesión cambiada');
          await client.edit('techniques',data,base);
          return client.lastConfirmedRevision.get('techniques')||base!;
        },error=>setError(error instanceof Error?error.message:'No se pudo guardar'),()=>setVersion(v=>v+1));
      }
      onlineDraft.current.update(next,entries.find(e=>e.key==='techniques')?.sha||null);
      setEntries(values=>values.map(e=>e.key==='techniques'?{...e,data:next,dirty:true}:e));
      setVersion(v=>v+1);return;
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
  const plans = useMemo(()=>entries
    .filter((e) => e.key.startsWith("plan:"))
    .map((e) => e.data as TrainingPlan),[entries]);
  const selectedOwnPlan = plans.find(plan => plan.planId === ownPlanId);
  useEffect(() => {
    if (!active || (ownPlanId && !selectedOwnPlan)) setOwnPlanId("");
  }, [active, ownPlanId, selectedOwnPlan]);
  function selectStudent(mail:string,section:TrainerSection="techniques",force=false,planId="") {
    const sequence=++studentSequence.current,owner=client.identity?.mail;
    setSelectedStudent(mail);setStudentSection(section);setStudentPlanId(planId);
    if(!force)setStudent(null);setStudentLoading(true);setStudentLoadFailed(false);
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
  useEffect(()=>{
    if(!onlineMode)return;
    const refresh=()=>{
      if(!client.identity||client.locked)return;
      if(trainer){void trainers().catch(e=>setError(e.message));if(selectedStudent)selectStudent(selectedStudent,studentSection,true,studentPlanId);}
      setVersion(v=>v+1);
    };
    window.addEventListener('pgt-live-update',refresh);return()=>window.removeEventListener('pgt-live-update',refresh);
  },[trainer,selectedStudent,studentSection,studentPlanId]);
  useEffect(()=>{if(!active){onlineDraft.current?.discard();onlineDraft.current=null;}},[Boolean(active)]);
  const syncState=(onlineMode?onlinePresentation:syncPresentation)(client.status,entries.some(e=>e.dirty)||pendingTechniqueSaves.current>0,entries.some(e=>e.key.startsWith("plan:")&&Boolean((e.data as TrainingPlan).structuralUpdateError)),profileUnsaved);
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
              <Notifications key={client.identity!.mail} owner={client.identity!.mail} techniques={techniques} comments={comments} onError={setError} onOpen={id=>{setSearch("");setTab("techniques");setNotificationTarget(id);}} />
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
      {busy && <Loading>Procesando solicitud…</Loading>}
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
                          : "Tu juego, técnica a técnica"}
                  </h1>
                  <p>
                    {tab === "trainer"
                      ? "Tu equipo, sus técnicas y la preparación de cada competición."
                      : "Trabaja lo que te funciona. Guarda tus técnicas y llega al torneo con un plan."}
                  </p>
                </div>
                <div className="sync">
                  <span role="status" className={syncState.success ? "sync-success" : undefined}>{client.status === "Sincronizando…" && <span className="loading-spinner" aria-hidden="true" />}{syncState.text}</span>
                  {!onlineMode&&<button
                    disabled={busy}
                    onClick={() => void run(() => client.sync())}
                  >
                    Sincronizar
                  </button>}
                </div>
              </section>

              {onlineMode&&onlineDraft.current?.hasFailed&&<section role="alert" className="conflict"><p>El borrador de técnicas no se ha guardado. No se enviará al recuperar la conexión.</p><button onClick={()=>void onlineDraft.current?.retry().catch(e=>setError(e.message))}>Reintentar guardado</button><button onClick={()=>{if(confirm('¿Descartar este borrador y cargar la versión actual?')){onlineDraft.current?.discard();void client.sync().catch(e=>setError(e.message));}}}>Revisar versión actual</button></section>}
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
                        <details className={`position repertoire-position ${p.tecnicas.length>0 && p.tecnicas.every(t=>t.descripcion_del_alumno.trim()) ? "is-complete" : "is-incomplete"}`} data-position-id={p.id} key={p.id} open={expandedPositions.has(p.id)} onToggle={e=>{
                          const open=e.currentTarget.open;
                          setExpandedPositions(previous=>{if(previous.has(p.id)===open)return previous;const next=new Set(previous);if(open)next.add(p.id);else next.delete(p.id);return next;});
                        }}>
                          <summary className="position-summary">
                            <span className="position-summary-heading"><span className="position-name-block"><strong>{p.posicion || "Sin nombre"}</strong><small className="priority-caption">Prioridad {p.prioridad}</small></span><span className="position-chevron" aria-hidden="true">⌄</span></span>
                            <span className="position-summary-meta"><span>{p.tecnicas.length} {p.tecnicas.length===1?"técnica":"técnicas"}</span><span className="position-status">{!p.tecnicas.length ? "Sin técnicas" : p.tecnicas.every(t=>t.descripcion_del_alumno.trim()) ? "✓ Completa" : `${p.tecnicas.filter(t=>!t.descripcion_del_alumno.trim()).length} sin descripción`}</span></span>
                            <span className="position-progress" role="progressbar" aria-label={`Descripciones de ${p.posicion}`} aria-valuemin={0} aria-valuemax={Math.max(1,p.tecnicas.length)} aria-valuenow={p.tecnicas.filter(t=>t.descripcion_del_alumno.trim()).length} aria-valuetext={`${p.tecnicas.filter(t=>t.descripcion_del_alumno.trim()).length} de ${p.tecnicas.length} técnicas con descripción`}><span style={{width:`${p.tecnicas.length ? p.tecnicas.filter(t=>t.descripcion_del_alumno.trim()).length/p.tecnicas.length*100 : 0}%`}} /></span>
                            <span className="technique-marks" aria-label="Estado de cada técnica">{p.tecnicas.map((t,i)=><span key={t.id} className={t.descripcion_del_alumno.trim()?"is-described":"is-missing"} title={`${t.tipo}: ${t.descripcion_del_alumno.trim()?"con descripción":"sin descripción"}`} aria-label={`${t.tipo}: ${t.descripcion_del_alumno.trim()?"con descripción":"sin descripción"}`}><span className="technique-mark-name" aria-hidden="true">{i+1}. {t.tipo || "Sin nombre"}</span><span aria-hidden="true">{t.descripcion_del_alumno.trim()?"✓":"○"}</span></span>)}</span>
                            <span className="position-open-hint">{expandedPositions.has(p.id)?"Cerrar posición":p.tecnicas.length>0 && p.tecnicas.every(t=>t.descripcion_del_alumno.trim())?"Ver técnicas":"Abrir y completar"}</span>
                          </summary>
                          <div className="position-editor">
                          <div className="position-title">
                            <div>
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
                            <div className={`technique ${t.descripcion_del_alumno.trim()?"technique-ready":"technique-pending"}`} id={`technique-${t.id}`} tabIndex={-1} key={t.id}>
                              <span className="number">{i + 1}</span>
                              <div>
                                <div className="technique-state">{t.descripcion_del_alumno.trim()?"✓ Con descripción":"○ Descripción pendiente"}</div>
                                <label className="technique-label" htmlFor={`type-${t.id}`}>Técnica</label>
                                <input id={`type-${t.id}`}
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
                                <label className="technique-label" htmlFor={`description-${t.id}`}>Tu descripción o enlace de vídeo</label>
                                <textarea id={`description-${t.id}`}
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
                                    {comments.comments.find(c => c.techniqueId === t.id)?.trainerName || "Entrenador"}:{" "}
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
                          </div>
                        </details>
                      ))}
                  </div>
                  <button onClick={()=>{
                    const id=crypto.randomUUID();
                    setExpandedPositions(previous=>new Set([...previous,id]));
                    void saveTech({...techniques,positions:[...techniques.positions,{id,posicion:"Nueva posición",prioridad:1,tecnicas:[]}]});
                  }}>
                    Añadir posición
                  </button>
                </>
              )}
              {tab === "plans" && (
                <section>
                  <OwnTrainingDay key={client.identity!.mail} plans={plans} owner={client.identity!.mail} />
                  <section className="own-complete-plans" aria-label="Planes completos">
                  <div className="section-head">
                    <div>
                      <h2>Planes completos</h2>
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
                  {plans.length > 0 && <>
                    <label>Mi plan
                      <select aria-label="Mi plan" value={selectedOwnPlan ? ownPlanId : ""} onChange={e => setOwnPlanId(e.target.value)}>
                        <option value="">Selecciona un plan</option>
                        {plans.map(plan => <option key={plan.planId} value={plan.planId}>Torneo · {plan.fecha_torneo}</option>)}
                      </select>
                    </label>
                    {selectedOwnPlan
                      ? <PlanView key={selectedOwnPlan.planId} plan={selectedOwnPlan} run={run} />
                      : <p className="muted">Selecciona un plan para consultar sus sesiones.</p>}
                  </>}
                  </section>
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
                            : trainerSection === "coverage" ? "Cobertura por alumno" : "Entrenamiento del día"}
                      </h2>
                      <p>
                        Consulta el repertorio de cada alumno y organiza sus
                        próximos torneos.
                      </p>
                    </div>
                    <a
                      className="action-link"
                      href="#competition-create"
                      onClick={() => {setTrainerSection("competitions");setCompetitionSection("create");}}
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
                      ["coverage", "Cobertura por alumno"],
                      ["day", "Entrenamiento del día"],
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
                  {["team","competitions"].includes(trainerSection) && (
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
                    <TrainerPreparation students={students} run={run} />
                  )}
                  {trainerSection === "day" && <TrainerDay run={run} />}
                  {catalog && trainerSection === "competitions" && (
                    <div>
                      <div className="trainer-sections" role="group" aria-label="Gestión de competiciones">
                        <button className={competitionSection === "list" ? "selected" : "secondary"} aria-pressed={competitionSection === "list"} onClick={()=>setCompetitionSection("list")}>Listado</button>
                        <button className={competitionSection === "create" ? "selected" : "secondary"} aria-pressed={competitionSection === "create"} onClick={()=>setCompetitionSection("create")}>Nueva competición</button>
                      </div>
                      {competitionSection === "create" && <CompetitionForm
                        students={students}
                        run={run}
                        sha={catalog.sha}
                        reload={async()=>{await trainers();setCompetitionSection("list");}}
                      />}
                      {competitionSection === "list" && <section
                        className="competition-list"
                        aria-label="Competiciones creadas"
                      >
                        <h3>Competiciones del equipo</h3>
                        <label className="check"><input type="checkbox" checked={includePast} onChange={e=>setIncludePast(e.target.checked)}/>Incluir competiciones pasadas</label>
                        {!listedCompetitions(catalog.data.plans,madridDate(),includePast).length && (
                          <p className="competition-empty">
                            No hay competiciones para este filtro.
                          </p>
                        )}
                        {listedCompetitions(catalog.data.plans,madridDate(),includePast).map((c) => (
                          <CompetitionCard key={c.planId} competition={c} students={students} sha={catalog.sha} run={run} reload={trainers} />
                        ))}
                      </section>}
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
                              unsavedTechniques:onlineMode ? onlineDraft.current?.value : undefined,
                              legacyDrafts: onlineMode ? JSON.parse((await db.meta.get("legacy-drafts:"+client.identity!.mail))?.value||"null") : undefined,
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
                            onlineMode ? "Se guardarán el perfil y las técnicas de esta copia en el servidor. Los planes son de solo lectura." : "Se importará como cambios locales pendientes, sin sobrescribir GitHub automáticamente.",
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
  const [weightInvalid,setWeightInvalid]=useState("");
  const draftBase = useRef(sha);
  const previous = useRef(profileDraft(profile));
  useEffect(() => {
    const incoming = profileDraft(profile);
    const baseline = previous.current;
    setDraft((current) => refreshProfileDraft(current, baseline, incoming));
    if(JSON.stringify(draft)===JSON.stringify(baseline))draftBase.current=sha;
    previous.current = incoming;
  }, [profile]);
  useEffect(()=>{
    const saved=profileDraft(profile);
    onDirty((Object.keys(saved) as (keyof typeof draft)[]).some(key=>draft[key]!==saved[key]&&!(key==="peso"&&draft[key]!==""&&saved[key]!==""&&weightValue(draft[key])===weightValue(saved[key]))));
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
          const error=weightError(String(f.get("peso")));
          setWeightInvalid(error);
          if(error){(e.currentTarget.elements.namedItem("peso") as HTMLInputElement).focus();return;}
          void run(() =>
            client.edit("profile", {
              ...profile,
              nombre: String(f.get("nombre")),
              apellidos: String(f.get("apellidos")),
              fecha_nacimiento: String(f.get("fecha")) || null,
              peso: weightValue(String(f.get("peso"))),
              cinturon: String(f.get("cinturon")) as Profile["cinturon"],
            },onlineMode ? draftBase.current : undefined).then(()=>{draftBase.current=client.lastConfirmedRevision.get("profile")||sha;}),
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
            <input name="peso" type="text" inputMode="decimal" {...field("peso")}
              aria-invalid={Boolean(weightInvalid)} aria-describedby={weightInvalid ? "profile-weight-error" : undefined}
              onInput={e=>{const error=weightError(e.currentTarget.value);e.currentTarget.setCustomValidity(error);setWeightInvalid(error);}} />
            {weightInvalid && <span className="field-error" role="alert" id="profile-weight-error">{weightInvalid}</span>}
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
function SessionExercises({session}:{session:TrainingPlan["sessions"][number]}) {
  return <>{session.exercises.map((ex,ei)=><div className="exercise" key={ei}>
    <strong>{ei+1}. {ex.posicion}</strong>
    <small className="priority-caption">Prioridad {ex.prioridad}</small>
    <p><strong>{ex.tipo}</strong></p>
    <p className="plan-description">{ex.descripcion_del_alumno}</p>
    {ex.comment && <p className="note">Entrenador: {ex.comment}</p>}
  </div>)}</>;
}
function OwnTrainingDay({plans,owner}:{plans:TrainingPlan[];owner:string}) {
  const [date,setDate]=useState("");
  const today=madridDate();
  const day=useMemo(()=>ownTrainingDay(plans,owner,today,date),[plans,owner,today,date]);
  return <section className="own-training-day" aria-label="Mis entrenamientos del día">
    <div className="section-head"><div><h2>Mi entrenamiento del día</h2><p>Consulta todas tus sesiones de la fecha elegida. Por defecto se muestra el próximo entrenamiento posterior a hoy.</p></div>
      <label>Fecha de mis entrenamientos<input type="date" value={day.date} onChange={e=>setDate(e.target.value)} /></label>
    </div>
    {!day.date && <p className="empty">No tienes próximos entrenamientos en tus planes activos. Puedes elegir una fecha para consultar las sesiones guardadas.</p>}
    {day.date && !day.sessions.length && <p className="empty">No tienes sesiones para esta fecha.</p>}
    {day.sessions.length>0 && <p>{day.sessions.length} {day.sessions.length===1?"sesión":"sesiones"} · {new Date(day.date+"T12:00:00").toLocaleDateString("es-ES",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})}</p>}
    <div className="own-day-sessions">{day.sessions.map(({plan,session,index})=>{
      const timer=tabata(plan);
      return <article className="card own-session-card" key={`${plan.planId}:${index}`}>
        <h3>Torneo · {plan.fecha_torneo}</h3>
        {plan.structuralUpdateError && <p role="alert">Actualización del plan bloqueada: {plan.structuralUpdateError} Se muestra la última sesión guardada.</p>}
        <p className="timer">Trabajo {format(timer.work)} · Cambio {format(timer.rest)} · {timer.cycles} ciclos · {timer.sets} sets · Entre técnicas {format(timer.betweenSets)} · Total {format(timer.duration)}</p>
        <SessionExercises session={session} />
      </article>;
    })}</div>
  </section>;
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
            <SessionExercises session={session} />
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
  const [commentIssues,setCommentIssues]=useState<PlanIssue[]>([]);
  useEffect(()=>setCommentIssues([]),[snapshot.profile.data.mail]);
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
      {commentIssues.length>0 && <p role="alert" className="field-error">{planIssueMessage(commentIssues)}</p>}
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
      {refreshing && <p className="muted" role="status" aria-label="Actualizando ficha"><span className="loading-spinner" aria-hidden="true" />Actualizando en segundo plano…</p>}
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
              <span>{p.posicion}<small className="priority-caption">Prioridad {p.prioridad}</small></span>
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
                      const saved=await client.request<{planIssues?:PlanIssue[]}>(
                        `/api/app/users/${encodeURIComponent(snapshot.profile.data.mail)}/comments`,
                        "PUT",
                        {
                          data: { ...notes, comments },
                          sha: snapshot.comments!.sha,
                        },
                      );
                      setCommentIssues(saved.planIssues || []);
                      if(saved.planIssues?.length)client.status=planIssueMessage(saved.planIssues);
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
  const [daysError,setDaysError]=useState(false);
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
          if(creating)return;
          const days=e.currentTarget.querySelectorAll<HTMLInputElement>('input[name="day"]:checked');
          setDaysError(!days.length);
          if(!checkDates(e.currentTarget))return;
          if(!days.length){e.currentTarget.querySelector<HTMLInputElement>('input[name="day"]')?.focus();return;}
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
        <fieldset aria-invalid={daysError} aria-describedby={daysError ? "competition-days-error" : undefined}
          onChange={e=>{if(e.currentTarget.querySelector('input:checked'))setDaysError(false);}}>
          <legend>Días de entrenamiento</legend>
          {daysError && <p role="alert" className="field-error" id="competition-days-error">Selecciona al menos un día de entrenamiento.</p>}
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
