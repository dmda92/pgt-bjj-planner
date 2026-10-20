# Auditoría previa a Firestore y tiempo real — 20/10/2026

Estado: auditoría y línea base de regresión; **persistencia nueva no implementada ni desplegada**. Ejecución limitada a DEV. El encargo del propietario sustituye las restricciones históricas de almacenamiento GitHub/offline de AGENTS.md y requisitos, pero conserva todas las reglas funcionales vigentes. Plan recibido: [FIRESTORE_PLAN_2026-10-20.md](FIRESTORE_PLAN_2026-10-20.md).

## Referencias verificadas

- Repositorio público de código `dmda92/pgt-bjj-planner`; no se consultó el repositorio privado de datos ni cuentas reales.
- Base `main`: `3b8125cb362f665f908e4028d54514f65f00459a`. `develop`: `66b46bbc792f8b918e4cb006ee04b6f1df353783`. El segundo es padre del merge en main; diferencia de árboles vacía. No hay trabajo exclusivo de develop ni PR abiertas en la inspección inicial.
- Rama local `feature/firestore-realtime-dev` creada directamente desde el main anterior, sin incorporar develop. No se actualiza main/develop en esta fase.
- Rulesets activos `protect-main` y `protect-develop`; el segundo prohíbe borrado/force push y exige PR y resolución de conversaciones. No exige aprobaciones numéricas actualmente. No se modificaron reglas ni se usaron bypasses.
- Último run DEV inspeccionado: [39338518875](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39338518875), SHA `66b46bb`, validate y deploy-dev terminados con success. Esto prueba los pasos de Actions de esa revisión, no Firestore ni el estado interno actual del panel cloud.
- `cloudflare-dev.yml`: PR a develop valida sin secretos; push/dispatch de develop puede desplegar usando Environment development y `DEV_DEPLOY_ENABLED`. Config/nombre/cuenta/head explícitos. `cloudflare.yml`: publicación restringida a main. Tras detectar en el CI de esta PR que Playwright 1.58.2 rechaza Ubuntu 26.04, se fija únicamente el runner de validación DEV a ubuntu-24.04; el job de despliegue y el workflow PRO permanecen intactos.
- DEV `pgt-github-probe-dev` / `wrangler.dev.jsonc`, assets `dist`, origen `https://pgt-github-probe-dev.david-dzm5.workers.dev`, SECURITY local ProbeSecurity con migración SQLite propia. PRO tiene configuración/Worker separados. Se leyeron archivos de configuración, sin acceder a recursos PRO.

## Mapa de dominio y dependencias

| Comportamiento | Implementación actual | Contrato que debe preservarse |
| --- | --- | --- |
| Calendario y generación | `src/domain/planner.ts`: trainingDates, generatePlan, tabata | Inicio incluido según días elegidos, torneo excluido; parámetros configurables; arrays originales y UUID conservados |
| Secuencia circular y posición partida | `src/domain/plan-continuity.ts`: initialCursor, nextExercise | Completar pasada antes de avanzar; prioridades existentes ascendentes; movimiento segunda/atrás/adelante y continuidad entre sesiones |
| Borrados estructurales | mismo archivo: updateFutureDeletions | Solo sesiones **> hoy Madrid** y torneos > hoy; validar cursor/histórico; bloqueo recuperable sin perder último plan |
| Descripciones/comentarios | `src/domain/plan-text-updates.ts`: updateFuturePlanText | UUID y checkpoints servidor; todas las ocurrencias futuras; ni hoy ni pasado; idempotencia; no regenerar distribución por cambios de texto |
| Validaciones | `src/domain/models.ts`, `json-limits.ts` | 200 posiciones, 100 técnicas/posición; 1–100 ejercicios; calendario hasta 730 días; tiempos y validaciones existentes; 4 MiB/JSON y 100.000 UTF-16/texto |
| Registro, sesión, perfil, roles | `worker/application.ts`: initialize, session, trainer, handle | Hash PBKDF2-SHA256 con sal/600000; rol no confiado al cliente; nunca devolver pwd; revocar ante cambio de contraseña/rol |
| Asignación y eliminación | mismo archivo: reconcile, createMissingPlan y rutas competition/assignment/delete-competition | Entrenador competidor permitido; plan inicial server-side; no recrear existente; tombstone antes de borrar; reasignar genera nuevo plan |
| Proyección persistida de planes | mismo archivo: updatePlanTexts | Ejecutada por Worker en mutaciones/restauración y consulta de detalle; CAS y relectura de fuentes; errores recuperables por plan |
| Entrenamiento del día | `worker/training-day.ts`, `src/domain/trainer-reports.ts` | Índice derivado ligado a versión, agregación/multiplicidad/orden existentes; POST prepara faltantes; GET puede materializar índices derivados |
| Cobertura/PDF/vista propia | `src/domain/coverage.ts`, `own-training-day.ts`, `src/infrastructure/pdf.ts` | Cálculos desde snapshots guardados, mismo contenido, Barlow/cobertura de caracteres y paginación vigentes |

