# Operación GitHub → Firestore PRO con el migrador existente

Preparación, no autorización de ejecución. Se reutiliza `scripts/run-dev-migration.mjs` y
`tools/migration/`; sus nombres históricos no implican un segundo migrador. PRO requiere
`--target pgt-bjj-pro` explícito. Omitirlo mantiene el destino DEV y rechaza un bundle PRO.

## Captura fijada

Origen y bloqueos actuales: [auditoría](PRO_PREPARACION_2026-10-28.md). SHA
`0a754e2b58a929323946217a3be495944818ce89`. No volver a consultar HEAD para modificarlo.
Captura AES-256-GCM, clave e inventario privado fuera del repositorio y de su checkout principal.
Antes de planificar o cargar PRO, el runner compara independientemente `source.enc.json`
contra el bundle: perfiles y hashes, cat?logo, t?cnicas, ?ndices, comentarios y planes completos.
Rechaza cambios aun si se recalcul? correctamente el checksum del bundle.
El guard resuelve symlinks y detecta también el Git común de un worktree enlazado.

La extracción admite únicamente lectura del repositorio permitido, árbol completo y blobs
verificados. No contiene una capacidad de escribir GitHub. Las identidades de producción
conservan exactamente el hash PBKDF2-SHA256/600000 válido. No se crean contraseñas nuevas,
archivos de claves de usuarios, sesiones ni tokens al importar PRO.

## Archivos privados del operador

Directorio fuera de ambos checkouts, con ACL restrictiva. No publicar ni subir a Git:

| Archivo | Contenido |
|---|---|
| key.bin | 32 bytes de clave del paquete |
| source.enc.json | Captura original cifrada e inmutable |
| bundle.enc.json | Conversión cifrada para `pgt-bjj-pro` |
| inventory.complete.enc.json | Inventario por ruta/blob/hash canónico y diferencias identificativas |
| operator.json | project, database, serviceAccountEmail, serviceAccountFile fuera de Git |
| plan.json | Plan sintético válido, ligado al checksum y proyecto |
| grant.json | Concesión de cuota observada y reservas reales, ligada al checksum |
| production-authorization.json | Registro de autorización expresa del propietario |
| index-evidence.json | Solo si la identidad no puede leer índices: atestación expresa y reciente del propietario |

`operator.json` debe identificar `project=pgt-bjj-pro`, `database=(default)` y el principal
PRO dedicado de importación, cuyo JSON debe coincidir exactamente. Nunca usar DEV. Su secreto
no se copia al Worker. La cuenta del runtime normal y la del validador son otras identidades.

`grant.json` usa el esquema MigrationGrant de `tools/migration/budget.ts`: project, runId UUID,
checksum, observedAt/expiresAt en milisegundos y remaining/reserve/limits con reads/writes/deletes.
Observación inicial de menos de cinco minutos; vencimiento máximo de 30 minutos. No inventar
cuotas. Límites más reserva no pueden superar lo observado. Todos los procesos del destino
deben usar el mismo ledger SQLite en el padre del directorio privado, `<project>-ledger.sqlite`.
No ejecutar desde varios equipos o padres/ledgers distintos. Reservas anteriores, fallos y ACK
perdidos no se reembolsan; esperar vencimiento más margen antes de sustituir una concesión activa.

`production-authorization.json` exige: project/base exactos, sourceCommit, checksum, action
`initial-fixed-snapshot-migration`, acceptPostSnapshotChangesExcluded=true,
ownerAuthorizationReference con referencia comprobable al permiso humano, authorizedAt y
expiresAt (máximo 24 horas). **Crear un archivo no concede permiso**. No generarlo como
autorización válida antes de que el propietario apruebe la primera escritura.

## Comandos y su efecto

Desde la raíz del worktree, Node 24; sustituir `<privado>` por la ruta protegida real.

```text
node --experimental-strip-types scripts/run-dev-migration.mjs plan <privado> --target pgt-bjj-pro
node --experimental-strip-types scripts/run-dev-migration.mjs metadata-check <privado> --target pgt-bjj-pro
node --experimental-strip-types scripts/run-dev-migration.mjs indexes-check <privado> --target pgt-bjj-pro
node --experimental-strip-types scripts/run-dev-migration.mjs destination-check <privado> --target pgt-bjj-pro
```

