# Remediación QA del 26/10/2026

Trabajo autorizado: 15 casos fallidos y la incidencia suplementaria CAS. Rama
`fetaure/optimizacionFirestore`, base local `7a931a9`. Al comenzar, el árbol de
trabajo estaba limpio. No se cambia de rama, se hace commit/push, se integra en
develop ni se despliega. No se modifican datos remotos ni recursos PRO.

## Alcance de la evidencia

Las reproducciones y comprobaciones nuevas utilizan Chromium, la PWA compilada,
Worker/workerd, SQLite local y transporte Firestore sintético. Las pruebas de
dominio y de presupuesto utilizan fixtures y mocks locales. **No son una
validación contra Google Firestore ni contra la versión desplegada en DEV.**
No se repite ni se reescribe la campaña de 206 casos original.

Los rojos se conservaron antes de cada corrección funcional. Logs, informes
Playwright, capturas y trazas están en `.qa/remediation-2026-10-28/`, excluido de
Git. Las pruebas y este informe sí son parte revisable del código. No se incluyen
credenciales reales, cookies ni tokens en este documento.

## Seguridad

### SEC-01 — Revocación irreversible

**Causa:** la validez dependía del rol y de una huella de contraseña. Un ciclo de
roles que volviera al valor original podía volver a aceptar la sesión antigua.

**Corrección:** `sessionEpoch` opaco y exclusivo del servidor en el perfil V2 y
en cada sesión nueva; se rota dentro del mismo CAS de un cambio efectivo de rol
o contraseña. HTTP y apertura de tiempo real comparan esa identidad además del
rol y la huella. Un formato de sesión antiguo sin epoch falla cerrado. Los
perfiles migrados tienen un valor inicial definido sin escribir ni cambiar su
contraseña. El campo interno no se entrega en perfiles públicos ni snapshots.

**Archivos:** `worker/v2/session-identity.ts`, `users.ts`,
`query-coordinator.ts`, `runtime.ts`; fixtures sintéticos de
`scripts/test-firestore-v2-runtime.mjs`, `test-v2-app-runtime.mjs`,
`benchmark-v2-application.mjs` y pruebas V2 correspondientes.

**Pruebas:** `tests/v2-users.test.ts`: ciclo de roles, reinicio del coordinador,
formato legado, perfiles públicos y presupuesto en caliente. Runtime con ticket
retenido, HTTP y cierre de WebSocket. Evidencias `SEC-01-red.log`,
`SEC-01-green.log` y `SEC-01-runtime.log`.

**Efecto operativo:** la próxima publicación de esta versión en DEV requerirá
autenticarse de nuevo a las sesiones del formato anterior. Las contraseñas se
conservan. No hay migración de perfiles ni escaneo de sesiones en Firestore.

El broadcast compara únicamente los perfiles modificados ya incluidos en la
publicación, sin consultar los perfiles de todos los sockets. Si falla la entrega
o un reinicio encuentra outbox pendiente, cierra sockets con 1012 para exigir
revalidación antes de seguir. El arranque añade una consulta SQLite acotada de
metadatos de coordinación, no una lectura de negocio Firestore. El epoch viaja
en la misma escritura de perfil existente. Una prueba con tres sockets y perfiles
expulsados de caché mide **cero lecturas de perfiles no afectados**, también al
recuperar el reinicio. Guard permanente: `scripts/test-v2-session-runtime.mjs`,
incluido en `npm run test:runtime`. Evidencias finales:
`SEC-01-cold-budget-green.log` y `SEC-01-runtime-final.log`.

### ISO-08 — Caché privada tras denegación

**Causa:** un 403 no retiraba las fichas/entrenamientos privados cacheados; una
respuesta anterior podía además volver a guardarlos después de invalidarlos.

**Corrección:** invalidación antes del borrado, fences de identidad/generación,
escritura transaccional y marca persistente de revocación por actor. Se cubren
401, 403, 4401, logout, cambio de identidad, otra pestaña y respuesta en vuelo.
Si IndexedDB falla al borrar, la copia sigue denegada después de recargar; una
autenticación nueva y limpieza satisfactoria permiten recuperar el servicio.
No se borra el journal de borradores al revocar acceso.