El cálculo inicial y recálculo autorizado se realizan en el **Worker**. El cliente también hace una proyección local provisional para edición offline, mediante projectFutureDescriptions/updateFutureDeletions; esa proyección debe desaparecer de la nueva ruta de escritura, conservando las funciones de dominio sin modificarlas. No trasladar por error el cálculo a una implementación nueva en servidor o cliente.

Dependencia actual: UI → Client → IndexedDB dirty/base/SHA → sync/merge → AppApi → CloudStorageProvider → GithubContentsStorage. AppApi además usa almacenamiento DO para sesiones, límites y marcadores de coordinación. Todos los requests /api pasan por un único DO `idFromName('github-probe')` dentro de su namespace, con cola de ejecución. La cola no convierte en atómicas las escrituras remotas múltiples ante crash.

## Inventario de almacenamiento (derivado del código, no de datos reales)

| Recurso actual bajo PGT/ | Contenido y relaciones | Destino propuesto |
| --- | --- | --- |
| master_data/tecnics_base.json | Plantilla de alta, UUID nuevos por alumno | metadata/template y versión de plantilla fragmentada si es necesario |
| master_data/plans.json | Competiciones, asignaciones y deletedPlanIds | competitions, assignments, tombstones y versión de catálogo |
| users_data/mail/user_data.json | Perfil, rol, pwd privado, versión | users y credencial privada separada |
| users_data/mail/tecnics.json | Arrays ordenados, UUID, textos, descriptionUpdates, deletedIds/deletionCatalog/deletionRevision | Generación de repertorio con manifiesto, posiciones/técnicas y metadatos de borrado |
| users_data/mail/trainer_comments.json | Comentarios por UUID, trainerName y commentUpdates | Comentarios por técnica y generación/metadatos |
| users_data/mail/plans_index.json | Asignados y tombstones individuales | Asignaciones y tombstones por usuario |
| users_data/mail/training_plans/plan_UUID.json | Snapshot completo, sesiones, continuidad/catálogos/cursores/checkpoints | Plan con generación de snapshot y fragmentos inmutables |
| users_data/mail/training_plans/structure_UUID.json | Índice derivado ligado a sourceSha | Proyección derivada ligada a versión de plan, reconstruible |

No se conocen conteos ni tamaños reales: medirlos exigiría leer datos reales, no autorizado. El límite lógico actual es 4.194.304 bytes por JSON y envoltorio +64 KiB. La suite runtime ya contiene un caso sintético de plan proyectado de 16.842.193 bytes rechazado sin perder las fuentes. No reducir esos límites de producto para encajar Firestore.

`GithubContentsStorage` implementa read/write/remove/list y verificación de privacidad. AppApi y training-day consumen rutas, listados y versiones de 40 hex; snapshot/view aceptan known con ese formato. No basta con cambiar un adaptador: separar repositorios de dominio y versiones opacas (con compatibilidad del contrato), eliminando rutas/SHA del flujo nuevo. `CloudStorageProvider.verifyPrivate` no debe simular una validación de seguridad Firestore.

