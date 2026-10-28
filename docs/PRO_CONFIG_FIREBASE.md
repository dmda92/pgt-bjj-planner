# Configuración manual Firebase PRO

Estado: guía preparada; no se han creado cuentas, concedido IAM, publicado reglas/índices
ni consultado/escrito la base PRO durante esta preparación.

1. Confirmar proyecto **pgt-bjj-pro**, base **(default)**, Firestore Native/Standard y ubicación.
   No usar pgt-bjj-dev. La base se parametriza pero la allowlist de esta entrega solo admite
   `(default)` en ambos proyectos; otra base requiere un cambio revisado, no un payload.
2. Mantener reglas de cliente deny-all. Los navegadores acceden al Worker, no directamente
   a Firestore. El acceso del servidor depende de IAM: deny-all no limita una cuenta de servicio.
3. Crear una cuenta dedicada de runtime `pgt-worker-pro@pgt-bjj-pro.iam.gserviceaccount.com`,
   sin permisos sobre DEV. Necesita lectura/escritura de entidades, consultas y transacciones
   de Firestore; `roles/datastore.user` es el rol predefinido habitual. No Owner/Editor/Admin.
4. Crear un principal separado para la importación, por ejemplo
   `pgt-migration-pro@pgt-bjj-pro.iam.gserviceaccount.com`, con permisos de datos y lectura de
   metadatos necesarios, limitado a PRO. Su clave va exclusivamente al operador local, nunca
   al Worker, al frontend o a Actions. El runtime no recibe la capacidad administrativa de migración.
5. Crear `pgt-validator-pro@pgt-bjj-pro.iam.gserviceaccount.com` con **solo lectura** de datos
   (`roles/datastore.viewer`, o rol personalizado equivalente verificado). No conceder create,
   update, delete o permisos de escritura heredados. Revisar todos sus bindings efectivos.
6. El propietario o una identidad administrativa independiente publica y comprueba las cuatro
   exenciones de `firestore.v2.indexes.json`: collectionGroups aggregates, plans, blocks y operations,
   fieldPath `*`, indexes vacíos. No copiar configuración DEV ni sustituir otros índices sin revisar.
   Usar el proyecto explícito. Registrar evidencia de índices antes de escribir mapas grandes.
   No elevar el runtime para consultar la API de administración de índices.
7. Entregar al operador evidencia reciente de cuotas reales disponibles de lecturas, escrituras
   y borrados, y sus reservas. Los contadores del simulador no son consumo medido. Mantener Free;
   no habilitar facturación para resolver un gate. Dimensionar la verificación profunda y sus reintentos.
8. Antes de la primera escritura, ejecutar comprobaciones autorizadas de destino vacío y metadatos
   con el runner y presupuesto. Sin otros escritores, runtime PRO aún no desplegado y validador
   de solo lectura aún no publicado. Si aparecen documentos ajenos, detener; no borrarlos.

Las claves JSON deben contener `type=service_account`, `project_id=pgt-bjj-pro`, `client_email`
igual al principal configurado y una clave PEM PKCS8. No ponerlas en Markdown o argumentos.
Guardar mediante canal privado; limitar ACL y rotar/revocar la credencial temporal del importador
cuando termine su uso. No eliminar secretos existentes del Worker antes de validar el relevo.

Fuentes oficiales consultadas para roles y separación Rules/IAM:
[IAM Firestore](https://firebase.google.com/docs/firestore/security/iam),
[autenticación REST](https://firebase.google.com/docs/firestore/use-rest-api).
