# Modelo documental nativo y administración de DEV

Destino fijo: pgt-bjj-dev/(default), Standard/Native, europe-west1, Spark. API única en pgt-github-probe-dev. SECURITY conserva sesiones, límites y serialización. DOMAIN_IO es un namespace SQLite DEV independiente: cada operación se ejecuta en un DO efímero privado sin guardar negocio ni SQLite; mantiene el presupuesto CPU de DO para el mismo PBKDF2. El transporte saliente usa DO privados con máximo 32 llamadas externas (OAuth y reintentos incluidos), rotando antes del límite Free de 50. Las respuestas RPC son bytes materializados y cambios de sesión, sin streams/RpcTarget. El coordinador aplica checkpoints en una transacción antes de responder. Datos funcionales siempre Firestore; acceso directo deny-all. Ninguna credencial se entrega al navegador. Producción y repositorio original no se modifican.

## Colecciones y campos

| Colección/documento | Campos y relaciones | Gestión |
|---|---|---|
| users/{correo normalizado} | mail, nombre, apellidos, fecha_nacimiento, peso, cinturon, **perfil**, schemaVersion/revision/updatedAt | Perfil legible; actualizado por su propietario; rol solo entrenador/administración autorizada |
| users/{correo}/private/credentials | passwordHash PBKDF2-SHA256 600000 con sal, formato anterior intacto | Nunca texto claro ni respuesta de API. Usar reset seguro |
| technique_catalog/original | metadatos originales y activeRevision (referencia nativa clicable) | Catálogo original, no plantilla sintética |
| user_techniques/{correo} | versión, positions[] (metadatos ordenados), descriptionUpdates (mapa), deletionCatalog, activeRevision, deletedIds/deletionRevision | Repertorio de ese usuario; UUID de posiciones y técnicas propios |
| …/revisions/{UUID}/positions/{UUID o position-001 base} (compatibilidad/fallback >96 KiB) | id, posicion, prioridad, ordinal | Orden y prioridad explícitos |
| …/revisions/{UUID}/techniques/{UUID o position-001-technique-001 base} | id, positionId, positionPriority, tipo, descripcion_del_alumno, ordinal local a posición | Consulta por posición/prioridad dentro del repertorio; descripciones nativas sin codificación |
| …/revisions/{UUID}/description_versions/{UUID técnica} (fallback) | value, ordinal | Versiones de descripciones por UUID, incluidas referencias históricas |
| …/revisions/{UUID}/deletion_catalog/{UUID posición} (fallback) | id, priority, techniques[], ordinal | Estado de continuidad asociado a eliminaciones; no catálogo actual |
| trainer_comments/{correo} | versión, comments[] y commentUpdates; activeRevision solo si requiere tablas | Comentarios autorizados de entrenadores, separados de las descripciones del alumno |
| …/revisions/{UUID}/comments/{UUID técnica} (fallback) | techniqueId, comment, trainerName opcional, ordinal | Autor asignado por servidor |
| …/revisions/{UUID}/comment_versions/{UUID técnica} (fallback) | value, ordinal | Versiones para avisos y recálculo futuro |
| competitions/{UUID competición} | planId, fecha_comienzo, fecha_torneo, **alumnos[]**, días, ejercicios, tiempos y descansos | Única autoridad de inscripciones; parámetros conservados |
| settings/competitions | revisión del catálogo, competitionIds[] ordenados | Coordinación CAS y orden global; no JSON completo ni blobs |
| competition_tombstones/{UUID} | planId, ordinal | Borrados de competiciones necesarios para reconciliación; retirar los de QA al limpiar su ejecución |
| user_plan_assignments/{correo} | planIds[], deletedPlanIds[], schemaVersion/revision/updatedAt | Proyección recuperable desde competiciones; no editar como segunda autoridad |
| training_plans/{UUID competición}__{correo} | mail, planId, configuración snapshot, fecha, revisiones aplicadas, activeRevision | Índices por mail y planId; el mismo planId une competición/participante |
| …/revisions/{UUID}/sessions/{AAAA-MM-DD} | date, ordinal, exercises[] y continuityBoundary nativos | Unidad de lectura/actualización: sesión; orden exacto de ejercicios |
| …/revisions/{UUID}/exercises/{fecha}_{ordinal} (fallback de sesión grande) | sessionDate, ordinal, positionId, techniqueId, posicion, prioridad, tipo, descripción, comment, pass, positionComplete | Snapshot histórico exacto; un ejercicio no depende del repertorio actual para poder leer pasado/PDF |
| …/revisions/{UUID}/continuity_catalog/{UUID posición} (fallback; normal: continuityCatalog[] en raíz) | catálogo y orden del generador | Misma estructura lógica, sin tocar algoritmo |
| …/revisions/{UUID}/boundaries/{fecha} (fallback; normal: continuityBoundary en sesión) | date, exerciseSignature (array de mapas), stateSignature, cursor con prioridades, movimiento, pasadas y remainingPositionGroups | Cola ordenada agrupada por posición, con UUID y marcadores de finalización; se reconstruye literalmente el cursor original |
| …/revisions/{UUID}/applied_description_versions y applied_comment_versions | UUID, value, ordinal | Checkpoints de propagación, no textos duplicados editables |
| training_day_indexes/{UUID}__{correo} | mail, planId, sourceSha (token de revisión API), blocked, activeRevision | Derivado reconstruible; fuente funcional sigue siendo el plan |
| …/revisions/{UUID}/dictionary/{ordinal} (fallback; normal: dayDictionary[] en raíz) y sessions/{fecha} | posicion/tipo y referencias numéricas a su diccionario | Las tuplas se convierten en mapas nativos, sin arrays anidados incompatibles con Firestore |
| settings/schema | modelo, proyecto, origen/blob del catálogo, conteos, checksums de auditoría e initializedAt | Evidencia de inicialización controlada |
| realtime_events/{UUID} | owner, kind, version, createdAt | Outbox de invalidación; Commit atómico con la entidad; eliminado tras confirmar entrega |
| qa_runs/{UUID} | purpose, roles preparados, tareas de limpieza e IDs de competición sintética | Solo durante el ensayo; borrado físico al terminar o recuperación de una ejecución interrumpida |