## Cliente, caché y consumidores

- `src/application/client.ts`: login/register restauran snapshot; sync al inicio y online; edit solo marca dirty y proyecta planes; performSync hace merge de tres vías y sube fuentes. importBackup crea pendientes; resolve conserva conflictos/borradores. Hay que reemplazar ese circuito, no llamarlo más frecuentemente.
- `src/infrastructure/local.ts`: Dexie `pgt-active-user-v1`, esquema v4; entries/meta, trainerViews, trainerDays y commentNotices. entries aislada por owner; trainerViews por actor/alumno/sección/plan, trainerDays por actor/fecha; avisos por dispositivo/usuario.
- `src/main.tsx`: carga activa llama sync; saveTech cambia estado inmediatamente y encadena guardados locales por pulsación; perfil con borrador explícito; comentarios se guardan por API; participantes usan Guardar datos y borrador/SHA. Catálogo/lista de alumnos, ficha seleccionada, selector de plan y entrenamiento del día tienen estados/cachés distintos: invalidar solo entries no refrescará esas pantallas.
- `src/ui-trainer-reports.tsx`: carga de informes y caché de día debe reaccionar a eventos; conservar selección/fecha y protección contra respuestas antiguas.
- Backup/importación, avisos de actualización PWA, exportación de borradores antiguos y textos de estado también consumen dirty/sync. Conservar exportación y avisos leídos; nunca descartar o subir silenciosamente un borrador legado.
- `public/sw.js`: assets y navegación offline; excluye /api y peticiones de otros orígenes. Mantener instalación/PDF y lectura de caché; no incorporar mutaciones en SW ni background sync.
- Límites actuales DO: 30 requests/IP/min, 300 global/min, 10 mutaciones/min y 100/h; GitHub tiene presupuesto adicional 70/min, 450/h. No eliminar protección de abuso por cambiar proveedor, pero la edición por pulsación no puede traducirse literalmente a un PUT completo por tecla. Coalescer borradores online en memoria, marcar guardado solo después del ACK, conservar borrador ante error y no reenviarlo al reconectar.

## Decisión de tiempo real

| Opción | Ventajas | Coste/impacto |
| --- | --- | --- |
| A: SDK web + onSnapshot | Listeners nativos y cambios directos de Firestore | Puente Firebase Auth/custom token, doble revocación y reglas por rol; separar estrictamente credenciales; pruebas adicionales de permisos; facturación de lecturas por listener |
| B: Worker + WebSocket DO | Conserva sesión PGT, control de acceso y mutaciones servidor; no añade login ni Firebase Auth | Mantener invalidación, reconexión y entrega; escrituras externas necesitan mecanismo explícito; peticiones de relectura consumen cuota |

**Seleccionada B**, con WebSocket Hibernation API y REST Firestore autenticado desde Worker. Usar el DO DEV como coordinador y propietario del fan-out; hibernación para conexiones inactivas. Guardar en DO exclusivamente sesiones, tickets, secuencias y coordinación; negocio y registro durable de cambios confirmados en Firestore.

Protocolo previsto: ticket opaco de un uso/vida corta emitido por API autenticada, enlace del socket a sesión y actor; no token de sesión permanente en URL. Origin exacto DEV obligatorio. Eventos de invalidación con versión/ID y recursos autorizados; no emitir payloads de negocio a suscriptores genéricos. Alumno solo sus recursos, entrenadores recursos permitidos por rol actual. Revocación/rol debe cerrar/revalidar sockets, no solo llamadas HTTP. Reconexión con backoff/jitter y recarga autorizada del estado actual; foco/online también revalida. Ignorar duplicados/versiones antiguas y limpiar al logout/cambio de cuenta. Siempre handshake → snapshot → reconciliar eventos recibidos durante la carga para no perder la ventana inicial.

