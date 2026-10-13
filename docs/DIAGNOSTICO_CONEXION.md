# Diagnóstico de conexión Worker → GitHub

## Fallos reproducidos y corregidos

En el runtime local workerd/Miniflare instalado con Wrangler 4.150.0 y compatibility_date 2026-10-13 se han reproducido dos fallos deterministas anteriores a la conexión:

1. Guardar fetch nativo y llamar `this.transport(...)` proporciona el objeto GithubContentsStorage como receptor; el runtime lanza TypeError / Illegal invocation. El transporte por defecto ahora es una función envolvente que llama al fetch global directamente.
2. `redirect: 'error'` no está implementado en ese runtime: construir la petición produce TypeError / Invalid redirect value. Ahora se utiliza `manual`; cualquier 3xx se rechaza explícitamente y nunca se sigue su Location. Se mantiene la protección de credenciales, no se cambia a follow.

La documentación de Request consultada enumera el modo error, pero el ejecutable workerd probado lo rechaza. La prueba de runtime conserva evidencia reproducible de ambos casos y verifica el comportamiento corregido usando fetch nativo con un servicio saliente interceptado. No realiza ninguna conexión externa ni valida el PAT desplegado.

`AbortSignal.timeout(15000)` sí se ha ejecutado correctamente en esa misma prueba. No es necesario sustituirlo. Un 401/403 HTTP de GitHub se diferencia de una excepción de transporte y mantiene los códigos de error propios del adaptador.

Referencias de API: https://developers.cloudflare.com/workers/runtime-apis/request/ y https://developers.cloudflare.com/workers/runtime-apis/fetch/ . La compatibilidad se comprueba con runtime, no solamente mocks de Node.

## Diagnóstico seguro

Cada excepción de transporte genera una línea JSON de console.error visible en wrangler tail:

- event: `pgt.github.transport_failure`.
- diagnosticId: UUID, compartido por los intentos de la misma operación remota.
- host fijo api.github.com; operación repository_metadata o json_content; método; intento; duración; si se reintentará.
- reason, errorName y, cuando se reconoce, causeName/transportCode, todos de vocabularios cerrados.

Clasificaciones: FETCH_INVALID_RECEIVER, UNSUPPORTED_REDIRECT_MODE, ABORT_API_UNAVAILABLE, FETCH_TIMEOUT, FETCH_ABORTED, DNS_FAILURE, TLS_FAILURE, CONNECTION_RESET, CONNECTION_REFUSED, NETWORK_UNREACHABLE o NETWORK_OR_RUNTIME_FAILURE.

Un 3xx genera `pgt.github.redirect_rejected` con httpStatus y devuelve DATA_REDIRECT_REJECTED. No registra Location ni sigue el destino.

**Nunca se registran objetos Error, mensajes crudos, stack, tokens, contraseñas, cabeceras, cuerpos, rutas de archivos, correos, URL completa ni respuestas GitHub.** Nombres/códigos arbitrarios se descartan; solo se usan patrones del mensaje internamente para asignar una clasificación fija. Los fallos deterministas de configuración/runtime no se reintentan; los transitorios mantienen un único reintento GET con backoff. Las mutaciones ambiguas no se repiten automáticamente.

## Actualizar desde PowerShell

En C:\GitHub\pgt-bjj-planner:

```powershell
git pull --ff-only origin main
npm.cmd ci
npm.cmd run build
npm.cmd run deploy:worker
```

Conservar el ALLOWED_ORIGIN real ya configurado en wrangler.jsonc y los secretos existentes; no se requiere cambiar tokens para corregir estos dos fallos. No usar reset --hard para resolver cambios locales de configuración. El nombre del Worker sigue siendo pgt-github-probe. Work no ejecuta login, tail remoto ni deploy.

En otra terminal, antes de pulsar Comprobar acceso:

```powershell
npx.cmd wrangler tail pgt-github-probe --format pretty
```

Volver a probar POST /api/admin/check. Si la credencial tiene acceso y el repo permanece privado, debería devolver 200. Un error diferente de credenciales/cuotas no implica que el arreglo de transporte haya fallado. Si persiste DATA_NETWORK_RETRY, compartir únicamente las líneas JSON pgt.github.* y el código HTTP de la pantalla. No compartir Authorization, secretos ni capturas que los muestren.

## Validación disponible

```sh
npm test
npm run typecheck
npm run build
npm run check:worker
npm run test:runtime
```

La suite de runtime reproduce los dos fallos previos, demuestra petición corregida al servicio GitHub simulado usando fetch nativo, bloqueo de redirect sin segundo envío y distinción de 401. Los tests de diagnóstico inyectan errores con secretos ficticios para verificar que jamás aparezcan en logs.

Pendiente: repetir la prueba real con el Worker desplegado por el propietario. No se afirma que se haya probado la conexión Cloudflare → GitHub en producción ni se considera superada la prueba completa de viabilidad.