Todos los documentos de negocio contienen valores nativos. No existen inline, bytesValue, digest, directory, file, parts ni entidades serializadas en strings. Los nombres de archivo que subsisten en respuestas de error mantienen compatibilidad funcional del cliente; no son claves ni rutas de persistencia. El campo sha del protocolo HTTP conserva un token de revisión opaco para compatibilidad con frontend existente: no identifica archivos GitHub y no es un ID de documento. La firma de ejercicios se almacena como array de mapas nativos y se recompone exactamente al entrar en dominio. stateSignature es la huella hexadecimal original del cursor, nunca un sustituto del contenido funcional. Una firma histórica inválida se conserva como diagnóstico invalidLegacySignature sin corregir el plan.

Las fechas de calendario permanecen YYYY-MM-DD; updatedAt/generatedAt/createdAt/initializedAt son timestamps nativos al almacenar y vuelven al ISO original al entrar en dominio. Los arrays y ordinales conservan orden sin depender del orden de respuesta de Firestore. Las referencias activeRevision se pueden abrir desde la consola.

## Atomicidad y límites

Los agregados lógicos siguen admitiendo 4 MiB y cada documento tiene el guard nativo de 1 MiB. Metadatos acotados a 96 KiB por grupo se guardan en la raíz; sesiones con ejercicios/continuidad acotadas a 400 KiB JSON se guardan como un documento por sesión. Si superan estos umbrales, se conservan tablas semánticas, sin fragmentar bytes ni truncar textos. Se mantiene la lectura de las revisiones ya desplegadas; no se hace migración masiva ni se reescriben datos al consultar.

