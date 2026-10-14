# PGT — Especificación funcional y técnica para implementación

**Versión:** 2.1 (corrección del propietario, 14/10/2026; requisitos iniciales 2.0) · **Estado:** listo para prototipo técnico y desarrollo, sujeto a validar GitHub privado como almacenamiento mediante Cloudflare Worker gratuito.

## 0. Encargo para ChatGPT Work

Construir, probar y preparar el despliegue de una aplicación PWA de planificación de competición de jiu-jitsu. Implementar exactamente los requisitos de este documento. No inventar posiciones ni técnicas: utilizar el JSON oficial del proyecto `posiciones a trabajar mínimos.json` como origen de `master_data/tecnics_base.json`. Solicitar acceso a dicho fichero si no está disponible. Preparar el código para el repositorio GitHub `dmda92/pgt-bjj-planner`, README.md y AGENTS.md. Guardar una copia íntegra de este documento de requisitos en `docs/REQUISITOS_PGT_APP.md` dentro del repositorio y referenciarla expresamente desde `AGENTS.md` como especificación inicial del proyecto. Con autorización del propietario y acceso a GitHub, subir el código probado a la rama `main`. NO acceder a Cloudflare, NO crear ni configurar un proyecto Cloudflare y NO realizar el despliegue: el propietario conectará GitHub con Cloudflare Pages manualmente. Validar primero una prueba de concepto real de lectura/escritura en un repositorio GitHub PRIVADO de datos mediante un Cloudflare Worker mínimo, sin inicio de sesión GitHub de los alumnos. El propietario creará el repositorio privado de datos, autorizará un token GitHub de alcance limitado y configurará Cloudflare cuando Work facilite instrucciones; Work preparará código y pruebas sin desplegar ni acceder a Cloudflare.

**Datos por completar por el propietario:**

- Cuenta/organización GitHub: `dmda92`

- Nombre del repositorio GitHub: `pgt-bjj-planner`

- Repositorio de código: `dmda92/pgt-bjj-planner` (mantener como repositorio independiente del almacenamiento de datos).
- Repositorio de datos: `dmda92/pgt-bjj-data` (**privado**, a crear por el propietario; no debe hacerse público). Carpeta raíz de datos `PGT/` con `master_data/` y `users_data/`.
- Acceso de API a datos: token GitHub de permisos mínimos para `dmda92/pgt-bjj-data`, exclusivamente como secreto del Worker. **No incluir el valor del token en el Markdown, Git, archivos `.env` versionados ni navegador.**
- Cloudflare Worker (nombre, URL, bindings y secretos): `[POR CONFIGURAR POR EL PROPIETARIO CON LAS INSTRUCCIONES DE WORK]`. No se exige conocerlos antes del desarrollo.
- Cuenta Microsoft/OneDrive y registro Microsoft Entra: **no necesarios** para esta arquitectura.

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

- Coste objetivo obligatorio de 0 €: sin dominio de pago, IP fija, servidor propio ni servicios de pago. Usar Cloudflare Pages, un Cloudflare Worker mínimo y almacenamiento auxiliar de secretos/estado dentro de cuotas gratuitas, más GitHub Free con repositorio privado de datos. Work debe comprobar límites y compatibilidad de cuotas antes de continuar; no activar planes de pago sin permiso. Advertir sobre límites y cambios futuros.

- PWA estática offline-first con IndexedDB local y sincronización bidireccional por JSON en repositorio privado GitHub, pasando por un Cloudflare Worker para autorización y operaciones remotas. No utilizar GitHub privado como base de datos de consulta interactiva.

- Arquitectura simple, SOLID aplicado pragmáticamente, TypeScript, alta cobertura de tests, código mantenible.

- Proveedor cloud intercambiable mediante interfaz (GitHub Contents API como primera implementación).

- La misma PWA sirve ambos roles, mostrando permisos y pantallas correspondientes.

## 2. Arquitectura

- Frontend: React + TypeScript + Vite (propuesta de implementación); PWA con manifest y service worker.

- Persistencia local: IndexedDB mediante Dexie.js (propuesta). Persistir datos de negocio, versiones y cola de cambios pendientes.

- Distribución prevista: Cloudflare Pages para frontend estático HTTPS y Cloudflare Worker para API de autenticación/autorización y GitHub privado. Work implementará y probará localmente ambos componentes, con instrucciones de configuración; el propietario configurará y desplegará Pages y Worker desde su cuenta Cloudflare. Work no necesita credenciales ni URL real de Cloudflare para desarrollar.

