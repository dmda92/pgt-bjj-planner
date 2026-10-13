# PGT — Especificación funcional y técnica para implementación

**Versión:** 1.0 · **Estado:** listo para prototipo técnico y desarrollo, sujeto a validación del acceso OneDrive.

## 0. Encargo para ChatGPT Work

Construir, probar y preparar el despliegue de una aplicación PWA de planificación de competición de jiu-jitsu. Implementar exactamente los requisitos de este documento. No inventar posiciones ni técnicas: utilizar el JSON oficial del proyecto `posiciones a trabajar mínimos.json` como origen de `master_data/tecnics_base.json`. Solicitar acceso a dicho fichero si no está disponible. Preparar el código para el repositorio GitHub `dmda92/pgt-bjj-planner`, README.md y AGENTS.md. Guardar una copia íntegra de este documento de requisitos en `docs/REQUISITOS_PGT_APP.md` dentro del repositorio y referenciarla expresamente desde `AGENTS.md` como especificación inicial del proyecto. Con autorización del propietario y acceso a GitHub, subir el código probado a la rama `main`. NO acceder a Cloudflare, NO crear ni configurar un proyecto Cloudflare y NO realizar el despliegue: el propietario conectará GitHub con Cloudflare Pages manualmente. Validar primero una prueba de concepto real de acceso a la única cuenta OneDrive del propietario a través de un Cloudflare Worker mínimo con Microsoft Graph y OAuth, sin inicio de sesión Microsoft de los alumnos. El propietario autorizará Microsoft inicialmente y configurará Cloudflare; Work preparará código e instrucciones, sin desplegar ni acceder a la cuenta Cloudflare.

**Datos por completar por el propietario:**

- Cuenta/organización GitHub: `dmda92`

- Nombre del repositorio GitHub: `pgt-bjj-planner`

- Cuenta Microsoft/OneDrive del propietario: `pgt.bjj@outlook.es`
- Carpeta raíz de datos de la aplicación en OneDrive: `PGT/` (dentro de esta carpeta se crearán `master_data/` y `users_data/`).

- Autorización Microsoft OAuth para el Worker: `[PENDIENTE DE PRUEBA DE CONCEPTO Y CONSENTIMIENTO DEL PROPIETARIO]`. Nunca introducir la contraseña de Microsoft en el código ni en este documento.
- Cloudflare Worker (nombre, URL, identificadores, KV y secretos): `[POR CONFIGURAR POR EL PROPIETARIO CON LAS INSTRUCCIONES DE WORK]`. No se exige conocerlos antes del desarrollo.

- Identificador de aplicación Microsoft Entra (Client ID) y configuración OAuth: `[PENDIENTE DE REGISTRO/VALIDACIÓN]`; registrar una aplicación compatible con cuentas Microsoft personales si la prueba lo requiere.

### 0.1 Acceso de ChatGPT Work a GitHub

- Antes de intentar subir código, Work debe comprobar que dispone de una conexión autorizada con GitHub y permisos de escritura sobre `dmda92/pgt-bjj-planner`. Conocer el usuario y el nombre del repositorio no concede acceso.

- Si falta la conexión o los permisos necesarios, solicitar al propietario que autorice la integración disponible. No solicitar ni incorporar contraseñas ni tokens personales de GitHub al Markdown, al código ni al repositorio.

- Subir a `main` únicamente con autorización del propietario, tras las pruebas y verificaciones previstas. Confirmar el resultado comprobando que los commits y archivos aparecen efectivamente en el repositorio; no afirmar que se ha publicado código sin verificarlo.

- Si la integración disponible solo permite lectura o no permite subir cambios, informar claramente del bloqueo y preparar una entrega alternativa completa del código para que el propietario pueda subirla, sin fingir que el repositorio ha sido actualizado.

- Esta autorización de GitHub es independiente de la conexión GitHub–Cloudflare que configurará el propietario. Work no debe acceder a Cloudflare ni desplegar allí.

## 1. Objetivos y restricciones

- Una aplicación para Android, iPhone y navegadores de escritorio, con instalación opcional como PWA.

- Alumno: mantener colección personal de posiciones y técnicas favoritas, descripciones y planes de competición.

- Entrenador: consultar alumnos, comentar técnicas, crear competiciones y asignar alumnos.

- Coste objetivo obligatorio de 0 €: sin dominio de pago, IP fija, servidor propio ni servicios de pago. Usar Cloudflare Pages, un Cloudflare Worker mínimo y almacenamiento auxiliar de secretos/estado dentro de cuotas gratuitas, más OneDrive gratuito. Work debe comprobar límites y compatibilidad de cuotas antes de continuar; no activar planes de pago sin permiso. Advertir sobre límites y cambios futuros.

- PWA estática offline-first con IndexedDB local y sincronización bidireccional por JSON en OneDrive, pasando por un Cloudflare Worker para autorización y operaciones remotas. No utilizar OneDrive como base de datos de consulta interactiva.

- Arquitectura simple, SOLID aplicado pragmáticamente, TypeScript, alta cobertura de tests, código mantenible.

- Proveedor cloud intercambiable mediante interfaz (OneDrive como primera implementación).

- La misma PWA sirve ambos roles, mostrando permisos y pantallas correspondientes.

## 2. Arquitectura

- Frontend: React + TypeScript + Vite (propuesta de implementación); PWA con manifest y service worker.

- Persistencia local: IndexedDB mediante Dexie.js (propuesta). Persistir datos de negocio, versiones y cola de cambios pendientes.

