import {readFileSync,existsSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {caseTest,expect,campaign} from '../helpers/case-test.mjs';
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');

caseTest('PDF 02',{environment:'PDF descargado de DEV real; revision visual completa local de las paginas renderizadas',users:['A','revisor visual QA'],adaptation:'Documento descargado en esta misma campana; no se realizan consultas ni autenticacion remota en este suplemento.'},async({},r)=>{
 const previous=r.previous();
 await r.step('Exigir resultado automatico previo y su alcance en esta misma campana',async()=>{
  expect(previous?.status,'El suplemento requiere primero la comprobacion automatica parcial del PDF actual').toBe('PARCIAL');
  expect(previous?.expected).toBe(r.result.expected);
  expect(previous?.steps).toContain('Contrastar introducción literal, logo y páginas de PDF');
  expect(previous?.observed).toContain('comprobados automáticamente');
  expect(previous?.observed).toContain('Introducción literal completa');
  expect(previous?.limitation).toContain('revisión visual real');
  r.includePrevious();
 });
 await r.step('Validar revision visual realmente registrada de todas las paginas y hashes actuales',async()=>{
  const path=resolve(campaign,'evidence/PDF-02/visual-review/visual-review.json');expect(existsSync(path)).toBe(true);const audit=JSON.parse(readFileSync(path,'utf8'));
  expect(audit.case).toBe('PDF 02');expect(audit.status).toBe('APROBADO');expect(audit.visualReviewCompleted).toBe(true);expect(audit.allPagesReviewed).toBe(true);expect(Number.isInteger(audit.pageCount)).toBe(true);expect(audit.pageCount).toBeGreaterThan(0);expect(audit.reviewedPages).toEqual(Array.from({length:audit.pageCount},(_,i)=>i+1));expect(audit.pages).toHaveLength(audit.pageCount);expect(audit.findings).toEqual([]);expect(audit.participantMatchesCampaignA).toBe(true);
  const source=resolve(audit.sourcePDF);expect(relative(resolve(campaign,'evidence/PDF-02'),source).startsWith('..')).toBe(false);expect(existsSync(source)).toBe(true);expect(sha(source)).toBe(audit.sourceSHA256);
  expect(previous.evidence.map(p=>resolve(campaign,p))).toContain(source);
  for(const [index,page]of audit.pages.entries()){
   expect(page.page).toBe(index+1);expect(page.openedAndVisuallyInspected).toBe(true);expect(page.finding.length).toBeGreaterThan(10);
   for(const key of ['headerVisible','logoVisible','footerNumberVisible','textReadable'])expect(page[key],key+' page '+page.page).toBe(true);
   for(const key of ['clippingObserved','overlapObserved','browserPrintHeaderObserved'])expect(page[key],key+' page '+page.page).toBe(false);
   expect(page.automatedWordBoxesOutsidePage).toBe(0);expect(page.replacementGlyphs).toBe(0);
   const image=resolve(campaign,page.image);expect(relative(resolve(campaign,'evidence/PDF-02/visual-review'),image).startsWith('..')).toBe(false);expect(existsSync(image)).toBe(true);expect(sha(image)).toBe(page.imageSHA256);r.result.evidence.push(image);
  }
  r.result.evidence.push(path);await r.json('verified-full-visual-review',{reviewedAt:audit.reviewedAt,sourcePDF:source,sourceSHA256:audit.sourceSHA256,allPagesViewed:audit.reviewedPages,allPageImageHashesVerified:true,participantMatchesA:true,findings:audit.findings,informationalFindings:audit.informationalFindings});
 });
 r.finish('APROBADO','Introduccion literal, logo y ausencia de cabeceras del navegador comprobados automaticamente en el PDF real de esta campana. Revision visual independiente de todas sus paginas: textos legibles/completos, logo, cabecera y pies correctos, sin recortes, solapes ni contenido de otra identidad. SHA256 del PDF y de cada imagen verificados.','Revision del PDF descargado de DEV realizada en escritorio; no acredita visor Android/iOS fisico. Este suplemento solo lee archivos locales y conserva evidencias automaticas previas.');
});