La mutación debe confirmar commit Firestore antes del éxito local y del evento. Publicar invalidación también si hubo commit de fuente y falla una proyección posterior: no ocultar cambios parcialmente persistidos. Outbox/change record en el mismo commit que la publicación de una generación, con ACK/relectura/reconexión recuperables; eventos de invalidación no equivalen a una cola de ediciones offline.

**Frontera explícita:** B recibe automáticamente las escrituras a través de la API/migrador coordinado. Ediciones arbitrarias desde consola Firestore no generan por sí solas un evento DO. En DEV, herramientas operativas deben pasar por el mismo servicio y publicar invalidación. Si el requisito incluye futuros escritores externos independientes, añadir un listener/puente soportado (validar costes antes) o reconsiderar A; nunca sustituirlo por polling agresivo.

## Esquema propuesto y atomicidad

Base exclusiva `(default)` de `pgt-bjj-dev`; namespace de esquema `pgt_v1`. Identidad mail normalizada conservada y codificada en ID estable; UUID de posiciones/técnicas/planes sin regenerar. No inferir orden por ID ni fecha: índices ordinales explícitos para reconstruir exactamente arrays originales. Separar secretos de perfil público aunque todo se lea mediante Worker.

Colecciones lógicas: users/credentials, competitions, assignments, tombstones, repertoires, comments, plans, derivedTrainingStructures, operations/changes. Cada entidad usa versión de aplicación opaca y precondición Firestore updateTime/existencia. Transacciones en creación de identidad, edición de fuente, asignación/tombstone y publicación de manifiestos; CAS ante cambios de fuentes durante generación. Idempotency key ligada al actor/operación/payload; no repetir a ciegas una mutación de resultado incierto. Conflicto visible con borrador recuperable; no last-write-wins.

Un plan puede superar 1 MiB aunque sea válido para la app. Usar **generaciones inmutables fragmentadas** con manifiesto activo que enumera partes, tamaño, hash y versión. Fragmentos objetivo ≤192 KiB de payload UTF-8 (el tamaño Firestore incluye metadatos/campos); no asumir que una sesión, un cursor o un catálogo caben en un documento. Fragmentar también metadatos grandes y fuentes según tamaño real. Escrituras parciales de descripción/técnica actualizan únicamente entidad/fragmentos afectados, sin reescribir catálogos ajenos. Desindexar textos/payload/cursores; índices solo sobre campos de consulta.

Preparar fragmentos fuera del puntero activo, verificar hashes/conteos y publicar mediante transacción con precondición de versión y fuentes. Lectores ven generación antigua o nueva íntegra. Si catálogo/plan/versiones cambian durante staging, abortar y reintentar de forma acotada. No intentar meter 20.000 técnicas, 730 sesiones o un fan-out de 100 alumnos en un único commit. Para operaciones largas conservar fases de operación e idempotencia en Firestore, reconciliación recuperable y estado de proyección pendiente según semántica existente; no comunicar operación completa antes de la fase requerida. Recoger fragmentos huérfanos solo mediante herramienta DEV segura tras verificar referencias.

El migrador deberá reconstruir/exportar el contrato lógico y comparar hashes exactos, incluyendo metadata/checkpoints/UUID/contraseñas/tombstones. Dry-run sin red de escritura; origen test explícito; denegar proyecto distinto a pgt-bjj-dev por defecto. No usar export/import administrado de GCP ni cuentas reales en este ensayo. Preparar cutover PRO solo como documento futuro; no ejecutarlo.

## Límites, autenticación y costes verificados en fuentes oficiales

