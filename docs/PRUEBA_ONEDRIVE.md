# Prueba bloqueante — pasos del propietario

## 1. Lo preparado

Código del Worker y cliente mínimo, pruebas con Graph simulado, tokens cifrados persistentes, renovación serializada, OAuth PKCE y restricción entre alumnos. **No se ha ejecutado OAuth con pgt.bjj@outlook.es ni se ha desplegado Cloudflare.** No continuar desarrollo completo hasta completar esta lista y revisar resultados. La contraseña Microsoft no se necesita en el código.

## 2. Preparar cuenta y registro Microsoft

1. En OneDrive de `pgt.bjj@outlook.es`, crear `PGT` en la raíz. Confirmar espacio libre. El prototipo creará `users_data` y dos carpetas de alumnos, pero no modifica plantilla ni planes.
2. Registrar una aplicación Microsoft Entra compatible con **cuentas Microsoft personales** (solo personales o multitenant más personales). Si la cuenta no puede acceder al registro de aplicaciones, comunicar ese bloqueo; no contratar un plan ni crear otro proveedor por cuenta propia.
3. Guardar el **Application (client) ID**, identificador público. No enviar contraseñas ni secretos por chat.
4. Plataforma de redirección: **Web**, no SPA. Es un OAuth de servidor con intercambio y renovación en Worker. No activar implicit grant ni ROPC. Scopes delegados `Files.ReadWrite`, `User.Read` (verifica que la cuenta autorizada sea del propietario) y `offline_access`.
5. Crear un secreto de cliente con caducidad conocida. Su **valor** se introduce exclusivamente en los secretos del Worker; guardar y programar su renovación por el propietario. No enviarlo ni versionarlo.

## 3. Configurar Cloudflare personalmente

Necesita una cuenta Cloudflare Free y Node 24 en su equipo. Desde el checkout del repositorio:

```sh
npm ci
npx wrangler login
```

El nombre propuesto está en `wrangler.jsonc`: `pgt-bjj-planner-poc`. Puede modificarlo antes de publicar. El binding CONTROL y la migración new_sqlite_classes crean el almacenamiento SQLite gratuito al publicar; no hace falta inventar un ID de KV. No utilizar Durable Objects con backend KV ni activar Paid.

Configurar variables **no secretas** en `vars` de wrangler.jsonc o en configuración Cloudflare, de forma coherente con los siguientes despliegues:

- `MS_CLIENT_ID`: Application (client) ID.
- `OWNER_MAIL`: pgt.bjj@outlook.es.
- `PUBLIC_BASE_URL`: URL exacta del Worker sin barra final, normalmente `https://pgt-bjj-planner-poc.<subdominio>.workers.dev`.
- `ALLOWED_ORIGIN`: esa misma URL para esta prueba, ya que el cliente mínimo lo sirve el Worker. Cuando exista Pages se revisará su origen.

Generar dos secretos aleatorios independientes, sin imprimirlos aquí ni en commits: una clave AES de 32 bytes codificada base64 y una clave administrativa larga. Guardar en gestor privado. Cargar desde su terminal (Wrangler pide el valor sin incluirlo en el comando):

```sh
npx wrangler secret put MS_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put ADMIN_SETUP_KEY
```

Si Wrangler exige crear el Worker antes de cargar secretos, hacer una publicación inicial con los valores públicos configurados. Sin secretos no podrá autorizar ni acceder a Microsoft. Revisar que permanezca en Free. Luego cargar secretos y publicar configuración final:

```sh
npm run deploy:worker
```

Solo lo ejecuta el propietario. Work no lo ejecutará. En Entra añadir ahora la redirect URI **exacta** `https://<URL-del-Worker>/oauth/callback` como Web. Sin placeholders ni barra adicional. Si probase localmente, usar además `http://localhost:8787/oauth/callback` como Web y `.dev.vars` local.

## 4. Autorizar y ejecutar prueba real

1. Abrir la URL del Worker. En el panel de propietario introducir ADMIN_SETUP_KEY; pulsar Autorizar Microsoft. Iniciar sesión exclusivamente como pgt.bjj@outlook.es y consentir. El callback confirma guardado sin mostrar tokens. Volver a la raíz de la URL, sin compartir URL callback.
2. Crear dos perfiles PGT **de prueba** con correos que controle, A y B, contraseñas independientes de prueba. Las cuentas ya existentes no se sobrescriben. No utilice perfiles de negocio existentes.
3. Cerrar/reabrir página para eliminar la clave administrativa en memoria. Entrar como A únicamente con PGT. Crear JSON (revisión 1), leerlo, editar y guardar (revisión 2), leer de nuevo. Cada escritura debe confirmarse y comprobarse en OneDrive. No pulsar guardar dos veces sin releer: se espera conflicto.
4. Introducir correo B en acceso cruzado. Esperado 403. Probar versión antigua. Esperado 412 y contenido de OneDrive intacto. Salir: sesión revocada. Intentar leer sin sesión: 401.
5. En otro navegador/perfil privado, entrar como B: no se solicita Microsoft y no puede leer/escribir A. Repetir con instalación/perfil completamente nuevo de navegador.
6. Propietario: introducir clave administrativa y pulsar Probar renovación. Esperado renovación persistida y acceso Graph. Publicar otra vez **el mismo código/configuración**, o reiniciar el runtime local si está probando localmente; comprobar que sigue funcionando sin reautorizar. Probar dos renovaciones simultáneas y comprobar ausencia de errores por rotación.
7. Repetir lectura y edición en Chrome Android y Safari iOS, con login PGT únicamente. Son pruebas de navegador: la instalación PWA será un gate posterior de la aplicación final, no existe manifest/service worker en este cliente de prueba.
8. Esperar caducidad de access token (normalmente cerca de una hora) sin pulsar renovación manual, repetir lectura y verificar renovación automática. Revocar consentimiento de la aplicación desde la cuenta Microsoft; después forzar renovación. Esperado 503 MICROSOFT_REAUTH_REQUIRED, sin falsear éxito ni sobrescribir datos. Los access tokens pueden conservar validez temporal tras revocar, por eso se fuerza renovación. Reautorizar y comprobar recuperación.
9. Consultar métricas del Worker/DO: errores de cuota, CPU, duración, frecuencia. No subir a Paid para resolver errores: informar resultados. Comprobar que no hay secretos en HTML, respuestas ni logs.
10. Cuentas de prueba contienen `pocOnly: true`, user_data.json y viability.json. Al terminar, eliminar **solo** esas carpetas de pruebas desde OneDrive. No borrar PGT completo. Retirar el prototipo público/clave administrativa antes de sustituirlo por app final.

## 5. Información que devolver a Work (solo no secreta)

- Client ID, URL del Worker y confirmación redirect URI Web.
- Tabla de resultados: autorización, creación, lectura, actualización, conflicto 412, acceso cruzado 403, logout 401, renovación forzada, renovación tras caducidad, persistencia tras publicación, revocación, reautorización, Android y Safari iOS.
- Fechas y códigos HTTP, errores sanitizados, métricas de cuotas/CPU. Nunca token, contraseña, clave administrativa, secreto de cliente ni URL callback con código.

Si cualquiera de estas comprobaciones falla, detener y resolver antes del desarrollo. Los tests con mocks no satisfacen la prueba real. Una limitación de registro Entra, permisos, cuota o CPU es un bloqueo a informar.
