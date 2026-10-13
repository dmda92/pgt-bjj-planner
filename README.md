# PGT — GitHub privado + Worker

Proyecto reiniciado desde cero según requisitos versión 2.0. El árbol actual sustituye completamente al prototipo anterior. **Solo contiene la prueba bloqueante de almacenamiento y autenticación; todavía no es la aplicación PWA completa.**

- Especificación adjunta íntegra: [docs/REQUISITOS_PGT_APP.md](docs/REQUISITOS_PGT_APP.md).
- Configuración y pruebas reales del propietario: [docs/CONFIGURACION_PRUEBA.md](docs/CONFIGURACION_PRUEBA.md).
- Validaciones, cuotas y decisiones: [docs/VALIDACION.md](docs/VALIDACION.md).
- Error DATA_NETWORK_RETRY: [diagnóstico seguro y corrección de fetch](docs/DIAGNOSTICO_CONEXION.md).

El propietario confirmó que la frase «No usar GitHub privado, GitHub REST API» del apartado 2.1 es una errata. La arquitectura aplicable es repositorio privado GitHub y API Contents mediante Worker, según el resto del documento. Se conserva el adjunto sin modificarlo.

## Repositorios y arquitectura

Código (frontend src/ y API worker/): dmda92/pgt-bjj-planner. Datos JSON exclusivamente en **dmda92/pgt-bjj-data PRIVADO**, bajo PGT/. El Worker comprueba la privacidad del repositorio antes de acceder a datos. El cliente solo recibe una sesión PGT opaca; nunca token GitHub ni hashes de contraseña. No hay API GitHub genérica, rutas arbitrarias ni operaciones fuera de PGT.

GitHub Contents API es el adaptador detrás de CloudStorageProvider. Las escrituras actualizan solo con SHA esperado; errores 409/422 se conservan como conflictos, nunca sobrescritura. Creación omite SHA y no sustituye archivos existentes. Lecturas fallidas de forma transitoria reintentan una vez con backoff; mutaciones ambiguas no se repiten automáticamente. La prueba evita commits cuando se guarda el mismo texto sin cambios. La app futura agrupará pendientes desde IndexedDB, sin polling ni escritura por pulsación.

Durable Object SQLite gratuito únicamente para sesiones, límites de frecuencia y serialización de operaciones. Ningún dato de negocio se almacena ahí. No se necesita KV, D1 ni otra BD de negocio. PBKDF2-SHA256 con 600.000 iteraciones y sal independiente mediante Web Crypto, ejecutado dentro de DO para comprobar compatibilidad/CPU real en el plan gratuito. La calibración remota sigue pendiente.

## Desarrollo local

Node 24. Desde checkout:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run check:worker
npm run test:runtime
```

`build` produce `dist` con **cliente técnico de prueba**, no PWA completa. `check:worker` compila localmente en modo dry-run sin publicar. Para ejecutar simulador local, configurar `.dev.vars` privadamente a partir del ejemplo y ejecutar `npm run dev:worker`. Nunca versionar `.dev.vars`, `.env` real, tokens ni contraseñas. `.env.example` solo tiene URL pública de API; `.dev.vars.example` tiene marcadores de secretos.

El cliente estático se sirve por el mismo Worker para simplificar la prueba. Puede compilarse con VITE_API_BASE_URL si se sirve desde otro origen; ALLOWED_ORIGIN debe coincidir exactamente. No hay login GitHub/Microsoft para alumnos. Las sesiones del prototipo duran 12 horas y solo se guardan en memoria del navegador: esto no satisface todavía el requisito de persistencia de sesión de la aplicación final. Los perfiles probeOnly no son registros de negocio completos; el propietario los crea con una clave administrativa. No se habilita registro público ni bootstrap de entrenador en esta fase.

## Configuración y despliegue

**Work no accede a la cuenta Cloudflare ni despliega.** El propietario configura Worker Free, binding SQLite, variables y secretos; instrucciones en CONFIGURACION_PRUEBA.md. El token GitHub es fine-grained, solo pgt-bjj-data y Contents Read and write. Rotarlo antes de caducidad con `wrangler secret put GITHUB_DATA_TOKEN`; no enviarlo por chat. El API indica credencial inválida, sin permisos, repo invisible o límites sin exponer respuesta privada.

Después de superar el gate se desarrollará React/TypeScript/Vite, PWA, IndexedDB, planes, PDF, sincronización y roles completos. Pages se conectará manualmente a main, comando npm run build, salida dist. **No conectar Pages todavía pensando que esto ya es la app terminada.** Worker y Pages se publican por separado desde este mismo monorepo.

## Backup y recuperación

El historial privado de GitHub permite recuperar versiones de JSON. La restauración debe volver a escribir con el SHA actual; no restaurar por fuerza una rama ni perder versiones de otros alumnos. Al revocar/caducar el token, las operaciones remotas fallan hasta que el propietario lo rote. Esta prueba no implementa aún IndexedDB/pendientes ni importación/exportación: son parte del desarrollo posterior al gate. Borrar un archivo no elimina su contenido del historial Git; no guardar secretos ni contraseñas en texto claro en el repo de datos.
