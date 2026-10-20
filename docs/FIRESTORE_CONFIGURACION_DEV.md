# Configuración manual imprescindible — solo DEV

Estos pasos preparan la integración; no significan que ya esté implementada. La fase de auditoría no ha creado recursos, identidades ni claves. No modificar `pgt-bjj-pro`, Worker PRO, secretos de producción ni el repo de datos reales. No activar planes de pago.

## 1. Confirmar Firestore existente

1. Abrir [Firebase pgt-bjj-dev](https://console.firebase.google.com/project/pgt-bjj-dev/firestore) y comprobar el identificador **pgt-bjj-dev** en el selector.
2. En Build → Firestore Database, comprobar si existe base. Necesitamos **Cloud Firestore Standard, modo Native, base `(default)`**. Anotar su ubicación y el plan del proyecto (Spark o Blaze). No borrar/recrear una base existente ni cambiar facturación.
3. Si solo existe el proyecto, pero no la base: Crear base de datos → Standard → `(default)` → modo producción, dentro del nivel gratuito. Como ubicación inicial propuesta, `europe-west1` si está disponible. La ubicación es una decisión persistente: si la consola pide activar facturación o contratar una opción de pago, detenerse y comunicarlo antes de aceptar.
4. No habilitar Firebase Authentication, Realtime Database, Functions, TTL, PITR ni backups de pago. La arquitectura elegida conserva el login PGT.

## 2. Identidad exclusiva del Worker DEV

1. Abrir [Google Cloud → Cuentas de servicio, proyecto DEV](https://console.cloud.google.com/iam-admin/serviceaccounts?project=pgt-bjj-dev). Comprobar otra vez el proyecto.
2. Crear cuenta `pgt-worker-dev` (o comunicar la identidad DEV existente si ya hay una dedicada). Descripción: acceso de runtime Worker PGT DEV a Firestore.
3. Conceder **Cloud Datastore User** (`roles/datastore.user`) **solo en pgt-bjj-dev**. Es el rol predefinido de datos, no Owner, Editor, Firebase Admin ni Datastore Owner. No conceder permisos en otros proyectos, grupos u organización. El Worker no necesita crear bases ni desplegar reglas/índices.
4. En la cuenta → Claves → Agregar clave → Crear clave nueva → JSON. El archivo contiene una clave privada: guardarlo localmente fuera del repo. Verificar localmente `project_id = pgt-bjj-dev` y que `client_email` pertenece a esa cuenta DEV. Si una política de organización impide crear claves, comunicarlo; no desactivar políticas ni usar claves PRO como sustituto.
5. No enviar el archivo ni su contenido al chat. No guardarlo en Git, Library, `.env` versionado ni GitHub Actions. Documentación del mecanismo: [cuentas de servicio y claves](https://cloud.google.com/iam/docs/creating-managing-service-account-keys). Se prevé rotación/revocación antes de cualquier futura operación PRO; esta clave nunca tendrá uso PRO.

## 3. Secreto de Cloudflare DEV

1. Cloudflare → Workers & Pages → **pgt-github-probe-dev** → Settings → Variables and Secrets.
2. Add → tipo **Secret** → nombre **FIRESTORE_SERVICE_ACCOUNT_JSON** → valor: contenido completo del JSON descargado. Guardar solo en ese Worker. No copiar a `pgt-github-probe`.
3. Alternativa desde terminal en el repo (requiere login Cloudflare propio): `npx --no-install wrangler secret put FIRESTORE_SERVICE_ACCOUNT_JSON --config wrangler.dev.jsonc --name pgt-github-probe-dev`. Pegar el JSON en la entrada protegida de Wrangler, nunca como argumento ni en el historial de la shell. Revisar el destino mostrado antes de confirmar.
4. Esta fase no consume todavía ese secreto. La implementación añadirá variables versionadas `FIRESTORE_PROJECT_ID=pgt-bjj-dev` y `FIRESTORE_DATABASE_ID=(default)` únicamente a configuración DEV y una comprobación que rechace identidades/proyectos distintos antes de cualquier petición. No añadir `VITE_*` con credenciales.
5. No eliminar aún GITHUB_DATA_TOKEN: el Worker DEV actual todavía lo utiliza. Se retirará de la ruta operativa DEV al completar/verificar el cambio de backend. No hacer migración alguna del repo compartido.

## 4. Reglas y acceso web

En Firestore DEV → Rules, cuando se confirme que es una base DEV nueva/dedicada sin clientes ajenos, publicar deny-all para clientes directos:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Si la base DEV ya sirve otra aplicación, comunicarlo antes de cambiar sus reglas. La cuenta de servicio OAuth2 usa IAM, omite estas reglas y accede únicamente por el Worker; por eso los permisos de AppApi y sus pruebas siguen siendo obligatorios. No usar reglas de modo test ni `allow true`.

## 5. GitHub y despliegue

El último workflow DEV inspeccionado ya desplegó correctamente. No es necesario crear otro token GitHub ni cambiar producción. Mantener Environment `development`, `DEV_DEPLOY_ENABLED`, `DEV_ACCOUNT_ID` y secretos Cloudflare DEV existentes. No copiar la clave Firebase a secretos de repositorio ni activar despliegue de esta PR borrador.

No configurar un segundo build en Workers Builds/Pages: DEV seguirá publicando desde Actions al integrar una PR a develop con pruebas correctas. Los índices necesarios se definirán en la implementación y se desplegarán solo a DEV mediante procedimiento explícito; no crear índices ahora a ciegas.

## Datos no secretos que confirmar para continuar

Comunicar únicamente: base `(default)` disponible, Standard/Native, ubicación, Spark/Blaze actual, nombre de la cuenta de servicio DEV y que el secreto `FIRESTORE_SERVICE_ACCOUNT_JSON` está cargado en `pgt-github-probe-dev`. Nunca enviar clave, token OAuth ni contraseñas de pruebas.

Después: implementar adaptadores/dominio de persistencia, emulador/integración, migrador sintético, canal WebSocket, caché y rechazo offline; verificar en dos contextos/roles; integrar por PR a develop y ejecutar despliegue DEV. No afirmar tiempo real ni equivalencia end-to-end antes de esas pruebas. Si no puede proporcionarse esta configuración, mantener el punto de parada de la sección 3 del plan técnico.