- `plan`: no red, credenciales ni Firestore reales. Con fuente inconsistente escribe
  `plan-blocked.json` con estimaciones nulas y termina sin simular reparaciones. Con fuente válida
  reproduce staging/activación/verificación mediante transporte sintético y el mismo ledger.
  Distingue documentos estimados de reservas conservadoras no reembolsables de las consultas.
  suggestedLimits parte de las reservas, no de un margen sobre lecturas lógicas insuficiente.
- `metadata-check`: OAuth y lectura de metadatos, sin documentos de negocio ni CRUD diagnóstico.
  Puede ejecutarse con fuente bloqueada para comprobar configuración. No se ha ejecutado en PRO.
- `indexes-check`: verifica exenciones de cuatro collectionGroups. Un 403 no prueba que existan:
  exige evidencia explícita del propietario; no eleva IAM. Sin escrituras.
- `destination-check`: lectura presupuestada; rechaza colecciones ajenas, otro namespace o dataset
  activo diferente. Permite reanudar únicamente el staging idéntico. No limpia la base.

Tras resolver bloqueos, presentar primero resultados, estimación y riesgos al propietario.
**Los siguientes comandos escriben y requieren autorización expresa previa; no se han ejecutado:**

```text
node --experimental-strip-types scripts/run-dev-migration.mjs stage <privado> --target pgt-bjj-pro
node --experimental-strip-types scripts/run-dev-migration.mjs activate <privado> --target pgt-bjj-pro
```

Stage crea únicamente el namespace inactivo del checksum, conserva perfiles/credenciales, planes y
texto; genera solo representaciones e índices derivados, nunca sesiones nuevas. PRO bloquea índices
inconsistentes y planes ausentes. Verificación independiente relee fuentes y distribuciones, compara
contenido profundo e inventarios exactos de agregados/planes y valida el manifiesto. Solo entonces
publica phase=verified. No usa el ACK o la caché como prueba de persistencia.

Activate comprueba autorización vigente, destino, integridad, CAS inicial y ausencia de un dataset
activo diferente. Repite la verificación profunda. Publica atómicamente el marcador active y el
puntero; no cambia contraseñas ni datos de negocio. Una repetición con el mismo puntero y contenido
es idempotente. Esto es recuperación de un ACK, no una nueva migración o captura de GitHub.

Posteriormente, solo lectura:

```text
node --experimental-strip-types scripts/run-dev-migration.mjs verify <privado> --target pgt-bjj-pro
```

Verifica de nuevo sin mutaciones. Los resultados privados conservan SHA/checksum/presupuesto;
no imprimir contenido personal, hashes de contraseña o claves. Logs públicos solo muestran recuentos.

## Congelación y recuperación

La aplicación GitHub permanece disponible y sus escrituras no se bloquean. La exclusividad exigida
es sobre **Firestore PRO nuevo**: sin runtime escritor ni otros operadores, salvo el importador
autorizado. El inventario no puede bloquear atómicamente un escritor externo arbitrario; restringir
IAM y controlar operadores es una precondición real, no una bandera ficticia de mantenimiento.

No se sincronizan commits posteriores. No se cambia el SHA porque hayan pasado horas o días.
Tras datos aceptados en Firestore, volver al backend GitHub exige otro encargo de recuperación;
no usar un rollback automático que pierda cambios. Ver [procedimiento](PRO_EJECUCION_Y_RECUPERACION.md).


## Correcciones expresamente autorizadas posteriores

El propietario resolvi? los tres bloqueos mediante una desasignaci?n y reconstrucci?n de
una referencia existente. Ver PRO_CORRECCIONES_AUTORIZADAS_2026-10-28.md. La extracci?n
original no cambia. Para repetir esa conversi?n se utiliza `convert ... --corrections-file
<archivo_privado>`; el runner exige el mismo `corrections.json` fuera de Git. No se aplica
ninguna correcci?n por defecto ni se aceptan cambios de estado que incumplan sus precondiciones.
