# Apertura de alumnos desde Entrenador — diagnóstico y validación (14/10/2026)

## Flujo anterior y causa

Referencia: commit fe55820f0eb3c0c5941ea57234cbe4de4aa700b7. Seleccionar alumno ejecutaba `client.request(.../snapshot)`; no consultaba una caché del alumno en IndexedDB ni enviaba sus SHA conocidos. El panel esperaba el snapshot completo antes de mostrar Técnicas. El Worker verificaba repositorio privado y sesión/rol actuales, conciliaba catálogo/índice/borrados, comprobaba actualizaciones de planes, leía perfil, técnicas, comentarios e índice y descargaba todos los JSON de planes secuencialmente.

`updatePlanTexts` leía técnicas/comentarios al comienzo y nuevamente para cada plan, además de cada plan, incluso cuando sus checkpoints ya estaban aplicados. No regeneraba arbitrariamente el algoritmo: repetía verificaciones y lectura/procesamiento de JSON. Después, el snapshot volvía a descargar los mismos planes para devolverlos al navegador. La respuesta de apertura de Técnicas incluía documentos que pertenecían a Planes. Al volver a seleccionar no se reutilizaban documentos ni versiones del alumno consultado.

El banco con 36 técnicas de textos extensos y 20 planes produjo 91 lecturas de documentos y 3 listados de GitHub, además de la verificación de repositorio, y una respuesta de 18.852.113 bytes. La mayor parte de la espera estaba en las operaciones secuenciales del Worker/GitHub; la comprobación de planes consumía unos 865 ms con latencia inyectada de 12 ms por operación.

## Flujo actual

1. Selección y sección se actualizan inmediatamente. IndexedDB busca la clave `[entrenador, alumno, sección, plan]`. Si existe copia, React la muestra sin esperar a la red; si no existe, solo ese panel muestra carga. La interfaz general permanece operable.
2. En paralelo con la visualización local, una petición `/view` comprueba autorización actual y actualiza la sección. Técnicas solicita únicamente perfil/técnicas/comentarios; Administración solo perfil. Planes devuelve primero un manifiesto de IDs y fechas. El selector del plan descarga únicamente el JSON escogido.
3. El cliente envía SHA conocidos. El Worker usa listados de metadatos para devolver `unchanged` sin descargar ni enviar archivos idénticos. Los documentos independientes de Técnicas se leen en paralelo. La propagación pendiente entre planes independientes usa concurrencia limitada a cuatro.
4. Antes de descargar un detalle de plan se comprueban fuente/plan/día Madrid contra un marcador de coordinación de SHA. Sin cambios no se lee ni procesa ese JSON para recalcularlo. Si hay cambios, se usan las funciones existentes; el JSON leído o escrito en esa comprobación se reutiliza para la respuesta, evitando duplicarlo. Un conflicto SHA relee plan y fuentes antes del reintento.
5. La copia validada se guarda en la tabla `trainerViews`, separada de `entries` y de su cola de pendientes. Peticiones simultáneas de la misma clave se deduplican. Guardar comentarios/rol fuerza una consulta nueva después de terminar la anterior. Las respuestas antiguas de otras selecciones o sesiones no sustituyen la ficha actual. El cálculo de progreso se memoiza y usa una sola pasada.

## Seguridad y sincronización

Cada petición verifica repositorio privado y sesión/rol actuales. La caché no concede permisos. Sus claves incluyen identidad del entrenador, alumno, sección y plan; se borra al salir o al observar revocación. Un 401 perteneciente a una sesión anterior no bloquea la sesión nueva. El último perfil confirmado localmente prevalece sobre el capturado al iniciar sesión, para admitir promociones/revocaciones sincronizadas. Un 403 del entrenador actual invalida su caché y no sigue mostrando esa ficha. Offline se permite consultar únicamente copias ya disponibles, bajo la identidad activa; no se solicita red.

Los datos de fichas no se guardan en el Durable Object: únicamente marcadores de coordinación de SHA/día. El negocio permanece en GitHub privado y en IndexedDB. No se modifica el algoritmo, la protección Madrid del histórico, la validación de entrada ni el control CAS. Ver un manifiesto de planes no modifica negocio; los borrados explícitos del catálogo se excluyen de la lista, aunque exista una eliminación de archivo pendiente. La sincronización completa conserva su recuperación de conciliación y fan-out interrumpido.

