# Error INTERNAL_ERROR al crear perfiles de prueba

## Resultado de la investigación

No se ha reproducido el 500 comunicado en producción. En el mismo workerd/Miniflare usado con Wrangler 4.150.0 y fecha de compatibilidad 2026-10-13:

- Una llamada nativa crypto.subtle.deriveBits con PBKDF2-SHA256, 600.000 iteraciones y 256 bits funciona.
- El flujo completo del bundle dentro de un Durable Object SQLite devuelve **201** para a@a.es y b@b.es, con contraseñas sintéticas y GitHub interceptado.
- El hash almacenado solo en memoria de la prueba coincide con Node/OpenSSL pbkdf2Sync usando la misma contraseña y sal, 600.000 iteraciones y 32 bytes. Login correcto funciona; contraseña errónea y usuario inexistente se rechazan.
- El transporte se ejercita con fetch nativo, respuestas GitHub 404 para perfil ausente y 201 para creación. Se prueban perfiles existentes, prohibición de rol inyectado, autorización administrativa, aislamiento y errores GitHub.

**GitHub está simulado en esta prueba de runtime. No se ha accedido al Worker desplegado ni creado/modificado ningún usuario o dato real.** La comprobación READ_ACCESS_CONFIRMED del propietario no demuestra permiso de escritura, pero la falta de permiso debería producir DATA_TOKEN_PERMISSION_OR_SECONDARY_LIMIT, no INTERNAL_ERROR.

No se ha identificado aún la excepción exacta de producción. La entrega añade instrumentación segura para identificarla tras el siguiente despliegue; no se presenta como solución demostrada del 500. No se cambia algoritmo, salt, formato ni parámetros de seguridad; no se añade dependencia criptográfica, servicio o proveedor.

## Diagnóstico nuevo

Los errores esperados ApiError conservan sus códigos HTTP y públicos. Una excepción inesperada registra una línea JSON `pgt.request.unexpected_error` y devuelve:

```json
{"error":"INTERNAL_ERROR","diagnosticId":"<UUID-de-correlacion>"}
```

La línea de tail incluye ese mismo diagnosticId, operación genérica, etapa, tipo de excepción reconocido, clasificación y duración. Para alta las etapas son:

1. validate_origin / throttle.
2. authorize_admin.
3. parse_body / validate_body.
4. password_key_import / password_derive_bits / password_encode.
5. verify_private_repository.
6. read_user_profile.
7. write_user_profile.

Si la excepción se origina en deriveBits, el log indicará password_derive_bits y errorName. Si el runtime desplegado informa un límite de iteraciones, se clasificará PBKDF2_ITERATION_LIMIT; **eso no se ha observado localmente ni se corrige reduciendo iteraciones**. Otras clasificaciones incluyen PASSWORD_DERIVATION_FAILURE, PASSWORD_KEY_IMPORT_FAILURE, PASSWORD_ENCODING_FAILURE y JSON_DECODING_FAILURE.

No se registra el Error original, mensaje crudo, stack, password, hash, sal, token, cabeceras, cuerpo, correo ni ruta privada. El texto de excepción solo se examina internamente para devolver categorías cerradas. El UUID no contiene información del usuario. Los tests inyectan secretos sintéticos y verifican su ausencia en logs.

## Actualizar y obtener la excepción de producción

Desde Windows PowerShell en C:\GitHub\pgt-bjj-planner:

```powershell
git pull --ff-only origin main
npm.cmd ci
npm.cmd run build
npm.cmd run deploy:worker
```

Conservar ALLOWED_ORIGIN real y secretos existentes. No cambiar contraseñas ni tokens para obtener este diagnóstico. Work no ejecuta deploy, login ni tail remoto.

En otra terminal:

```powershell
npx.cmd wrangler tail pgt-github-probe --format pretty
```

Intentar una única alta desde la pantalla, usando un correo de prueba que no exista y contraseña de prueba. Si devuelve 500, compartir el diagnosticId de la respuesta y la línea JSON pgt.request.unexpected_error correspondiente (más pgt.github.* si aparecen). Nunca enviar contraseña, hash o cabeceras. Con esa evidencia se podrá corregir la causa concreta; la viabilidad sigue pendiente.

## Pruebas

npm test, npm run typecheck, npm run build, npm run check:worker y npm run test:runtime. La prueba ampliada ejecuta el bundle real con SQLite DO, WebCrypto nativo y fetch nativo. Sus perfiles sintéticos se guardan en un Map efímero del proceso y se destruyen al terminar. No hay conexión saliente real.
