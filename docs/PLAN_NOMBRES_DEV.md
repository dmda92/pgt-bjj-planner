# Corrección de nombres futuros — DEV 22/10/2026

Caso reportado: al añadir una técnica, la interfaz guarda primero tipo="Nueva técnica". El alta recalcula el plan con ese valor; el cambio posterior a "Otra mas" no era una alta, descripción ni comentario, por lo que no actualizaba el tipo en el plan. Las pruebas anteriores comprobaban el UUID incorporado, pero no el renombrado posterior. Se añade esa comprobación completa.

## Corrección

src/domain/plan-labels.ts actualiza tipo de técnica y posicion por sus UUID actuales exclusivamente en sesiones > hoy Europe/Madrid de competiciones activas. No genera ejercicios ni altera prioridades, orden, pasadas, marcas de posición, continuidad, fechas, N, Tábata, descripciones o comentarios. Hoy y pasado conservan su instantánea literal. Se ignoran referencias retiradas o de otra posición y planes estructuralmente bloqueados. No se usa el nombre como identidad.

StructuredAppApi aplica los nombres después de sus actualizaciones estructurales y de textos. Se conservan autorización, CAS y eventos. Se comparan campos antes de guardar; repetir lectura o enviar fuente idéntica no reescribe el plan. No añade campos, documentos, listeners ni polling.

También se reparan nombres futuros ya desactualizados cuando se consulta el plan con autorización vigente. La clave de coordinación pasa a plan-update:<mail>:<planId>:labels-v1 para no aceptar checkpoints del código que ignoraba nombres. Se conserva el prefijo por usuario para la limpieza de coordinación existente. La primera comprobación es por plan consultado, no un inventario/migración de Firestore. Después se reutiliza la marca por SHA de fuente/plan y día. Los snapshots que ya descargan los planes reutilizan la lectura del repositorio durante esa operación; la comprobación no relee tras un ACK válido.

El generador, las bajas y los cuatro archivos del dominio congelados conservan sus hashes. Worker y frontend PRO mantienen su código anterior. Feature/future-plan-labels nace de main3b8125c y después incorpora develop77680073; PR y publicación exclusivamente a develop/DEV.

## Verificación

- Dominio: "Nueva técnica" → "Otra mas" en todas las apariciones futuras; nombres de posición; hoy/pasado exactos; invariancia del resto del plan y continuidad; idempotencia; torneos finalizados, bloqueo y referencias retiradas.
- Runtime nativo workerd/SQLite y Firestore interceptado: renombrado persistido y emitido por WebSocket, mismo UUID y distribución/cursor, histórico protegido y lectura repetida sin escrituras.
- Navegador DEV aislado: crear con el botón, esperar su incorporación, editar el campo Tipo de técnica a "Otra mas", comprobar todas las apariciones futuras en IndexedDB y abrir Mis planes para verificar el nombre visible. Mantiene todas las pruebas de altas, posiciones vacías, aislamiento, PDF y offline.
- No se ejecutan pruebas reales contra Firestore ni se modifica directamente ningún usuario/plan del propietario. La reparación se activa mediante las consultas normales de la aplicación después del despliegue.

Requisitos: REQUISITOS_PGT_APP.md 11.4. La autorización de corrección y despliegue DEV continúa el encargo del propietario; no autoriza main/PRO.