- Entrega preparada para despliegue: `package.json` con `npm run build` operativo, salida estática en `dist`, configuración SPA para navegación por rutas si se utiliza, manifest y service worker PWA. Implementar detección de nueva versión y aviso de actualización sin descartar cambios locales pendientes ni provocar pérdida de datos.

- GitHub es el origen del despliegue: Work debe entregar código y pruebas en el repositorio indicado cuando esté autorizado. Tras la configuración manual inicial del propietario, Cloudflare Pages publicará nuevas compilaciones automáticamente al recibir cambios en `main`. No depender de un despliegue previo para poder desarrollar o probar localmente.

- Nube: un repositorio GitHub privado de datos `dmda92/pgt-bjj-data`, propiedad de `dmda92`, con todos los JSON dentro de `PGT/`. La PWA llamará al Worker; solo el Worker accederá a GitHub REST API con un token de alcance limitado. La lógica de dominio no dependerá de la API concreta.

- Capas: domain (modelos, reglas, generador puro); application (casos de uso); infrastructure (IndexedDB, cliente API PGT, Worker, GitHub REST API y autenticación); ui (pantallas).

- Interfaces mínimas: `LocalRepository`, `CloudStorageProvider`, `AuthenticationProvider`, `SyncService`. Implementar adaptador de API Worker sin exponer credenciales GitHub al navegador.

- Funcionamiento offline: consultar y editar datos cacheados sin red; las operaciones remotas quedan pendientes y se reintentan.

### 2.1 Decisión obligatoria: GitHub privado como almacenamiento y Cloudflare Worker mínimo

- **Decisión expresa del propietario:** todos los JSON estarán en UN repositorio GitHub PRIVADO `dmda92/pgt-bjj-data` bajo su única cuenta GitHub. El código estará separado en `dmda92/pgt-bjj-planner`, con frontend y Worker en un monorepo. Los alumnos no necesitan cuentas GitHub ni Microsoft; entran solo con credenciales PGT. No usar GitHub privado, GitHub REST API ni Microsoft Entra.
- **Seguridad:** el Worker guarda el token GitHub exclusivamente como secreto, nunca en navegador, repositorio, logs ni Markdown. Verifica identidad, rol y propiedad de cada recurso; no permite rutas arbitrarias, traversal ni operaciones GitHub genéricas. El repositorio de datos nunca será público.
- **Token GitHub:** preferir fine-grained personal access token limitado al repositorio `dmda92/pgt-bjj-data`, con permiso **Contents: Read and write** y sin permisos innecesarios. El propietario lo crea y lo carga manualmente como secreto de Cloudflare. Documentar caducidad, rotación, revocación y comportamiento cuando expire; nunca pedir que se pegue en el chat. Si GitHub ofrece una opción más segura y gratuita compatible, justificarla y obtener aprobación antes de sustituirla.
- **Prueba bloqueante:** comprobar mediante GitHub REST API real que el token puede leer, crear y actualizar JSON en el repositorio privado, respetando el SHA de versión para escrituras condicionales; verificar rechazo de SHA obsoleto, credenciales incorrectas y acceso cruzado entre alumnos mediante Worker. Si el acceso real depende de secretos que solo puede configurar el propietario, detenerse y solicitar pasos concretos sin dar por superada la prueba con mocks. Si no es viable sin coste o tarjeta, informar y detenerse sin cambiar proveedor unilateralmente.
- **Login PGT:** el Worker valida contraseñas almacenadas como hash robusto con sal (Argon2id o alternativa compatible y justificada) y expide sesiones protegidas; comprueba autorización en cada operación. Proteger registro, recuperación, roles, sesiones y bootstrap inicial del entrenador. No confiar en el campo `perfil` del navegador.

### 2.2 Worker, GitHub y configuración a cargo del propietario

