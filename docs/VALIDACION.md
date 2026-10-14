# PGT — validación de la aplicación · 13/10/2026

## Estado y evidencia

El propietario dio por terminada la prueba de viabilidad tras confirmar en el Worker desplegado: acceso al repositorio privado, altas de prueba, login, lectura/escritura/actualización de JSON, revisiones, UNCHANGED_NO_COMMIT, aislamiento 403, conflictos 409, borrado/recreación y sincronización móvil→ordenador. El 401 tras logout se comportó como rechazo de sesión. Esta aceptación autoriza desarrollar la aplicación; no equivale a aceptación remota de la nueva UI.

Se comprobaron permisos push/admin sobre dmda92/pgt-bjj-planner antes de publicar. La plantilla real fue leída desde la biblioteca del propietario, transformada sin modificar nombres/tipos/prioridades/orden, escrita en el repo privado y releída: coincide exactamente. Commit de datos `692c2f2075d0ede793558fb401465ec380eff220`; SHA del archivo `6ee2b21eb7c3972e5dd7922c4dda17531c3fc356`. 17 posiciones / 36 técnicas, descripciones vacías, sin order ni UUID compartidos entre alumnos. SHA256 de los campos auditados: `ad30591f477db4c8f4d24575808df499fb39538651904caa48ddf7f421322de1`.

No se han modificado registros reales ni los alumnos de la prueba. Los JSON de negocio/original de técnicas no se publican en el repo público de código. Las pruebas usan fixtures explícitamente sintéticos; scripts/verify-template.mjs permite volver a cotejar los archivos reales obtenidos privadamente por el propietario. Requisitos originales completos conservados en REQUISITOS_PGT_APP.md; errata de 2.1 confirmada por el propietario y documentada sin editar el adjunto.

## Pruebas locales ejecutadas

- `npm test`: **47 pruebas**, sin fallos ni omitidas. Adaptador GitHub, validación, SHA/CAS, UTF8, tokens/cuotas/errores, diagnósticos seguros, contraseña con sal y 600.000 iteraciones, permisos, roles, bootstrap, comentarios, planes/snapshots, desasignación/borrado, no-op, cambio/reset de contraseña y revocación. IndexedDB con fake-indexeddb: propietario, reemplazo atómico y rollback al interrumpir restauración.
- `npm run typecheck`: TypeScript sin errores.
- `npm run build`: Vite genera dist; recursos locales, sin fuentes/CDN externos. PDF separado en chunk dinámico, incluido en el precache para funcionar offline. Manifest, iconos PNG/SVG, service worker versionado y aviso de actualización.
- `npm run check:worker`: bundle local mediante esbuild; no contacta con Cloudflare.
- `npm run test:runtime`: workerd/Miniflare con SQLite Durable Object real y salida GitHub interceptada. Reproduce incompatibilidades antiguas de fetch/receptor/redirect, transporte corregido, hashes verificados contra Node/OpenSSL, flujo completo de altas, sesiones y errores. PBKDF2 probado nativo y con el límite observado inyectado; conserva SHA256/600000/256 y Unicode. Nueva API: registros completos con plantilla sintética, bootstrap, roles, comentarios, asignación, generación única, cambios posteriores sin regenerar, manual, CAS, desasignación, borrado y logout.
- `npm run test:browser`: Chromium real, servidor y API sintéticos exclusivamente en 127.0.0.1. Registro/login; IndexedDB real; edición offline y recarga tras confirmación local; bloqueo A→B con pendientes; restauración fallida sin exponer datos anteriores; importación completa de nueva identidad; dos dispositivos con cambios independientes y colisión explícita; roles/competición; plan; PDF offline; manual; contraseña propia y sesiones de pestañas; ancho 390 px sin desbordamiento horizontal. No se ha usado el sitio desplegado ni cuentas reales.
- PDF generado por el navegador: inspección de todas las páginas con Poppler y pypdf, introducción literal, Tábata 32:10 con 5 sets/180/10/20, cuatro sesiones completas distribuidas en tres páginas, logo en cada página. Código compacta una sesión extensa y bloquea exportación si no cabe incluso en tamaño compacto.

La descarga habitual de Chromium no funcionó en este entorno (archivo truncado); la comprobación se completó con un ejecutable local extraído del paquete de Chromium de pruebas. Ese paquete auxiliar no forma parte de las dependencias del proyecto ni de la aplicación. El checkout del propietario usa `npx.cmd playwright install chromium` y `npm.cmd run test:browser`.