- [Firestore cuotas](https://firebase.google.com/docs/firestore/quotas): documento 1 MiB, solicitud 10 MiB, transacción 270 s/60 s inactiva. Las 500 transformaciones son por documento; no confundirlas con una autorización para batches ilimitados. Paginar, acotar operaciones y medir tamaño de Commit codificado.
- Cuota gratis de una base por proyecto: 1 GiB, 50.000 lecturas/día, 20.000 escrituras y 20.000 borrados/día, 10 GiB salida/mes. TTL/PITR/backups administrados no incluidos. La existencia del proyecto no confirma edición, base, región ni facturación.
- [REST y autenticación](https://firebase.google.com/docs/firestore/use-rest-api): OAuth2 de cuenta de servicio con scope datastore. Acceso de servicio se autoriza por IAM y **omite reglas Firestore**; deny-all web no sustituye permisos en Worker/IAM.
- [IAM](https://firebase.google.com/docs/firestore/security/iam): cuenta de servicio exclusiva DEV con rol de datos `roles/datastore.user`, sin Owner/Editor/admin de Firebase, sin roles ni pertenencia a grupos con acceso a PRO. Acceso al proyecto DEV no demuestra por sí solo ausencia de permisos heredados: revisar también organización/grupos.
- Identidad Worker→Google: JWT RS256 usando WebCrypto e intercambio OAuth en host fijo, token cacheado solo en memoria hasta vencimiento, nunca en cliente/logs. WIF evitaría claves persistentes pero requiere proveedor/identidad OIDC confiable del Worker que hoy no existe; no inventar esa integración ni reutilizar identidad GitHub Actions para runtime. Clave DEV guardada exclusivamente como secreto Worker; rotación/revocación documentadas.
- [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) y [precios DO](https://developers.cloudflare.com/durable-objects/platform/pricing/): hibernación recomendada; Free SQLite, 100.000 requests/día y 13.000 GB-s/día, más límites de almacenamiento/filas. La API actual serializa todas las operaciones: medir latencia de fan-out y no usar streams que retengan la cola indefinidamente.

Estimación a medir, no precio garantizado: si una edición modifica un documento de técnica + manifiesto + change record y afecta 2 planes con 3 fragmentos nuevos cada uno y sus manifiestos, son 11 escrituras, más metadatos/índices adicionales que deba publicar la implementación. Las lecturas son autorización + fuentes + partes/queries realmente consultadas por cada sesión; 20 clientes releyendo 10 documentos tras 100 eventos ya implican 20.000 lecturas, antes de inicialización y dominio. Coalescer invalidaciones y cargar solo vistas afectadas. No instalar listeners globales sobre todos los documentos ni descargar todos los planes por pulsación. Objetivo inicial DEV: propagación p95 ≤2 s en 30 ediciones, 0 recargas manuales y 0 escrituras desconectado; registrar muestras, número de clientes, red y contadores. No hay medidas remotas todavía.

## Pruebas y punto de parada

Se capturaron 12 fixtures sintéticos completos contra los archivos sin modificar del commit base. Se comparan planes, cursores/checkpoints, fechas, textos, orden, UUID, pasadas, finalización, cobertura y Tábata; más hash SHA-256 de cuatro archivos de dominio y secuencia circular explícita. No regenerar fixtures desde el código de la migración para hacerlas pasar.

La suite existente cubre flujos/validaciones/API/autorización/CAS/recuperación; es una línea base con adaptadores simulados y workerd, **no** prueba de transacciones Firestore ni propagación real. Evidencias/comandos en [FIRESTORE_VALIDACION_DEV.md](FIRESTORE_VALIDACION_DEV.md).

Falta acceso operativo a Firebase/Firestore DEV: no hay credencial DEV configurada en este checkout ni conexión Firebase instalada en esta sesión. Descubrimiento de plugins encuentra un plugin oficial Firebase disponible sin instalar; no equivale a acceso autorizado ya conectado. No se accedió a paneles ni se sondaron sesiones. Sin región/base/facturación/identidad verificadas no se supera fase 3. Conforme al punto de parada del plan, **la implementación B–G y despliegue quedan pendientes de esa configuración**, no se cambia aún el Worker ni el cliente y la PR se mantiene borrador. Pasos imprescindibles: [FIRESTORE_CONFIGURACION_DEV.md](FIRESTORE_CONFIGURACION_DEV.md).