- Distribución prevista: Cloudflare Pages para frontend estático HTTPS y Cloudflare Worker para API de autenticación/autorización y OneDrive. Work implementará y probará localmente ambos componentes, con instrucciones de configuración; el propietario configurará y desplegará Pages y Worker desde su cuenta Cloudflare. Work no necesita credenciales ni URL real de Cloudflare para desarrollar.

- Entrega preparada para despliegue: `package.json` con `npm run build` operativo, salida estática en `dist`, configuración SPA para navegación por rutas si se utiliza, manifest y service worker PWA. Implementar detección de nueva versión y aviso de actualización sin descartar cambios locales pendientes ni provocar pérdida de datos.

- GitHub es el origen del despliegue: Work debe entregar código y pruebas en el repositorio indicado cuando esté autorizado. Tras la configuración manual inicial del propietario, Cloudflare Pages publicará nuevas compilaciones automáticamente al recibir cambios en `main`. No depender de un despliegue previo para poder desarrollar o probar localmente.

- Nube: una sola cuenta personal de OneDrive del propietario, con todos los JSON dentro de `PGT/`. La PWA llamará al Worker; solo el Worker se comunicará con Microsoft Graph mediante OAuth delegado autorizado por el propietario. Validar el flujo real con cuenta Microsoft personal y renovación de acceso. La lógica de dominio no dependerá de la API concreta.

- Capas: domain (modelos, reglas, generador puro); application (casos de uso); infrastructure (IndexedDB, cliente API PGT, Worker, Microsoft Graph y autenticación); ui (pantallas).

- Interfaces mínimas: `LocalRepository`, `CloudStorageProvider`, `AuthenticationProvider`, `SyncService`. Implementar adaptador de API Worker sin exponer credenciales Graph al navegador.

- Funcionamiento offline: consultar y editar datos cacheados sin red; las operaciones remotas quedan pendientes y se reintentan.

### 2.1 Decisión obligatoria: una sola cuenta OneDrive y Cloudflare Worker mínimo

- **Decisión expresa del propietario:** todos los JSON estarán en UNA sola cuenta personal gratuita de OneDrive, perteneciente al propietario. Ningún alumno necesita cuenta, contraseña ni consentimiento de Microsoft. Cada alumno entra exclusivamente con credenciales PGT. Se autoriza exclusivamente un Cloudflare Worker mínimo como intermediario entre la PWA y OneDrive para autenticar usuarios PGT, comprobar permisos y acceder a Microsoft Graph. No añadir otros servidores ni proveedores sin permiso. Priorizar simplicidad y coste cero.

- **Seguridad de credenciales:** el Worker guardará los tokens de Microsoft fuera del navegador y del repositorio, mediante secretos y almacenamiento persistente protegido apropiado. Nunca enviar tokens Microsoft a los alumnos ni incluirlos en el bundle, repositorio, logs o Markdown. El Worker debe verificar la identidad y rol PGT y restringir por servidor las rutas/operaciones a los archivos autorizados dentro de `PGT/`; no confiar en controles de interfaz ni aceptar rutas arbitrarias del cliente.

- **OAuth:** el propietario inicia sesión y consiente la autorización Microsoft solo durante la configuración inicial (y cuando Microsoft exija reautorización). El Worker utiliza OAuth delegado y renueva tokens según las políticas de Microsoft. No usar usuario/contraseña embebidos, client secret en frontend ni asumir que la autorización es indefinida. Validar soporte de cuentas Microsoft personales, scopes mínimos y revocación.

- **Prueba bloqueante antes del desarrollo:** construir un Worker y cliente mínimos que prueben autorización inicial del propietario, lectura, creación, actualización y sincronización de un JSON bajo `PGT/` mediante Microsoft Graph; renovación de token y respuesta a revocación/caducidad; inicio de sesión PGT de prueba y rechazo de acceso cruzado entre alumnos. Verificar escritorio, Android e iOS sin login Microsoft del alumno. Si falla, documentar el bloqueo y detenerse para consultar al propietario: NO sustituir OneDrive ni exigir cuentas Microsoft a alumnos unilateralmente.

- **Credenciales y configuración:** Work solicitará al propietario solo identificadores públicos, permisos y acciones de configuración cuando sean necesarios. Client ID y URL pública del Worker pueden figurar en configuración; tokens OAuth, secretos de sesión y credenciales no se escribirán en el documento ni se versionarán. Entregar `.env.example`/ejemplos de configuración sin valores reales y pasos de carga de secretos en Cloudflare.

- **Login PGT:** las contraseñas de alumnos se guardan como hash con sal (Argon2id o alternativa robusta compatible), nunca cifrado reversible. El Worker valida las credenciales y expide sesiones PGT protegidas; verifica autorización en cada operación. La PWA no recibe acceso general a OneDrive. Proteger altas, recuperación, cambios de rol, restablecimiento de contraseña y sesiones contra acceso no autorizado; diseñar un procedimiento seguro de alta del primer entrenador.

### 2.2 Worker, autorización y configuración a cargo del propietario

