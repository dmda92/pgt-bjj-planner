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

El workflow no debe ejecutar inventarios, bootstrap, carga o QA sobre Google.
La futura importación requiere inventario, cuota fiable, presupuesto compartido
y gate de mantenimiento; no se infiere autorización para omitirlos del deploy.

La URL de PR, SHA de integración, ejecución Actions y resultado efectivo se
registrarán en el informe de cierre de la operación. No afirmar despliegue con
la mera creación de PR o con un job omitido.