La señal de denegación también retira las fichas ya renderizadas en las otras
pestañas y desmonta los informes privados, incluso si después se desconectan.
No inicia nuevas consultas. Rojo `red-cross-tab-private-view/`, verde
`green-cross-tab-private-view/`; comprobación explícita de cero solicitudes
privadas nuevas desde la segunda pestaña.

**Archivos:** `src/application/firestore-client.ts`;
`qa/remediation/security-cache.spec.mjs`.

**Pruebas:** rojo de ficha real local con 403; verdes de cachés trainerViews y
trainerDays, respuestas retenidas con 401/403, otras pestañas y fallo de borrado
con recarga. Evidencias `ISO08-red.log`, `ISO08-all-final.log`.

## Conservación de borradores

Solución compartida: tabla IndexedDB `drafts` separada de las copias confirmadas,
clave por actor/propietario/recurso/editor. El identificador de editor usa
sessionStorage para sobrevivir a la recarga y separar pestañas. Cada registro
conserva datos, fuente inicial, versión CAS y generación. No almacena sesiones ni
credenciales. Un checkpoint precede al envío; el ACK solo elimina la generación
confirmada. Una edición posterior mantiene su texto y avanza la base desde su
propio ACK.

La restauración no envía nada: se requiere Reintentar o Guardar explícito.
La edición sin conexión continúa rechazada. Tampoco se añade una cola que se
ejecute al reconectar. Los errores de IndexedDB conservan el editor, muestran
fallo y bloquean cierre/actualización destructivos; se puede copiar/exportar antes
de descartar expresamente. No existe limpieza por TTL ni descarte silencioso.

Perfil permite recuperar explícitamente un registro de una pestaña cerrada o
descartarlo con confirmación y comprobación de su generación. Recuperar no pisa
otro borrador abierto para el mismo recurso; el traslado entre editores es una
transacción local. Recuperar un comentario ajeno exige comprobar primero el
acceso remoto al alumno. Tras perder el rol de entrenador, la exportación no
incluye los borradores privados de otros propietarios.

Si IndexedDB rechaza la escritura, una copia identificada como **no duradera**
permanece en memoria por la misma clave: sobrevive al desmontaje de componentes
y a una revocación dentro de esa página. No se anuncia como guardada. El aviso
global impide mostrar sincronización completa y beforeunload advierte antes de
abandonar la página. Chromium comprueba el diálogo real y que cancelarlo evita
la recarga y conserva el texto. **Un cierre forzado del proceso mientras el
almacenamiento está averiado no puede garantizar conservación**; se ofrece
copiar/exportar y se bloquean las salidas voluntarias destructivas. Esto no añade
reintentos automáticos de red.

Evidencia adicional: `red-closed-tab-draft/`, `green-closed-tab-draft/`,
`JOURNAL-IDB-red.log`, `JOURNAL-IDB-green.log`,
`red-volatile-comment-switch/`, `green-volatile-comment-offline/`.
Capturas de Perfil a 1440/390 px: `green-profile-draft-visual/`.
El comentario permanece de solo lectura offline y no emite comandos
(`red-offline-comment/` y verde correspondiente).

**Archivos compartidos:** `src/application/draft-journal.ts`, `online-draft.ts`,
`src/infrastructure/local.ts`, `src/main.tsx`, `src/ui-comment-editor.tsx`.
Pruebas: `tests/draft-journal.test.ts`, `online-draft-persistence.test.ts`,
`online-draft.test.ts`, `qa/remediation/drafts.spec.mjs` y `ui.spec.mjs`.