- El Worker es la única API remota de la PWA. Aplicar autenticación PGT del lado servidor, control de acceso por alumno/entrenador, validación estricta de operaciones y rutas, límites de tamaño y frecuencia, CORS limitado al origen de la PWA, protección CSRF si se usan cookies y gestión segura de sesiones. No implementar endpoints genéricos que expongan Graph o el token de Microsoft.
- OAuth Microsoft: registrar/validar aplicación que admita cuentas Microsoft personales; usar flujo de código de autorización y PKCE cuando proceda, scopes delegados mínimos para los archivos de `PGT/` y consentimiento interactivo del propietario. No utilizar client credentials como sustituto del consentimiento de una cuenta personal. Documentar URI de redirección exacta una vez exista la URL del Worker.
- Tokens Microsoft: almacenar refresh token y metadatos de forma persistente y protegida mediante mecanismos compatibles con Workers, nunca solo en variables de entorno efímeras si el token rota. Diseñar actualización atómica, cifrado en reposo cuando corresponda, recuperación ante rotación concurrente y procedimiento de reautorización por el propietario. Las claves de cifrado y firma deben ser secretos de Cloudflare, no variables públicas de Vite.
- Persistencia auxiliar: utilizar KV, Durable Objects u otro servicio gratuito compatible únicamente si resulta necesario para tokens, sesiones o coordinación; verificar consistencia, límites y cuotas antes de elegir. OneDrive continúa siendo la fuente de verdad de los JSON de negocio; no introducir una segunda base de datos de negocio sin autorización.
- Registro abierto: el Worker debe evitar que un usuario se asigne el rol de entrenador o restablezca contraseñas ajenas. Definir un procedimiento controlado para crear el primer entrenador y para gestionar sesiones revocadas. No confiar en el campo `perfil` recibido del navegador.
- Preparar configuración del Worker versionable sin secretos (`wrangler.jsonc` o equivalente), scripts de desarrollo/prueba y despliegue documentados. El propietario creará/configurará la cuenta/proyecto Cloudflare, bindings, almacenamiento, variables secretas y dominio o URL del Worker; Work no accederá a Cloudflare. El frontend recibirá únicamente la URL pública de la API mediante variable de compilación, por ejemplo `VITE_API_BASE_URL`.
- No exigir al propietario un nombre de Worker, URL, identificador de KV, Client ID o redirect URI antes de iniciar el desarrollo. Work debe indicar exactamente cuándo y cómo obtenerlos; el propietario los facilitará tras configurarlos. Para pruebas previas al despliegue usar simuladores locales y, cuando sea indispensable, pedir al propietario que ejecute la autorización/prueba remota y aporte resultados no secretos.
- Antes de considerar viable la arquitectura, probar OAuth real con la cuenta personal, renovación persistente y operaciones Graph, además de la autenticación/autorización PGT. Si la validación remota requiere configuración que solo puede hacer el propietario, detenerse en ese punto y pedirla; no dar por superada la prueba con mocks.

## 3. Estructura de archivos en OneDrive

Todas las rutas de esta sección son relativas a la carpeta `PGT/` situada en la raíz del OneDrive de `pgt.bjj@outlook.es`. La PWA no debe crear ni buscar estos JSON fuera de `PGT/`.

```text
PGT/
  master_data/
    tecnics_base.json
    plans.json
  users_data/
    <mail>/
      user_data.json
      tecnics.json
      trainer_comments.json
      plans_index.json
      training_plans/
        plan_<planId>.json
```

- `<mail>` es el correo normalizado en minúsculas y no se puede modificar después del alta; validar caracteres y evitar rutas ambiguas.

- `master_data/tecnics_base.json`: copia de la fuente oficial con `descripcion_del_alumno` vacía; comentarios del entrenador fuera del fichero. Se consulta solo para el alta, no se sincroniza de forma continua. Al crear el `tecnics.json` de cada alumno se generan UUID nuevos para todas sus posiciones y técnicas; no se copian identificadores de la plantilla ni de otros alumnos.

- `master_data/plans.json`: catálogo global de competiciones y asignaciones, gestionado exclusivamente por entrenador.

- `users_data/<mail>/user_data.json`: datos de perfil del alumno.

- `users_data/<mail>/tecnics.json`: posiciones y técnicas personales; editable por alumno.

- `users_data/<mail>/trainer_comments.json`: comentarios del entrenador asociados a GUID de técnica; edición del entrenador.

- `users_data/<mail>/plans_index.json`: lista de GUID de planes asignados al alumno, mantenida por acciones del entrenador. Una baja de asignación elimina la referencia, pero **no borra el plan local ya recibido**.

- `users_data/<mail>/training_plans/plan_<planId>.json`: instantánea individual del plan generado, editable manualmente por el alumno después de su creación.

- No crear `users_data/<mail>/master_training_plans/plans.json`: ruta eliminada.

- Incluir `schemaVersion`, `revision`, `updatedAt` en los archivos sincronizados y conservar metadatos de versión remota (`eTag` u homólogo) en IndexedDB.

## 4. Modelos de datos y validaciones

### 4.1 Perfil `user_data.json`

```json
{
  "schemaVersion": 1,
  "mail": "alumno@ejemplo.com",
  "nombre": "",
  "apellidos": "",
  "fecha_nacimiento": "1992-08-24",
  "peso": null,
  "cinturon": "Blanco",
  "perfil": "alumno",
  "pwd": "<hash_con_sal>",
  "revision": 1,
  "updatedAt": "2026-10-13T00:00:00Z"
}
```

- `mail` es login, identificador de carpeta, único e inmutable; no hay `userId` independiente.

- `fecha_nacimiento`: ISO `YYYY-MM-DD`; fechas y horas de modificación UTC ISO 8601.

- `cinturon`: Blanco, Azul, Morado, Marrón o Negro.

- `perfil`: alumno (por defecto) o entrenador. Solo entrenador puede cambiarlo desde la UI; primer entrenador: registro normal y edición manual inicial de JSON por propietario.

- `pwd`: hash de contraseña con sal, verificable sin descifrar. No mostrarlo ni permitir editarlo directamente; ofrecer cambio de contraseña mediante formulario.

- Recuperación: enlace «¿Olvidó su contraseña?» muestra «Contacte con el administrador». No se envían correos automáticos. El entrenador, como administrador, puede restablecer manualmente la contraseña de un alumno desde su perfil.

