# Migración GitHub PRO → Firestore V2

## Estado

Extractor GET-only, conversión offline, cifrado, staging, verificación, presupuesto
durable compartido y activación CAS DEV implementados y probados con fixtures.
El runtime V2 se desplegó en DEV el 26/10/2026 (PR #25/#26). Se ha capturado
el origen privado, cifrado y convertido localmente bajo la autorización posterior
del propietario. No se ha importado ni activado todavía un namespace remoto.
No usa Firestore DEV anterior como origen.

## Origen y CLI

Solo dmda92/pgt-bjj-data privado bajo PGT/, fijado por commit de 40 hex.
Árbol completo, blobs verificados por SHA Git, rutas desconocidas bloqueantes.
El extractor no puede editar, borrar o cambiar la visibilidad de GitHub.

Paquetes AES-256-GCM y clave de 32 bytes fuera del repositorio, sin sobrescribir
archivos. En Windows proteger el directorio con ACL; mode 0600 no las sustituye.
Nunca incluir paquetes, claves, contenido o credenciales en Actions/Git/logs.

```text
node --experimental-strip-types scripts/migrate-github-v2.mjs help
node --experimental-strip-types scripts/migrate-github-v2.mjs keygen --key-file <clave_fuera_del_repo>
node --experimental-strip-types scripts/migrate-github-v2.mjs extract --commit <SHA_40_HEX> --allow-github-read --key-file <clave> --output <captura_nueva_cifrada>
node --experimental-strip-types scripts/migrate-github-v2.mjs convert --project pgt-bjj-dev --key-file <clave> --input <captura_cifrada> --output <conversion_nueva_cifrada>
node --experimental-strip-types scripts/migrate-github-v2.mjs inspect --key-file <clave> --input <paquete_cifrado>
```

Solo extract usa red/GitHub. Token de lectura mínimo mediante
PGT_MIGRATION_GITHUB_READ_TOKEN por canal privado, nunca en argumentos.
Convert/inspect/keygen son locales. Esta CLI no carga ni activa Firestore.

Conversión conserva perfiles, UUID, orden, comentarios/autores, asignaciones,
tombstones, planes/histórico y continuidad. Sin reloj ni generación de sesiones.
El índice derivado de asignaciones se reconstruye desde el catálogo autorizado,
igual que updateIndexes del backend original; se registra un aviso y se preservan
los tombstones no reasignados. Nunca se reparan o regeneran snapshots guardados.
Los derivados se reconstruyen de snapshots fuente. Incoherencias/huérfanos/UUID
compartidos bloquean; asignaciones sin snapshot quedan pendientes recuperables.
DEV elimina hashes PRO; entrenadores requieren contraseñas DEV independientes.
Alumnos sin contraseña podrán recibir restablecimiento controlado.
Conversión offline PRO conserva hashes válidos; escritura PRO deshabilitada.

## Runner privado y presupuesto

tools/migration/run-dev.ts::runDevMigration requiere bundle íntegro DEV,
MigrationGrant, storage durable/transaccional compartido por TODOS los ejecutores,
entorno y transporte explícito. Sin transporte por defecto ni endpoint público.
Grant: runId/checksum, cuota restante observada hace menos de cinco minutos,
reserva no consumible, límites y vencimiento. MigrationBudget reserva antes de
cada HTTP Firestore; errores y respuestas perdidas no reembolsan reservas.
Las reservas de varios ejecutores usan el mismo ledger. Una concesión distinta
espera a vencimiento más margen de requests en vuelo. FirestoreUsage mantiene
además un guard local; ese contador aislado no se presenta como límite global.

Acción stage o activate explícita. Activate requiere también ActivationGate que
acredite mantenimiento/escritores drenados, contraseñas y CAS exacto del puntero.
El gate se comprueba antes de mutar y antes de activar. Ningún payload de AppApi
se convierte en esa capacidad. SQLite del ledger no guarda fuentes o contraseñas.

El operador debe aportar el storage compartido REAL y el gate de mantenimiento.
La librería y su integración se prueban localmente, no se presentan como ejecución
remota. El presupuesto cubre la migración, no tráfico ordinario de otras versiones:
cuota, reserva y mantenimiento deben considerar ese tráfico.

## Procedimiento futuro, no ejecutado

1. Autorizar operación DEV; identificar cuenta/proyecto/base y cuota fiable.
   Inventariar/clasificar captura offline y resolver bloqueos del conversor.
2. Revisar/publicar exenciones firestore.v2.indexes.json antes de escribir mapas
   grandes y verificar deny-all/IAM DEV. No sustituir índices anteriores sin revisión.
3. Capturar commit explícito, cifrar, convertir y verificar checksum.
4. Stage solo en pgt_v2/import-<checksum24>, nunca mezclar/borrar namespaces.
   Cuota agotada deja staging inactivo; reanudar bajo autorización renovada.
5. Leer independientemente fuentes, planes y agendas; comparar resultados/hashes.
   Marcar verified y active=false solo después de comprobar todo.
6. Mantenimiento: drenar escritores y preparar credenciales por canal privado.
   Activate con CAS del puntero. Credenciales parciales se reanudan con el mismo
   valor; otro valor causa conflicto, sin sustituirlo silenciosamente.
7. Publicar atómicamente active=true y pgt_v2/control. Reiniciar coordinador/cerrar
   sesiones antiguas antes de abrir tráfico: no cambiar el puntero dejando una
   instancia anterior sirviendo otro namespace desde su caché.
8. Verificación mínima autorizada con cuota fiable y limpieza sintética prevista.
   Nunca ejecutar la batería local contra Google. Guardar solo evidencia sin contenido.

Antes de abrir escrituras puede volverse al origen intacto. Después no hacer un
rollback que pierda cambios escritos en Firestore. No borrar pgt-bjj-data ni sus
históricos como parte de este proceso.

## Ejecutor local DEV — primera activación

`scripts/run-dev-migration.mjs <plan|indexes-check|stage|activate> <directorio_privado>`
es un ejecutor local fuera del runtime. No se publica un endpoint administrativo.
Todos los procesos de ese destino usan el mismo SQLite persistente en el padre
del directorio privado, con transacciones BEGIN IMMEDIATE y synchronous=FULL.
No utilizar otro equipo/ledger en paralelo. No copia secretos del Worker.

`extract-local` permite obtener la captura de un clon bare privado, fijado por
commit y con origen exacto comprobado. Solo invoca comandos Git de lectura.
La autenticación de clone la gestiona Git, sin extraer tokens de su almacén.

`plan` usa únicamente un transporte simulado en memoria, guarda credenciales
aleatorias DEV en dev-credentials.json privado y estima stage + activate sin red.
Puede prepararse ese archivo previamente para habilitar solo cuentas concretas;
todos los entrenadores necesitan una credencial independiente de PRO.

Para ejecutar, operator.json privado contiene serviceAccountFile y expectedBuild
(SHA desplegado de develop); grant.json contiene MigrationGrant completo con
checksum del paquete, runId, observedAt, expiresAt, remaining, reserve y limits.
La observación debe tener menos de cinco minutos al abrir la concesión. No se
inventa cuota ni se deriva de los contadores locales. El margen del plan cubre
comprobaciones de mantenimiento; no se reembolsan peticiones fallidas.

Antes de datos, verifica las cuatro exenciones de índices por la API Admin de
Firestore, sin publicar ni sustituir configuración. Un 403 requiere confirmación
explícita del propietario desde Firebase, registrada en index-evidence.json privado
(project, database, source=owner-firebase-console, observedAt, allFieldsExempt y
collectionGroups con los cuatro grupos). No se eleva IAM del runtime ni se da
por configurado a partir de un 403. La carga rechaza índices no exentos o evidencia
ausente. El gate comprueba el build DEV y la ausencia real de pgt_v2/control:
sin puntero, el runtime V2 no admite escritores. Comprueba otra vez antes de
activar. Si ya hay un conjunto activo, se detiene: este ejecutor no finge un
mantenimiento para reemplazarlo. Reiniciar coordinador mediante despliegue desde
develop después de activar, antes de las pruebas mínimas autorizadas.

Inventario del 26/10/2026: 102 JSON, 18 usuarios (3 entrenadores), una competición,
14 planes guardados, tres índices derivados desactualizados y un plan asignado
todavía inexistente. Este último conserva el estado recuperable, sin inventar
histórico. Simulación con la captura: 403 lecturas, 296 escrituras, cero borrados;
presupuesto propuesto con margen: 554/420/0. No son operaciones Google medidas.
La captura, claves, contraseñas y evidencias detalladas permanecen fuera de Git.

El corte futuro PRO usa otra captura final actualizada durante mantenimiento,
nunca datos modificados en DEV. Reutiliza extractor/conversor; la habilitación de
escritura PRO requiere encargo específico y no consiste en desactivar guards DEV.
