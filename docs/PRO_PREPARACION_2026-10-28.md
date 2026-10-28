# Preparación Firestore PRO — 28/10/2026

> Actualizaci?n posterior del propietario: las dos correcciones de asignaciones ya se
> aplicaron y verificaron offline. El paquete actual tiene cero bloqueos de conversi?n;
> GitHub y Firestore PRO no se han modificado. Los bloqueos descritos m?s abajo son
> el diagn?stico previo. Ver [resultado vigente](PRO_CORRECCIONES_AUTORIZADAS_2026-10-28.md).


## Alcance y estado

Preparación local autorizada por el propietario. Rama `feature/firestore-pro-preparation`,
worktree `.worktrees/firestore-pro-preparation`, base `origin/develop`
`9e4c61464ab98c3f5415d0ffd16074f14da56e96`. Esta excepción expresa permite partir de develop
y preparar posteriormente una PR develop → main; no autoriza ahora ninguna integración o publicación.
El checkout original y sus cambios de QA se conservan sin trasladarlos a esta rama.

**No se ha escrito, consultado ni activado Firestore PRO. No se ha desplegado ningún Worker,
cambiado secretos/bindings activos ni modificado GitHub de datos.** La supuesta base PRO vacía
es una precondición aportada por el propietario, pendiente de comprobar remotamente.

La decisión vigente es una captura fija mientras la aplicación antigua sigue funcionando.
No se congelan escritores GitHub, no se sincronizan diferencias posteriores y no se repite
la migración para incorporarlas. Una recuperación de cambios posteriores queda fuera del encargo.
Esto sustituye para este corte los procedimientos históricos que exigían parar el Worker GitHub.

## Auditoría contrastada con código

Se revisaron MIGRACION_GITHUB_FIRESTORE_V2, FIRESTORE_V2_CONTRATOS, VALIDACION_FIRESTORE_V2,
CI_CD, ambos Wrangler, cloudflare.yml, scripts de extracción/ejecución, run-dev, autenticación,
preflight, transporte nativo, agregados, planes, consultas, sesiones, caché y entradas DEV/PRO.

| Hallazgo previo | Cambio preparatorio |
|---|---|
| Identidad OAuth restringida a DEV | Configuración servidor validada: entorno, proyecto, base y principal exacto de credencial |
| URLs nativas, batchGet y referencias fijadas a DEV | Construidas desde el destino validado; cruce de proyectos rechazado |
| Runtime exige activación DEV | Control y namespace deben corresponder al destino; PRO exige metadatos de integridad adicionales |
| Entrada PRO importa GitHub | Nueva `worker/pro.ts`, sin GitHub ni migrador en bundle |
| PRO solo declara ProbeSecurity | Namespace legado preservado e inerte; clases nuevas FirestoreSecurity y DomainIO con migración aditiva |
| Migrador stage/activate exclusivo DEV | Mismo migrador con destino PRO explícito, ledger por destino, autorización y comprobación inicial |
| DEV sustituye contraseñas | PRO conserva los hashes originales y no ejecuta restablecimientos |
| Conversión reconstruye índices asignados | En PRO las discrepancias bloquean, sin reparación silenciosa |
| Login normal escribe sesiones/rate limits/tickets en DO | Validador separado con Cloudflare Access, sin DO ni login normal |
| Main puede publicar automáticamente | Workflow futuro añade gate FIRESTORE_PRO_READY y comprobaciones PRO aisladas |

La caché, nombres de sesión y rutas relativas se mantienen dentro de Workers/DO separados.
Los prefijos antiguos no conceden acceso a sesiones PRO: la nueva clase usa un namespace distinto.
Las utilidades históricas de smoke/preflight siguen siendo exclusivamente DEV; no se convierten en
endpoints administrativos PRO. La compatibilidad DEV de bajo nivel no permite seleccionar PRO
sin configuración explícita. El navegador no puede elegir proyecto/base/cuenta.

## Origen capturado y conversión real offline

Repositorio privado `dmda92/pgt-bjj-data`, SHA inmutable:
`0a754e2b58a929323946217a3be495944818ce89`.