### 4.2 Posiciones y técnicas `tecnics.json`

```json
[
  {
    "id": "<uuid-posicion>",
    "posicion": "Guardia cerrada (guardiero)",
    "prioridad": 1,
    "tecnicas": [
      {
        "id": "<uuid-tecnica>",
        "tipo": "Sumision",
        "descripcion_del_alumno": ""
      }
    ]
  }
]
```

- Cada posición y técnica tiene UUID estable y exclusivo de ese alumno, generado al copiar la plantilla durante su alta; ningún UUID se reutiliza entre alumnos. Las nuevas posiciones y técnicas reciben también UUID nuevos. No existe campo `order`.

- **El orden de las posiciones y técnicas es exactamente el orden de sus arrays**, no el UUID. Permitir reordenación explícita en UI si se necesita; mantener el orden al sincronizar.

- Alumno puede añadir, borrar y editar posiciones/técnicas, descripción y prioridad. Prioridad entera positiva; preservar los nombres y tipos originales al importar el JSON oficial, sin normalizarlos ni inventar contenido.

- Al borrar técnica o posición, eliminar comentarios relacionados de la colección activa, pero **no alterar los planes ya generados**.

- Si una posición no tiene técnicas, no se puede incluir como posición entrenable.

### 4.3 Comentarios `trainer_comments.json`

```json
{
  "schemaVersion": 1,
  "comments": [
    {"techniqueId": "<uuid-tecnica>", "comment": ""}
  ],
  "revision": 1,
  "updatedAt": "2026-10-13T00:00:00Z"
}
```

- Solo entrenador crea/modifica comentarios. El alumno puede leerlos.

- Asociar mediante GUID de técnica. Al borrar una técnica, eliminar comentario en nube/local en la próxima sincronización, sin resucitarlo desde una copia antigua.

### 4.4 Catálogo global `master_data/plans.json`

```json
[
  {
    "planId": "<uuid-plan>",
    "fecha_comienzo": "2026-10-08",
    "fecha_torneo": "2026-12-13",
    "alumnos": ["alumno@ejemplo.com"],
    "dias_de_entrenamiento": [2, 4],
    "ejercicios_por_sesion": 5,
    "tiempo_por_tecnica_segundos": 180,
    "descanso_entre_ciclos_segundos": 10,
    "descanso_entre_tecnicas_segundos": 20
  }
]
```

- Días ISO: 1=lunes … 7=domingo. GUID del plan se genera una vez al crearlo. `ejercicios_por_sesion` es un entero positivo obligatorio, introducido por el entrenador al crear el plan; el formulario propone 5 por defecto. `tiempo_por_tecnica_segundos`, `descanso_entre_ciclos_segundos` y `descanso_entre_tecnicas_segundos` son enteros en segundos, configurables por el entrenador al crear el plan (180, 10 y 20 por defecto, respectivamente). El tiempo de trabajo debe ser mayor que cero; ambos descansos pueden ser cero. El descanso entre ciclos es exclusivamente el cambio de roles entre los dos alumnos para la MISMA técnica; el descanso entre técnicas se aplica exclusivamente al pasar a un ejercicio distinto.

- Solo entrenador crea competiciones y añade o quita alumnos. No puede cambiar fechas, días, `ejercicios_por_sesion`, `tiempo_por_tecnica_segundos`, `descanso_entre_ciclos_segundos` ni `descanso_entre_tecnicas_segundos` después de crear el plan.

- Al eliminar una asignación, desaparece del índice del alumno, pero no se elimina su plan ya recibido por ese motivo.

- **Borrado explícito de un plan entero:** borrar el catálogo, las referencias y los archivos individuales relacionados, distinguiéndolo de quitar un alumno.

### 4.5 Índice `plans_index.json`

```json
{"schemaVersion": 1, "planIds": ["<uuid-plan>"], "revision": 1, "updatedAt": "2026-10-13T00:00:00Z"}
```

- Mantenido por entrenador; descargado por alumno. Nuevos IDs activan la generación individual al sincronizar.

- La asignación a un alumno ya registrado debe ser detectable aunque el alumno haya estado offline.

### 4.6 Plan individual `plan_<planId>.json`

- Guardar `planId`, correo, fecha de inicio, fecha de torneo, días, `ejercicios_por_sesion`, `tiempo_por_tecnica_segundos`, `descanso_entre_ciclos_segundos`, `descanso_entre_tecnicas_segundos`, fecha de generación, versión y lista de sesiones.

- Cada sesión contiene fecha, técnicas ordenadas y **snapshot** de `positionId`, `techniqueId`, nombre completo de posición con rol, prioridad, tipo, descripción del alumno y comentario del entrenador en el momento de generación.

- Se generan una única vez al recibir una nueva asignación. Después **nunca se regeneran automáticamente**, aunque cambien técnicas o comentarios; el alumno puede modificar manualmente su plan.

- Guardar edición manual sin recalcular automáticamente el resto de sesiones.

- Al quitar al alumno de la asignación, el plan individual existente permanece localmente visible.

## 5. Autenticación y perfiles

- Pantalla de login inicial si no hay sesión; correo y contraseña; persistencia de sesión hasta cierre manual.

- Registro abierto a cualquier persona: crear perfil alumno, carpeta y JSON inicial de técnicas a partir de la plantilla, generando UUID nuevos para todas sus posiciones y técnicas sin reutilizarlos entre alumnos, índice vacío, comentarios vacíos y carpeta de planes.

