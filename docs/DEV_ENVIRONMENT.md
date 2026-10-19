# Entorno DEV — preparación pendiente de autorización

## Estado y alcance

Rama feature/dev-environment creada desde main 0714047486464bb0f2dc2fccd0fdc65ba31c214b. En la inspección inicial develop era fe55820f0eb3c0c5941ea57234cbe4de4aa700b7 (anterior a main). Por ello la PR incluye también la historia de main ausente en develop: revisar su diff completo antes de integrarla. No se ha incorporado develop a la feature.

No se ha fusionado ni desplegado nada. wrangler.jsonc y .github/workflows/cloudflare.yml permanecen intactos. El código de negocio tampoco cambia. La política vigente está en AGENTS.md; docs/CI_CD.md describe el antecedente PRO y no autoriza operaciones actuales.

## Recursos y compatibilidad

wrangler.dev.jsonc publica pgt-github-probe-dev, entrada worker/index.ts, assets dist/ y binding ASSETS. /api/* pasa primero por Worker. SECURITY apunta a la clase local ProbeSecurity, sin script_name ni namespace remoto. La migración github-probe-dev-v1 crea SQLite en el namespace del nuevo Worker; no reutiliza el namespace de PRO. El mismo idFromName('github-probe') es independiente en cada namespace. No ejecutar migraciones remotas durante esta preparación.

Origen DEV exclusivo: https://pgt-github-probe-dev.david-dzm5.workers.dev. Confirmar el subdominio en la cuenta antes del primer deploy. No añadir el origen PRO ni ALLOWED_ORIGIN heredado desde el panel. VITE_API_BASE_URL vacío conserva API relativa al mismo origen. Sesiones actuales usan Bearer y almacenamiento de sesión del DO; no cookies compartidas. IndexedDB, localStorage, CacheStorage, manifest y registro Service Worker quedan aislados por origen. El SW excluye /api/ y peticiones de otro origen. No hace falta modificar UI, autenticación ni PWA para dos Workers.

DATA_BRANCH=main es la rama del repositorio de DATOS, no la rama de despliegue. El adaptador existente fija dmda92/pgt-bjj-data privado y PGT/. Compartirlo temporalmente está autorizado, pero NO ofrece aislamiento de negocio: cuentas de prueba distintas no aíslan el catálogo global de competiciones ni acciones del entrenador. No crear/borrar competiciones o asignaciones reales ni usar cuentas de alumnos reales. El rediseño de almacenamiento queda fuera de alcance.

## Configuración manual futura (no realizada)

1. Revisar PR y CI. No fusionar hasta autorización del propietario. Mantener `DEV_DEPLOY_ENABLED` ausente o false.
2. Crear GitHub Environment `development`, limitar ramas de despliegue a develop y añadir revisión requerida si está disponible en el plan. Configurar valores específicos DEV, sin copiar secretos PRO.
3. Tras revisión de Cloudflare y autorización del propietario, configurar credenciales y secretos que se detallan abajo. No activar aún el interruptor por el mero hecho de crear el Environment.
4. Para activación futura autorizada: definir variable de repositorio `DEV_DEPLOY_ENABLED=true`. Es de repositorio porque la condición del job se evalúa antes de cargar variables de Environment. El siguiente push autorizado resultante de una PR integrada en develop validará y desplegará DEV. El workflow no tiene workflow_dispatch; no usar main para activarlo. Si no hay cambios pendientes, preparar una PR de activación documental en develop tras aprobación.
5. El primer despliegue y la provisión de secretos DEV requieren coordinación del propietario: si el Worker todavía no existe, crear únicamente el Worker DEV y cargar sus secretos desde el panel/procedimiento seguro, con autorización posterior. Validar nombre/cuenta/bindings antes de cada operación. Después probar login/sync solo con fixtures/cuentas de prueba aprobadas, sin tocar recursos PRO.

| Elemento | Ubicación | Uso |
| --- | --- | --- |
| CLOUDFLARE_API_TOKEN | Secret del Environment development | Token NUEVO para publicar DEV; nunca al frontend |
| CLOUDFLARE_ACCOUNT_ID | Secret del Environment development | Cuenta de destino DEV |
| DEV_ACCOUNT_ID | Variable del Environment development | Identificador esperado; se compara con el secreto antes de desplegar |
| DEV_DEPLOY_ENABLED | Variable de repositorio, inicialmente false/ausente | Activación explícita posterior |
| GITHUB_DATA_TOKEN | Secreto SOLO del Worker DEV | Token nuevo fine-grained al repo privado de datos, Contents read/write, caducidad/rotación documentadas por propietario |
| PROBE_ADMIN_KEY | Secreto SOLO del Worker DEV, si se usan pruebas probe heredadas | Clave aleatoria propia de al menos 32 caracteres; no necesaria para AppApi; no habilitar pruebas remotas heredadas sin revisar sus escrituras |
| DATA_BRANCH / ALLOWED_ORIGINS | Variables públicas de wrangler.dev.jsonc | Rama de datos y CORS exacto DEV |
| VITE_API_BASE_URL | Configuración pública de build, vacía | API del mismo origen; nunca secretos |

Actions no recibe GITHUB_DATA_TOKEN ni PROBE_ADMIN_KEY y no ejecuta secret put/bulk/delete. Los secretos del Worker deben existir antes de probar autenticación real. Nunca imprimir valores ni ponerlos en ejemplos, capturas o logs. Las credenciales PRO existentes no se leen, cambian ni reutilizan.

Cloudflare API tokens suelen limitar Workers Scripts:Edit por cuenta, sin garantizar restricción por nombre de Worker. Revisar permisos efectivos antes de provisionar: cuenta DEV separada ofrece mayor aislamiento, pero no cambiar ahora cuenta/origen sin ajustar la configuración y revisar dependencias. Si se usa la misma cuenta, documentar que el token podría afectar PRO y obtener autorización específica de ese alcance; no afirmar aislamiento IAM por nombre. GITHUB_DATA_TOKEN limitado al repo compartido también permite técnicamente acceso a datos reales: la restricción de esta tarea sigue siendo obligatoria.

## CI/CD y protección del destino

cloudflare-dev.yml escucha solo PR a develop y push a develop. La validación no usa secretos ni Environment y no despliega: tests existentes, build y dry-run local. Deploy es otro job, depende de validación, requiere push exacto a refs/heads/develop y el interruptor explícito. Carga el Environment development y compara cuenta esperada. Configuración y nombre de Worker se indican explícitamente; check-dev-config rechaza binding externo, rutas, overrides env, origen o destino distintos. No hay comando PRO en este workflow.

Concurrencia serializa validaciones por ref y despliegues mediante grupo exclusivo DEV, sin interrumpir uploads. Justo antes de invocar Wrangler se consulta HEAD de develop con GITHUB_TOKEN de lectura: un SHA ya obsoleto se omite; un fallo de consulta bloquea. Existe una ventana inevitable entre comprobar HEAD y completar una publicación remota: si develop avanza durante un upload, este termina y la siguiente ejecución publica la revisión nueva. No se promete una transacción atómica GitHub/Cloudflare ni se cancela un upload en curso.

El workflow PRO se inspeccionó: push/PR solo main, más workflow_dispatch; sus pasos de publicación exigen refs/heads/main. Un push de esta feature o develop no lo activa. La protección de ramas se observó en la API; no se cambiaron reglas.

## Mecanismos externos pendientes

Verificado en Git: workflows versionados y configuración Wrangler. No hay herramientas Cloudflare conectadas en esta sesión; no se han comprobado ni cambiado Workers Builds, Pages, dashboard, tokens, permisos de cuenta ni secretos/variables de GitHub. No presentar esta inspección como validación remota.

Antes de habilitar DEV, propietario debe revisar Workers Builds y Pages: ninguna integración debe publicar PRO desde develop/features; DEV debe tener un único publicador (Actions). No conectar DEV a builds automáticos paralelos. Revisar especialmente builds de previews y comandos que omitan --config. Si hay una integración PRO incompatible, detenerse y solicitar tarea/autorización específica para cambiarla; esta PR conserva PRO intacto.

## AGENTS.md

Se conserva el contenido funcional previo. Solo se marcan como antecedentes las instrucciones incompatibles de despliegue y se añade política completa: feature desde main, PR a develop, autorización DEV condicionada, promoción selectiva y dependencias, prohibición de merge develop→main, límites PRO, secretos, conflictos, precedencia y checklists de inicio/cierre. Ninguna regla de BJJ, seguridad, sincronización o diseño cambia.

## Validación ejecutada — 19/10/2026

Node 24.19.0; npm ci completado. Fixtures sintéticos, Miniflare/workerd con GitHub interceptado, almacenamiento en memoria y servidores locales; no se cargaron credenciales ni se usaron datos reales.

| Comando | Resultado |
| --- | --- |
| npm test | OK: 117/117 |
| npm run typecheck | OK |
| npm run build | OK |
| npm run check:worker | OK |
| npm run test:runtime | FALLA en test-plan-recovery-runtime.mjs:142; subpruebas anteriores runtime/SQLite, autenticación y AppApi pasan |
| npm run test:browser | NO SUPERADA: Chromium no instalado; intento de instalación falla por descarga ZIP inválida/truncada; la cadena no ejecutó las suites posteriores |
| npm run test:performance | OK, benchmark sintético, sin equivalencia con producción |
| node scripts/check-dev-config.mjs | OK |
| wrangler deploy --config wrangler.dev.jsonc --dry-run --outdir .worker-dev-build | OK; bundle y assets locales, sin publicación |
| Parseo YAML y revisión de triggers/jobs | OK; solo develop, PR sin secretos ni deploy |
| git diff --check / comparación archivos PRO | OK; PRO intacto |

El fallo runtime se reprodujo por separado en checkout detached de main 0714047, usando exactamente el mismo bundle (worker/src sin cambios). El test espera todas las descripciones actualizadas, incluidas sesiones desde 17/10/2026; esas fechas ya son pasado/hoy y el producto las protege. No se alteran tests ni reglas de histórico para hacerlo pasar. Requiere corrección independiente del fixture temporal aprobada por el propietario antes de integrar; el gate runtime bloquea el deploy también en Actions. La ejecución de la cadena runtime se detuvo en esa aserción: no se afirma cobertura de sus pasos posteriores.

No se ha verificado aislamiento remoto real entre dos Workers, ni login/sync DEV remoto, ni CI remoto completo antes de abrir PR. El análisis de bindings y pruebas locales no sustituyen esa aceptación. No activar DEV hasta resolver el fallo, completar navegador/CI, revisar integraciones externas y recibir autorización.
