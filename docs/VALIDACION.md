# Validación y límites — 13/10/2026

## Alcance

Nuevo árbol de código desde cero; sustitución completa del prototipo anterior en main mediante commit normal, conservando historial Git. Repo de datos independiente y privado. No se ha borrado información de alumnos; solo un archivo temporal de prueba creado en esta sesión.

Se conserva literalmente el adjunto en REQUISITOS_PGT_APP.md. El propietario confirmó en la pregunta de errata que se debe usar GitHub privado/REST API aunque una frase de 2.1 lo prohíba por error. Esta decisión se recoge aquí y en AGENTS.md sin alterar el adjunto.

## Prueba real mediante complemento

- dmda92/pgt-bjj-planner: permisos admin/push/pull comprobados.
- dmda92/pgt-bjj-data: visibilidad PRIVATE, admin/push/pull comprobados.
- Crear archivo temporal `PGT/_viability/work-20261013-1257.json` con texto sintético sin datos personales: éxito.
- Leer versión 1, guardar su SHA: éxito.
- Actualizar a versión 2 usando SHA esperado: éxito.
- Actualizar usando SHA de versión 1: **GitHub devuelve 409 CONFLICT**.
- Leer tras conflicto: SHA y contenido de versión 2 intactos.
- Borrar con SHA de versión 2: éxito; lectura posterior devuelve 404. No queda archivo temporal activo.

**Esta prueba usa las credenciales del complemento. No valida el fine-grained token del propietario ni el runtime Worker.**

## Pruebas de código

15 casos: rutas, repositorio privado, UTF8/base64, SHA, CRUD, errores/credenciales/rate limits, backoff y no repetición de mutaciones ambiguas; correo, PBKDF2 con sal, CORS, roles no inyectables, altas de prueba, login/logout, acceso cruzado, no-op sin commits, revocación y límites.

Comandos de entrega: npm test, npm run typecheck, npm run build y npm run check:worker. Además, npm run test:runtime ejecuta el bundle en Miniflare/workerd local con Durable Object SQLite: verificados 401 sin sesión y 404 para endpoint inexistente. Las pruebas de dominio API usan almacenamiento cloud falso; el runtime local no equivale a despliegue remoto ni valida el token GitHub. No se afirma cobertura porcentual del proyecto final: sigue sin implementarse.

## Cuotas verificadas en documentación oficial

GitHub Free permite repositorios privados. PAT autenticado: límite primario general 5.000 peticiones/hora por usuario, compartido con otros usos según autenticación. Límites secundarios generales: creación de contenido como máximo 80 peticiones/minuto y 500/hora; algunos endpoints tienen límites inferiores, sujetos a cambio. Contents: soporte completo de base64 hasta 1 MB, límite de listados 1.000 entradas por directorio. GitHub recomienda repos pequeños, idealmente <1 GB y encarecidamente <5 GB; no usar como almacenamiento masivo de vídeos. Guardar enlaces de vídeos, no binarios.

Este prototipo impone 64 KiB/archivo, 2.000 caracteres por texto, 16 KiB/payload, operaciones seriales y presupuesto conservador 10 mutaciones/minuto y 100/hora para prueba; no polling. Comprobar la escala prevista y coordinar operaciones multiarchivo antes del desarrollo final. No garantizar cuotas para un número indefinido de alumnos. El historial crece con cada commit: vigilar tamaño. El registro abierto definitivo precisará protección y presupuestos de cuotas apropiados.

Workers Free: 100.000 peticiones/día, 10 ms CPU por request de entrada. DO SQLite Free: 100.000 peticiones/día, 13.000 GB-s/día, 5 millones de filas leídas/día, 100.000 escritas/día, 5 GB de almacenamiento total. Un request puede implicar múltiples lecturas/escrituras. El DO tiene su propio presupuesto de CPU por invocación (documentación indica 30 segundos), donde se ejecuta PBKDF2; validar coste/rendimiento real. No activar planes Paid. Si excede cuotas gratuitas, fallará; informar y no solicitar tarjeta como solución.

Fuentes oficiales consultadas:

- https://docs.github.com/en/get-started/learning-about-github/githubs-plans
- https://docs.github.com/en/rest/repos/contents
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/

## Pendiente / bloqueo antes de aplicación completa

Propietario debe configurar token secreto limitado y desplegar Worker Free; validar CRUD real, permisos, revocación, conflictos, aislamiento y dispositivos. Work no accede a Cloudflare ni despliega. No sustituir prueba con mocks.

No implementados todavía: React/Vite, PWA/instalación, IndexedDB/offline, registro público completo/plantilla oficial, bootstrap de entrenador, roles y cambios de contraseña definitivos, generador de competición, sincronización completa y PDF. La plantilla oficial no se ha importado ni inventado. El build actual es solo cliente técnico, no la aplicación final.