- El Worker valida el perfil y hash, crea una sesión PGT segura y comprueba permisos por petición; los alumnos no pueden leer ni escribir archivos de otros usuarios, aunque conozcan sus rutas. Añadir pruebas negativas de acceso cruzado y de escalada de privilegios.

- Cambio de contraseña desde el perfil del usuario autenticado: introducir nueva contraseña y repetirla; validar coincidencia antes de guardar. El alumno puede elegir libremente su nueva contraseña. Correo inmutable.

- El entrenador actúa como administrador y dispone en su perfil de una función «Restablecer contraseña de alumno»: introducir el correo del alumno, la nueva contraseña y su confirmación. Validar que el correo corresponde a un alumno existente y que ambas contraseñas coinciden; mostrar errores claros sin modificar datos si falla la validación.

- Al confirmar el restablecimiento, calcular un nuevo hash con sal y actualizar exclusivamente el campo `pwd` de `users_data/<mail>/user_data.json` del alumno mediante escritura condicional con control de versión. No modificar sus técnicas, comentarios, planes ni otros datos de perfil. No mostrar ni registrar la contraseña en texto claro.

- El restablecimiento administrativo requiere conexión y confirmación de escritura en OneDrive antes de informar de éxito. El Worker debe invalidar o revocar las sesiones PGT afectadas al cambiar/restablecer contraseña y documentar el mecanismo de revocación.

- Entrenador ve usuarios, técnicas, comentarios y planes; alumno solo ve su información desde la UI. La restricción de UI no equivale a seguridad de acceso a archivos.

- Primer entrenador: procedimiento inicial controlado por el propietario y verificado por el Worker (por ejemplo bootstrap administrativo de un solo uso); nunca permitir elevarse a entrenador desde el registro público.

## 6. Sincronización

- Al abrir la PWA con sesión activa, al recuperar conexión y con botón accesible desde cualquier pantalla.

- Offline-first: cada edición se persiste localmente inmediatamente y se marca pendiente.

- Detectar cambios mediante dirty flags, revisiones, hashes/etags y, cuando esté disponible, API delta de Microsoft Graph; no descargar ni subir todos los JSON si no han cambiado.

- La operación de sincronización procesa **todos** los pendientes necesarios; no mostrar «Sincronizado» si queda alguno sin confirmar. Si falla un archivo, conservar pendientes y permitir reintentar de forma idempotente.

- Para escrituras, utilizar precondiciones de versión (por ejemplo `If-Match`) y tratar conflictos 412. Nunca sobrescribir silenciosamente cambios remotos.

- Multidispositivo offline: descargar y fusionar cuando los cambios afecten campos/entidades diferentes; cuando ambas copias editen el mismo dato, presentar conflicto al usuario para escoger versión o conservar ambas. No elegir automáticamente «último en escribir» para conflictos reales.

- Borrados: registrar tombstones o equivalentes hasta confirmar propagación para evitar resurrecciones.

- Al cambiar de dispositivo, restaurar todos los archivos y reconstruir IndexedDB desde OneDrive.

### 6.1 Aislamiento de datos locales y cambio de usuario

- La aplicación utilizará una única base de datos IndexedDB activa, asociada exclusivamente al usuario que haya iniciado sesión. No almacenará simultáneamente datos de negocio de distintos usuarios; los datos de alumnos consultados por un entrenador pertenecen al ámbito de su sesión de entrenador.

- Toda operación local o remota comprobará que el usuario propietario de la base de datos coincide con la identidad de la sesión activa. Una sesión cerrada no podrá leer, modificar ni sincronizar información.

- Al cerrar sesión, bloquear inmediatamente la interfaz y el acceso a los datos del usuario anterior, limpiar estados en memoria y cachés de datos personales. No eliminar datos locales con cambios pendientes.

- Antes de permitir cambiar a otro usuario, comprobar si existen cambios locales pendientes. Intentar sincronizarlos; si no se consigue completar, impedir el cambio de usuario y mostrar un error con opción de reintento. No descartar cambios silenciosamente.

- Para iniciar sesión con un usuario distinto se requiere conexión a Internet. Tras validar sus credenciales, descargar de OneDrive todos los datos necesarios de ese usuario, sin utilizar los marcadores incrementales del usuario anterior, y validarlos en un área temporal antes de sustituir los datos locales.

- La sustitución de IndexedDB será atómica o tendrá un mecanismo de recuperación equivalente: nunca dejar una mezcla de datos de dos usuarios ni presentar una importación incompleta como correcta. Solo habilitar la interfaz del nuevo usuario después de completar la importación y establecer la propiedad de la base de datos.

- Si falla la descarga o validación del nuevo usuario, no iniciar su sesión ni exponer los datos del usuario anterior. Conservar los datos previos de forma inaccesible hasta un reintento o restauración segura.

- La primera carga de un usuario en un dispositivo y cualquier cambio de usuario exigen descarga completa desde OneDrive. Las sincronizaciones posteriores del mismo usuario serán incrementales. Tras la carga inicial, el usuario activo podrá trabajar offline.

- Coordinar todas las pestañas/ventanas de la misma PWA mediante BroadcastChannel o mecanismo equivalente y comprobaciones de identidad antes de cada operación. Ante un cambio de sesión, bloquear las pestañas antiguas e impedir escrituras o sincronizaciones de la sesión anterior.

- Limpiar cualquier caché de datos personales, estado React, cola de operaciones y referencia en memoria del usuario anterior que no pertenezca a la nueva sesión. El caché estático del service worker podrá conservar recursos de la aplicación, pero no respuestas con datos privados de otro usuario.

