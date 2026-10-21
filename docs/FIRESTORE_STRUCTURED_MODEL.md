# Modelo documental nativo y administración de DEV

Destino fijo: pgt-bjj-dev/(default), Standard/Native, europe-west1, Spark. API única en pgt-github-probe-dev. Reglas de acceso directo continúan deny-all. Credencial OAuth de servicio nunca llega al navegador. Producción y repositorio privado original: ninguna escritura autorizada.

## Colecciones y campos

| Colección/documento | Campos y relaciones | Gestión |
|---|---|---|
| users/{correo normalizado} | mail, nombre, apellidos, fecha_nacimiento, peso, cinturon, **perfil**, schemaVersion/revision/updatedAt | Perfil legible; actualizado por su propietario; rol solo entrenador/administración autorizada |
| users/{correo}/private/credentials | passwordHash PBKDF2-SHA256 600000 con sal, formato anterior intacto | Nunca texto claro ni respuesta de API. Usar reset seguro |
| technique_catalog/original | metadatos originales y activeRevision (referencia nativa clicable) | Catálogo original, no plantilla sintética |
| user_techniques/{correo} | versión funcional, activeRevision, deletedIds/deletionRevision | Repertorio de ese usuario; UUID de posiciones y técnicas propios |
| …/revisions/{UUID}/positions/{UUID o position-001 base} | id, posicion, prioridad, ordinal | Orden y prioridad explícitos |
| …/revisions/{UUID}/techniques/{UUID o position-001-technique-001 base} | id, positionId, tipo, descripcion_del_alumno, ordinal | Consulta por posición dentro del repertorio; descripciones nativas sin codificación |
| …/revisions/{UUID}/description_versions/{UUID técnica} | value, ordinal | Versiones de descripciones por UUID, incluidas referencias históricas |
| …/revisions/{UUID}/deletion_catalog/{UUID posición} | id, priority, techniques[], ordinal | Estado de continuidad asociado a eliminaciones; no catálogo actual |
| trainer_comments/{correo} | versión y activeRevision | Comentarios autorizados de entrenadores, separados de las descripciones del alumno |
| …/revisions/{UUID}/comments/{UUID técnica} | techniqueId, comment, trainerName opcional, ordinal | Autor asignado por servidor |
| …/revisions/{UUID}/comment_versions/{UUID técnica} | value, ordinal | Versiones para avisos y recálculo futuro |
| competitions/{UUID competición} | planId, fecha_comienzo, fecha_torneo, **alumnos[]**, días, ejercicios, tiempos y descansos | Única autoridad de inscripciones; parámetros conservados |
| settings/competitions | revisión del catálogo, competitionIds[] ordenados | Coordinación CAS y orden global; no JSON completo ni blobs |
| competition_tombstones/{UUID} | planId, ordinal | Borrados de competiciones necesarios para reconciliación; retirar los de QA al limpiar su ejecución |
| user_plan_assignments/{correo} | planIds[], deletedPlanIds[], schemaVersion/revision/updatedAt | Proyección recuperable desde competiciones; no editar como segunda autoridad |
| training_plans/{UUID competición}__{correo} | mail, planId, configuración snapshot, fecha, revisiones aplicadas, activeRevision | Índices por mail y planId; el mismo planId une competición/participante |
| …/revisions/{UUID}/sessions/{AAAA-MM-DD} | date, ordinal | Calendario y orden de sesiones |
| …/revisions/{UUID}/exercises/{fecha}_{ordinal} | sessionDate, ordinal, positionId, techniqueId, posicion, prioridad, tipo, descripción, comment, pass, positionComplete | Snapshot histórico exacto; un ejercicio no depende del repertorio actual para poder leer pasado/PDF |
| …/revisions/{UUID}/continuity_catalog/{UUID posición} | catálogo y orden del generador | Misma estructura lógica, sin tocar algoritmo |
| …/revisions/{UUID}/boundaries/{fecha} | date, exerciseSignature (array de mapas), stateSignature, cursor con prioridades, movimiento, pasadas y remainingPositionGroups | Cola ordenada agrupada por posición, con UUID y marcadores de finalización; se reconstruye literalmente el cursor original |
| …/revisions/{UUID}/applied_description_versions y applied_comment_versions | UUID, value, ordinal | Checkpoints de propagación, no textos duplicados editables |
| training_day_indexes/{UUID}__{correo} | mail, planId, sourceSha (token de revisión API), blocked, activeRevision | Derivado reconstruible; fuente funcional sigue siendo el plan |
| …/revisions/{UUID}/dictionary/{ordinal} y sessions/{fecha} | posicion/tipo y referencias numéricas a su diccionario | Las tuplas se convierten en mapas nativos, sin arrays anidados incompatibles con Firestore |
| settings/schema | modelo, proyecto, origen/blob del catálogo, conteos, checksums de auditoría e initializedAt | Evidencia de inicialización controlada |
| realtime_events/{UUID} | owner, kind, version, createdAt | Outbox de invalidación; Commit atómico con la entidad; eliminado tras confirmar entrega |
| qa_runs/{UUID} | purpose, roles preparados, tareas de limpieza e IDs de competición sintética | Solo durante el ensayo; borrado físico al terminar o recuperación de una ejecución interrumpida |

