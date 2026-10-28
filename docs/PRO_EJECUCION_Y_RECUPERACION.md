# Secuencia de migración, revisión y recuperación PRO

> Actualizaci?n posterior del propietario: las dos correcciones de asignaciones ya se
> aplicaron y verificaron offline. El paquete actual tiene cero bloqueos de conversi?n;
> GitHub y Firestore PRO no se han modificado. Los bloqueos descritos m?s abajo son
> el diagn?stico previo. Ver [resultado vigente](PRO_CORRECCIONES_AUTORIZADAS_2026-10-28.md).


## Puertas pendientes

1. Resolver con decisión expresa las tres inconsistencias del origen fijo documentadas en
   [auditoría](PRO_PREPARACION_2026-10-28.md). No reparar ni generar sesiones automáticamente.
2. Completar cuentas, permisos, índices, cuota observada, presupuesto con ledger y diagnóstico
   de destino; ver guías Firebase/Cloudflare. No afirmar que PRO está vacío sin leerlo.
3. Con un bundle válido, ejecutar `plan --target pgt-bjj-pro` local: incluye staging, activación y
   verificación independiente. Registrar operaciones simuladas, bytes y margen; no son consumo real.
4. Presentar al propietario SHA fijo, inventario, resultado offline, hashes de integridad no sensibles,
   estado de credenciales/índices/cuota, operaciones, riesgos y recuperación. **Esperar autorización
   expresa de primera escritura PRO**. El archivo privado de autorización solo registra esa decisión.

## Ejecución posterior a la autorización, aún no realizada

Reutilizar el runner existente conforme a [MIGRACION_PRO_V2](MIGRACION_PRO_V2.md), con
`--target pgt-bjj-pro` explícito. `stage` escribe solamente el namespace inactivo del checksum.
Verificación profunda independiente antes de marcador verified; luego activación CAS inicial
de `pgt_v2/control`, con proyecto/base/SHA/checksum exactos y autorización vigente.

No detener ni bloquear el Worker GitHub. No reutilizar DEV, sus claves, capturas o usuarios QA.
No hacer una segunda captura ni migración incremental: origen `0a754e2b58a929323946217a3be495944818ce89`.
El runtime Firestore PRO normal permanece sin desplegar y sin escritores durante staging/validación.

## Integridad y validación visual

Ejecutar `verify` con transporte real de solo lectura y presupuesto: comparar profundamente las
fuentes reconstruidas, perfiles/roles/credenciales privadas, catálogo/asignaciones/tombstones,
planes completos/histórico/UUID/orden/Tábata, textos y derivados. Comparar inventarios exactos,
no solo recuentos. No exportar hashes de contraseña a informes públicos. Las transformaciones
legítimas deben estar enumeradas y probadas contra el mismo SHA antes de autorizar la carga.

No publicar la app normal para hacer esta revisión. Tras autorización de despliegue independiente,
usar el validador viewer/Access, verificar ausencia de escrituras y entregar URL real al propietario.
El inspector cubre consultas; no pretende demostrar ediciones normales ni compatibilidad móvil física.
Conservar hashes/comparación final tras la inspección. Esperar revisión y autorización de publicación.

## Release

Integrar preparación en develop por procedimiento autorizado; no push directo. Revisar TODO el
diff develop → main y sus dependencias; esta promoción completa es excepción expresa del propietario
a la regla histórica de promoción selectiva. La autorización de preparar no autoriza merge.
Preparar PR solo en la fase autorizada. Revisar CI, Firestore, bindings/secretos/origen y activar
gate de release solo con autorización. Solicitar autorización específica de merge si dispara deploy.
Supervisar Actions y `/api/runtime`, autenticar de forma controlada, leer datos/roles sin modificar
negocio. No ejecutar registro, guardado, prepare o limpieza de pruebas sobre usuarios reales.

## Fallos parciales y rollback

- **Captura/conversión:** el origen es de lectura y permanece intacto. Conservar paquetes cifrados,
  clave separada y SHA. No sobrescribir evidencias para ocultar diferencias.
- **Antes de activar:** detener nuevas invocaciones, conservar namespace inactivo y ledger. Reanudar
  el mismo bundle/checksum con concesión nueva y presupuesto compartido; CAS/create-only rechazan
  contenido distinto. Respuesta perdida consume reserva; no reembolsar operaciones inciertas.
  No borrar la base ni cambiar al namespace DEV. Un staging parcial no afecta al Worker GitHub.
- **Activación con ACK perdido:** consultar el puntero y verificar dataset exacto; la activación es
  idempotente para ese mismo contenido. Si apunta a otro dataset, detener. No forzar el CAS.
- **Antes del despliegue normal:** GitHub continúa siendo el sistema en servicio. Un fallo del validador
  se resuelve desactivando su ruta/publicación, sin afectar Workers habituales o bases.
- **Después del despliegue, antes de escrituras Firestore:** cualquier vuelta al Worker antiguo requiere
  decisión explícita y comprobación de que no se aceptaron cambios en Firestore. Conservar namespaces,
  sesiones y evidencias; no borrar nada para simular un entorno inicial.
- **Después de aceptar escrituras Firestore:** no volver automáticamente a GitHub: perdería esos cambios.
  Corregir preferiblemente sobre Firestore. Exportar/reconciliar para otra recuperación exigiría encargo
  nuevo; no está autorizado por esta tarea. Ningún rollback del workflow debe ejecutarse a ciegas.

Cerrar desactivando solo el validador temporal cuando el propietario termine; comprobar DEV/PRO
por sus diagnósticos respectivos y revisar que no haya conexiones cruzadas. Conservar GitHub como
histórico y registrar que los commits posteriores al SHA elegido podrían recuperarse en otro encargo.