Las actualizaciones pequeñas comparan campos nativos y ejecutan únicamente su diferencia, raíz CAS y outbox en un único commit (máximo conservador: 450 escrituras/8 MiB). Cada hijo modificado/eliminado lleva su precondición updateTime. Los lectores comprueban de nuevo la raíz después de los hijos y reintentan como máximo dos veces si cambió; no aceptan una mezcla con los mismos conteos. Una escritura idéntica no publica un evento. El resultado utiliza el recibo del commit, sin releer el documento para confirmar un ACK correcto.

Una creación o diferencia mayor usa staging y publicación CAS de revisión. publicationId resuelve ACK perdido sin repetir la mutación; revision_cleanup se publica atómicamente al retirar una revisión. La recuperación consulta como máximo cuatro tareas en mutaciones/alarma, no en cada GET. El outbox consulta como máximo 100 eventos por lote y confirma después de publicarlos. Los fallos conservan recuperación; no se afirma una transacción global de todas las entidades de un torneo.

La copia de textos y configuración dentro de ejercicios es un snapshot histórico funcional obligatorio, no una duplicación editable de la fuente. Los índices del día son derivados vinculados a revisión; no se editan. Las inscripciones solo se deciden en competitions.alumnos[]. Varias entidades de una operación de negocio conservan la reconciliación recuperable anterior; no se afirma una transacción global sobre todos los alumnos.

Fuentes de límites: https://firebase.google.com/docs/firestore/quotas y https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit . El límite de 500 transformaciones es por documento; el transporte REST se acota por tamaño de solicitud (menos de 10 MiB), sin confundirlo con ese contador. Consultas de un campo utilizan índices simples automáticos. firestore.structured.indexes.json propone exenciones para textos/cursor que nunca se consultan; aplicarlas solo en DEV con la cuenta propietaria si se realizan ensayos de volumen. El runtime no amplía IAM ni despliega índices PRO.

Coste medido y límites del presupuesto real: [FIRESTORE_CONSUMO_DEV.md](FIRESTORE_CONSUMO_DEV.md). No confundir llamadas HTTP con documentos leídos. Las estimaciones no sustituyen el contador de cuotas de Google. No activar Blaze ni TTL de pago.

## Consultas en Firebase Console

1. Usuarios: colección **users**, documento del correo en minúsculas. Perfil visible como `perfil: alumno` o `perfil: entrenador`. Filtro `perfil == entrenador` consulta entrenadores directamente.
2. Repertorio: user_techniques → correo → positions[] contiene nombres/prioridades/UUID en orden. Abrir **activeRevision** → techniques, filtrar positionId o positionPriority. ordinal es local a la posición. positionPriority es una proyección controlada: solo la API modifica conjuntamente metadatos y técnicas con CAS; no editarla a mano.
3. Catálogo: technique_catalog → original → positions[] y activeRevision → techniques. Los IDs legibles de referencia no se reutilizan al crear alumnos.
4. Competiciones: competitions → UUID. alumnos es un array legible; usar filtro array-contains correo. Buscar training_plans con `planId == UUID` para todos sus participantes o `mail == correo` para un usuario.
5. Plan: abrir activeRevision, sessions por fecha; exercises[] y continuityBoundary dentro de cada sesión. Las sesiones excepcionalmente grandes mantienen las tablas de fallback. Los textos históricos siguen visibles aunque se haya eliminado la técnica actual.
6. Comentarios: trainer_comments → correo → comments[]/commentUpdates; tablas bajo activeRevision solo en el fallback grande. El autor es del servidor.

## Qué se puede editar directamente

