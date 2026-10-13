# Configurar la prueba real — solo propietario

El repo dmda92/pgt-bjj-data ya está comprobado como privado y accesible mediante el complemento. **El complemento no proporciona el secreto de ejecución del Worker.** Work ha probado su propio acceso; falta probar el token limitado que configure el propietario. No se necesita Microsoft, OAuth, Client ID, redirect URI ni tarjeta para registrar una aplicación Microsoft.

## 1. Crear token GitHub limitado

En https://github.com/settings/personal-access-tokens/new:

1. Nombre sugerido: PGT Worker datos.
2. Resource owner: dmda92.
3. Expiration: elegir fecha y guardar recordatorio privado de renovación.
4. Repository access: **Only select repositories → pgt-bjj-data**. No seleccionar pgt-bjj-planner ni All repositories.
5. Repository permissions: **Contents → Read and write**. Metadata de lectura se concede automáticamente. Sin Workflows, Actions, administración ni permisos de cuenta.
6. Generate token. Guardarlo en gestor privado y cargarlo como secreto. **Nunca pegarlo en este chat, commit, log ni variable pública.**

El token da acceso a todos los archivos del repo de datos; el aislamiento entre alumnos se impone en la API del Worker. No lo entregue a alumnos.

## 2. Preparar Worker en su equipo

Instalar Node 24 si no está disponible, descargar/clonar pgt-bjj-planner y abrir terminal en su raíz:

```sh
npm ci
npm run build
npx wrangler login
```

Work no ejecutará login ni deploy. Usar cuenta Cloudflare Free, sin activar Paid. Si Cloudflare le exige tarjeta para este uso gratuito, detenerse e informar; no aceptarla por defecto.

El nombre propuesto en wrangler.jsonc es **pgt-github-probe** (nuevo, distinto del antiguo prototipo). Binding SECURITY y migración new_sqlite_classes crean almacenamiento SQLite compatible con Free al publicar. No necesita crear KV ni aportar su ID. DATA_BRANCH permanece main. Si el repo de datos estuviera vacío sin rama, la primera creación por Contents inicializa main; la prueba del complemento ya ha inicializado esa rama.

Desde el dashboard puede conocer el subdominio workers.dev de su cuenta. La URL será normalmente `https://pgt-github-probe.<subdominio>.workers.dev`. Ajustar **ALLOWED_ORIGIN en vars** a esa URL exacta, sin barra final. El cliente técnico y API se sirven desde la misma URL; no necesita Pages todavía.

Crear una clave PROBE_ADMIN_KEY aleatoria de al menos 32 caracteres; independiente del token GitHub. Guardarla en gestor privado. Solo se utiliza para comprobar el repo y crear usuarios de prueba, no para autorizar alumnos.

Cargar secretos (los comandos preguntan el valor; no ponerlo en la línea de comandos):

```sh
npx wrangler secret put GITHUB_DATA_TOKEN
npx wrangler secret put PROBE_ADMIN_KEY
```

Si Wrangler exige crear primero el Worker, aceptar crear exclusivamente pgt-github-probe en Free, o hacer publicación inicial sin secretos y cargarlos después. Sin los secretos el API rechaza acceso. Publicar versión final:

```sh
npm run build
npm run deploy:worker
```

Ambos comandos los ejecuta el propietario. No hay OAuth ni autorización interactiva GitHub de alumnos. No enviar el token a Work.

## 3. Ejecutar prueba

1. Abrir la URL del Worker. Introducir PROBE_ADMIN_KEY y pulsar Comprobar acceso: debe confirmar repositorio privado y acceso de lectura.
2. Crear dos usuarios de prueba A/B, con correos que controle y contraseñas de prueba de 12–128 caracteres. No usar cuentas de negocio existentes: si existen, la prueba rechaza sustituirlas. Las cuentas contienen probeOnly: true.
3. Entrar como A únicamente con correo/contraseña PGT. Se limpia la clave administrativa de la pantalla al entrar.
4. Escribir texto y pulsar Crear/guardar. Debe devolver WRITE_CONFIRMED con SHA, revisión 1 y estar en `PGT/users_data/<A>/viability.json` del repo privado. Leerlo, cambiar texto y guardar: SHA y revisión deben cambiar. Guardar el mismo texto debe devolver UNCHANGED_NO_COMMIT.
5. Pulsar Verificar conflicto de SHA antiguo: esperado 409; confirmar que el texto remoto sigue intacto. Esta prueba de UI detecta el conflicto antes de sobrescribir; los tests del adaptador y prueba real del complemento verifican también rechazo del SHA en GitHub.
6. Introducir correo B y pulsar Verificar rechazo de acceso cruzado: esperado 403, sin acceder a datos B. Intentar operaciones con sesión inexistente/caducada debe dar 401. Salir revoca inmediatamente la sesión en el servidor.
7. Abrir otra ventana privada o dispositivo, entrar como B: nunca debe solicitar login GitHub/Microsoft. A y B deben crear y leer JSON distintos. Repetir en escritorio, Chrome Android y Safari iOS.
8. Publicar de nuevo el mismo Worker y comprobar que la sesión activa sigue siendo válida dentro de las 12 horas. Tokens PGT están solo en memoria del cliente: al recargar esta prueba deberá entrar otra vez; la app final tendrá persistencia de sesión.
9. Comprobar cuotas y CPU en métricas sin activar Paid. Si PBKDF2 o tráfico supera el plan gratuito, informar antes de continuar.
10. Probar token incorrecto/revocado: revocar el token de esta prueba en GitHub y repetir lectura/check; esperado error remoto, sin éxito ficticio. Crear otro token con mismo alcance y cargarlo con wrangler secret put GITHUB_DATA_TOKEN. Recuperar lectura sin cambiar perfiles ni JSON. Para comprobar permisos insuficientes puede usar temporalmente token limitado al mismo repo con Contents solo Read; el check puede funcionar, pero una escritura debe fallar. Reponer Read and write. No compartir valores.
11. Borrar JSON de prueba desde su sesión: requiere SHA actual y confirma DELETE_CONFIRMED. Limpiar manualmente **solo las carpetas A/B de prueba** del repo privado al acabar. La prueba auxiliar del complemento bajo PGT/_viability/ ya se ha borrado. Los commits de pruebas permanecen en historial Git; no incluyen datos personales.

Para probar un SHA antiguo que alcance GitHub sin el control previo de API, usar el adaptador desde un entorno privado local con el token; no exponer un endpoint genérico ni una ruta de bypass. El conflicto real ya fue verificado mediante el complemento, pero eso no prueba el token del Worker.

## 4. Devolver a Work (sin secretos)

- URL pública del Worker y confirmación de ALLOWED_ORIGIN exacto.
- Resultados HTTP de check, altas de prueba, login, lectura, escritura, no-op, conflicto, acceso cruzado, logout, borrado, token revocado y recuperación con token rotado.
- Resultados escritorio/Android/iOS; errores y métricas sanitizados.

No devolver token, contraseñas, PROBE_ADMIN_KEY ni cabeceras Authorization. La viabilidad sigue pendiente hasta revisar las pruebas reales del Worker. Una conexión del complemento y tests con mocks no sustituyen esa validación.