La revisión automática bloqueó `wrangler deploy --dry-run` porque puede conectar con Cloudflare, prohibido por el propietario. Se sustituyó esa comprobación por compilación local esbuild y ejecución workerd, ambas completadas. No se ha desplegado ni configurado Cloudflare. La validación de Wrangler contra la cuenta/plataforma corresponde al propietario al publicar.

## Cobertura y alcance

Medición reproducible: `node --experimental-strip-types --test --experimental-test-coverage tests/domain.test.ts`. Medición actual: planner.ts 100 % de líneas / 97,78 % de ramas; models.ts 100 % de líneas y ramas; merge.ts 100 % de líneas / 92,78 % de ramas. El único rango no cubierto del generador es el final inalcanzable de su flujo infinito (comprobado en NODE_V8_COVERAGE); sus decisiones de negocio están ejercitadas. No se confunde ese hecho con un reporte total del 100 %. Modelos y merge tienen pruebas de errores, UUID, fechas, límites, inserciones, borrado/edición, conflictos de orden y elección remota sin perder cambios locales independientes. Las cifras específicas se obtienen del reporte ejecutado; no se afirma que la cobertura de todo SyncService/UI/casos de uso cumpla aún sus objetivos de 95 %/90 %. Esos porcentajes son objetivos del documento; las pruebas de integración y navegador no se contabilizan en el reporte unitario de Node.

El runtime local no valida el token privado real del Worker. Esa conexión está cubierta por las pruebas remotas del propietario en la fase de viabilidad. La nueva aplicación requiere revisión de aceptación tras su despliegue manual.

## Límites y cuotas

GitHub autenticado: límite primario general de 5.000 llamadas/hora y límites secundarios generales de creación de contenido de 80/minuto y 500/hora, compartidos con otros usos de la cuenta. Contents admite base64 completo hasta 1 MiB y listados hasta 1.000 entradas. La app adopta **64 KiB por JSON de negocio**, payload API app **96 KiB** (envelope), máximo 200 posiciones / 100 técnicas por posición, 10.000 caracteres por descripción/comentario y calendario máximo de 730 días. Un plan extenso puede superar 64 KiB antes de los límites de campos; se rechaza con 413, conservando datos locales. No prometer tamaño ilimitado ni usar GitHub para vídeos.

Límites del endpoint: 30 peticiones/IP/minuto, 300 globales/minuto, login/registro 6/IP/minuto, 10 solicitudes de mutación/minuto y 100/hora. Además se cuenta cada escritura real a GitHub (incluidas inicialización/generación/reconciliación): 70/minuto y 450/hora. Respuestas 429 con Retry-After; no reintentar en bucle. Estos presupuestos no garantizan una cuota libre si otros procesos utilizan el token/cuenta.

Sin polling ni commits por pulsación; cada cambio se guarda en IndexedDB y los pendientes se agrupan al sincronizar. Sincronización posterior del mismo usuario envía versiones SHA; listados de metadatos permiten omitir lecturas de JSON inalterados. Perfil/rol vigente sí se verifica remotamente por seguridad. Primer login/cambio de usuario exige restauración completa. El DO no almacena documentos de negocio; solo sesiones, límites y coordinación. El catálogo privado conserva tombstones y permite reintentar operaciones multiarchivo incompletas.

Workers Free: 100.000 peticiones/día y 10 ms CPU por request de entrada; el hash/generación/operaciones remotas se ejecutan en SQLite DO, cuyo presupuesto de CPU es distinto (30 s por invocación por defecto). DO Free: 100.000 peticiones/día, 13.000 GB-s/día, 5 millones de filas leídas/día, 100.000 escritas/día y 5 GB totales. Un endpoint puede consumir múltiples filas y subrequests. La documentación de Workers indica 50 subrequests externos por invocación en Free: restaurar muchos planes o reconciliar una competición de muchos alumnos puede superar límites. Esta versión está orientada a grupos pequeños; la escala y el coste real se revisan antes de ampliar el uso. El historial Git crece con cada commit. No activar Paid ni pedir tarjeta como respuesta a una cuota.

Fuentes oficiales revisadas (13/10/2026):

- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- https://docs.github.com/en/rest/repos/contents
- https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/

## Aceptación pendiente a cargo del propietario

1. Desplegar la nueva versión y configurar el primer entrenador manualmente en el perfil de GitHub privado.
2. Dos cuentas nuevas reales, aislamiento, comentario, asignación, manual/PDF, cambio/reset de contraseña y 409 entre dispositivos.
3. Android Chrome e iPhone Safari reales: instalación PWA, reinicio, teclado/táctil, offline, PDF, actualización y sincronización PC. La prueba responsive en Chromium no acredita Safari/iOS.
4. Medir CPU/latencia/cuotas en su cuenta Free, con el número real de alumnos y planes, sin cambiar parámetros de autenticación.
5. Rotación/revocación real del token GitHub y recuperación tras caducidad, sin pérdida de pendientes.