- **Perfil/rol en users:** la lectura de autorización usa el documento actual. Cambiar perfil invalida el rol de la sesión anterior al siguiente acceso/revalidación del canal; cerrar sesión y entrar de nuevo para usar el nuevo rol. Una sesión antigua no gana privilegios por cambiar su payload. No hay notificación instantánea desde una consola externa en reposo.
- **Nombre, apellidos, peso, fecha y cinturón:** respetar las mismas validaciones de la API; la consola puede escribir datos inválidos, por lo que se recomienda la pantalla Perfil. Reabrir/refrescar la sesión para ver una edición externa. No cambiar mail/ID.
- **Contraseña:** no editar passwordHash a mano. Usar la operación de reset autenticada y revocar sesiones.
- **Técnicas, prioridades, comentarios, inscripciones y competiciones:** utilizar la aplicación/API administrativa con revisión y autorización. Escribir a mano los documentos es visible, pero no ejecuta recálculo, checkpoints, índices ni outbox; no es una operación segura sobre un plan activo.
- **Planes, continuidad, revisiones, ordinales, asignaciones derivadas y outbox:** no editar directamente. Son resultados/versiones gestionados por servidor; conservar pasado/hoy literalmente.

No existe listener de Firebase Console ni permiso web abierto. Los cambios funcionales seguros pasan por Worker; los cambios de consola de perfil se aplican en la siguiente lectura autorizada. Mantener deny-all y la cuenta de servicio limitada a DEV.

## Operación y revisión

Las features nacen de main y se integran mediante PR en develop. Solo develop puede desplegar en DEV, con comprobación de cuenta, Worker, proyecto y HEAD. El propietario autorizó explícitamente fusionar la PR #12 en develop el 21/10/2026 para completar el despliegue y las pruebas reales. Se retiró la excepción incorrecta de despliegue directo de la feature; no se modifican las protecciones del Environment. Las validaciones se ejecutan antes de inventario/limpieza/carga/QA. No se modificó el workflow PRO.

Desde la optimización de consumo, los despliegues solo verifican la identidad del runtime, sin CRUD preflight, inventario, bootstrap, limpieza ni QA real automáticos. Los scripts históricos prepare-structured-dev.mjs y verify-structured-dev.mjs rechazan su ejecución antes de cualquier HTTP. La batería extensa de navegador solo admite transporte local interceptado. Una validación real requiere cuota fiable reciente y un plan completo que incluya limpieza y cumpla 200 lecturas/150 escrituras/50 eliminaciones/2 usuarios; el gate rechaza cuota desconocida, cercana al límite o un plan mayor. La PR permanece sin fusionar para revisión del propietario.

## Primera cuenta de entrenador tras la limpieza

Una vez completada la inicialización real en DEV: registrar una cuenta propia desde la aplicación, abrir **pgt-bjj-dev → Firestore → users → correo**, cambiar únicamente perfil de alumno a entrenador, y cerrar/abrir sesión. No se crea una cuenta administrativa con contraseña conocida ni se migran cuentas originales. La limpieza pendiente de la última ejecución interrumpida no se considera completada: verificar y retirar solo los recursos de su marcador cuando haya cuota fiable suficiente.

Estado operativo y bloqueo de Environment: [VALIDACION_FIRESTORE_STRUCTURED.md](VALIDACION_FIRESTORE_STRUCTURED.md). La implementación preparada no equivale a una limpieza o carga remota ejecutada.

## Auditoría preventiva de fiabilidad

Véase FIRESTORE_RELIABILITY_AUDIT.md. Cada documento se comprueba contra 1 MiB con el cálculo de tamaños nativos de Firebase, además del límite agregado de 4 MiB. Los inventarios siguen nextPageToken. Las lecturas fresh invalidan cachés del agregado y del transporte; las comprobaciones finales de catálogo vuelven a Google. revision_cleanup es exclusivamente coordinación de retirada, sin contenido funcional codificado. No editar manualmente activeRevision, entityCounts ni tareas de retirada.

### Ubicación y publicación de eventos

Los ejecutores privados y el transporte reciben locationHint=weur para aproximarse a Firestore europe-west1; Cloudflare lo trata como preferencia, no como garantía. La revalidación de sockets y lectura de outbox se agrupa cerca de la base, sin copiar negocio a SQLite. El coordinador publica primero y confirma después por CAS: una interrupción conserva la recuperación del outbox. Los tokens OAuth pueden conservarse en memoria hasta su expiración; las lecturas funcionales siguen acotadas a cada operación.
