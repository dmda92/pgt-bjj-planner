# Integración y despliegue DEV V2 — 26/10/2026

El propietario solicita PR e integración de estos cambios en develop y despliegue DEV.
Esta autorización sustituye la orden anterior de terminar sin desplegar. No incluye PRO.

## Destino comprobado

- Rama de origen existente: fetaure/optimizacionFirestore.
- Base develop inspeccionada: 4bd8145f01a6bad55b4c5f37ae7a8e6b0b7fedf1.
- La feature incorpora ese develop; se conserva la excepción expresa de rama.
- Worker: pgt-github-probe-dev; configuración: wrangler.dev.jsonc.
- Proyecto: pgt-bjj-dev; base: (default).
- Origen: https://pgt-github-probe-dev.david-dzm5.workers.dev.
- GitHub Environment development; guard de cuenta y HEAD del workflow DEV.
- Bindings SECURITY/DOMAIN_IO y migraciones existentes, sin cambios PRO.

## Validación previa

La revisión completa de la PR #25 identificó reformateos del commit previo del
propietario en archivos de PRO. Se excluyen 15 rutas protegidas (entrada y sus
dependencias, configuración y workflow PRO) restaurando el contenido de develop.
Se comprobó equivalencia de compilación TypeScript antes de restaurar: no se
retiran cambios funcionales. El resto del reformateo previo permanece en la rama
solicitada; el diff hacia develop se revisa incluyendo ese antecedente.
También se excluye del índice la carpeta local .idea, incluido el historial del
editor, sin borrar los archivos del equipo; se añade a .gitignore. Se conserva
el contenido de la skill oficial de develop en el commit de integración, sin
alterar su copia local. Integración mediante squash para no incorporar a la
historia de develop los commits previos de metadatos del editor.

324 pruebas completas, tipos, PWA, compilación Worker, tres suites runtime,
navegador V2 y bancos sintéticos correctos en la ejecución documentada en
[VALIDACION_FIRESTORE_V2.md](VALIDACION_FIRESTORE_V2.md). CI vuelve a validar el
commit de PR antes del merge y el commit resultante de develop antes de publicar.

## Límite funcional del despliegue de código

V2 exige pgt_v2/control e importación verificada/activada. Esta entrega no ha
capturado datos GitHub, importado, publicado índices o activado un namespace real.
El endpoint de versión permite verificar el despliegue sin consumir Firestore.
Su éxito NO acredita disponibilidad de login o datos. El acceso a la aplicación
quedará pendiente de la activación segura descrita en
[MIGRACION_GITHUB_FIRESTORE_V2.md](MIGRACION_GITHUB_FIRESTORE_V2.md).

La instancia recuerda el bloqueo por importación no activada/verificada hasta su
reinicio. No repite lecturas del puntero por cada reconexión de clientes antiguos;
los errores transitorios de transporte no se cachean. Regresión workerd: veinte
peticiones antes de activar consumen una lectura de configuración y cero escrituras.

El workflow no debe ejecutar inventarios, bootstrap, carga o QA sobre Google.
La futura importación requiere inventario, cuota fiable, presupuesto compartido
y gate de mantenimiento; no se infiere autorización para omitirlos del deploy.

La URL de PR, SHA de integración, ejecución Actions y resultado efectivo se
registrarán en el informe de cierre de la operación. No afirmar despliegue con
la mera creación de PR o con un job omitido.

## Incidencia de infraestructura CI

El propietario canceló la ejecución 40354773536. Sus logs muestran 12 min 54 s
para descargar dependencias apt desde azure.archive.ubuntu.com (18,5 kB/s);
Chromium se descargó después en segundos. El instalador compartido de CI DEV
usa archive.ubuntu.com con verificación de firmas apt intacta, timeout de red
de 30 segundos y un reintento. Dependencias y navegador tienen límites globales
de 240 y 180 segundos; el paso completo, ocho minutos. No se omiten pruebas ni
se cambia Playwright. Solo se modifica la configuración del runner efímero DEV,
nunca el workflow PRO. Validación local limitada a sintaxis y comprobación del
workflow; la instalación Linux efectiva se valida en Actions.
