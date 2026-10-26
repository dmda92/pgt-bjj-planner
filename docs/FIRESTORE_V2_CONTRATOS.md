# Contratos Firestore V2 — implementación, 26/10/2026

## Arquitectura conectada

worker/dev.ts exporta worker/v2/runtime.ts. El cliente único es
src/application/firestore-client.ts, sin herencia o selección de proveedores.
No existe fallback al antiguo Firestore DEV ni a GitHub. La entrada exige una
importación verificada y activada. Worker PRO y su configuración permanecen intactos.

React → cliente V2/IndexedDB → API autenticada → coordinador serial de academia
→ repositorios nativos → transporte privado DEV → Firestore.
Los eventos selectivos vuelven al cliente mediante WebSocket hibernable.

El coordinador es el único escritor del namespace activo. La caché nunca sustituye
la autorización: se comprueban actor, rol y huella de contraseña. Migración solo
escribe namespaces inactivos. Una intervención externa sobre datos activos exige
mantenimiento y reinicio de caché.

## Datos

Bajo pgt_v2/import-<checksum24>:

| Ruta | Contenido |
| --- | --- |
| aggregates/profile__<mail> | Perfil y hash privado, no enviado al cliente |
| aggregates/repertoire__<mail> | Técnicas, UUID, orden y metadatos del servidor |
| aggregates/comments__<mail> | Comentarios, autores y versiones por UUID |
| aggregates/assignment__<mail> | Asignaciones, tombstones, pendientes y avisos |
| aggregates/catalog__competitions | Competiciones y participantes |
| aggregates/template__official | Plantilla capturada del origen |
| aggregates/roster__users | Nombre, rol y cinturón para entrenador |
| aggregates/plan-text__<planId>__<mail> | Valores y vigencias por UUID/fecha |
| aggregates/agenda__<YYYY-MM> | Agenda compartida sin descripciones/comentarios |
| aggregates/agenda__calendar | Meses disponibles para fecha automática |
| plans/<planId>__<mail> | Distribución versionada y calendario |
| <entidad>/blocks/<SHA256> | Fragmentos nativos inmutables, máximo 512 KiB |
| operations/c_<operationId> | ACK idempotente y referencias de eventos |

pgt_v2/control selecciona una sola importación. Los documentos usan mapas, arrays
y escalares nativos, sin strings JSON opacos. Datos pequeños inline; los grandes,
fragmentados. Publicaciones grandes externalizan también cabeceras/proyecciones.
El hash identifica contenido lógico; se conserva el límite lógico de 4 MiB.
El codec conserva arrays y orden significativo en firmas de continuidad.

## Consultas y comandos

GET /api/v2/users/:mail/{profile,repertoire,comments,assignment,snapshot};
GET /api/v2/users/:mail/plans/:id?date=YYYY-MM-DD;
GET /api/v2/{catalog,roster,training-day} y /agenda/YYYY-MM.
Snapshot admite versiones conocidas y devuelve unchanged. Las fechas inválidas
se rechazan antes de Firestore. GET nunca ejecuta flush, generación o escrituras.

POST /api/v2/auth/{login,register,logout}; comandos específicos profile, password,
role, repertoire, comments, text, competition, assignment, delete-competition y
prepare. Sin API genérica, rutas arbitrarias, edición/importación de planes,
bootstrap de propietario ni elevación desde el payload. Orígenes exactos y
límites de frecuencia/cuerpo. Entrenadores participantes conservan sus permisos.

operationId + versión base + huella de petición calculada por servidor.
El recibo se recupera antes de repetir reloj, aleatoriedad o KDF.
Staging inmutable primero; un commit CAS publica fuentes, cabeceras, índices,
proyecciones y recibo. Fallos previos no publican medias asignaciones.
El ACK alimenta la caché y evita lecturas de confirmación.
Si se pierde la respuesta HTTP, el cliente reintenta una sola vez el mismo
operationId/cuerpo, estando online y en la misma sesión; no crea una cola offline.

