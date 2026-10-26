import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {buildPlanPdf} from '../src/infrastructure/pdf.ts';
import {generatePlan} from '../src/domain/planner.ts';
import {cloneTemplate} from '../src/domain/models.ts';

const base = JSON.parse(await readFile('data/tecnics_base.json', 'utf8'));
const competition = {
    planId: crypto.randomUUID(),
    fecha_comienzo: '2026-10-08',
    fecha_torneo: '2026-12-13',
    dias_de_entrenamiento: [2, 4],
    alumnos: ['ejemplo@example.com'],
    ejercicios_por_sesion: 5,
    tiempo_por_tecnica_segundos: 180,
    descanso_entre_ciclos_segundos: 10,
    descanso_entre_tecnicas_segundos: 20
};
const techniques = cloneTemplate(base);
const plan = generatePlan(competition, 'ejemplo@example.com', techniques, {comments: []}, '2026-10-08T12:00:00Z');
const descriptions = ['Control de la manga y la solapa. Romper la postura antes de atacar.', 'Crear espacio con los marcos y recuperar la guardia.', 'Mantener el control de la cadera y estabilizar antes de avanzar.'];
for (const session of plan.sessions) session.exercises.forEach((ex, i) => {
    ex.descripcion_del_alumno = descriptions[i % 3];
    if (i === 1) ex.comment = 'Buscar el ángulo sin perder el control del rival.';
});
const assets = {
    logo: new Uint8Array(await readFile('public/logo-pgt.jpg')),
    regular: (await readFile('public/fonts/Barlow-Regular.ttf')).toString('base64'),
    bold: (await readFile('public/fonts/Barlow-SemiBold.ttf')).toString('base64')
};
await mkdir('.pdf-artifacts', {recursive: true});
const {pdf, placements} = await buildPlanPdf(plan, assets);
await writeFile('.pdf-artifacts/Plan_PGT_ejemplo.pdf', new Uint8Array(pdf.output('arraybuffer')));
await writeFile('.pdf-artifacts/placements.json', JSON.stringify(placements));
console.log({pages: pdf.getNumberOfPages(), sessions: placements.length});
