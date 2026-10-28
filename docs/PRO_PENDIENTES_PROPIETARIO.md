# Qué debe configurar el propietario y cuándo

> Actualizaci?n posterior del propietario: las dos correcciones de asignaciones ya se
> aplicaron y verificaron offline. El paquete actual tiene cero bloqueos de conversi?n;
> GitHub y Firestore PRO no se han modificado. Los bloqueos descritos m?s abajo son
> el diagn?stico previo. Ver [resultado vigente](PRO_CORRECCIONES_AUTORIZADAS_2026-10-28.md).


## Decision de datos resuelta

El propietario ya autorizo y se aplicaron offline la desasignacion del participante sin
plan y la reconstruccion de la referencia del otro participante. El paquete actual tiene
cero bloqueos y conserva los 14 planes. Ver
[resultado y presupuesto](PRO_CORRECCIONES_AUTORIZADAS_2026-10-28.md).

Las tres claves se encuentran, segun el propietario, en
`C:/Users/Usuario/AppData/Local/PGT/credentials-pro`. Todavia no se han usado para
conectar con Firestore PRO ni instalado en Workers por esta tarea.

## Firebase: antes de autorizar la carga

1. Confirmar `pgt-bjj-pro / (default)`, Native/Standard y reglas de cliente deny-all.
2. Preparar tres cuentas separadas, sin acceso a DEV:
   - `pgt-migration-pro@pgt-bjj-pro.iam.gserviceaccount.com`: importador local, datos read/write.
   - `pgt-worker-pro@pgt-bjj-pro.iam.gserviceaccount.com`: futuro runtime, datos read/write.
   - `pgt-validator-pro@pgt-bjj-pro.iam.gserviceaccount.com`: datos **solo lectura**, sin roles heredados de escritura.
3. Guardar sus JSON por canal privado fuera de Git. La del importador se referencia desde
   `operator.json`; las otras se instalarán en sus Workers únicamente en la fase autorizada.
   No introducir todavía secretos en el Worker PRO actual ni reutilizar los de DEV.
4. Publicar/revisar las exenciones de `firestore.v2.indexes.json` para los cuatro grupos indicados
   en [PRO_CONFIG_FIREBASE](PRO_CONFIG_FIREBASE.md). La identidad del runtime no administra índices.
5. La cuota disponible debe observarse **cuando se vaya a ejecutar**, no ahora con horas de
   antelación: la concesión exige evidencia de menos de cinco minutos. El operador comprobará
   metadatos, índices y ausencia de datos ajenos antes de escribir. El plan corregido propone 1.835 lecturas y 375 escrituras de presupuesto,
   con cero borrados; no equivale a cuota disponible observada.

## Cloudflare temporal: después de migrar y verificar

Preparar aplicación Access con allowlist/MFA, audience/issuer y dominio exclusivo para
`pgt-firestore-pro-validation`. Cuenta viewer propia; sin DO. Configurar los pins exactos
de SHA/checksum/namespace y el correo de un entrenador existente. El despliegue del validador
requiere autorización separada. No hay todavía URL real ni deben crearse usuarios para probarlo.
Ver [procedimiento completo](PRO_VALIDATION.md).

## Cloudflare PRO y Actions: solamente antes del release autorizado

- Secreto `FIRESTORE_SERVICE_ACCOUNT_JSON` del runtime PRO.
- Variables `FIRESTORE_ENVIRONMENT=pro`, `FIRESTORE_PROJECT_ID=pgt-bjj-pro`,
  `FIRESTORE_DATABASE_ID=(default)`, `FIRESTORE_SERVICE_ACCOUNT_EMAIL` y `ALLOWED_ORIGINS`
  según [PRO_CONFIG_CLOUDFLARE](PRO_CONFIG_CLOUDFLARE.md).
- Confirmar cuenta, bindings y migraciones reales. Wrangler preparará los DO nuevos durante
  el despliegue autorizado; no borrar ni renombrar el namespace antiguo manualmente.
- Mantener secretos GitHub antiguos hasta completar comprobación del relevo.
- Revisar `CLOUDFLARE_DEPLOY_ENABLED` y dejar `FIRESTORE_PRO_READY` sin habilitar hasta
  aprobación del informe de migración/validación y permiso de publicación. El workflow nuevo
  aún no está publicado y ninguna de estas variables se ha cambiado en remoto.

El propietario autoriza primero la migración real, luego el validador, y finalmente publicación
y merge si dispara deploy. Los cambios posteriores al SHA elegido quedan excluidos por su decisión.