Descripciones/comentarios usan vigencias sin leer distribución ni escribir agenda.
Autores y checkpoints son server-owned. El formulario conserva borrador y base CAS
aunque lleguen cambios remotos; muestra conflicto y exige revisión explícita.
Altas/bajas/nombres conservan las funciones puras vigentes, Madrid, hoy/pasado y
torneos finalizados. Asignar crea únicamente planes ausentes. Desasignar publica
tombstone y borra la cabecera individual, incluido su histórico; reasignar crea
otra generación. Proyecciones inviables conservan fuentes y último plan válido.

## Caché, transporte y recuperación

32 MiB del coordinador divididos entre fuentes/versiones y planes derivados;
16 MiB adicionales para bloques inmutables. Son límites de caché, no medición del
heap total. LRU, deduplicación y copias aisladas. Lecturas fresh no usan la caché
de bloques. Validez por publicaciones/generaciones, sin TTL de negocio.
Reiniciar descarta caché y obliga a reautorizar.

batchGet agrupa HTTP concurrentes por IDs conocidos. NO reduce el número facturable
de documentos. El binding DEV DOMAIN_IO transporta una operación Google por
invocación, destino DEV fijo y nombres/métodos validados; sin API pública, datos
de negocio ni credenciales en SQLite. Permite respetar el límite externo de
Workers Free durante operaciones grandes. Las llamadas internas siguen limitadas.

WebSocket usa tickets de un uso, actor, conexión, epoch, secuencia y operationId.
Solo recursos afectados/autorizados, sin datos privados. No eco al mismo emisor;
sí a otros dispositivos. Saltos/reinicios comprueban versiones. Sin polling,
listeners Firestore por usuario ni refrescos por foco/visibilidad.

Antes del commit, SQLite registra el identificador de entrega. El recibo
Firestore conserva las referencias. Alarm reintenta hasta tres veces; después
cierra sockets para forzar handshake. Sin tareas no hay sondeos periódicos.
El runtime aislado comprueba una entrega fallida y recuperación sin repetir datos.

IndexedDB conserva copias por actor. Solo escribe entradas modificadas y elimina
las retiradas. Comentarios y avisos se aceptan en transacción. Borradores heredados
se archivan para exportación, nunca se suben o descartan automáticamente.
Consulta/PDF offline de todos los planes descargados; sin edición/cola offline.

## Limpieza y límites

Antes de staging se registra la ruta de la entidad en SQLite, sin contenido.
Alarm procesa hasta dos páginas por invocación y borra solo hashes no referenciados,
bajo el mismo coordinador serial. Incluye staging fallido y fragmentos retirados.
No barre la base ni elimina recibos de idempotencia. Tres fallos quedan en
v2-gc-failed:* para diagnóstico; un nuevo cambio vuelve a registrar la entidad.

Guard operativo: hasta 400 entidades/cabeceras, commit de 8 MiB y 100 participantes
por comando. No publicar parcialmente para eludirlos. Ampliarlos requiere una
generación/journal adicional. No se ha medido el pico remoto de memoria.

Las mutaciones estructurales materializan el plan compacto completo para aplicar
el dominio original, comprobar continuidad y límite lógico exacto. No se afirma
cero lecturas históricas estructurales. Los meses intactos reutilizan hashes y no
se reescriben. Se elige esta vía frente a un segundo algoritmo parcial de continuidad.

firestore.v2.indexes.json prepara exenciones para acceso por ID conocido.
Revisar/publicar antes de cargar mapas grandes; no se ha publicado ni alterado IAM.

Referencias oficiales verificadas:
[facturación](https://firebase.google.com/docs/firestore/pricing),
[límites Firestore](https://firebase.google.com/docs/firestore/quotas),
[batchGet](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchGet),
[límites Workers](https://developers.cloudflare.com/workers/platform/limits/),
[límites DO](https://developers.cloudflare.com/durable-objects/platform/limits/).
