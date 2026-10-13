# PGT — Planificador de competición

PWA React/TypeScript para alumnos y entrenadores de jiu-jitsu. IndexedDB es la persistencia de trabajo; la sincronización pasa por Cloudflare Worker + Durable Object SQLite y escribe JSON por SHA en el repositorio **privado** `dmda92/pgt-bjj-data`. Código en `dmda92/pgt-bjj-planner`. No se requieren cuentas GitHub/Microsoft para alumnos ni servicios de pago.

- [Requisitos originales completos, versión 2.0](docs/REQUISITOS_PGT_APP.md).
- [Reglas del proyecto](AGENTS.md).
- [Resultados y límites de validación](docs/VALIDACION.md).
- [Configuración y despliegue manual](docs/DESPLIEGUE_APP.md).
- [Diagnóstico de conexión](docs/DIAGNOSTICO_CONEXION.md) y [PBKDF2](docs/DIAGNOSTICO_ALTA.md).

El propietario dio por terminada la viabilidad tras probar el Worker, GitHub privado, CRUD, login, aislamiento, conflictos y sincronización móvil/PC. La frase que prohíbe GitHub privado/REST en 2.1 del adjunto es una errata confirmada por el propietario; el documento se conserva íntegro.

## Funciones

Registro como alumno, sesión persistente y revocable, perfil y contraseña. Técnicas editables, búsqueda, UUID exclusivos por alumno y comentarios separados del entrenador. Competiciones con configuración inmutable, asignaciones, planes generados una vez, edición manual, cobertura y Tábata. PDF con introducción literal y logo PGT en cada página, sin dividir sesiones. PWA instalada opcionalmente, edición offline, sincronización incremental por SHA, fusión de campos/entidades independientes y elección explícita ante colisiones. Copia JSON propia y bloqueo de otras pestañas cuando cambia la sesión.

La plantilla privada `PGT/master_data/tecnics_base.json` procede exclusivamente de **Competidores jiu jitsu/Posiciones A TRabajar Minimos.json** (nombre encontrado: `posiciones a trabajar mínimos.json`). Mantiene literalmente nombres, tipos, prioridades y orden de arrays: **17 posiciones y 36 técnicas**. El original permanece en la biblioteca del propietario; no se publica en el repositorio de código. Los tests usan datos sintéticos identificados como tales, nunca como plantilla real. Se omite `order` según requisitos; cada alumno recibe UUID nuevos y descripciones vacías. La copia operativa está en `PGT/master_data/tecnics_base.json` del repositorio privado. El logo procede de `Competidores jiu jitsu/logo PGT.jpg`.

## Desarrollo y pruebas

Node.js 24. Desde la carpeta del proyecto:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run check:worker
npm run test:runtime
npx playwright install chromium
npm run test:browser
```

`check:worker` compila **localmente con esbuild**, sin contactar con Cloudflare. `test:runtime` ejecuta workerd/Miniflare + DO SQLite, con GitHub interceptado y datos sintéticos; incluye WebCrypto y el límite nativo PBKDF2 observado. No usa secretos reales ni crea alumnos reales. `scripts/verify-template.mjs <JSON-original> <JSON-plantilla>` coteja los campos exactos del origen y la plantilla sin publicar esos archivos. La comparación real se ha ejecutado y confirmado, aparte de los fixtures. `test:browser` sirve `dist` en 127.0.0.1 con una API ficticia, usa IndexedDB real del navegador y comprueba escenarios de sesión/offline/PDF. Para un Chromium ya instalado puede usarse `PGT_TEST_CHROMIUM_PATH` y, opcionalmente, `PGT_TEST_CHROMIUM_ARGS` (array JSON de argumentos).

```sh
npm run dev
```

Vite muestra la interfaz. Para API real de desarrollo configurar **privadamente** `.dev.vars` con los marcadores de `.dev.vars.example` y arrancar `npm run dev:worker`; esta operación corresponde al propietario y sus credenciales. Vite puede usar una URL pública configurada en `VITE_API_BASE_URL` o servir todo localmente con Wrangler. Nunca versionar `.env`, `.dev.vars`, contraseñas ni tokens. Las pruebas automáticas no necesitan estos archivos.

Capas: `src/domain` (modelos, generador y merge), `src/application` (sesión/sync), `src/infrastructure` (Dexie/PDF), UI en `src/main.tsx`, API y adaptador GitHub en `worker/`. El provider cloud es intercambiable mediante `CloudStorageProvider`; su sustitución requiere aprobación del propietario.

## Seguridad y recuperación

GitHub fine-grained token solo para `pgt-bjj-data`, **Contents Read and write**, exclusivamente secreto del Worker. PBKDF2-SHA256 con sal, 600.000 iteraciones y salida 256 bits; fallback compatible `@noble/hashes` únicamente ante el límite nativo confirmado. No se reducen parámetros. Nunca devolver hashes, token GitHub ni clave administrativa. Las sesiones PGT no caducan por inactividad según requisitos; se revocan por logout, cambio de contraseña/rol. El Worker verifica perfil/rol vigente en cada operación. Primer entrenador mediante bootstrap de un solo uso con la clave administrativa existente. Un entrenador no puede quitarse a sí mismo el rol; otro entrenador puede gestionarlo.

IndexedDB contiene exclusivamente un propietario activo. Cambio de usuario exige sincronizar pendientes, descargar y validar al nuevo usuario y reemplazar la base atómicamente. Logout bloquea el acceso y conserva los pendientes; para recuperarlos se vuelve a entrar con el mismo usuario. Primera carga y cambio de usuario requieren conexión; una sesión previamente restaurada permite edición offline. Datos de alumnos consultados por un entrenador se muestran en memoria y se limpian al cerrar sesión.

Antes de resolver conflictos, exportar la copia propia. La importación marca cambios locales y no sobrescribe GitHub automáticamente; no permite restaurar otro alumno ni resucitar un plan borrado por el entrenador. Desasignar conserva planes individuales ya generados. Borrar competición deja tombstone en el catálogo y elimina índices/archivos; reconciliación reintenta pasos incompletos en la siguiente sincronización. No hay transacción atómica multiarchivo en Contents API. Guardar vídeos mediante enlaces; no subir binarios de vídeos al repositorio de datos.

Los backups contienen datos de negocio, nunca sesión ni hash. La UI no borra pendientes al actualizar el service worker; pide sincronizar previamente. La exportación sirve como contingencia, pero no habilita automáticamente cambiar de usuario o borrar pendientes.

## Despliegue del propietario

Work no configura la cuenta Cloudflare ni publica allí. Se conserva el Worker **pgt-github-probe** y su binding **SECURITY / ProbeSecurity**; no renombrar namespaces ni migraciones existentes. Mantener los secretos actuales `GITHUB_DATA_TOKEN` y `PROBE_ADMIN_KEY`. El propietario publica Worker y configura Pages (`main`, `npm run build`, `dist`) por separado. Instrucciones exactas de PowerShell y primer entrenador en [DESPLIEGUE_APP.md](docs/DESPLIEGUE_APP.md).

Esta versión está verificada localmente. Safari/iOS real, instalación desde dispositivos y aceptación de la nueva UI tras despliegue corresponden a las comprobaciones indicadas en VALIDACION.md; la viabilidad del prototipo anterior no sustituye esas comprobaciones. No activar planes Paid cuando aparezca una cuota: detener operación y revisar límites.