- El Worker es la única API remota. Aplicar control de acceso por alumno/entrenador, validación estricta de payloads y rutas, límites de tamaño/frecuencia, CORS restringido, protección CSRF si se usan cookies y gestión segura de sesiones. No exponer endpoints genéricos de GitHub ni tokens.
- GitHub Contents API: leer archivos con contenido codificado y metadatos SHA; crear/actualizar con PUT y SHA esperado, borrar con SHA, y gestionar errores 401/403/404/409/422, rate limits y reintentos con backoff. No usar GitHub como BD de consulta en cada interacción: IndexedDB sigue siendo la persistencia local. No hacer commits para lecturas ni escrituras innecesarias.
- **Concurrencia:** el SHA del archivo es la versión remota para compare-and-swap. Ante conflicto, descargar versión actual y aplicar reglas de fusión del apartado 6; nunca sobrescribir silenciosamente. Las operaciones que afecten varios JSON no son transacciones atómicas: diseñar reintentos idempotentes, pasos recuperables y reconciliación para evitar estados incoherentes.
- **Cuotas y escala:** comprobar antes de desarrollar límites actuales del plan gratuito de GitHub (API, tamaño de archivos, commits y uso razonable), Cloudflare Workers y almacenamiento auxiliar. Evitar sincronización excesiva, polling continuo y escritura de cada pulsación; agrupar cambios. Si el volumen real supera el uso razonable de GitHub como almacenamiento de JSON, advertir antes de implementar.
- **Persistencia auxiliar:** usar KV, D1, Durable Objects u otra opción gratuita solo para sesiones, revocación, coordinación o seguridad cuando sea necesario, justificando cuotas y consistencia. Los JSON de negocio siguen teniendo como fuente de verdad el repositorio privado. No crear otra base de datos de negocio sin autorización.
- **Alta pública y bootstrap:** un usuario nunca puede asignarse rol entrenador. Definir un procedimiento controlado y de un solo uso para el primer entrenador, que no dependa de modificar manualmente hashes o permisos sin validación.
- Work preparará `worker/`, configuración versionable sin secretos (`wrangler.jsonc` o equivalente), scripts de prueba y despliegue, `.env.example` sin valores reales y documentación de la configuración manual. El propietario configurará y desplegará Cloudflare Pages y Worker. Frontend: `VITE_API_BASE_URL` pública, nunca el token GitHub.
- **Monorepo:** mantener `src/` y `worker/` dentro de `dmda92/pgt-bjj-planner`. `dmda92/pgt-bjj-data` contendrá únicamente datos privados. Work no debe confundir permisos de escritura sobre el repo de código con permisos de API sobre el repo de datos.
- No exigir nombre/URL del Worker, token ni identificadores de Cloudflare antes de iniciar el desarrollo. Cuando se requiera la prueba real, pedir al propietario crear el repo privado y configurar el token/entorno seguro, y dar instrucciones exactas. No dar por probada la integración si solo hay mocks.

## 3. Estructura de archivos en el repositorio GitHub privado

Todas las rutas de esta sección son relativas a la carpeta `PGT/` en la rama principal del repositorio privado `dmda92/pgt-bjj-data`. El Worker no debe crear ni buscar estos JSON fuera de `PGT/`; el navegador nunca accede directamente a este repositorio.

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

- Incluir `schemaVersion`, `revision`, `updatedAt` en los archivos sincronizados y conservar metadatos de versión remota (`sha` de GitHub) en IndexedDB.

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

- `perfil`: alumno (por defecto) o entrenador. Solo entrenador puede cambiarlo desde la UI; primer entrenador: bootstrap administrativo de un solo uso, protegido y documentado; no permitir elevación desde el registro público.

