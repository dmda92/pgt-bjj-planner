# PGT — despliegue manual de la aplicación

Estas acciones las ejecuta exclusivamente el propietario. Work no accede a Cloudflare ni despliega. El nombre, Durable Object SQLite y secretos de la prueba se mantienen. La interfaz estática del Worker pasa a ser la aplicación; los endpoints `/api/admin/*`, `/api/auth/*` y `/api/probe/*` siguen disponibles, aunque no se muestran en la nueva UI.

## 1. Actualizar el checkout en Windows PowerShell

Abrir PowerShell **en la carpeta que contiene package.json y wrangler.jsonc**. Si ya está descargado el repositorio:

```powershell
cd C:\ruta\a\pgt-bjj-planner
git pull --ff-only
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run check:worker
npm.cmd run test:runtime
```

Si todavía no se ha clonado:

```powershell
git clone https://github.com/dmda92/pgt-bjj-planner.git
cd pgt-bjj-planner
npm.cmd ci
```

Continuar con las comprobaciones del bloque anterior, omitiendo cd/git pull cuando corresponda. Si git pull informa de cambios locales (por ejemplo el origen en wrangler.jsonc), conservarlos y resolverlos; no usar reset --hard ni borrar archivos de configuración para forzar la actualización.

## 2. Publicar el Worker y abrir la aplicación por su misma URL

Para la primera comprobación usar la URL del Worker existente. No hace falta cambiar los secretos ni el algoritmo de contraseña. Compilar sin URL externa para que el frontend use la API del mismo origen:

```powershell
Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
npm.cmd run build
npx.cmd wrangler deploy --var "ALLOWED_ORIGIN:https://pgt-github-probe.david-dzm5.workers.dev"
```

Esta es la única orden que despliega; la ejecuta el propietario. Verificar que la cuenta sigue en Free. `wrangler.jsonc` contiene un ALLOWED_ORIGIN de ejemplo; el argumento --var fija el origen correcto en esta publicación. El secreto del token no se pone en esa opción ni en ningún archivo versionado.

Abrir `https://pgt-github-probe.david-dzm5.workers.dev`. La raíz muestra la nueva aplicación PGT. Si hay caché de la versión anterior, recargar; ante futuras actualizaciones usar el aviso de la PWA, sincronizando los cambios pendientes antes.

## 3. Crear el primer entrenador

1. Registrar una **cuenta personal nueva de PGT** desde «Registrarme», con contraseña de 12 a 128 caracteres. No utilizar a@a.es/b@b.es si siguen siendo perfiles probeOnly; no se convierten ni se sobrescriben automáticamente.
2. Cerrar sesión.
3. Abrir «Configuración inicial del propietario» en la pantalla de acceso.
4. Introducir el correo que se acaba de registrar y el valor de **PROBE_ADMIN_KEY** que ya guarda el propietario. No pegarlo en este chat. La UI no lo guarda en IndexedDB/localStorage ni en logs.
5. Pulsar «Crear primer entrenador». Debe confirmar éxito; el bootstrap se bloquea después del primer uso.
6. Iniciar sesión otra vez. Aparece «Entrenador», desde donde se consultan alumnos, comentarios, contraseñas, roles y competiciones.

La plantilla operativa ya existe en el repo privado: `PGT/master_data/tecnics_base.json`, 17 posiciones/36 técnicas. El resto de archivos de negocio se inicializa al registrar alumnos y crear competiciones. Los registros de la prueba y sus JSON no se han modificado en esta entrega.

## 4. Conectar Pages manualmente cuando la UI esté verificada

El propietario configura Pages con el repositorio `dmda92/pgt-bjj-planner`:

- Rama de producción: **main**.
- Directorio raíz: raíz del repositorio.
- Comando de build: **npm run build**.
- Salida: **dist**.
- Node.js: **24**.
- Variable pública `VITE_API_BASE_URL`: `https://pgt-github-probe.david-dzm5.workers.dev`.
- Ningún secreto GitHub/PGT administrativo en variables del build ni en Pages.

Conocer la URL HTTPS de Pages y actualizar el origen permitido del Worker desde PowerShell:

```powershell
npx.cmd wrangler deploy --var "ALLOWED_ORIGIN:https://TU-PROYECTO.pages.dev"
```

Sustituir TU-PROYECTO por el nombre real. Utilizar entonces la URL de Pages como entrada; un solo origen está autorizado y la UI servida por la raíz del Worker deja de ser el origen de uso previsto. Las preview URLs no están habilitadas automáticamente. No ampliar CORS con '*'.

Los cambios en main podrán activar compilaciones automáticas de Pages **solo después de que el propietario configure esa integración**. Publicar Worker sigue siendo un paso separado y manual.

## 5. Diagnóstico y rotación

Para escuchar logs sin que Work acceda a la cuenta:

```powershell
npx.cmd wrangler tail pgt-github-probe --format pretty
```

Reproducir el fallo después de conectar tail. Una respuesta INTERNAL_ERROR incluye diagnosticId, correlacionado con un log seguro; nunca contiene error crudo, stack, hash, correo ni credenciales. Errores GitHub de token/caducidad/permisos/cuota se distinguen. La UI conserva los pendientes al fallar una sincronización.

Rotar el token privado antes de su caducidad, limitándolo a pgt-bjj-data, Contents Read and write:

```powershell
npx.cmd wrangler secret put GITHUB_DATA_TOKEN
```

Introducirlo únicamente en el prompt de Wrangler. El cambio de contraseña de un alumno revoca sus sesiones, preservando todos sus otros campos y documentos.

Pruebas del navegador local (opcionales en el checkout del propietario):

```powershell
npx.cmd playwright install chromium
npm.cmd run test:browser
```

Comprobar la matriz de aceptación de docs/VALIDACION.md tras publicar, particularmente login con cuenta nueva, edición offline, comentario de entrenador, asignación, PDF, conflicto real entre dos dispositivos y eliminación/desasignación.

## Error 100324: redirección circular

La regla `/* /index.html 200` del primer commit de la aplicación fue rechazada por Workers Assets por su interacción con la normalización de index.html. Se ha eliminado public/_redirects: la aplicación actual navega entre secciones mediante estado React y no utiliza rutas de navegador que necesiten un fallback SPA. La raíz se sirve como index.html mediante ASSETS y las rutas /api/* siguen entrando primero al Worker. Ejecutar git pull --ff-only y npm.cmd run build antes de repetir el despliegue; Vite limpia dist y elimina el _redirects antiguo. No modificar secretos ni el binding SQLite.