- Estas reglas evitan mezclar datos locales entre sesiones; no protegen los datos locales frente a quien controle físicamente el dispositivo. La separación remota entre alumnos debe imponerse en el Worker.

### 6.2 Propiedad y dirección de sincronización

\| Archivo | Alumno | Entrenador |

\|---|---|---|

\| `tecnics_base.json` | Solo copia inicial | Gestiona plantilla oficial fuera del flujo normal |

\| `user_data.json` | Subida de cambios propios, incluida contraseña; descarga para restauración y recibir cambios autorizados de perfil | Cambios de rol y restablecimiento de contraseña de alumnos |

\| `tecnics.json` | Lectura/escritura de sus técnicas | Lectura |

\| `trainer_comments.json` | Descarga/lectura | Lectura/escritura |

\| `master_data/plans.json` | Sin escritura | Lectura/escritura |

\| `plans_index.json` | Descarga/lectura | Lectura/escritura |

\| `plan_<planId>.json` | Generación inicial y edición manual; lectura/escritura y restauración | Lectura |

- Esta tabla prevalece sobre la regla anterior de «solo subida» para `user_data.json` y `plan_<planId>.json`: **la descarga también es imprescindible para restaurar datos y trabajar desde varios dispositivos**.

- Evitar condiciones de carrera cuando el entrenador añade un plan y el alumno sincroniza; comprobar que el índice y el catálogo sean coherentes antes de generar.

## 7. Generación de planes de competición

- Entrenador crea competición con fechas, días de semana, alumnos y número de ejercicios por sesión (`ejercicios_por_sesion`), tiempo por técnica (`tiempo_por_tecnica_segundos`), descanso entre ciclos/cambio de compañero (`descanso_entre_ciclos_segundos`) y descanso entre técnicas (`descanso_entre_tecnicas_segundos`). Un plan individual por alumno a partir de sus técnicas vigentes al generarse.

- Sesiones en días elegidos entre fecha inicial inclusiva y fecha del torneo exclusiva. No programar nunca el día del torneo ni después.

- EXACTAMENTE `ejercicios_por_sesion` ejercicios/técnicas por sesión, con el valor entero positivo definido al crear la competición (5 por defecto). Si el alumno no tiene técnicas entrenables, mostrar error de validación y no crear sesiones.

- Prioridades existentes ordenadas numéricamente de menor a mayor. Iniciar con la primera y segunda prioridad disponible y después alternar retroceder una posición y avanzar dos posiciones en la lista circular, respetando la secuencia ejemplificada: P1, P2, P1, P3, P2, P4, P3, P5, P4, P1, P5, P2, P1, P3… para P1–P5. Para una única prioridad, repetir esa misma prioridad indefinidamente.

- En cada aparición de prioridad, completar todas las técnicas de todas sus posiciones antes de avanzar a la siguiente prioridad; respetar orden de posiciones y técnicas en arrays JSON.

- Repartir flujo continuo de técnicas en bloques de `ejercicios_por_sesion` por sesión; si una posición queda a medias, continuar desde la técnica pendiente en la siguiente sesión; una sesión puede mezclar posiciones y prioridades. No repetir para rellenar salvo repetición derivada naturalmente de nuevas pasadas completas de la secuencia.

- Una posición se considera completada solo cuando se practican todas sus técnicas, incluso entre sesiones. Registrar pasadas parciales.

- Al eliminar el campo `order`, el plan muestra `tipo`, descripción y comentario y utiliza posición secuencial visual dentro de la sesión si hace falta; **no inventar ni reconstruir el antiguo `order`**.

- Si faltan prioridades intermedias, trabajar con las prioridades realmente existentes. Evitar bucles para prioridades sin técnicas.

- El generador debe ser puro, determinista y cubierto por tests exhaustivos de continuidad y secuencia circular.

### 7.1 Tábata por sesión

La configuración del Tábata **se obtiene exclusivamente de los valores guardados en la competición creada por el entrenador**, que también se copian al plan individual del alumno al generarlo. No utilizar tiempos fijos en el generador, la interfaz ni el PDF; los valores predeterminados solo se aplican al formulario de alta de la competición.

\| Parámetro del Tábata | Origen en el plan | Valor predeterminado al crear la competición |

\|---|---|---|

\| Tiempo de trabajo | `tiempo_por_tecnica_segundos` | 180 s (3:00) |

\| Descanso entre ciclos / cambio de compañero | `descanso_entre_ciclos_segundos` | 10 s (0:10) |

\| Ciclos | Constante del sistema: **2** | 2 |

\| Sets | `ejercicios_por_sesion` | 5 |

\| Descanso entre sets / técnicas diferentes | `descanso_entre_tecnicas_segundos` | 20 s (0:20) |

- **Un set equivale a una técnica** realizada por los dos alumnos de la pareja: alumno A trabaja durante `tiempo_por_tecnica_segundos`, después transcurre `descanso_entre_ciclos_segundos` para cambiar de roles y alumno B trabaja durante `tiempo_por_tecnica_segundos`. Esto constituye exactamente **2 ciclos**. El descanso entre ciclos se aplica **una sola vez por técnica**, entre A y B, nunca después de B.

- Al terminar ambos alumnos una técnica, y **solo si queda otra técnica en la sesión**, transcurre `descanso_entre_tecnicas_segundos` antes de comenzar el siguiente set. No confundir este descanso con el cambio de roles dentro de una técnica.

- **Duración efectiva**, con N = `ejercicios_por_sesion`, T = `tiempo_por_tecnica_segundos`, C = `descanso_entre_ciclos_segundos` y D = `descanso_entre_tecnicas_segundos`: `(2 × T + C) × N + D × (N − 1)` segundos. No se cuenta descanso tras el último ciclo de cada set ni tras el último set. Con N = 5, T = 180, C = 10 y D = 20: `1930 s = 32:10`.