No se considera esta matriz terminada por el hecho de que funcionase la interfaz técnica del prototipo anterior.


## Ajuste de tipo de técnica en negrita — 14/10/2026

El componente compartido PlanView muestra el tipo en strong tanto en Mis planes como en el plan del alumno consultado por Entrenador. Las técnicas de TrainerStudent ya usan strong; se conserva ese formato. No cambia datos ni exportación PDF.

Validación local: npm test (63/63), typecheck, build, check:worker, test:runtime y test:browser correctos. Chromium local mediante PGT_TEST_CHROMIUM_PATH; revisión de capturas de planes en escritorio y móvil. Fixtures locales, sin aceptación remota ni comprobación Safari/iOS. Despliegue pendiente del propietario.


## Incidencia Origin, login, peso y retirada de bootstrap — 14/10/2026

Causa reproducida: ALLOWED_ORIGIN único y dominio de ejemplo en wrangler.jsonc. La validación de Origin precede al payload y autenticación: POST/PUT con Origin rechazados, mientras GET sin Origin puede funcionar. No depende del peso ni del bootstrap. No se ha inspeccionado la configuración desplegada de Cloudflare; confirmación remota pendiente.

ALLOWED_ORIGINS permite únicamente orígenes exactos enumerados; configuración con URL real del Worker y soporte de la variable singular anterior. Sin comodines ni confianza basada en Host. Origen null, previews y dominios arbitrarios rechazados. OPTIONS permitido solo para orígenes declarados. Sesión Bearer, sin cookies; SW no cachea API y build renueva versión de assets.

Retirados formulario/estado y operación de bootstrap; ruta antigua 404. AppApi no recibe clave especial. Primer entrenador configurado manualmente en GitHub; fixtures simulan ese procedimiento. PROBE_ADMIN_KEY sigue exclusivamente en endpoints heredados de viabilidad, por lo que no es un secreto exclusivo del bootstrap. No se han cambiado secretos ni datos reales.

Peso validado en HTML, dominio y Client.edit antes de persistir; API rechaza inválidos sin escrituras. Decimal y null se sincronizan posteriormente. Se conservan pendientes antiguos y bloqueo de cambio de cuenta para evitar pérdida de datos.

Validación: 66/66 tests, typecheck, build, check:worker, runtime y Chromium local correctos. Regresión de allowlist/preflight, mismatch independientemente de peso, bootstrap retirado, registro alumno y peso sin escrituras. Runtime completo alterna Worker/Pages en Origin incluso durante login/logout/escrituras. Browser prueba ausencia de formulario, peso negativo, offline, reentrada, aislamiento y perfil entre dispositivos. Producción y PWA móvil real/Safari/iOS pendientes de aceptación del propietario.

## Rediseño de exportación PDF — 14/10/2026

Petición expresa del propietario: mejorar la exportación inspirándose en tarjetas de sesión y resumen de sus capturas. El permiso sustituye la restricción de no modificar PDF por cambios visuales del frontend. Exportación nativa jsPDF con Barlow local embebida, paleta pizarra/azul, resumen inicial de datos guardados, configuración Tábata en cinco campos, tarjetas cronológicas en dos columnas, posición/prioridad/pasada y tipo en negrita, descripciones y comentarios diferenciados, logo y numeración en todas las páginas. No incluye porcentajes de catálogo ni convierte cobertura en asistencia.

Se mide cada sesión antes de dibujar: traslado entero, ancho completo para textos densos, compactación hasta 7 pt y error explícito si aun así no cabe. Nunca se divide ni se regenera. Función buildPlanPdf devuelve posiciones para comprobar paginación; exportPlan mantiene descarga y recursos locales offline.

Validación: 69/69 tests; tres regresiones nuevas de no mutación/orden/páginas sin solapamiento, sesión densa de ancho completo/error por exceso y tiempos variables/descansos cero/nombres largos/plan vacío. Typecheck, build, check:worker, runtime y navegador local correctos, incluida descarga PDF offline sin exportación previa. Ejemplo de 19 sesiones y 95 ejercicios con descripciones/comentarios ilustrativos: 11 páginas renderizadas y revisadas; márgenes de todo el texto y logo de cada página verificados. No usa datos reales ni cambia técnicas, algoritmo, sincronización, permisos o planes guardados. Pendiente publicar y revisar en dispositivos físicos/Safari.

Ejemplo reproducible local: node scripts/preview-plan-pdf.mjs. Usa plantilla oficial y descripciones ilustrativas; no constituye un plan real de alumno.