Todos los documentos de negocio contienen valores nativos. No existen inline, bytesValue, digest, directory, file, parts ni entidades serializadas en strings. Los nombres de archivo que subsisten en respuestas de error mantienen compatibilidad funcional del cliente; no son claves ni rutas de persistencia. El campo sha del protocolo HTTP conserva un token de revisión opaco para compatibilidad con frontend existente: no identifica archivos GitHub y no es un ID de documento. La firma de ejercicios se almacena como array de mapas nativos y se recompone exactamente al entrar en dominio. stateSignature es la huella hexadecimal original del cursor, nunca un sustituto del contenido funcional. Una firma histórica inválida se conserva como diagnóstico invalidLegacySignature sin corregir el plan.

Las fechas de calendario permanecen YYYY-MM-DD; updatedAt/generatedAt/createdAt/initializedAt son timestamps nativos al almacenar y vuelven al ISO original al entrar en dominio. Los arrays y ordinales conservan orden sin depender del orden de respuesta de Firestore. Las referencias activeRevision se pueden abrir desde la consola.

## Atomicidad y límites

Los agregados lógicos siguen admitiendo 4 MiB; una descripción/comentario mantiene el límite original de 100000 unidades UTF-16. Dividir por entidades (posición/técnica/sesión/ejercicio) evita documentos Firestore mayores de 1 MiB sin fragmentar bytes. La nueva revisión se prepara en documentos nativos, con Commits acotados por bytes, y se publica mediante una referencia CAS con precondición updateTime. El cambio de referencia y outbox son atómicos. Un ACK perdido se resuelve por publicationId propio, sin repetir mutaciones. Lectores de revisiones retiradas detectan el cambio y vuelven a obtener la revisión activa; nunca aceptan un agregado incompleto. Se borran revisiones antiguas y staging fallido, no se acumulan fragmentos.

La copia de textos y configuración dentro de ejercicios es un snapshot histórico funcional obligatorio, no una duplicación editable de la fuente. Los índices del día son derivados vinculados a revisión; no se editan. Las inscripciones solo se deciden en competitions.alumnos[]. Varias entidades de una operación de negocio conservan la reconciliación recuperable anterior; no se afirma una transacción global sobre todos los alumnos.

Fuentes de límites: https://firebase.google.com/docs/firestore/quotas y https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit . El límite de 500 transformaciones es por documento; el transporte REST se acota por tamaño de solicitud (menos de 10 MiB), sin confundirlo con ese contador. Consultas de un campo utilizan índices simples automáticos. firestore.structured.indexes.json propone exenciones para textos/cursor que nunca se consultan; aplicarlas solo en DEV con la cuenta propietaria si se realizan ensayos de volumen. El runtime no amplía IAM ni despliega índices PRO.