La referencia se consultó por Git en modo lectura. Se obtuvo un clon bare privado y una
captura AES-256-GCM fijada a ese SHA, con verificación de blobs. Paquetes, clave e inventario
detallado están fuera de Git, bajo ACL del usuario, en
`C:/Users/Usuario/AppData/Local/PGT/migrations/pro-20261028-preparation`.
No publicar ese directorio ni su clon, contenido o claves. El inventario público solo contiene recuentos.

| Tipo | Cantidad |
|---|---:|
| Archivos JSON | 102 |
| Bytes fuente | 1.050.735 |
| Usuarios / entrenadores | 18 / 3 |
| Perfiles / repertorios / comentarios / índices de usuario | 18 de cada uno |
| Catálogo / plantilla | 1 de cada uno |
| Planes / índices derivados históricos | 14 / 14 |
| Competiciones | 1 |
| Hashes de contraseña importados, sin mostrarlos | 18 |

Checksum fuente: `51c137d162d0cccddfc417673d7e506c6e29adf97becc77a3b160a39cf7ed70f`.
Checksum de conversión: `17464d62213764ff7a0c178e96413ca173f32b1cc8441d2d985fa164be6437fb`.
No son hashes de contraseña. El namespace candidato sería
`pgt_v2/import-17464d62213764ff7a0c178e`, pero **no es apto para carga**.

### Bloqueo de datos

`ready=false`: dos `ASSIGNMENT_INDEX_INCONSISTENT` y un `ASSIGNED_PLAN_MISSING`. En dos índices individuales falta
una asignación presente en el catálogo; no aparecen asignaciones adicionales. Los detalles
identificativos quedan en el inventario privado cifrado. No se han corregido los JSON,
regenerado planes ni alterado GitHub. El plan offline registra `BLOCKED_OFFLINE_NO_NETWORK`,
con estimaciones nulas: no se simula un dataset reparado como si fuese el original.

Antes de cargar hace falta una decisión expresa del propietario sobre el tratamiento de estas
tres diferencias en el mismo SHA. Si se autoriza una transformación legítima, debe ser concreta,
trazable, probada y producir un checksum nuevo. No se vuelve a capturar un SHA más reciente
para eludir el bloqueo. No se pide aún autorización de primera escritura.

La comprobaci?n independiente contra los blobs originales confirma igualdad profunda de los
88 documentos de negocio convertidos (incluidos los 14 planes y los hashes privados de los
18 perfiles). Los 14 ?ndices de estructura hist?ricos se conservan en la captura; las nuevas
proyecciones son derivadas. Esta igualdad tambi?n conserva las inconsistencias detectadas,
por lo que no elimina el bloqueo de carga. No es una verificaci?n de Firestore remoto.

## Riesgos y pendientes

- Los cambios GitHub posteriores al SHA quedan excluidos por decisión expresa, incluidos los
  que confirme un cliente antiguo antes del despliegue. GitHub y su historia se conservan.
- Los borradores IndexedDB anteriores se archivan/exportan; no se importan automáticamente.
  No presentar esta migración como recuperación de ediciones locales.
- Credenciales, IAM, índices, cuota disponible, ausencia de otros escritores PRO y destino vacío
  siguen pendientes de comprobación real. Un dry-run no prueba permisos ni cuota Google.
- El validador permite inspección de datos con las consultas reales, mediante una interfaz de
  inspección, no demuestra que todas las pantallas editables de la aplicación funcionen en PRO.
- La campaña QA previa dejó limitaciones de dispositivos físicos/despliegues; no desaparecen
  por superar los tests locales de esta preparación.

## Entregables relacionados

- [Configuración Firebase](PRO_CONFIG_FIREBASE.md).
- [Configuración Cloudflare](PRO_CONFIG_CLOUDFLARE.md).
- [Migrador y controles PRO](MIGRACION_PRO_V2.md).
- [Validador temporal](PRO_VALIDATION.md).
- [Secuencia y recuperación](PRO_EJECUCION_Y_RECUPERACION.md).
- [Resultados de pruebas locales](PRO_VALIDACION_LOCAL_2026-10-28.md).