- Mostrar siempre los cinco parámetros y la duración efectiva calculados a partir del plan concreto, tanto en la interfaz como en el PDF. Si una aplicación externa de Tábata contabiliza descansos finales adicionales, distinguir su tiempo mostrado de la duración efectiva de entrenamiento.

## 8. Funcionalidades e interfaz

### Alumno

- Registro, login, cierre de sesión y perfil editable (salvo correo/rol). Cambio de contraseña propia mediante doble introducción y comprobación de coincidencia.

- Lista de posiciones ordenadas y técnicas, búsqueda, creación, edición, borrado, prioridad y descripción personal.

- Visualización de comentarios del entrenador asociados a técnica.

- Listado de planes asignados y planes individuales ya recibidos; calendario de sesiones, detalle de técnicas y edición manual del plan.

- Botón global «Sincronizar» y estado de sincronización/errores.

- Uso sin conexión con datos previamente cargados.

### Entrenador

- Listar y buscar alumnos; buscar posiciones por coincidencia de texto insensible a mayúsculas (equivalente a ILIKE).

- Consultar técnicas de alumnos, editar comentarios separados y medir porcentaje de técnicas con descripción no vacía.

- Crear competiciones (inicio, torneo, días de entrenamiento y número entero positivo de ejercicios por sesión (5 por defecto), tiempo por técnica en segundos (180 por defecto), descanso entre ciclos/cambio de compañero en segundos (10 por defecto) y descanso entre técnicas en segundos (20 por defecto), asignar/quitar alumnos y consultar sus planes.

- No editar fechas, días, número de ejercicios por sesión ni tiempos de trabajo, cambio de compañero y descanso entre técnicas de una competición creada; distinguir desasignación de eliminación total.

- Gestionar roles de usuarios desde la UI de entrenador, sujeto a las limitaciones de seguridad documentadas.

- Actuar como administrador para restablecer contraseñas de alumnos desde el perfil del entrenador: correo del alumno, contraseña nueva y confirmación; validar existencia y coincidencia, guardar hash con sal en OneDrive y mostrar confirmación solo tras escritura correcta.

### PDF

- Exportar plan individual a PDF con fechas, posiciones, prioridades, técnicas, descripción del alumno y comentario del entrenador.

- Incluir literalmente al inicio: «Cada competidor deberá rellenar, para cada técnica, la que a él mejor le sale en combate habitualmente. Nada de flipadas, lo que más habitualmente le funciona con rivales de su mismo nivel

No tienen por qué ser todas desde exactamente la misma situación. Por ejemplo, podemos tener una opción de guardia cerrada para cuando estamos en el suelo y otra para cuando el rival se pone de pie. Le pediremos al compañero lo que queremos que haga para practicarla.»

- Cada día debe ocupar una sola página como máximo; si no cabe en la página actual, trasladarlo entero a la siguiente. Si excepcionalmente no cabe en una página, señalar error y aplicar diseño compacto sin dividirlo, o impedir exportación con aviso claro.

- Incluir configuración de Tábata con los sets y los tres tiempos guardados en el plan (trabajo por alumno, cambio de roles entre ciclos y descanso entre técnicas); los ciclos son siempre 2, y su duración efectiva calculada. Si se dispone del logo PGT, situarlo arriba a la derecha en todas las páginas.

## 9. Requisitos no funcionales y pruebas

- Accesible, responsive, táctil, usable en Safari iOS, Chrome Android y navegadores modernos Windows.

- No publicar contraseñas, tokens OAuth, secretos de sesión ni claves de GitHub, Microsoft o Cloudflare en el repositorio o frontend; `.env.example` con valores de ejemplo. Usar secretos del Worker y almacenamiento persistente adecuado para tokens renovables. Los identificadores públicos no son secretos. Nunca registrar credenciales en logs.

- Validación de JSON y migraciones por `schemaVersion`; recuperación desde OneDrive, exportación/importación manual como contingencia.

- Tests unitarios: generador de planes 100 % de ramas críticas; sincronización/conflictos ≥95 %; validación de modelos ≥95 %; casos de uso ≥90 % como objetivos, no sustitutos de tests de integración.

- Tests de integración: IndexedDB, almacenamiento cloud simulado, Worker/API, sesiones y permisos por rol/usuario, sincronización bidireccional, borrados, conflictos, fallos parciales y restauración. Simular token caducado, renovación, revocación y acceso cruzado; validar Graph real por separado en la prueba de concepto.

- Tests end-to-end: registro, login, creación de técnicas, asignación de plan, generación, edición manual, comentarios, exportación PDF, instalación PWA y modo offline. Incluir cambio de contraseña propia, restablecimiento por entrenador (correo válido/inexistente, contraseñas distintas, error de red, conflicto de versión), verificación de nuevo hash y conservación del resto del perfil. Añadir pruebas de cambio de usuario A → B, cierre con cambios pendientes, fallo de descarga inicial, restauración completa, sesiones en pestañas simultáneas y ausencia de datos de A en la sesión de B (incluido tras recarga y en modo offline). Incluir planes con distintos valores de `ejercicios_por_sesion`, `tiempo_por_tecnica_segundos`, `descanso_entre_ciclos_segundos` y `descanso_entre_tecnicas_segundos` (incluidos descansos cero), validar los límites y comprobar que PDF, Tábata y duración efectiva reflejan los valores configurados.

- `README.md`: instalación, comandos, arquitectura, cuentas a configurar, instrucciones para que el propietario conecte manualmente `dmda92/pgt-bjj-planner` a Cloudflare Pages (`main`, `npm run build`, `dist`) y configure/despliegue el Worker, sus bindings/almacenamiento, secretos, ruta/API pública, OAuth Microsoft, URI de redirección y autorización inicial. Explicar costes/cuotas, copias de seguridad, recuperación, límites, pruebas y despliegues posteriores de Pages/Worker.

- `AGENTS.md`: reglas de negocio, algoritmo circular, fuente JSON, estructura, convenciones, tests obligatorios, prohibición de inventar técnicas y límites de seguridad. Incluir una referencia explícita a `docs/REQUISITOS_PGT_APP.md`, identificándolo como el documento de requisitos iniciales del proyecto, que debe consultarse antes de implementar o modificar funcionalidades.

- `docs/REQUISITOS_PGT_APP.md`: conservar en el repositorio una copia completa de este mismo documento, sin resumirlo ni sustituirlo por una versión parcial. Debe mantenerse accesible y versionado en Git junto al código, de modo que los futuros desarrollos puedan consultar los requisitos originales.

## 10. Criterios de aceptación

1. La misma URL funciona en móvil y ordenador; se puede instalar como PWA donde el navegador lo permita.

2. La app consulta y edita datos desde IndexedDB sin conexión tras la primera carga.

3. Dos alumnos pueden tener técnicas y planes diferentes; el entrenador puede consultar ambos desde la interfaz.

4. Cada técnica y posición tiene GUID estable y exclusivo del alumno, asignado al crear su `tecnics.json`; el orden de arrays se respeta siempre.

5. Los comentarios se sincronizan aparte, sin sobrescribir descripciones del alumno.

6. Al asignar competición, el alumno recibe su referencia y genera un plan individual una sola vez.

7. Todos los días programados tienen exactamente el número de técnicas configurado al crear la competición (5 por defecto); los tres tiempos (trabajo por alumno, cambio de compañero entre ciclos y descanso entre técnicas) se configuran al crearla (180 s, 10 s y 20 s por defecto), quedan fijados para el plan y determinan la duración efectiva y el Tábata (siempre 2 ciclos y tantos sets como ejercicios por sesión); el patrón circular/continuidad pasa los tests para distintos valores positivos.

8. Cambios posteriores de técnicas no regeneran planes; la edición manual sí persiste.

9. Desasignar alumno retira referencia sin eliminar plan ya descargado; eliminar un plan entero sí limpia sus referencias y archivos.

10. Una sincronización con conflicto nunca pierde datos silenciosamente; una restauración desde OneDrive reconstruye la BD local.

11. Los PDFs no dividen sesiones entre páginas e incluyen todos los campos e introducción literal.

12. No se activa ningún servicio de pago. Se permite exclusivamente un Cloudflare Worker mínimo y almacenamiento auxiliar gratuito para autenticar PGT y conectar con la única cuenta OneDrive del propietario. Los tokens y secretos no se publican en cliente ni repositorio. El propietario configura y despliega Cloudflare.

13. Cambiar de usuario exige sincronizar previamente los cambios pendientes, descargar y validar todos los datos del nuevo usuario y sustituir IndexedDB sin mezclar información; las pestañas anteriores quedan bloqueadas y ningún dato del usuario previo aparece en la nueva sesión.

14. El entrenador puede restablecer la contraseña de un alumno mediante correo y doble introducción, con persistencia confirmada en OneDrive; el alumno puede cambiar su propia contraseña desde su perfil. Ninguna de estas operaciones altera técnicas, comentarios o planes.

## 11. Decisiones técnicas pendientes de validación (no inventar)

- Viabilidad real de acceso del Worker a la única cuenta OneDrive personal del propietario mediante Microsoft Graph OAuth delegado, sin login Microsoft de alumnos: registro compatible, consentimiento, redirección, scopes, almacenamiento y renovación de tokens, caducidad y revocación.

- Autenticación y autorización efectivas en el Worker: sesiones PGT, permisos por rol y usuario, prevención de acceso cruzado, altas, revocación y protección de rutas.

- Disponibilidad de la cuenta Microsoft, cuota gratuita, permisos de lectura/escritura y política de uso de Graph; cuotas gratuitas de Workers y almacenamiento auxiliar, y mecanismo real de configuración sin que Work acceda a Cloudflare.

- Comportamiento exacto ante eliminación de un plan no descargado o datos antiguos offline.

- Compatibilidad de algoritmos de hash de contraseña en navegador y migración si se adoptara un proveedor de identidad en el futuro.

**Instrucción final a Work:** primero validar mediante prueba funcional mínima un Cloudflare Worker con Microsoft Graph OAuth delegado para la única cuenta OneDrive personal del propietario: consentimiento inicial del propietario, lectura/escritura de JSON en `PGT/`, renovación y revocación, login PGT y autorización por usuario, sin cuentas Microsoft de alumnos. Si la prueba falla, detenerse y explicar el bloqueo, sin cambiar de proveedor ni exigir cuentas Microsoft. Después desarrollar y probar frontend y Worker, documentar los pasos exactos que debe ejecutar el propietario en Microsoft y Cloudflare, guardar íntegro este documento en `docs/REQUISITOS_PGT_APP.md` y referenciarlo desde `AGENTS.md`, comprobar `npm run build` y, si existe autorización GitHub, subir el código a `dmda92/pgt-bjj-planner` en `main`. Work no debe acceder a Cloudflare ni realizar allí el despliegue; el propietario configura Pages, Worker, secretos, OAuth y conexión GitHub–Cloudflare.