Coste: una revisión del repertorio reescribe sus posiciones/técnicas y sus metadatos, y elimina su revisión anterior. Un plan añade sesiones/ejercicios/checkpoints; consultas leen documentos, aunque se agrupen en una petición REST. No equivalen peticiones HTTP a lecturas/escrituras facturadas. El informe de inventario y los contadores del ensayo permiten estimar volumen; consultar Firebase DEV → Uso para cuotas reales. No activar Blaze ni TTL de pago. Un error de cuota no confirma guardado ni descarta borrador.

## Consultas en Firebase Console

1. Usuarios: colección **users**, documento del correo en minúsculas. Perfil visible como `perfil: alumno` o `perfil: entrenador`. Filtro `perfil == entrenador` consulta entrenadores directamente.
2. Repertorio: user_techniques → correo → abrir **activeRevision** → positions; ordenar por ordinal o filtrar prioridad. En techniques, filtrar positionId con el UUID obtenido de la posición; ordinal conserva el orden. Es una unión explícita de dos consultas, evitando duplicar una prioridad mutable en cada técnica.
3. Catálogo: technique_catalog → original → activeRevision → positions/techniques. Los IDs legibles de referencia no se reutilizan al crear alumnos.
4. Competiciones: competitions → UUID. alumnos es un array legible; usar filtro array-contains correo. Buscar training_plans con `planId == UUID` para todos sus participantes o `mail == correo` para un usuario.
5. Plan: abrir activeRevision, sessions por fecha, exercises por sessionDate/ordinal. Los textos históricos siguen visibles aunque se haya eliminado la técnica actual.
6. Comentarios: trainer_comments → correo → activeRevision → comments → UUID técnica. El autor es del servidor.

## Qué se puede editar directamente

- **Perfil/rol en users:** la lectura de autorización usa el documento actual. Cambiar perfil invalida el rol de la sesión anterior al siguiente acceso/revalidación del canal; cerrar sesión y entrar de nuevo para usar el nuevo rol. Una sesión antigua no gana privilegios por cambiar su payload. No hay notificación instantánea desde una consola externa en reposo.
- **Nombre, apellidos, peso, fecha y cinturón:** respetar las mismas validaciones de la API; la consola puede escribir datos inválidos, por lo que se recomienda la pantalla Perfil. Reabrir/refrescar la sesión para ver una edición externa. No cambiar mail/ID.
- **Contraseña:** no editar passwordHash a mano. Usar la operación de reset autenticada y revocar sesiones.
- **Técnicas, prioridades, comentarios, inscripciones y competiciones:** utilizar la aplicación/API administrativa con revisión y autorización. Escribir a mano los documentos es visible, pero no ejecuta recálculo, checkpoints, índices ni outbox; no es una operación segura sobre un plan activo.
- **Planes, continuidad, revisiones, ordinales, asignaciones derivadas y outbox:** no editar directamente. Son resultados/versiones gestionados por servidor; conservar pasado/hoy literalmente.

No existe listener de Firebase Console ni permiso web abierto. Los cambios funcionales seguros pasan por Worker; los cambios de consola de perfil se aplican en la siguiente lectura autorizada. Mantener deny-all y la cuenta de servicio limitada a DEV.

## Operación y revisión

La PR se deja abierta hacia develop. Para completar las pruebas sin fusionarla, el workflow DEV permite exactamente feature/firestore-structured-model además de develop, con la misma cuenta/Worker/proyecto y verificación de HEAD. Ninguna otra feature puede desplegar. Las validaciones se ejecutan antes de inventario/limpieza/carga/QA. No se modificó el workflow PRO.

prepare-structured-dev.mjs inventaría y borra solo colecciones heredadas autorizadas, con metadatos de control SQLite, precondiciones y lotes acotados. Preserva colecciones nativas ajenas; colecciones desconocidas o documentos cambiados detienen ese borrado. Carga el catálogo fijo original y recupera únicamente QA interrumpida identificada. verify-structured-dev.mjs comprueba después la ausencia de legado, QA y padres huérfanos. Los informes no contienen contraseñas ni datos de usuarios originales. La fuente privada del catálogo no se copia al repositorio público.
