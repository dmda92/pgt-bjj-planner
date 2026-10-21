# Auditoría preventiva de fiabilidad — 21/10/2026

Base revisada: feature 2a2c8e9, develop 6b870a7. Continuación autorizada por el propietario tras detener los despliegues. Revisión previa a implementar; solo DEV. La feature original procede de main; se mantiene su trazabilidad y PR #18 a develop.

## Hallazgos y plan de corrección

| Riesgo observado en código | Consecuencia | Corrección y prueba prevista |
| --- | --- | --- |
| Un único DO coordina todas las peticiones y hace I/O externo; las pruebas solo sumaban llamadas por HTTP, no por contexto compartido | Ráfagas consumen presupuestos distintos del contador simulado | Separar coordinación persistente de ejecución privada por operación; I/O externo acotado en DO efímeros. Imponer presupuesto en el transporte aislado y probar ráfagas, no solo solicitudes secuenciales |
| `DomainIO` Worker ordinario también ejecutaba PBKDF2; trasladarlo fue seguido de fallo de login, sin excepción identificable | Contexto CPU inadecuado para autenticación costosa; causa del fallo remoto anterior aún no demostrada | Ejecución en DO (30 s CPU documentados), conservar PBKDF2/sal/600000 iteraciones; eliminar dependencia de streams/RpcTarget, devolver bytes y cambios de sesión serializables |
| `read(ref,true)` evita caché de agregado pero `load` reutiliza caché nativa | Conflicto puede reintentarse con la misma versión obsoleta; comprobaciones finales no son frescas | Invalidar lecturas y consultas al pedir frescura; regresiones con edición concurrente real en fixture |
| Retirar revisión anterior forma parte del resultado después de confirmar CAS | Error de limpieza presenta como fallido un guardado que ya se publicó | Cola nativa de limpieza idempotente, recuperación administrativa acotada; comprobar pérdida de respuesta y fallo posterior a publicación |
| Sin validación del tamaño nativo individual antes de staging | Límite JSON de aplicación 4 MiB no equivale a límite Firestore de documento 1 MiB | Medir representación nativa conservadoramente antes de escribir; nunca truncar entidades; prueba de rechazo sin publicación parcial |
| Lista de colecciones no pagina; commitChunks solo divide por bytes | Inventarios incompletos y lotes grandes | Paginar listCollectionIds; acotar tamaño y número de escrituras por lote; probar paginación |
| Revalidación de catálogo usa caché | Respuesta mezcla una asignación retirada durante lectura | Lectura realmente fresca y CAS preservado |
| El gate real precedía a un inventario, pero publicación ya había ocurrido | Pipeline rojo deja DEV defectuoso publicado | Ejecutar todos los gates aislados antes del merge y conservar gate real estricto; no considerar despliegue aceptado hasta navegador e integridad. No desplegar feature ni relajar controles |

## Documentación oficial contrastada

- https://firebase.google.com/docs/firestore/best-practices — evitar fanout de índices, reintentos transaccionales REST, pruebas de carga. No repetir mutaciones de resultado incierto: verificar `publicationId` primero.
- https://firebase.google.com/docs/firestore/quotas — documento 1 MiB, petición API 10 MiB, cuotas gratuitas. El límite funcional agregado de 4 MiB se conserva mediante documentos por entidad, no blobs.
- https://firebase.google.com/docs/firestore/manage-data/transactions — commit atómico y precondiciones; no aplicar último escritor.
- https://developers.cloudflare.com/workers/platform/limits/ — Free 50 subpeticiones externas; 1000 internas, CPU Worker y conexiones no equivalentes a Firestore.
- https://developers.cloudflare.com/durable-objects/platform/limits/ — DO SQLite Free y CPU de 30 segundos por petición.
- https://developers.cloudflare.com/changelog/post/2026-08-28-durable-objects-dynamic-workers-limit/ — solicitudes concurrentes del mismo DO comparten contexto I/O. Un contador por respuesta HTTP no lo reproduce.

## Invariantes y aceptación

No se modifica src/domain, algoritmo, UI, PDF, contraseñas, políticas de autorización ni PRO. Repositorios nativos conservan UUID, orden ordinal, timestamps y referencias. Sesiones/checkpoints son los únicos datos copiados al coordinador; negocio siempre Firestore. Nuevos DO de ejecución no almacenan negocio ni escriben SQLite. Solo PR a develop después de pruebas completas; aceptación real requiere cero 5xx inesperados, caracterización exacta, navegador, tiempo real y limpieza de usuarios sintéticos.

Pendientes de aceptación al iniciar: diagnóstico exacto del fallo de #17, validación nueva arquitectura en workerd y Cloudflare real. No afirmar resuelto por compilar o por mocks.

## Ejecución previa al merge

Las regresiones de frescura y limpieza fallaron contra la implementación inicial y pasaron tras corregirla. El ensayo workerd fuerza el fallback PBKDF2 original (600000 iteraciones), identifica el DO de salida real y limita sus llamadas (incluido OAuth) a 32. Comprueba ráfaga concurrente de 12 lecturas, cinco competiciones, permisos, revocación, oracle exacto y limpieza. Namespace DOMAIN_IO nuevo, SQLite solo por disponibilidad Free, sin escrituras de negocio/SQLite en sus instancias efímeras. No se reutiliza un Worker ordinario para autenticación costosa.

