# CI/CD de PGT BJJ Planner

## Estado revisado y alcance

Repositorio dmda92/pgt-bjj-planner: no había workflows. wrangler.jsonc usa pgt-github-probe, Worker worker/index.ts,
assets ./dist, binding ASSETS y SECURITY / ProbeSecurity, migración github-probe-v1. El mismo despliegue publica API y
PWA; la API del frontend usa su mismo origen. Datos exclusivamente en el repositorio privado pgt-bjj-data.

No se ha accedido a la cuenta Cloudflare ni comprobado sus conexiones Git actuales. Las comprobaciones del panel
indicadas aquí las realiza el propietario. La preparación del workflow está autorizada; no se ha realizado un despliegue
de producción.

## Configuración inicial en GitHub (una vez)

En el repositorio → Settings → Secrets and variables → Actions → Secrets, crear:

| Secreto               | Valor                                                                |
|-----------------------|----------------------------------------------------------------------|
| CLOUDFLARE_API_TOKEN  | Token de API Cloudflare para desplegar Workers en la cuenta correcta |
| CLOUDFLARE_ACCOUNT_ID | Account ID de la cuenta que contiene pgt-github-probe                |

Crear el token en Cloudflare, en Account API tokens → Create Token, con plantilla Edit Cloudflare Workers y limitar
Account Resources a la cuenta indicada. No usar Global API Key. Workers Scripts: Edit es necesario; mantener los
permisos adicionales de recursos que exige la plantilla para Workers/Static Assets. No se necesitan permisos sobre zonas
DNS si se sigue usando workers.dev y no se modifican rutas de zona. No reducir a ciegas permisos para los Durable
Objects existentes. Revisar expiración y renovar el secreto de Actions antes de que caduque.

No copiar a Actions GITHUB_DATA_TOKEN ni PROBE_ADMIN_KEY; ya permanecen como secretos del Worker. El token de despliegue
de Cloudflare es distinto del token de GitHub para los datos. No pegar ninguno en commits, archivos .env, capturas o
logs.

Después de comprobar Cloudflare, en la pestaña Variables de Actions, crear una **Repository variable**:

| Variable                  | Valor |
|---------------------------|-------|
| CLOUDFLARE_DEPLOY_ENABLED | true  |

El interruptor permite preparar los archivos sin publicar antes de configurar la cuenta. Ausente o distinto de true:
ejecuta validación y omite despliegue. Una vez activado, cada push a main valida y publica automáticamente. No hacen
falta aprobaciones por ejecución. Tras configurar, usar Actions → Validate and deploy PGT → Run workflow → main, o
realizar el siguiente push; configurar secretos no dispara por sí mismo una ejecución.

Comprobar que Actions está habilitado y permite actions/checkout y actions/setup-node. La rama main debe permitir el
workflow. Opcionalmente exigir el check validate-and-deploy en la protección de rama antes de integrar PRs.

## Comprobaciones en Cloudflare

1. Workers & Pages → seleccionar **pgt-github-probe**, de tipo Worker, en la misma cuenta cuyo Account ID se guardó en
   GitHub. Conservar nombre, SECURITY / ProbeSecurity, binding ASSETS y migración existente; no crear otro Worker,
   namespace o entorno.
2. Settings → Variables and Secrets: conservar GITHUB_DATA_TOKEN y PROBE_ADMIN_KEY. No volver a introducirlos para cada
   despliegue. El workflow no ejecuta secret put/delete/bulk, no pasa secrets-file y no accede al repositorio de datos.
   Las migraciones declaradas ya aplicadas no se recrean por cada despliegue.
3. Si el Worker está conectado a GitHub mediante **Workers Builds**, desactivar/desconectar su publicación automática
   antes de activar Actions. Solo Actions debe publicar este Worker. No dejar dos mecanismos ni workflows antiguos
   usando wrangler deploy sobre pgt-github-probe. No hacer despliegues manuales concurrentes.
