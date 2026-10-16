import supportedCodepoints from "./pdf-font-coverage.json" with {type:"json"};
import { tabata } from "../domain/planner.ts";
import type { TrainingPlan } from "../domain/models.ts";
import type { jsPDF } from "jspdf";
export const introduction =
  "Cada competidor deberá rellenar, para cada técnica, la que a él mejor le sale en combate habitualmente. Nada de flipadas, lo que más habitualmente le funciona con rivales de su mismo nivel\n\nNo tienen por qué ser todas desde exactamente la misma situación. Por ejemplo, podemos tener una opción de guardia cerrada para cuando estamos en el suelo y otra para cuando el rival se pone de pie. Le pediremos al compañero lo que queremos que haga para practicarla.";
export interface PdfAssets { logo: Uint8Array; regular: string; bold: string }
export interface SessionPlacement { date: string; page: number; x: number; y: number; width: number; height: number }
const ink = "#20313f", blue = "#365e7d", muted = "#627483", line = "#dbe3e9", pale = "#f3f6f9";
const M = 16, W = 178, TOP = 39, BOTTOM = 276, GAP = 8, COL = (W - GAP) / 2;
const duration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const date = (value: string, options: Intl.DateTimeFormatOptions) => new Date(value + "T12:00:00Z").toLocaleDateString("es-ES", { ...options, timeZone: "UTC" });
const shortDate = (value: string) => date(value, { day: "2-digit", month: "2-digit", year: "numeric" });
type Session = TrainingPlan["sessions"][number];
type TextRow = { text: string[]; kind: "position" | "type" | "description" | "comment"; height: number };
function font(pdf: jsPDF, size: number, bold = false, color = ink) {
  pdf.setFont("Barlow", bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(color);
}
function measure(pdf: jsPDF, session: Session, width: number, size: number) {
  const rows: TextRow[] = [];
  let previous = "";
  for (const [i, ex] of session.exercises.entries()) {
    const position = JSON.stringify([ex.positionId, ex.posicion, ex.prioridad, ex.pass]);
    const add = (value: string, kind: TextRow["kind"], bold = false) => {
      font(pdf, size, bold);
      const text = pdf.splitTextToSize(value, width - 14) as string[];
      const spacing = size * 0.43;
      rows.push({text, kind, height: text.length * spacing + (kind === "position" ? 4 : kind === "type" ? 1.5 : 3)});
    };
    if (position !== previous) add(`P${ex.prioridad} · ${ex.posicion} · Pasada ${ex.pass}`, "position", true);
    add(`${i + 1}. ${ex.tipo}`, "type", true);
    add(ex.descripcion_del_alumno || "Descripción pendiente", "description");
    if (ex.comment) add(`Entrenador: ${ex.comment}`, "comment");
    previous = position;
  }
  return {rows, size, height: 40 + rows.reduce((n, r) => n + r.height, 0)};
}
/** Builds only from the saved snapshot; never reads current techniques or changes the plan. */
export async function buildPlanPdf(plan: TrainingPlan, assets: PdfAssets) {
  // Validate before generating/downloading: never silently discard unsupported text.
  const supported = new Set(supportedCodepoints);
  const values = [plan.mail, ...plan.sessions.flatMap(s => s.exercises.flatMap(e =>
    [e.posicion, e.tipo, e.descripcion_del_alumno, e.comment || ""]))];
  const missing = new Set<string>();
  for (const value of values) for (const char of value) {
    const cp = char.codePointAt(0)!;
    if (char !== "\n" && char !== "\r" && !supported.has(cp)) missing.add(`U+${cp.toString(16).toUpperCase()}`);
  }
  if (missing.size) throw Error(`No se puede exportar el PDF: contiene caracteres no compatibles con la fuente (${[...missing].slice(0,8).join(", ")}). Revisa el texto; tus datos no se han modificado.`);
  const {jsPDF} = await import("jspdf");
  const pdf = new jsPDF({unit:"mm", format:"a4", compress:true});
  pdf.addFileToVFS("Barlow-Regular.ttf", assets.regular);
  pdf.addFont("Barlow-Regular.ttf", "Barlow", "normal");
  pdf.addFileToVFS("Barlow-SemiBold.ttf", assets.bold);
  pdf.addFont("Barlow-SemiBold.ttf", "Barlow", "bold");
  pdf.setProperties({title:`PGT · Plan de competición · ${shortDate(plan.fecha_torneo)}`, subject:"Preparación de competición", author:"PGT"});
  const timer = tabata(plan);
  // Compact sessions stay together; long sessions continue across readable full-width cards.
  const cards = plan.sessions.flatMap((session, ordinal) => {
    let width = COL, layout = measure(pdf, session, width, 10);
    if (layout.height > BOTTOM - TOP) {
      width = W; layout = measure(pdf, session, width, 10);
    }
    if (layout.height <= BOTTOM - TOP)
      return [{session, ordinal, part: 1, parts: 1, width, ...layout}];
    const capacity = BOTTOM - TOP - 40;
    const chunks: TextRow[][] = [];
    let rows: TextRow[] = [], used = 0;
    const flush = () => { if (rows.length) chunks.push(rows); rows = []; used = 0; };
    for (const [index, row] of layout.rows.entries()) {
      const padding = row.kind === "position" ? 4 : row.kind === "type" ? 1.5 : 3;
      const lineHeight = layout.size * 0.43;
      // Keep a position heading with its technique, and a technique with the first text line.
      const keep = row.kind === "position" ? (layout.rows[index + 1]?.height || 0) + lineHeight : row.kind === "type" ? lineHeight + 3 : 0;
      if (used && row.height + keep > capacity - used && row.height <= capacity) flush();
      let offset = 0;
      while (offset < row.text.length) {
        const available = Math.floor((capacity - used - padding) / lineHeight);
        if (available < 1) { flush(); continue; }
        const count = Math.min(available, row.text.length - offset);
        const height = count * lineHeight + padding;
        rows.push({...row, text: row.text.slice(offset, offset + count), height});
        used += height; offset += count;
        if (offset < row.text.length) flush();
      }
    }
    flush();
    return chunks.map((rows, index) => ({session, ordinal, part: index + 1, parts: chunks.length, width: W, size: layout.size, rows, height: 40 + rows.reduce((sum, row) => sum + row.height, 0)}));
  });
  const header = () => {
    font(pdf,10,true); pdf.text("PGT / Preparación de competición",M,17);
    font(pdf,9,false,muted); pdf.text(`${shortDate(plan.fecha_comienzo)} - ${shortDate(plan.fecha_torneo)}`,M,24);
    pdf.addImage(assets.logo,"JPEG",174,7,20,20);
    pdf.setDrawColor(line);pdf.line(M,31,194,31);
  };
  header();
  font(pdf,25,true);pdf.text("Tu plan de competición",M,47);
  font(pdf,17,true,blue);pdf.text(date(plan.fecha_torneo,{day:"numeric",month:"long",year:"numeric"}),M,58);
  font(pdf,10,false,muted);
  const participant=pdf.splitTextToSize(`Participante: ${plan.mail}`,W) as string[];
  pdf.text(participant,M,67);
  let y=69+participant.length*4.3;
  const stats=[ ["Sesiones",String(plan.sessions.length)], ["Ejercicios",String(plan.sessions.reduce((n,s)=>n+s.exercises.length,0))], ["Técnicas diferentes",String(new Set(plan.sessions.flatMap(s=>s.exercises.map(e=>e.techniqueId))).size)], ["Tiempo por sesión",duration(timer.duration)] ];
  stats.forEach(([label,value],i)=>{
    const x=M+i*46;
    pdf.setFillColor(pale);pdf.roundedRect(x,y,40,25,2,2,"F");
    font(pdf,9,false,muted);pdf.text(label,x+4,y+7);
    font(pdf,19,true);pdf.text(value,x+4,y+19);
  });
  y+=37;
  font(pdf,13,true);pdf.text("Cómo preparar tus técnicas",M,y); y+=8;
  font(pdf,10);
  for(const paragraph of introduction.split("\n\n")){
    const text=pdf.splitTextToSize(paragraph,W) as string[];
    pdf.text(text,M,y,{lineHeightFactor:1.3});y+=text.length*4.6+6;
  }
  y+=3;
  font(pdf,13,true);pdf.text("Configura tu Tábata",M,y);y+=7;
  pdf.setFillColor(pale);pdf.roundedRect(M,y,W,35,2,2,"F");
  const settings=[["Trabajo por alumno",duration(timer.work)],["Cambio de roles",duration(timer.rest)],["Ciclos",String(timer.cycles)],["Sets / ejercicios",String(timer.sets)],["Entre técnicas",duration(timer.betweenSets)]];
  settings.forEach(([label,value],i)=>{const x=M+5+i*34; font(pdf,8,false,muted);pdf.text(label,x,y+8);font(pdf,15,true,blue);pdf.text(value,x,y+20);});
  font(pdf,9,false,muted);pdf.text(`Duración efectiva: ${duration(timer.duration)}. Sin descanso añadido después del último ejercicio.`,M+5,y+29);
  y+=46;
  const days=["lunes","martes","miércoles","jueves","viernes","sábado","domingo"];
  font(pdf,11,true);pdf.text("Tu calendario",M,y);y+=7;
  font(pdf,10);const calendar=pdf.splitTextToSize(`Del ${shortDate(plan.fecha_comienzo)} al ${shortDate(plan.fecha_torneo)} · ${plan.dias_de_entrenamiento.map(d=>days[d-1]).join(", ")}.`,W) as string[];
  pdf.text(calendar,M,y); y+=calendar.length*4.5+6;
  font(pdf,9,false,muted);pdf.text("Cada tarjeta conserva el orden de ejercicios del plan guardado.",M,y);
  const placements:SessionPlacement[]=[];
  let cursor=TOP, column=0, rowHeight=0;
  const nextPage=()=>{pdf.addPage();header();cursor=TOP;column=0;rowHeight=0;};
  if(cards.length) nextPage();
  for(const card of cards){
    if(card.width===W && column===1){cursor+=rowHeight+GAP;column=0;rowHeight=0;}
    if(cursor+card.height>BOTTOM)nextPage();
    const x=M+(column===1?COL+GAP:0);
    placements.push({date:card.session.date,page:pdf.getNumberOfPages(),x,y:cursor,width:card.width,height:card.height});
    pdf.setDrawColor(line);pdf.setFillColor("#ffffff");pdf.setLineWidth(.25);pdf.roundedRect(x,cursor,card.width,card.height,2.5,2.5,"FD");
    pdf.setFillColor(pale);pdf.roundedRect(x+5,cursor+5,13,14,1.5,1.5,"F");
    font(pdf,17,true,blue);pdf.text(card.session.date.slice(8),x+11.5,cursor+12,{align:"center"});
    font(pdf,7,true,muted);pdf.text(date(card.session.date,{month:"short"}).replace(".","").toUpperCase(),x+11.5,cursor+17,{align:"center"});
    font(pdf,11,true);pdf.text(date(card.session.date,{weekday:"long"}),x+22,cursor+10);
    font(pdf,8,false,muted);pdf.text(shortDate(card.session.date),x+22,cursor+16);
    font(pdf,8,false,muted);pdf.text(`${String(card.ordinal+1).padStart(2,"0")} / ${plan.sessions.length}`,x+card.width-5,cursor+10,{align:"right"});
    if (card.parts > 1) { font(pdf,8,true,blue); pdf.text(`${card.part === 1 ? "Parte" : "Continuación"} ${card.part} / ${card.parts}`,x+card.width-5,cursor+16,{align:"right"}); }
    pdf.setDrawColor(line);pdf.line(x+5,cursor+22,x+card.width-5,cursor+22);
    let textY=cursor+28;
    for(const row of card.rows){
      font(pdf,card.size,row.kind==="position"||row.kind==="type",row.kind==="comment"?blue:row.kind==="position"?blue:ink);
      pdf.text(row.text,x+7,textY,{lineHeightFactor:1.22});textY+=row.height;
    }
    pdf.setDrawColor(line);pdf.line(x+5,cursor+card.height-11,x+card.width-5,cursor+card.height-11);
    font(pdf,7.5,false,muted);pdf.text(`${card.session.exercises.length} ejercicios`,x+5,cursor+card.height-5);
    pdf.text(`${duration(timer.duration)} min`,x+card.width-5,cursor+card.height-5,{align:"right"});
    if(card.width===W){cursor+=card.height+GAP;column=0;rowHeight=0;}
    else if(column===0){column=1;rowHeight=card.height;}
    else {cursor+=Math.max(rowHeight,card.height)+GAP;column=0;rowHeight=0;}
  }
  const pages=pdf.getNumberOfPages();
  for(let page=1;page<=pages;page++){
    pdf.setPage(page);pdf.setDrawColor(line);pdf.line(M,282,194,282);
    font(pdf,8,false,muted);pdf.text("PGT · Plan personal de competición",M,288);pdf.text(`${page} / ${pages}`,194,288,{align:"right"});
  }
  return {pdf,placements};
}
async function loadAssets():Promise<PdfAssets>{
  const load=async(path:string)=>{const response=await fetch(path);if(!response.ok)throw Error("No se pudo cargar un recurso del PDF");return new Uint8Array(await response.arrayBuffer());};
  const [logo,regular,bold]=await Promise.all([load("/logo-pgt.jpg"),load("/fonts/Barlow-Regular.ttf"),load("/fonts/Barlow-SemiBold.ttf")]);
  const base64=(bytes:Uint8Array)=>{let text="";for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
  return {logo,regular:base64(regular),bold:base64(bold)};
}
export async function exportPlan(plan:TrainingPlan){
  const {pdf}=await buildPlanPdf(plan,await loadAssets());
  pdf.save(`PGT_plan_${plan.fecha_torneo}_${plan.mail.replace(/[^a-zA-Z0-9]/g,"_")}.pdf`);
}
