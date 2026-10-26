# Panel del entrenador — validación 16/10/2026

## Alcance

Competiciones separa listado y alta, conserva participantes/borrado, ordena fechas y filtra pasadas con día Madrid.
Preparación sustituye la consulta por fecha: repertorio actual para cobertura/descripciones; técnicas únicas y
apariciones de todo el snapshot para programación. Las técnicas históricas eliminadas se conservan en el detalle y no
inflan la cobertura. El entrenamiento diario agrupa multiconjuntos exactos de posición/tipo, mantiene cantidades, usa el
orden mayoritario y cuenta alumnos únicos. Mismos datos producen el mismo desempate.

## Datos y rendimiento

Un GET autorizado de entrenamiento diario lee el catálogo y metadatos de los planes de los participantes pertinentes.
Índices privados structure_<id>.json guardan SHA fuente, diccionario posición/tipo y listas numéricas por sesión. Se
reconstruyen solo si falta el índice, su formato no es válido o cambió el SHA. Nunca llevan descripciones/comentarios ni
reemplazan el plan; escrituras con CAS. Cuatro alumnos como máximo en paralelo. Se vuelve a comprobar el catálogo antes
de responder para no mezclar asignaciones cambiadas durante la lectura. Con fecha explícita solo se consideran
competiciones que cubren ese día; por defecto, las activas y la primera sesión posterior a hoy.

Cambiar de fecha con índices vigentes hace cero lecturas de JSON completos de planes (aserción API y Chromium). Fixture
sintético: plan 70.737 bytes, registro del índice 312 bytes; son datos de prueba, no latencia de Cloudflare/GitHub. Una
primera consulta o una nueva versión requiere leer e indexar el plan; los cambios solo de descripción también cambian el
SHA y pueden causar una reconstrucción. No se añade creación de índices a la sincronización. La conciliación elimina
derivados huérfanos usando el listado existente. Las asignaciones sin snapshot no se generan por leer; se señala vista
incompleta.

Caché local de respuestas por entrenador/fecha, independiente de entries, con presentación inmediata y comprobación
remota; offline solo copias disponibles. Limpieza por logout/revocación. La caché no concede permisos; cada consulta
remota vuelve a comprobar el rol. IndexedDB pasa a v3 conservando tablas anteriores; una prueba de migración v2→v3
comprueba pendientes offline, propietario y fichas existentes sin pérdidas. El DO sigue almacenando únicamente
coordinación/sesiones.

## Comprobaciones

- 111 pruebas unitarias: cálculos de preparación, prioridades sin cobertura, técnicas eliminadas, repetición,
  equivalencia entre UUID diferentes, cantidades distintas, orden mayoritario/desempate estable, alumnos únicos, fechas
  futuras y filtrado de competiciones.
- API: acceso 401/403, fecha imposible, índice frío/reutilizado, actualización por SHA, fuentes intactas, retirada de
  asignaciones y borrado del índice derivado.
- Chromium: Listado/Nueva competición, hoy incluido y pasado opcional; spinner con respuesta retenida, descripción
  actual, cobertura sin fecha; grupos de 3 y 1 alumnos con orden mayoritario, cambio de fecha sin releer planes, vacío,
  offline y limpieza de caché ante 403. Regresiones anteriores de participantes, borrado, planes, peso, días, PDF y
  sincronización.
- Capturas de preparación y día revisadas en escritorio; día a 390/768/1440 y preparación a 360/390/768/1280/1440 sin
  desbordamiento de página. No acredita Safari/iPhone físico.
- Typecheck, build, check:worker, runtime workerd/SQLite y banco de rendimiento se ejecutan antes de publicación.
  GitHub/GitHub transport en las suites es un fixture; no son altas ni cambios sobre usuarios reales.

Las pruebas funcionales no equivalen a asistencia o ejecución real del entrenamiento. Los informes describen lo
programado y la presencia de texto, no la calidad de la técnica.