| Caso | Causa concreta | Solución y comprobación |
|---|---|---|
| SYN-06 | Borrador fallido solo en memoria | Recarga recupera texto/base y requiere reintento; fuente remota permanece intacta hasta confirmar. |
| SYN-08 | Comentario React desaparecía al cambiar de alumno o recargar | Journal por entrenador/alumno/técnica; Guardar explícito, ACK por generación, texto posterior y fallo de IndexedDB comprobados. |
| SYN-11 | Reconexión/recarga no recuperaba un pendiente fallido | Restauración local y vía manual; prueba de desconexión/reconexión y cero comandos automáticos antes del reintento. |
| ISO-02 | Salir permitía cambiar de cuenta con cambios sin resolver | Cierre voluntario bloqueado con explicación; otra identidad no autentica con borradores de la anterior. Resolver permite salir y B no ve datos de A. |
| PWD-07 | Revocación desmontaba y descartaba el editor | Revocación sigue inmediata; autenticación de la misma cuenta con contraseña vigente recupera el journal y permite reintento autorizado. |
| PWA-06 | Activación del SW recargaba con texto fallido volátil | Checkpoint antes de actualizar; prueba de actualización real de SW local conserva texto y botón de reintento sin subirlo automáticamente. |

**Evidencias:** `drafts-red.log`, `ISO02-red-contract.log`, `PWA06-red.log`,
`journal-red.log`, `journal-green.log`, `red-ui-extra/`,
`green-drafts-ui/`, `ui-drafts-final.log`. Suplemento de dos pestañas:
`green-two-tab-drafts/` (dos textos, dos registros y cero envíos automáticos).
Capturas de comentario recuperado a 1440 y 390 px en `green-comment-visual/`.

## Conflictos y consistencia

### CAS suplementario — Reutilización de bloques inmutables

**Causa:** un lote create-only mezclaba bloques históricos existentes con bloques
nuevos. El rechazo atómico no creaba los nuevos; la recuperación exigía que ya
existieran todos y devolvía un conflicto falso.

**Corrección:** `worker/v2/immutable-blocks.ts` centraliza los cuatro caminos de
staging de agregados y planes. Ante conflicto se verifican los digests, se
reintenta solo el subconjunto faltante estrictamente menor y con límite. No se
sobrescriben bloques ni se debilita el CAS de cabeceras/receipts. Errores de
permisos, integridad y transporte siguen propagándose; un ACK perdido solo se
considera confirmado si existen todos los bloques íntegros.

**Archivos:** `worker/v2/aggregates.ts`, `plans.ts`, `immutable-blocks.ts`;
`tests/v2-block-reuse.test.ts`, `v2-immutable-blocks.test.ts`.

**Pruebas:** cuatro rojos (write/publish y write/prepare), restauración A→B→A con
metadatos nuevos, concurrencia, corrupción, errores 403/429/503, ACK perdido y
presupuesto. Evidencias `CAS-red.log`, `CAS-green.log`, `CAS-budget-green.log`,
`CAS-runtime-green.log`. El camino normal añade **cero lecturas**.

### PLA-04 — Borrador manual antiguo de plan

**Causa:** sincronizar archivaba el borrador pero sustituía su presentación sin
advertencia ni elección visible.

**Corrección:** se conserva íntegro en la exportación, se avisa y se bloquea la
presentación de planes hasta aceptar explícitamente usar los planes actuales
conservando la copia. La decisión se registra localmente, ligada al archivo
revisado. No se vuelve a habilitar edición/importación de planes.

**Archivos:** `src/main.tsx`, `qa/remediation/ui.spec.mjs`.
**Prueba:** plan dirty inyectado localmente, exportación profunda, aviso/acción y
cero comandos; plan remoto intacto. Rojo `red-ui-extra/`, verde
`green-drafts-ui/` y `ui-drafts-final.log`.

### CON-04 — Resolución sin perder cambios compatibles

**Causa:** Revisar versión actual descartaba todo el borrador, incluida otra
técnica sin conflicto.

**Corrección:** comparación de tres versiones por UUID/campo; metadatos de la
fuente remota y conservación de cambios compatibles. Los incompatibles requieren
elegir versión y Guardar resolución. Diferencias estructurales incompatibles son
una elección integral explícita: no se inventa un orden ni se recrean UUID.
Una nueva edición invalida la revisión abierta; un nuevo cambio remoto mantiene
el CAS y obliga a revisar otra vez.

**Archivos:** `src/application/reconcile-technique-draft.ts`, `src/main.tsx`,
`tests/reconcile-technique-draft.test.ts`, `qa/remediation/conflict.spec.mjs`.
**Pruebas:** dos contextos con petición retenida, 409 real, elección de la versión
remota conflictiva y conservación del texto local independiente; API y ambos
clientes convergen tras recargar. `CON04-red.log`, `CON04-green.log`, siete
pruebas puras de reconciliación.