El entorno local recuperó ejecución de comandos; Chromium no se pudo descargar (archivo truncado por red). Las pruebas de navegador se ejecutarán obligatoriamente en CI sobre la feature antes de integrar: subir código a feature no despliega DEV. No se relaja ninguna aserción ni se cambia el workflow PRO.

## Diagnóstico posterior del login y comprobación de credenciales

La integración #18 (3cd9285, ejecución 39618612882) superó los gates previos y el catálogo/inventario reales, pero el primer login de QA devolvió el código genérico anterior y el gate real quedó rojo. No se considera despliegue aceptado. El propietario confirmó después alta, logout y login correctos en la versión publicada; una prueba pública con cuenta inexistente devolvió 401 LOGIN_FAILED. Por tanto, no es correcto afirmar que el login falle de forma general ni atribuir definitivamente el 503 a CPU o a credenciales ausentes.

Se añade comprobación administrativa limitada al UUID sintético de cada ensayo: lectura independiente de users/{mail} y private/credentials, formato del hash sin cambios, reconstrucción desde repositorio y coincidencia de contraseña. Solo devuelve booleanos; no publica hash/sal/contraseña ni inspecciona usuarios personales. La prueba compara además login HTTP directo con login de navegador y registra inmediatamente status/código y versiones Worker/coordinador, sin esperar a un timeout de UI. Se añade espera por identidad efectiva de build antes de iniciar QA, y los RPC privados rechazan versiones incompatibles. La causa histórica de la respuesta antigua sigue pendiente de demostración; el nuevo diagnóstico debe distinguir datos, versión y contexto de cliente. El usuario creado manualmente por el propietario se conserva; la limpieza se limita a las identidades del UUID de QA.

El workflow DEV incorpora workflow_dispatch operation=verify (predeterminado): ejecuta preflight, QA y limpieza sobre el build vigente sin publicar otra versión. Lee solo DEV_BUILD_SHA de los settings autorizados para distinguir commit desplegado y commit del verificador. El push a develop mantiene el despliegue automático; no cambia Environment ni PRO. Esta opción permite reproducir fallos transitorios sin otro despliegue.
Los reintentos de un job fallido detectan si ese mismo SHA ya está publicado y omiten wrangler deploy: vuelven a ejecutar el gate sin cambiar la versión observada. Se mantiene el bloqueo por HEAD y la serialización DEV.

Hallazgo adicional al conservar la cuenta creada por el propietario: la limpieza heredada se ejecutaba también vacía e invalidaba todas las sesiones/checkpoints. Una regresión reprodujo ese cierre de sesión y se corrigió para invalidar solo después de eliminaciones heredadas efectivas. Las comprobaciones vacías no cambian sesiones nativas. QA sigue borrando solo sus propias sesiones y documentos.

## Resultado real de #19 y corrección de latencia

Ejecución 39623217124, build 2d51b975: el readiness observó inicialmente una versión pendiente y confirmó después el build Worker/coordinador/ejecutor (segundo intento). Los perfiles y credenciales sintéticos existían, los hashes se reconstruían y ambas contraseñas coincidían. Login directo y ambos logins de navegador devolvieron 200, el alta pública 201. No hubo 5xx. El fallo se desplazó al guardado/tiempo real: muestras 10803, 8293 y 11663 ms y el siguiente evento no llegó en el plazo de 20 s. No es un fallo general del login.

La entrada de navegador observada fue SJC; Firestore está en europe-west1. La revisión encuentra viajes RPC separados para cada lectura de autorización del coordinador. Se agrupan esas lecturas y la consulta outbox en un RPC privado, manteniendo ACK en un segundo RPC solo después de publicar a sockets. El namespace de ejecución recibe locationHint=weur en cada objeto nuevo (best effort documentado, no una garantía de ubicación). El coordinador conserva solo el token OAuth en memoria entre operaciones; los cachés de negocio se vacían como antes. No cambia algoritmo, permisos, sesiones, protocolo de eventos ni persistencia funcional. Prueba añadida: cambio directo de perfil desde Console invalida una suscripción incluso sin outbox. Fuentes: https://developers.cloudflare.com/durable-objects/reference/data-location/ y https://firebase.google.com/docs/firestore/best-practices .

QA en un DEV que ya tiene usuarios del propietario: una regresión reproduce tombstones de una competición sintética proyectados en el índice de otro usuario. La limpieza retira únicamente UUID acreditados por el marcador del propio ensayo y conserva el resto; rechaza una asignación compartida todavía activa. No elimina usuarios, competiciones ni planes ajenos. Se evitan además escrituras de catálogo cuando no queda contenido sintético que retirar.

## Continuación: presupuesto Spark y consumo (21/10/2026)

El nuevo encargo suspende QA real automática y cambia el criterio de aceptación: no basta con funcionar si consume operaciones innecesarias. Evidencias, mediciones y causas distinguidas de hipótesis en [FIRESTORE_CONSUMO_DEV.md](FIRESTORE_CONSUMO_DEV.md). La cuota de escrituras NO está diagnosticada como agotada: las capturas sitúan las lecturas cerca de 50.000 y el backend anterior descartaba el detalle de429. La nueva clasificación es segura y no expone mensajes/rutas/consumer IDs de Google.

Se conservan los resultados anteriores como historia, pero no son aceptación de la optimización actual. No se han ejecutado Google CRUD, inventarios globales, limpieza ni nuevos despliegues en esta fase. El alta real comprobada por el propietario sigue siendo evidencia válida del login publicado.
