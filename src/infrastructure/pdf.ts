import { tabata } from "../domain/planner.ts";
import type { TrainingPlan } from "../domain/models.ts";
export const introduction =
  "Cada competidor deberá rellenar, para cada técnica, la que a él mejor le sale en combate habitualmente. Nada de flipadas, lo que más habitualmente le funciona con rivales de su mismo nivel\n\nNo tienen por qué ser todas desde exactamente la misma situación. Por ejemplo, podemos tener una opción de guardia cerrada para cuando estamos en el suelo y otra para cuando el rival se pone de pie. Le pediremos al compañero lo que queremos que haga para practicarla.";
export async function exportPlan(plan: TrainingPlan) {
  const { jsPDF } = await import("jspdf");
  const logo = await fetch("/logo-pgt.jpg").then((r) => {
    if (!r.ok) throw Error("No se pudo cargar el logo");
    return r.arrayBuffer();
  });
  const pdf = new jsPDF();
  const margin = 16,
    width = 178,
    bottom = 278;
  let y = 32;
  const t = tabata(plan);
  const header = () => {
    pdf.setTextColor(23, 50, 61);
    pdf.setFontSize(17);
    pdf.text("PGT · Plan de competición", margin, 18);
    pdf.addImage(new Uint8Array(logo), "JPEG", 174, 7, 22, 22);
    pdf.setFontSize(9);
    pdf.text(`${plan.fecha_comienzo} — ${plan.fecha_torneo}`, margin, 25);
  };
  header();
  pdf.setFontSize(10);
  const intro = pdf.splitTextToSize(introduction, width);
  pdf.text(intro, margin, y);
  y += intro.length * 4.5 + 8;
  const timer = `Tábata: trabajo ${t.work}s · cambio ${t.rest}s · ${t.cycles} ciclos · ${t.sets} sets · entre técnicas ${t.betweenSets}s · duración ${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, "0")}`;
  const lines = pdf.splitTextToSize(timer, width);
  pdf.text(lines, margin, y);
  y += lines.length * 4.5 + 8;
  for (const session of plan.sessions) {
    let size = 10,
      rows: string[][] = [],
      height = 0;
    for (;;) {
      pdf.setFontSize(size);
      rows = session.exercises.map((e, i) =>
        pdf.splitTextToSize(
          `${i + 1}. P${e.prioridad} · ${e.posicion}\n${e.tipo}\n${e.descripcion_del_alumno || "Descripción pendiente"}${e.comment ? "\nEntrenador: " + e.comment : ""}`,
          width,
        ),
      );
      height = 12 + rows.reduce((n, r) => n + r.length * (size * 0.45) + 5, 0);
      if (height <= bottom - 33 || size <= 7) break;
      size--;
    }
    if (height > bottom - 33)
      throw Error(
        `La sesión ${session.date} no cabe en una página; acorta las descripciones antes de exportar`,
      );
    if (y + height > bottom) {
      pdf.addPage();
      header();
      y = 34;
    }
    pdf.setFontSize(13);
    pdf.text(
      new Date(session.date + "T12:00:00Z").toLocaleDateString("es-ES", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }),
      margin,
      y,
    );
    y += 9;
    pdf.setFontSize(size);
    for (const row of rows) {
      pdf.text(row, margin, y);
      y += row.length * (size * 0.45) + 5;
    }
    y += 4;
  }
  pdf.save(
    `PGT_plan_${plan.fecha_torneo}_${plan.mail.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`,
  );
}