### CON-09 — Plan retirado retenido por otro borrador

**Causa:** la protección global del borrador de técnicas impedía aceptar cambios
independientes del índice/planes en React.

**Corrección:** overlay exclusivo de técnicas sobre las nuevas entradas
confirmadas; se aceptan inmediatamente bajas de planes y datos independientes.

**Archivos:** `src/main.tsx`, `qa/remediation/ui.spec.mjs`.
**Prueba:** borrador con 500, desasignación desconectado, reconexión: desaparece
el plan y permanece la técnica pendiente. Fuente e IndexedDB verificadas.
Rojo `red-ui-extra/`, verde `ui-drafts-final.log`.

## Interfaz y rendimiento

| Caso | Causa y corrección | Archivos y evidencia |
|---|---|---|
| ENT-06 | El callback de guardado de A leía la generación de selección después del await, pudiendo pintar A sobre B. Ahora captura la generación del render y comprueba antes y después de cargar. | `src/main.tsx`; `ui.spec.mjs`, `red-ui/` y `ui-drafts-final.log`: guardado retenido, selección B, respuesta tardía de A y comprobación de aislamiento. |
| GEN-10 | Un plan asignado sin técnicas entrenables mostraba una invitación genérica a asignar torneo. Ahora el índice y repertorio ya descargados explican la causa y cómo corregirla, sin generar planes vacíos. | `src/main.tsx`; dos rojos/verdes en `ui.spec.mjs` (catálogo vacío y posición sin técnicas); cero nuevas consultas/cálculos de planes. |
| LIM-04 | 413 del documento transformado omitía archivo/bytes/límite aunque el parser del request sí los daba. Ahora aporta SizeDetails exactos con nombre lógico seguro. | `worker/v2/business.ts`, `tests/v2-business.test.ts`; `LIM04-red.log`, `LIM04-green.log`: repertorio y comentarios grandes, sin rutas privadas ni texto en diagnóstico. |
| REN-02 | Perfil/repertorio/comentarios e índice/catálogo se pedían en serie. Se inician en paralelo las fuentes independientes; el detalle de plan sigue bajo demanda. | `src/application/firestore-client.ts`; compuerta determinista en `ui.spec.mjs`, `red-ui/`, `REN02-final.log`; mismo número de llamadas, cero detalle de planes sin selección y uno al elegirlo. |

## Validación y repetición

Resultado final: **15 casos fallidos y CAS corregidos y validados localmente**.
Cada comportamiento tiene evidencia roja anterior a su corrección y comprobación
verde posterior. La tabla distingue la batería completa de unitarias de las
variantes E2E; sus cantidades no son el número de casos del protocolo original.

| Comprobación | Resultado | Evidencia en `.qa/remediation-2026-10-28/` |
|---|---|---|
| `npm test` | 368/368, cero fallos/cancelados/omitidos | `npm-test-complete-final.log` |
| `npm run test:qa-remediation` | 27/27 Chromium | `complete-final.log`, `complete-final/results.json`, `complete-final/report/index.html` |
| Typecheck y build | Aprobados | `typecheck-final.log`, `build-final.log` |
| Worker y cuatro runtimes locales | Aprobados | `SEC-01-worker-final.log`, `SEC-01-runtime-final.log` |
| Regresión browser PWA existente | Aprobada | `browser-final-complete.log` |
| Auditoría de bundle Firestore V2 | Aprobada | `check-firestore-v2.log` |
| Benchmark Firestore V2 sintético | Aprobado | `REN02-budget-benchmark.log`, `REN02-budget-final.log` |

En el benchmark local de aplicación, para 10/30/100 usuarios, diez navegaciones
por usuario, cien refrescos del día y snapshot después del propio ACK conservan
0 lecturas y 0 escrituras en caliente. El handshake frío tras reiniciar mantiene
6 lecturas y 0 escrituras. Son escenarios del banco sintético existente, no
medidas de facturación ni predicción de cualquier patrón real de producción.
REN-02 mantiene tres consultas de fuentes y solo un detalle al seleccionarlo;
la mejora consiste en solapar latencia, sin multiplicar documentos consultados.