Consultar una ficha no escribe ni sustituye el working set del entrenador. Cuando consulta su propia ficha como competidor, sus datos dirty y proyecciones pendientes prevalecen sobre la copia remota; un plan local limpio no sustituye a un remoto más reciente. Un cambio de identidad durante una descarga impide persistir su respuesta. Ante fallo de actualización se conserva la copia disponible y se muestra el error, sin anunciar una actualización exitosa.

## Medidas reales del banco local

Mismo volumen de datos y código real de AppApi; transporte GitHub simulado con JSON serializado/deserializado y 12 ms por operación (40 ms en la prueba lenta). No son tiempos medidos contra Cloudflare/GitHub de producción ni sobre dispositivos del propietario.

| Escenario | Antes | Después | Lecturas de documentos antes → después | Respuesta antes → después |
|---|---:|---:|---:|---:|
| Primera apertura de Técnicas | 1437 ms | 65 ms | 91 → 4 | 18.852.113 → 301.093 bytes |
| Segunda apertura de Técnicas, consulta remota | 1428 ms | 51 ms | 91 → 2 | 18.852.113 → 239 bytes |
| Lista de 20 planes | 1373 ms | 50 ms | 91 → 3 | 18.852.113 → 1668 bytes |
| Detalle de un plan | 1386 ms (todos los planes) | 119 ms (solo uno) | 91 → 6 | 18.852.113 → 929.168 bytes |
| Detalle repetido, comprobación remota | 1356 ms | 75 ms | 91 → 3 | 18.852.113 → 1783 bytes |
| Técnicas con 40 ms por operación | 4013 ms | 162 ms | 91 → 2 | 18.852.113 → 239 bytes |

Técnicas y manifiesto no invocan comprobación de planes (0 ms). Detalle frío: comprobación/reparación de un solo plan, 52 ms; detalle repetido: 13 ms de metadatos, cero lecturas de JSON de planes y cero recálculos. JSON fuente/serialización: 114 ms antes frente a 1 ms para Técnicas después; lectura/parseo de respuesta: 52 ms frente a <1 ms. El residuo de Worker fuera de la latencia inyectada pasa de 226 ms a 3 ms en esa apertura; es una medida de banco, no un perfil CPU de producción.

Chromium real, fixture con descripciones largas y respuesta HTTP demorada 100 ms: IndexedDB frío ~0,4–1,2 ms, lectura local posterior ~0,8–1,5 ms, recuperación offline ~0,7–1,1 ms, petición + JSON + validación + persistencia inicial ~108–111 ms. En la app React real, reapertura local visible en 57–69 ms (incluye automatización de clic y espera DOM), manteniendo retenida la petición remota hasta comprobar que el contenido ya era visible. No había lectura local de fichas de alumnos en el flujo anterior.

## Pruebas y reproducción

- Tests de API: secciones sin documentos ajenos, SHA sin descargas de técnicas/comentarios, autorización y rol actuales; manifiesto de 20 planes sin leer JSON, detalle de uno solo, recuperación de textos futuros sin tocar histórico/otros planes, detalle repetido sin lecturas ni procesamiento de planes.
- Chromium de app: primera apertura con petición retenida, copia inmediata durante actualización lenta, apertura offline, secciones y selector de plan; regresiones de alumnos/perfiles/comentarios/PWA/planes/sync.
- Chromium de caché: textos extensos idénticos, primera/segunda apertura, peticiones deduplicadas, varios alumnos y entrenadores, cambio de identidad durante fetch, 401 tardío de sesión anterior, invalidación 403, recuperación offline sin red y working set dirty intacto durante consultas y logout.
- Se mantienen las pruebas de sincronización concurrente/conflictos, recuperación de fan-out, protección del histórico y UUID. No se accede a datos reales.

`npm run test:performance` (también `node scripts/benchmark-trainer.mjs`) mide el código actual y comprueba que manifiestos/consultas sin cambios no descarguen documentos innecesarios. Para reproducir la línea base, materializar primero `git show fe55820f0eb3c0c5941ea57234cbe4de4aa700b7:worker/application.ts > worker/.performance-baseline.ts`, ejecutar el script con `--legacy-snapshot` y retirar el archivo temporal. Los resultados se escriben en `.performance-artifacts/`; no contienen payloads privados. `npm run test:browser` ejecuta ambas pruebas Chromium; la misma orden está integrada en CI, junto con test:performance antes del deploy.

Los tiempos varían según carga de la máquina y red. La reducción de lecturas/bytes, la exclusión de planes al abrir Técnicas y la ausencia de descargas en las rutas `unchanged` son verificables mediante aserciones; no se imponen umbrales temporales frágiles en CI.