- `pwd`: hash de contraseña con sal, verificable sin descifrar. El Worker nunca devolverá este campo en respuestas de perfil ni en exportaciones accesibles al alumno. No mostrarlo ni permitir editarlo directamente; ofrecer cambio de contraseña mediante formulario.

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
  "comments": [{ "techniqueId": "<uuid-tecnica>", "comment": "" }],
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
{
  "schemaVersion": 1,
  "planIds": ["<uuid-plan>"],
  "revision": 1,
  "updatedAt": "2026-10-13T00:00:00Z"
}
```

- Mantenido por entrenador; descargado por alumno. Nuevos IDs activan la generación individual al sincronizar.

- La asignación a un alumno ya registrado debe ser detectable aunque el alumno haya estado offline.

### 4.6 Plan individual `plan_<planId>.json`

- Guardar `planId`, correo, fecha de inicio, fecha de torneo, días, `ejercicios_por_sesion`, `tiempo_por_tecnica_segundos`, `descanso_entre_ciclos_segundos`, `descanso_entre_tecnicas_segundos`, fecha de generación, versión y lista de sesiones.

- Cada sesión contiene fecha, técnicas ordenadas y **snapshot** de `positionId`, `techniqueId`, nombre completo de posición con rol, prioridad, tipo, descripción del alumno y comentario del entrenador en el momento de generación.

- Se generan al recibir una nueva asignación. La regla de inmutabilidad absoluta queda sustituida por la actualización de textos exclusivamente futura del apartado 11. Las descripciones y comentarios se actualizan por UUID sin regenerar la distribución. Sesiones pasadas, sesión de hoy y competiciones finalizadas quedan protegidas. Los cambios estructurales se analizarán y consultarán antes de activar el recálculo futuro. El alumno puede modificar manualmente su plan.

- Guardar edición manual sin recalcular automáticamente el resto de sesiones.

- Al quitar al alumno de la asignación, el plan individual existente permanece localmente visible.

## 5. Autenticación y perfiles

- Pantalla de login inicial si no hay sesión; correo y contraseña; persistencia de sesión hasta cierre manual.

- Registro abierto a cualquier persona: crear perfil alumno, carpeta y JSON inicial de técnicas a partir de la plantilla, generando UUID nuevos para todas sus posiciones y técnicas sin reutilizarlos entre alumnos, índice vacío, comentarios vacíos y carpeta de planes.

- El Worker valida el perfil y hash, crea una sesión PGT segura y comprueba permisos por petición; los alumnos no pueden leer ni escribir archivos de otros usuarios, aunque conozcan sus rutas. Añadir pruebas negativas de acceso cruzado y de escalada de privilegios.

- Cambio de contraseña desde el perfil del usuario autenticado: introducir nueva contraseña y repetirla; validar coincidencia antes de guardar. El alumno puede elegir libremente su nueva contraseña. Correo inmutable.

- El entrenador actúa como administrador y dispone en su perfil de una función «Restablecer contraseña de alumno»: introducir el correo del alumno, la nueva contraseña y su confirmación. Validar que el correo corresponde a un alumno existente y que ambas contraseñas coinciden; mostrar errores claros sin modificar datos si falla la validación.

- Al confirmar el restablecimiento, calcular un nuevo hash con sal y actualizar exclusivamente el campo `pwd` de `users_data/<mail>/user_data.json` del alumno mediante escritura condicional con control de versión. No modificar sus técnicas, comentarios, planes ni otros datos de perfil. No mostrar ni registrar la contraseña en texto claro.

- El restablecimiento administrativo requiere conexión y confirmación de escritura en GitHub privado antes de informar de éxito. El Worker debe invalidar o revocar las sesiones PGT afectadas al cambiar/restablecer contraseña y documentar el mecanismo de revocación.

- Entrenador ve usuarios, técnicas, comentarios y planes; alumno solo ve su información desde la UI. La restricción de UI no equivale a seguridad de acceso a archivos.

- Primer entrenador: procedimiento inicial controlado por el propietario y verificado por el Worker (por ejemplo bootstrap administrativo de un solo uso); nunca permitir elevarse a entrenador desde el registro público.

## 6. Sincronización

- Al abrir la PWA con sesión activa, al recuperar conexión y con botón accesible desde cualquier pantalla.

- Offline-first: cada edición se persiste localmente inmediatamente y se marca pendiente.

- Detectar cambios mediante dirty flags, revisiones, hashes/SHA y metadatos de GitHub; usar manifiesto de revisiones o consultas condicionales cuando resulte viable; no descargar ni subir todos los JSON si no han cambiado.

- La operación de sincronización procesa **todos** los pendientes necesarios; no mostrar «Sincronizado» si queda alguno sin confirmar. Si falla un archivo, conservar pendientes y permitir reintentar de forma idempotente.

- Para escrituras, utilizar SHA esperado del archivo en GitHub Contents API y tratar conflictos 409/422 o equivalente. Nunca sobrescribir silenciosamente cambios remotos.

- Multidispositivo offline: descargar y fusionar cuando los cambios afecten campos/entidades diferentes; cuando ambas copias editen el mismo dato, presentar conflicto al usuario para escoger versión o conservar ambas. No elegir automáticamente «último en escribir» para conflictos reales.

- Borrados: registrar tombstones o equivalentes hasta confirmar propagación para evitar resurrecciones.

- Al cambiar de dispositivo, restaurar todos los archivos y reconstruir IndexedDB desde GitHub privado.

### 6.1 Aislamiento de datos locales y cambio de usuario

- La aplicación utilizará una única base de datos IndexedDB activa, asociada exclusivamente al usuario que haya iniciado sesión. No almacenará simultáneamente datos de negocio de distintos usuarios; los datos de alumnos consultados por un entrenador pertenecen al ámbito de su sesión de entrenador.

- Toda operación local o remota comprobará que el usuario propietario de la base de datos coincide con la identidad de la sesión activa. Una sesión cerrada no podrá leer, modificar ni sincronizar información.

- Al cerrar sesión, bloquear inmediatamente la interfaz y el acceso a los datos del usuario anterior, limpiar estados en memoria y cachés de datos personales. No eliminar datos locales con cambios pendientes.

- Antes de permitir cambiar a otro usuario, comprobar si existen cambios locales pendientes. Intentar sincronizarlos; si no se consigue completar, impedir el cambio de usuario y mostrar un error con opción de reintento. No descartar cambios silenciosamente.

- Para iniciar sesión con un usuario distinto se requiere conexión a Internet. Tras validar sus credenciales, descargar de GitHub privado todos los datos necesarios de ese usuario, sin utilizar los marcadores incrementales del usuario anterior, y validarlos en un área temporal antes de sustituir los datos locales.

- La sustitución de IndexedDB será atómica o tendrá un mecanismo de recuperación equivalente: nunca dejar una mezcla de datos de dos usuarios ni presentar una importación incompleta como correcta. Solo habilitar la interfaz del nuevo usuario después de completar la importación y establecer la propiedad de la base de datos.

- Si falla la descarga o validación del nuevo usuario, no iniciar su sesión ni exponer los datos del usuario anterior. Conservar los datos previos de forma inaccesible hasta un reintento o restauración segura.

- La primera carga de un usuario en un dispositivo y cualquier cambio de usuario exigen descarga completa desde GitHub privado. Las sincronizaciones posteriores del mismo usuario serán incrementales. Tras la carga inicial, el usuario activo podrá trabajar offline.

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

- Actuar como administrador para restablecer contraseñas de alumnos desde el perfil del entrenador: correo del alumno, contraseña nueva y confirmación; validar existencia y coincidencia, guardar hash con sal en GitHub privado y mostrar confirmación solo tras escritura correcta.

### PDF

- Exportar plan individual a PDF con fechas, posiciones, prioridades, técnicas, descripción del alumno y comentario del entrenador.

- Incluir literalmente al inicio: «Cada competidor deberá rellenar, para cada técnica, la que a él mejor le sale en combate habitualmente. Nada de flipadas, lo que más habitualmente le funciona con rivales de su mismo nivel

No tienen por qué ser todas desde exactamente la misma situación. Por ejemplo, podemos tener una opción de guardia cerrada para cuando estamos en el suelo y otra para cuando el rival se pone de pie. Le pediremos al compañero lo que queremos que haga para practicarla.»

- Cada día debe ocupar una sola página como máximo; si no cabe en la página actual, trasladarlo entero a la siguiente. Si excepcionalmente no cabe en una página, señalar error y aplicar diseño compacto sin dividirlo, o impedir exportación con aviso claro.

- Incluir configuración de Tábata con los sets y los tres tiempos guardados en el plan (trabajo por alumno, cambio de roles entre ciclos y descanso entre técnicas); los ciclos son siempre 2, y su duración efectiva calculada. Si se dispone del logo PGT, situarlo arriba a la derecha en todas las páginas.

## 9. Requisitos no funcionales y pruebas

- Accesible, responsive, táctil, usable en Safari iOS, Chrome Android y navegadores modernos Windows.

- No publicar contraseñas, tokens GitHub, secretos de sesión ni claves de Cloudflare en el repositorio o frontend; `.env.example` con valores de ejemplo. Usar secretos del Worker y almacenamiento persistente adecuado para sesiones y revocación. Los identificadores públicos no son secretos. Nunca registrar credenciales en logs.

- Validación de JSON y migraciones por `schemaVersion`; recuperación desde GitHub privado, exportación/importación manual como contingencia.

- Tests unitarios: generador de planes 100 % de ramas críticas; sincronización/conflictos ≥95 %; validación de modelos ≥95 %; casos de uso ≥90 % como objetivos, no sustitutos de tests de integración.

- Tests de integración: IndexedDB, almacenamiento cloud simulado, Worker/API, sesiones y permisos por rol/usuario, sincronización bidireccional, borrados, conflictos, fallos parciales y restauración. Simular token GitHub caducado, revocado o sin permisos y acceso cruzado; validar GitHub REST API real por separado en la prueba de concepto.

- Tests end-to-end: registro, login, creación de técnicas, asignación de plan, generación, edición manual, comentarios, exportación PDF, instalación PWA y modo offline. Incluir cambio de contraseña propia, restablecimiento por entrenador (correo válido/inexistente, contraseñas distintas, error de red, conflicto de versión), verificación de nuevo hash y conservación del resto del perfil. Añadir pruebas de cambio de usuario A → B, cierre con cambios pendientes, fallo de descarga inicial, restauración completa, sesiones en pestañas simultáneas y ausencia de datos de A en la sesión de B (incluido tras recarga y en modo offline). Incluir planes con distintos valores de `ejercicios_por_sesion`, `tiempo_por_tecnica_segundos`, `descanso_entre_ciclos_segundos` y `descanso_entre_tecnicas_segundos` (incluidos descansos cero), validar los límites y comprobar que PDF, Tábata y duración efectiva reflejan los valores configurados.

- `README.md`: instalación, comandos, arquitectura, cuentas a configurar, instrucciones para que el propietario conecte manualmente `dmda92/pgt-bjj-planner` a Cloudflare Pages (`main`, `npm run build`, `dist`) y configure/despliegue el Worker, sus bindings/almacenamiento, secretos, ruta/API pública, repositorio privado de datos, token GitHub de permisos mínimos y rotación. Explicar costes/cuotas, copias de seguridad, recuperación, límites, pruebas y despliegues posteriores de Pages/Worker.

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

8. Cambios de descripción y comentarios actualizan únicamente sesiones posteriores a hoy (Europe/Madrid) en competiciones posteriores a hoy, por UUID y sin regenerar ejercicios. El histórico y hoy permanecen exactos; la edición manual persiste. El recálculo estructural requiere el análisis y las decisiones del apartado 11.

9. Desasignar alumno retira referencia sin eliminar plan ya descargado; eliminar un plan entero sí limpia sus referencias y archivos.

10. Una sincronización con conflicto nunca pierde datos silenciosamente; una restauración desde GitHub privado reconstruye la BD local.

11. Los PDFs no dividen sesiones entre páginas e incluyen todos los campos e introducción literal.

12. No se activa ningún servicio de pago. Se permite un Cloudflare Worker mínimo y almacenamiento auxiliar gratuito para autenticar PGT y conectar con el repositorio GitHub privado de datos del propietario. Los tokens y secretos no se publican en cliente ni repositorio. El propietario configura y despliega Cloudflare.

13. Cambiar de usuario exige sincronizar previamente los cambios pendientes, descargar y validar todos los datos del nuevo usuario y sustituir IndexedDB sin mezclar información; las pestañas anteriores quedan bloqueadas y ningún dato del usuario previo aparece en la nueva sesión.

14. El entrenador puede restablecer la contraseña de un alumno mediante correo y doble introducción, con persistencia confirmada en GitHub privado; el alumno puede cambiar su propia contraseña desde su perfil. Ninguna de estas operaciones altera técnicas, comentarios o planes.

## 11. Decisiones técnicas pendientes de validación (no inventar)

- Acceso real de Cloudflare Worker a `dmda92/pgt-bjj-data` mediante token GitHub de alcance mínimo: lectura, creación, actualización condicional por SHA, borrado y rechazo de token revocado o sin permisos.
- Seguridad efectiva del Worker: sesiones PGT, roles, aislamiento entre alumnos, bootstrap del primer entrenador, alta pública, revocación y protección de rutas.
- Cuotas y uso razonable de GitHub Free para JSON versionados, límites de REST API y frecuencia de commits; cuotas de Workers y persistencia auxiliar gratuitas, sin tarjeta ni activación de pago.
- Comportamiento exacto ante eliminación de un plan no descargado o datos antiguos offline.
- Compatibilidad de algoritmos de hash de contraseña con Workers y migración si se adoptara otro proveedor de identidad en el futuro.
- Limitaciones de transacciones multiarchivo de GitHub Contents API; recuperación de fallos parciales y conflictos entre dispositivos.

**Instrucción final a Work:** primero comprobar permisos de GitHub sobre el repositorio de código y preparar una prueba funcional mínima del Worker con un repositorio GitHub privado de datos propiedad de `dmda92`: lectura/escritura de JSON bajo `PGT/`, escritura condicional por SHA y conflictos, login PGT y aislamiento de usuarios, sin cuentas GitHub de alumnos. El propietario creará `dmda92/pgt-bjj-data` privado y configurará el token GitHub de permisos mínimos en el entorno seguro cuando sea necesario. Si la prueba real no es viable gratuitamente y sin tarjeta, detenerse y explicar el bloqueo; no sustituir el proveedor sin permiso. Después desarrollar y probar frontend y Worker, documentar los pasos exactos de GitHub y Cloudflare para el propietario, guardar íntegro este documento en `docs/REQUISITOS_PGT_APP.md` y referenciarlo desde `AGENTS.md`, comprobar `npm run build` y, si existe autorización GitHub, subir el código a `dmda92/pgt-bjj-planner` en `main`. Work no debe acceder a Cloudflare ni realizar allí el despliegue; el propietario configura Pages, Worker, secretos y conexión GitHub–Cloudflare.

## 11. Corrección de requisitos: actualización solo hacia el futuro (14/10/2026)

Este apartado sustituye expresamente la regla original de planes completamente inmutables y cualquier petición anterior de actualizar también textos históricos. **Nunca modificar automáticamente sesiones pasadas, sesiones de hoy ni planes cuya fecha de competición sea anterior o igual a hoy.** Usar exclusivamente Europe/Madrid, tanto en el Worker como en la proyección offline. Pasada: fecha < hoy; hoy: fecha = hoy; futura: fecha > hoy; plan activo: fecha de torneo > hoy.

### 11.1 Implementación obligatoria de textos

- Al cambiar descripcion_del_alumno en tecnics.json, actualizarla en todas las apariciones futuras de esa techniqueId dentro de los planes activos del mismo usuario. No usar nombres o índices para relacionar técnicas.
- Al añadir, editar, vaciar o quitar un comentario del entrenador en trainer_comments.json, actualizar comment en las mismas condiciones. Alumno no puede escribir comentarios; entrenador no puede escribir técnicas de otro usuario.
- No modificar distribución, UUID, nombre de posición, prioridad, tipo, pass, positionComplete, fechas, ejercicios por sesión ni parámetros Tábata por estos cambios de texto.
- Persistir en el repositorio privado las fuentes y los planes mediante SHA. Mantener cada sesión histórica como instantánea exacta de positionId, techniqueId, nombre/rol, prioridad, tipo, descripción y comentario.
- Los planes activos ya recibidos se incluyen aunque luego se haya retirado su asignación: desasignar sigue conservando el plan individual, salvo borrado completo explícito.
- Una nueva modificación de fuente actualiza todas sus futuras apariciones, incluidas descripciones manuales previas de ese campo. Una edición manual posterior se conserva hasta que exista una nueva modificación de esa fuente. Una lectura o sincronización repetida sin cambio de fuente no debe machacar ediciones manuales.
- Cambios offline de descripción actualizan la vista local de sesiones futuras y quedan pendientes de sincronizar. Al reconectar, guardar fuente y planes; otro dispositivo recibe ambos mediante su sincronización. Las proyecciones locales no se suben como una segunda escritura autónoma del plan. Los conflictos manuales concurrentes siguen siendo explícitos.
- No afirmar éxito de propagación si alguna escritura falla. Como fuente y planes no son una transacción GitHub multiarquivo, persistir versión de actualización junto con la fuente y checkpoint aplicado junto con cada plan. Una sincronización/relectura reintenta lo pendiente de forma idempotente, recalculando el corte temporal Madrid al reintentar; una sesión que ya pasó o es hoy no se toca en la recuperación.
- Extensión compatible del schemaVersion 1: descriptionUpdates en Techniques, commentUpdates en Comments, appliedDescriptionUpdates/appliedCommentUpdates en TrainingPlan, todos mapas opcionales UUID → versión de actualización. Metadatos asignados por el Worker; ignorar cualquier valor suministrado por el cliente al escribir. Sin valores secretos, endpoints nuevos ni datos de negocio en SQLite DO.

### 11.2 Cambios estructurales: análisis previo obligatorio

Nuevas posiciones/técnicas, eliminaciones, prioridades y reordenaciones no deben modificar el histórico ni hoy. El objetivo es rellenar solamente las fechas futuras originales con el mismo N y Tábata, manteniendo el algoritmo circular desde el punto alcanzado, sin reiniciar ni repetir para rellenar. Usar el orden actual del alumno de acuerdo con las decisiones de cursor que se aprueben. Si una posición terminó su pasada, sus nuevas técnicas esperan a la siguiente aparición. Si no queda calendario suficiente, quedan pendientes.

Antes de activar esta parte, consultar las ambigüedades sobre inserciones anteriores al cursor, eliminación de elementos en curso, cambios de lista circular, prioridad/orden y planes editados manualmente. Análisis en ANALISIS_CAMBIOS_ESTRUCTURALES.md. En esta entrega **no se activa el recálculo estructural**; las pruebas verifican que añadir o reordenar no altera implícitamente las sesiones mientras se resuelven dichas decisiones.

### 11.3 Pruebas requeridas

Verificar: todas las apariciones futuras de descripciones y comentarios, histórico exacto, competiciones finalizadas incluso en su día de torneo, sesión de hoy protegida, cambios de día en España, secuencia/fechas/N/Tábata intactos, versiones idempotentes, recuperación tras escritura parcial, conflictos SHA, edición offline y sincronización entre dispositivos, permisos y aislamiento de otros alumnos. Las pruebas de incorporación/replanificación de nuevas técnicas se añadirán cuando se apruebe la política estructural, sin confundir la ausencia actual de recálculo con una incorporación ya implementada.

## 12. Decisión del propietario: planes de solo lectura (14/10/2026)

Sustituye cualquier permiso anterior de edición manual de planes, incluido el apartado 11. El alumno consulta y exporta su plan, pero no modifica manualmente sesiones, ejercicios ni descripciones dentro del plan. Un entrenador participante utiliza igualmente un plan de solo lectura. El entrenador sigue modificando comentarios de las técnicas, sin editar directamente los planes.

La fuente de cambios son tecnics.json y trainer_comments.json. La propagación automática de descripciones/comentarios futuros se mantiene; el histórico, hoy y torneos finalizados permanecen protegidos. El recálculo estructural aún requiere resolver el resto de decisiones del análisis.

Frontend sin controles de edición; cliente local rechaza editar claves plan:*; PUT de plan devuelve 403 PLAN_READ_ONLY tras verificar sesión/autorización. Una importación de copia valida sus planes como referencias, pero no los utiliza para sobrescribir la planificación; perfil y técnicas siguen restaurándose. Los borradores manuales pendientes de versiones anteriores no se envían, se mantienen exportables y se sustituyen por el remoto solo por decisión explícita del usuario. Los planes ya persistidos no se borran ni se migran destructivamente.

Pruebas: denegación de escritura directa para alumno y entrenador participante, plan sin controles editables, copia/cola antigua incapaz de sobrescribir el remoto, PDF y consulta offline conservados y actualizaciones automáticas futuras operativas.


## 13. Corrección del propietario: acceso y alta manual de entrenador (14/10/2026)

Sustituye toda exigencia anterior de bootstrap o clave especial. Alta pública siempre como alumno; primer entrenador mediante edición manual de perfil en GitHub privado por el propietario. Retirar UI, estados y endpoint de bootstrap; los roles siguen validados en servidor y gestionados por entrenadores autorizados. No borrar datos pendientes al cerrar sesión o cambiar de usuario. Peso vacío es null; peso informado debe ser finito, mayor que cero y menor que 500 kg. Rechazarlo antes de persistir localmente y en API. Autorizar exclusivamente orígenes legítimos enumerados explícitamente, sin wildcard ni confianza derivada de Host.

## 14. CI/CD automático autorizado (14/10/2026)

Cada push a main debe validar instalación, tests, typecheck y build antes de publicar el Worker y PWA. GitHub Actions utiliza únicamente secretos Cloudflare de despliegue y se habilita una vez configurados manualmente. Fallos bloquean publicación. No alterar datos, secretos existentes ni identidad de recursos. Evitar despliegues concurrentes y SHA obsoletos. Reusar Pages Git si existe sin añadir pages deploy duplicado; Worker con assets es la publicación conjunta por defecto. Guía CI_CD.md. Sustituye el despliegue manual obligatorio por versión; Work sigue sin configurar Cloudflare directamente.

## 15. Corrección de límites JSON (14/10/2026)

Sustituye límites anteriores de 64 KiB por JSON y 10.000 caracteres por texto. Adoptar 4.194.304 bytes UTF-8 por documento y 4.259.840 bytes por petición AppApi, con descripciones/comentarios de hasta 100.000 unidades UTF-16. Límites compartidos cliente/servidor; comprobar al sincronizar, sin truncar ni borrar ediciones locales. Informar archivo, tamaño y máximo ante exceso. Lectura GitHub de archivos mayores de 1 MB por blob inmutable/SHA. Reintentar pendientes tras actualizar sin reiniciar sesión/IndexedDB. Mantener permisos, SHA, histórico y seguridad. Análisis y validación en JSON_SIZE_LIMITS.md.

## 16. PDF: continuidad de sesiones largas (14/10/2026)

Por petición expresa del propietario, se elimina la restricción que impedía exportar una sesión completa cuando no cabía en una página. Esta regla sustituye cualquier requisito anterior de no dividir sesiones. Las sesiones largas continúan en tantas páginas como necesiten, con la fecha, el número de sesión y una indicación de parte/continuación. Se mantienen todos los ejercicios, descripciones y comentarios, su orden y un tamaño legible de texto; no se exige acortar textos ni se truncan datos. Las sesiones cortas conservan su presentación habitual. La exportación sigue funcionando offline y no modifica los planes.