Se preservan también las ejecuciones intermedias fallidas. Dos fallos de una
ejecución conjunta anterior correspondían a un selector de test que ya había
sido retirado por la mejora de seguridad y a un error del servidor QA al responder
dos veces por un asset ausente. El selector se actualizó al contrato más estricto
y el helper QA se corrigió con una regresión propia (`fixture.spec.mjs`);
la ejecución final completa es la de 27/27 indicada arriba.

Comandos locales, sin cuota Google:

```powershell
npm test
npm run typecheck
npm run build
npm run check:worker
npm run test:runtime
npm run test:browser
npm run check:firestore-v2
npm run benchmark:firestore-v2
npm run test:qa-remediation
npm run test:qa-remediation -- --grep CON04
```

El build debe preceder a los tests Chromium y `check:worker` a `test:runtime`.
Los informes locales de remediación se generan por defecto en
`.qa/remediation-2026-10-28/current/`. `QA_REPORT_SUFFIX` permite conservar cada
ejecución sin sobrescribirla. Los tests no requieren credenciales DEV.

Los contadores del transporte sintético miden documentos/operaciones intentadas,
no una factura real. Un rechazo de commit no debe interpretarse automáticamente
como una escritura facturable. Se distinguen peticiones HTTP de operaciones sobre
documentos. El journal y los fences operan exclusivamente en el navegador.

## Límites y revisión antes de integrar

No se modifican generador, continuidad, UUID, prioridades, reglas de permisos,
fecha Madrid ni política de protección de sesiones/planes. Las pruebas existentes
de histórico y concurrencia permanecen obligatorias. No se afirma validación de
Safari/iOS ni de dispositivos físicos.

Los 15 fallos y CAS tienen corrección y regresión local. Queda pendiente publicar
en DEV **solo con autorización posterior** y repetir allí las comprobaciones de
integración remota; esta campaña no permite afirmar que la versión desplegada ya
contenga las correcciones. El informe histórico de QA no se altera.

## Autorización posterior de integración DEV — 28/10/2026

Después del cierre anterior, el propietario solicita desplegar esta rama en
desarrollo. Autoriza guardar los cambios de la rama existente, publicar su PR a
`develop`, integrarla tras CI y desplegar exclusivamente DEV. La infraestructura
QA previamente confirmada en esta rama acompaña a las correcciones; `.qa/`,
credenciales, perfiles, informes y trazas privadas permanecen excluidos de Git.
No se modifica ni promociona `main`, ni configuración, secretos o datos PRO.

Destino comprobado: `wrangler.dev.jsonc`, Worker `pgt-github-probe-dev`, proyecto
`pgt-bjj-dev`, bindings existentes SECURITY/ProbeSecurity y DOMAIN_IO/DomainIO;
sin cambios de bindings o migraciones. El workflow `cloudflare-dev.yml` valida
cuenta DEV contra su variable esperada y SHA actual de develop antes de publicar.
Las 27 regresiones locales se incorporan a ese gate DEV después de instalar
Chromium. El workflow PRO permanece intacto.

La comprobación posterior al despliegue consulta `/api/dev/runtime` y verifica
el SHA de Worker/coordinador y proyecto. No ejecuta una campaña ni mutaciones
Google, que siguen sujetas a su gate de cuota independiente.

Primer CI de PR #31: 26/27 regresiones aprobadas; REN-02 contabilizó seis lecturas
de GC de los planes creados en el setup dentro de su ventana de navegación. En
Linux, más rápido, la alarma diferida coincidía con la medición; localmente ya
había terminado. Se reprodujo determinísticamente el mismo 6 frente a 0 usando
la alarma real. El fixture permite ahora controlar y drenar ese mantenimiento,
registrar su coste por separado y medir después la navegación, que sigue
exigiendo **cero lecturas y escrituras**. Un segundo drenado dentro de la ventana
comprueba que la navegación tampoco deja trabajo diferido. No se cambia código
de aplicación, se suprime GC real ni se relaja el presupuesto. Evidencia local:
`.qa/deploy-2026-10-28/REN02-maintenance-{red,green}.log`.
