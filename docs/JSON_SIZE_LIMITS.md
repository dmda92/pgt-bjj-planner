# Incidencia JSON_TOO_LARGE — 14/10/2026

## Causa raíz y límites anteriores

worker/storage.ts, función encoded: JSON.stringify → TextEncoder UTF-8 → comprobación de 65.536 bytes → ApiError 413 JSON_TOO_LARGE. Es un límite propio del adaptador del Worker, anterior a la llamada de escritura GitHub; no una cuota de GitHub. Se mide todo el documento, no una descripción aislada. Varias descripciones válidas de hasta 10.000 caracteres podían superar el total. AppApi aceptaba peticiones de hasta 98.304 bytes (envoltorio data/sha); security.jsonBody limitaba genéricamente a 16.384 cuando no se indicaba otro máximo. La lectura del adaptador también limitaba a 65.536; además capturaba su propio error de tamaño y lo transformaba en REMOTE_JSON_INVALID.

El rechazo puede corresponder a tecnics.json o a un plan individual generado/actualizado, que repite las descripciones. El código anterior ocultaba la ruta. No se dispone del JSON pendiente en IndexedDB del dispositivo del propietario, por lo que no se afirma haber medido su archivo real. El nuevo preflight de sincronización mide exactamente JSON serializado UTF-8 y los errores del adaptador identifican el archivo realmente rechazado, bytes, límite y fase. No incluye contenido, correo, token ni ruta completa en los diagnósticos de tamaño.

## Límites vigentes compartidos

| Ámbito | Límite |
| --- | --- |
| Cada JSON de negocio, incluyendo planes | 4.194.304 bytes UTF-8 (4 MiB) |
| Petición de AppApi, con data/sha y envoltorio | 4.259.840 bytes (4 MiB + 65.536) |
| Descripción y comentario de entrenador | 100.000 unidades UTF-16 por campo |
| Peticiones heredadas de viabilidad sin máximo explícito | 16.384 bytes, sin cambio |

Constantes únicas en src/domain/json-limits.ts, utilizadas por cliente, modelos y Worker. Se conservan límites estructurales, control de acceso, SHA/CAS, cuotas e histórico futuro. El límite de 4 MiB acota memoria/CPU por documento y el tráfico base64 (~5,6 MiB), aumentando 64 veces el total previo. Los campos extensos permiten explicación y enlaces; no se almacenan binarios de vídeos ni texto ilimitado.

## Persistencia y descarga

Escritura mediante Contents API por SHA como antes. Para leer, solicitar application/vnd.github.object+json: hasta 1 MB puede traer base64; para archivos mayores GitHub puede devolver encoding=none. Leer entonces el blob inmutable del SHA devuelto por Contents mediante /git/blobs/<sha>. No seguir URLs arbitrarias ni abrir una API GitHub genérica. Conservar comprobaciones de SHA y repositorio privado. Valida tamaño declarado y real decodificado antes de parsear. El token actual Contents Read/write sirve también para leer blobs; no requiere credenciales nuevas.

No se rebaja seguridad ni se usa una descarga de rama potencialmente distinta para emparejar datos con otro SHA. El máximo de GitHub para blobs es 100 MB; el máximo propio de 4 MiB se mantiene por seguridad.

## Comportamiento para el usuario

No truncar, borrar o dividir automáticamente los textos. La edición offline y los borradores previos se conservan íntegros. Comprobar el tamaño al intentar sincronizar, antes de la red, y validar nuevamente el documento final en el adaptador servidor. Un exceso informa, por ejemplo: tecnics.json: [bytes reales] bytes; límite 4.194.304 bytes por archivo. No se ha truncado el contenido. Los cambios locales se conservan. Si falla un plan actualizado, indicar su plan_<UUID>.json.

El cuerpo de una petición excesiva se cancela al superar el máximo; sus bytes pueden ser un mínimo observado, marcado como al menos, porque no se lee un flujo arbitrariamente grande. Los documentos serializados/decodificados tienen medición exacta.

Tras actualizar la app, pulsar Sincronizar de nuevo en la sesión actual; no es necesario cerrar sesión, borrar IndexedDB ni reintroducir textos. Si excede incluso el límite nuevo, corregir el contenido local deliberadamente y reintentar. Una escritura parcial conserva los checkpoints de propagación futura y los reintentos existentes; las sesiones históricas/hoy siguen protegidas.

## Pruebas y medidas reproducibles

- Fixture AppApi: tecnics.json de **1.177.040 bytes** antes de añadir metadatos servidor, varias posiciones/técnicas, textos mayores de 10.000 caracteres, acentos, español, japonés y enlaces. Guardado y snapshot recuperado con posiciones/textos idénticos.
- Adaptador real con transporte sintético: JSON mayor de 1 MB, primer PUT fallido, reintento, descarga por blob/SHA y comparación profunda. Rechazo antes de red si supera 4 MiB y error de lectura preservado con archivo y tamaño.
- Frontera exacta de 4.194.304 aceptada y un byte más rechazado; medición UTF-8 de acentos y emoji, límite de streaming de petición con detalles.
- Navegador: nueve descripciones largas en diferentes posiciones; 413 simulado del límite previo, mensaje claro, campos locales intactos, reintento en la misma sesión, reload y descarga desde otro contexto independiente idénticos.

La prueba rápida de edición detectó una carrera adicional: recargas de estado tras guardados anteriores podían sobrescribir la vista optimista de ediciones posteriores. Se serializa el guardado de técnicas, se descartan cargas anteriores mientras hay guardados pendientes y Sincronizar espera a que termine la cola local. No se vacía IndexedDB ni se cambia de sesión.

Ninguna medida sintética se presenta como tamaño del archivo del propietario. Los tests no acceden a datos reales. El PDF permite que las sesiones largas continúen en páginas adicionales, conservando íntegros sus textos e identificando la fecha y la parte de la sesión. El límite de tamaño JSON es independiente de esta paginación.

## Fuentes oficiales

- https://docs.github.com/en/rest/repos/contents
- https://docs.github.com/en/rest/git/blobs#get-a-blob