4. Verificar ALLOWED_ORIGINS en wrangler.jsonc: contiene la URL real del Worker. Si la entrada habitual está en Pages o
   en un dominio personalizado, añadir sus orígenes exactos a esa lista y hacer commit. No usar comodines. --keep-vars
   preserva variables adicionales del panel; las variables declaradas en Wrangler siguen teniendo los valores del
   repositorio. Revisar ALLOWED_ORIGIN heredado y retirar manualmente cualquier origen no deseado.
5. Mantener Free y confirmar que la cuenta dispone de los permisos de despliegue. No habilitar recursos Paid para
   arreglar un fallo de CI.

## Si Pages ya está conectado a GitHub

Comprobar en Workers & Pages si existe un proyecto **Pages** conectado a dmda92/pgt-bjj-planner. No confundirlo con el
Worker, ni con el prototipo alojado en chatgpt.site.

Si existe, conservar su integración Git: rama de producción main, raíz del repositorio, salida dist, Node.js 24. Como
comando de build usar:

```
npm ci && npm test && npm run typecheck && npm run build && npm run check:worker && npm run test:runtime
```

Configurar VITE_API_BASE_URL=https://pgt-github-probe.david-dzm5.workers.dev en el build de Pages. Permitir el origen
exacto de Pages en Wrangler. No introducir secretos de datos ni credenciales Cloudflare en variables del frontend. Pages
publicará la PWA; Actions publicará la API y los assets de respaldo del Worker. El workflow no ejecuta pages deploy ni
duplica la publicación del proyecto Pages.

Pages y Worker son dos publicaciones independientes; la publicación nativa de Pages no espera al job de Actions. Sus
propias comprobaciones bloquean su build, pero no existe una transacción atómica entre ambos proyectos. Para una
publicación conjunta de frontend/API de una misma versión, usar la URL del Worker, que es la opción lista por defecto.
Si Pages no existe, no hace falta crearlo: Actions ya despliega toda la aplicación en el Worker.

## Qué ejecuta el workflow

Push a main, PR dirigido a main y ejecución manual. PR solo valida, sin credenciales Cloudflare ni despliegue. Node 24,
npm ci, tests, typecheck, build PWA, compilación Worker, tests runtime, instalación Chromium y pruebas de navegador/PDF
offline. Los pasos son secuenciales: un fallo impide publicar. Wrangler es la versión fijada en package-lock.json;
--no-install no descarga una versión nueva.

Para main, concurrency serializa las ejecuciones y no cancela una subida ya iniciada. GitHub puede reemplazar
ejecuciones pendientes; no debe exigirse publicar cada commit intermedio de una ráfaga. Justo antes del deploy se
consulta HEAD de main: una ejecución antigua o reintentada con SHA viejo se omite. Si llega un push durante un upload
iniciado, ese upload puede terminar; la ejecución posterior del nuevo HEAD publica después y no simultáneamente. No hay
posibilidad de garantizar que un push nuevo interrumpa atómicamente una petición de deploy en curso. El control solo
cubre este workflow, de ahí desactivar Workers Builds y evitar publicaciones manuales concurrentes.

El token Cloudflare solo entra en el paso de deploy, después de aprobar comprobaciones y verificar SHA. Permiso
GITHUB_TOKEN únicamente contents: read; no se solicitan permisos de escritura sobre datos o código.

## Uso habitual y recuperación

Hacer push a main y abrir Actions → Validate and deploy PGT. Ver pasos verdes y versión nueva en Cloudflare Deployments.
Probar login, sincronización y descarga PDF; activar la actualización de PWA conservando pendientes. Un workflow verde
con deploy omitido por falta de interruptor no significa publicación realizada.

Si falla validación, corregir y hacer otro push. Si falla autenticación, revisar Account ID/permisos/expiración y
corregir los secretos; reejecutar el workflow de HEAD main. No reintentar commits antiguos para rollback: el guard los
omite. Para revertir, hacer revert del cambio como commit nuevo en main; pasa las mismas comprobaciones y conserva datos
y secretos. No borrar IndexedDB, repositorio privado o Durable Objects.

La primera ejecución remota y el despliegue real quedan pendientes de configurar secretos y activar el interruptor. La
validación local no acredita permisos reales de Cloudflare.

## Referencias oficiales

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/pages/configuration/git-integration/
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
