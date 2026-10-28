# PGT — requisitos iniciales y reglas

Consultar **docs/REQUISITOS_PGT_APP.md** antes de implementar o modificar funcionalidades; contiene la especificación
inicial y la corrección 2.1 (apartado 11, actualizaciones solo futuras). El propietario confirmó que la frase «No usar
GitHub privado, GitHub REST API» en 2.1 es una errata: usar GitHub privado + REST API + Worker según el resto del
documento. Conservar el origen de los requisitos y documentar expresamente las correcciones del propietario.

El propietario declaró terminadas las pruebas de viabilidad el 13 de octubre de 2026 tras confirmar lectura, escritura,
login, conflictos, aislamiento, borrado y sincronización móvil/ordenador. Autorizó desarrollar la aplicación. Conservar
esta evidencia sin afirmar que las pruebas locales equivalen a integración remota ni dar por probadas comprobaciones que
no realizó. La conexión del complemento GitHub no equivale al token privado del Worker.

Código en dmda92/pgt-bjj-planner, frontend src/ y API worker/. Datos de negocio exclusivamente en dmda92/pgt-bjj-data,
PRIVADO, bajo PGT/. No cambiar su visibilidad. Tokens solo en secretos del Worker; no en bundle, Git, logs ni Markdown.
Nunca acceso genérico de API, rutas arbitrarias ni elevación desde payload del cliente. Persistencia auxiliar SQLite DO
solo sesiones, límites y coordinación.

Antecedente inicial (sustituido por la política vigente al final): Work no accedía a Cloudflare ni configuraba o
desplegaba; solo el propietario ejecutaba deploy. Mantener Free; no pedir tarjeta. Usar JSON versionados con escrituras
SHA condicionales y reintentos idempotentes; conflictos reales nunca se resuelven por último escritor. No eliminar
cambios pendientes ni mezclar IndexedDB entre usuarios.

Tras superar el gate, implementar domain/application/infrastructure/ui. Fuente única de técnicas: posiciones a trabajar
mínimos.json. No inventar, normalizar ni reconstruir order; arrays determinan orden y UUID son exclusivos de cada
alumno. Generador puro: prioridades existentes ascendentes, primera/segunda, luego alternar retroceder 1 y avanzar 2
circularmente; completar todas las técnicas de cada pasada antes de avanzar. Continuidad entre sesiones, ejercicios y
tiempos configurados por competición; dos ciclos y duración (2T+C)N+D (N-1). Proteger siempre snapshots de sesiones <=
hoy y torneos <= hoy, según Europe/Madrid. Descripciones y comentarios cambian por UUID solo en sesiones > hoy de planes
activos, sin regenerar la distribución; persistir fuentes y planes con SHA, versiones idempotentes y recuperación.
Recálculo estructural pendiente de las decisiones de `docs/ANALISIS_CAMBIOS_ESTRUCTURALES.md`; no activarlo sin
resolverlas. Distinguir desasignación de borrado entero.

Antes de subir: npm test, npm run typecheck, npm run build, npm run check:worker y npm run test:runtime (este último usa
el bundle generado por check:worker). Documentar cobertura y límites; mocks no sustituyen integración real. La
aplicación incorpora plantilla oficial, registro, bootstrap, PWA, IndexedDB, planes y PDF. Registrar pruebas ejecutadas
y pendientes en docs/VALIDACION.md. No afirmar cobertura numérica ni aceptación en Safari/iOS sin medirlas.

## Identidad visual del frontend

Antes de modificar UI consultar `docs/DISENO_FRONTEND.md` y `.agents/skills/frontend-design/SKILL.md` (skill oficial de
Anthropic, incorporada con licencia). Usar fuentes locales, paleta pizarra/azul y superficies claras conforme a las
capturas elegidas por el propietario; no derivar los colores del logo PGT. Mantener el dashboard de entrenador, foco
visible, tamaños táctiles y movimiento reducido. Los resúmenes son cálculos de datos ya autorizados; no inventar
actividad, porcentajes globales, tendencias ni endpoints. No modificar autenticación, permisos, sincronización,
generador o PDF para conseguir un efecto visual. La nueva consulta de cobertura es exclusiva del entrenador y calcula
métricas sobre snapshots autorizados, sin regenerar planes ni introducir endpoints. Ejecutar también
`npm run test:browser` tras cambios de UI y revisar capturas de escritorio y móvil.

Validación de la dirección actual (capturas de referencia y cobertura) en `docs/VALIDACION_REDISENO.md`; rediseño
anterior en `docs/VALIDACION_DISENO.md`; el informe histórico `docs/VALIDACION.md` permanece intacto.

Cambios autorizados el 14/10/2026: PRO 01 (refresco de todos los campos del perfil tras sincronizar, preservando
borradores sin guardar) y entrenadores como participantes de competiciones. Detalles y validación en
`docs/CAMBIOS_PERFIL_PARTICIPANTES.md`. No filtrar entrenadores del selector de participantes.

Corrección de planes futura del 14/10/2026 en apartado 11 de requisitos. Metadatos de propagación solo asignados por
servidor; cliente no puede falsificar checkpoints. No sobrescribir ediciones manuales por mera lectura. Validación en
`docs/VALIDACION_ACTUALIZACIONES_FUTURAS.md`.

Decisión vigente (14/10/2026), apartado 12: planes de solo lectura para participantes, también entrenadores
competidores. No habilitar edición manual en UI/API/cliente ni importación de planes como cambios. Las modificaciones se
realizan en técnicas y comentarios; mantener propagación futura e histórico protegido. Conservar borradores antiguos
para exportación, sin subirlos o descartarlos silenciosamente.

Corrección 14/10/2026 apartado 13: eliminar bootstrap de propietario y clave especial de alta de entrenador. Primer
entrenador configurado manualmente en GitHub privado. ALLOWED_ORIGINS enumera orígenes exactos; configuración de Worker
con dominio real, no ejemplo. PROBE_ADMIN_KEY solo permanece para viabilidad heredada; no usarlo en AppApi. Peso
validado antes de guardar localmente y en servidor; preservar pendientes previos.

Antecedente CI/CD del propietario (14/10/2026), subordinado a la política vigente al final y sin autorización nueva para
PRO: preparar GitHub Actions para validar y publicar Worker + PWA en cada push a main, con secretos Actions configurados
manualmente y activación CLOUDFLARE_DEPLOY_ENABLED=true. Sustituye la obligación anterior de ejecutar deploy manual por
cada versión. Work no accede al panel Cloudflare ni establece secretos. Workflow .github/workflows/cloudflare.yml, guía
docs/CI_CD.md; serializar producción, verificar HEAD y no duplicar Workers Builds. Conservar datos,
nombre/bindings/migración y secretos existentes.

Límites JSON vigentes (apartado 15, 14/10/2026): constantes src/domain/json-limits.ts, 4 MiB por documento, envoltorio
AppApi +64 KiB y 100.000 unidades UTF-16 por descripción/comentario. No truncar/borrar automáticamente. Errores
identifican archivo y bytes sin contenido ni rutas privadas. Contents object + blob inmutable por SHA para lectura >1
MB; nunca URLs arbitrarias. Mantener dirty/checkpoints tras fallos. Guía docs/JSON_SIZE_LIMITS.md. Antecedente de
validación: verificar Actions y el paso efectivo de deploy solo durante una promoción a main expresamente autorizada
conforme a la política vigente.

### PDF: requisito vigente de sesiones largas

La sección 16 de docs/REQUISITOS_PGT_APP.md sustituye las reglas anteriores que prohibían partir sesiones. Permitir
continuidad en páginas adicionales sin rechazar la exportación por longitud, sin truncar textos ni modificar datos, y
con fecha y marca de continuación.

## Eliminaciones estructurales APROBADAS (14/10/2026)

Sustituye la prohibición anterior de activar recálculo para este caso: eliminar técnicas/posiciones recalcula todas las
sesiones > hoy de planes activos, con fecha Madrid; protege literalmente pasado, hoy y torneos <= hoy. Continuidad
compartida en src/domain/plan-continuity.ts, sin reiniciar prioridades ni introducir repeticiones de relleno. Persistir
tombstones server-owned, checkpoints y cursores verificables; conservar planes y mostrar bloqueo recuperable si catálogo
vacío o legado ambiguo. Sync incompleta mientras haya planes bloqueados. No aprobar por extensión
adiciones/reordenaciones/prioridades nuevas todavía pendientes. Consultar docs/ANALISIS_CAMBIOS_ESTRUCTURALES.md y
apartado 17 de requisitos.

Panel de entrenador, apartado 18: dividir ficha derecha en Técnicas/Planes/Administración; Técnicas por defecto en cada
selección. Separar identidad seleccionada de snapshot cargado, mostrar spinner durante carga y descartar respuestas de
selecciones anteriores. Conservar selector izquierdo y estado inicial.

Optimización de fichas (apartado 19): endpoint entrenador /view por sección; lista de planes y detalle individual.
IndexedDB trainerViews separada de entries, claves por entrenador/alumno/sección/plan, datos locales inmediatos y
comprobación SHA en segundo plano. DO solo coordinación SHA/día, nunca caché de negocio; mantener CAS/relectura de
fuentes y permisos actuales. Consultas no alteran dirty/base/cola. Invalidar por logout/401/403 del actor
correspondiente. Validación y banco en docs/RENDIMIENTO_ENTRENADOR.md, scripts/benchmark-trainer.mjs y tests Chromium de
caché incluidos en test:browser. No presentar medidas sintéticas como producción.

Selectores controlados: capturar el valor del evento antes de llamar a run u otra función que espere operaciones
asíncronas. El rol debe mostrarse pendiente mientras se guarda, confirmar desde perfil remoto o revertir ante fallo;
mantener permisos y CAS.

Feedback UI, apartado 20: verde discreto solo para sincronización realmente completada, derivado de
dirty/proyecciones/planes bloqueados y borradores de perfil; no mostrar éxito con pendientes. «Crear competición» con
spinner inmediato y botón temporalmente deshabilitado. Descripciones del alumno en Entrenador: textarea readOnly, no
disabled, conservando contenido completo.

### Guardado explícito de participantes (14/10/2026)

Participantes: cambios locales inmediatos en CompetitionCard; persistir solo mediante Guardar datos, deshabilitado sin
diferencias. Conservar borrador y SHA base ante fallo/conflicto.

## Desasignación con borrado individual — corrección del propietario (14/10/2026)

Sustituye todas las reglas anteriores que conservaban visible el plan desasignado. Al guardar la desasignación, borrar
el JSON individual remoto del participante, sin borrar la competición ni planes de otros alumnos. El índice mantiene
tombstones por alumno; sincronizar elimina la copia local limpia incluso tras trabajar offline. Reasignar elimina el
tombstone y genera un plan nuevo. El borrado explícito incluye sesiones históricas de ese plan; no altera las reglas de
protección ante recálculos automáticos. Persistir tombstone antes del borrado para recuperar fallos parciales.

### Validación de fechas de competición (15/10/2026)

El formulario señala el campo de fecha incorrecto, con mensaje asociado y validación nativa accesible. Torneo
estrictamente posterior al inicio y máximo 730 días, conforme al dominio. Corregir el campo retira el error; no enviar
solicitudes inválidas. Mantener validación backend. Pruebas de fechas imposibles/bisiestas, igualdad, anterioridad,
rango y corrección/reintento.

### Mínimo de descansos en nuevas competiciones (15/10/2026)

Corrección del propietario: Cambio de roles y Entre técnicas requieren enteros entre 1 y 3600 segundos al crear
competición. Formulario señala el campo mediante min=1 y validación nativa; Worker rechaza cero antes de escribir.
Sustituye admisión de descansos cero para nuevas altas. Leer/exportar/recalcular planes históricos con cero sigue
permitido sin modificar sus parámetros. Regresión: cero rechazado sin petición/escritura y uno aceptado.

### Feedback de borrado y espera del entrenador (15/10/2026)

Borrado de competición con estado inmediato y spinner accesible en su tarjeta; impedir doble envío y ediciones durante
borrado, retirar estado ante fallo. Placeholder de alumno más compacto, título 21 px, texto 15 px; carga horizontal con
spinner 28 px y título 18 px. Mantener diseño pizarra/azul y movimiento reducido. Prueba Chromium con petición de
borrado retenida y confirmación de retirada de tarjeta.

### Trabajo por alumno en minutos y segundos (16/10/2026)

Crear competición presenta Trabajo por alumno (min:seg), con valor inicial 3:00 y formato m:ss/mm:ss, entre 0:01 y 60:
00. Convertir a segundos al enviar; conservar modelo, API, Tábata y planes existentes. Rechazar cero, segundos >=60 y
duraciones superiores al máximo sin petición. Pruebas de conversión exacta y formulario, persistencia de 3:00 como 180
segundos.

### Correcciones QA de recuperación, validación y PDF (16/10/2026)

BUG-005/001: snapshot autorizado completo con `planIssues` por plan (`PLAN_TOO_LARGE` con bytes/archivo o
`NO_TRAINABLE_TECHNIQUES`). Entregar las fuentes y último plan válido aunque una proyección no sea viable; permitir
corregir el catálogo/comentario. Confirmar fuentes solo después de CAS; conservar pendiente de plan hasta
proyección/generación válida. Nunca capturar autenticación, permisos, transporte o conflictos agotados como recuperación
de negocio. Mantener límites, checkpoints, algoritmo y sesiones protegidas. Sin técnicas no crear planes vacíos. Cliente
persiste los avisos por propietario y nunca comunica sincronización completa con pendientes.

BUG-002: peso opcional, finito, estrictamente mayor que 0 y menor que 500, sin discretización ni redondeo; formulario
admite coma decimal y señala el campo. BUG-003: cero días impide enviar competición, muestra error asociado al grupo y
enfoca la primera casilla; cualquier selección no vacía es válida y Worker mantiene su validación.

BUG-004 (alcance simplificado aprobado por el propietario el 16/10/2026): conservar Barlow local y sus caracteres
españoles, puntuación y enlaces. No añadir fuentes CJK, cirílicas ni emoji. Validar cobertura común de Barlow
Regular/SemiBold antes de generar: si un carácter no está soportado, mostrar error explícito sin descargar un PDF
incompleto ni modificar datos. Mantener textos largos, paginación y exportación offline. Sustituye el fallback Unicode
ampliado anterior.

### Icono de instalación PGT (16/10/2026)

El propietario solicita el logo oficial del equipo como icono del acceso directo/PWA y apple-touch-icon. Usar el
original `logo PGT.jpg`, convertido proporcionalmente a PNG 192/512, con rutas nuevas para evitar el icono genérico
cacheado. No cambiar logo interior, PDF, paleta ni interfaz.

### Selector en Mis planes (16/10/2026)

Petición del propietario: Mis planes usa el mismo comportamiento que Planes en la ficha del alumno del entrenador:
desplegable con torneos, opción inicial «Selecciona un plan» y solo el plan elegido visible. Mantener lectura,
exportación PDF, offline y estado sin planes. Al desaparecer el plan o cerrar sesión se limpia la selección; no
modificar datos, sincronización ni permisos.

### Panel de competiciones, preparación y día (16/10/2026)

Aplicar apartado 21 de requisitos. Competiciones separa listado/crear y filtra pasado con día Madrid. Preparación usa
repertorio actual y un plan completo seleccionado, sin referencia temporal. Entrenamiento del día agrupa multiconjuntos
posición/tipo, con orden mayoritario y alumnos únicos. Índices privados structure_<planId>.json ligados a SHA, creados
bajo demanda y retirados con el plan; no datos de negocio en DO ni reconstrucciones en sync. IndexedDB v3 añade
trainerDays aislada y con invalidación de permisos/sesión. Validación y límites en
docs/VALIDACION_PANEL_ENTRENADOR_2026-10-16.md.

### Nombre y ratio de cobertura (16/10/2026)

Corrección del propietario: «Preparación del plan» pasa a «Cobertura por alumno». La tabla por prioridad sustituye
«Repeticiones adicionales» por «Veces por prioridad»: Apariciones / Repertorio actual de esa prioridad, con dos
decimales y formato español. Denominador cero muestra «—». No cambiar otros cálculos ni datos del plan.

## Notificaciones de comentarios — petición del propietario (16/10/2026)

Campana en cabecera superior derecha de la sesión, con contador destacado de pendientes. Solo avisos internos recibidos
al restaurar/sincronizar comentarios, sin push ni nuevas peticiones. Cada técnica con comentario nuevo o modificado
tiene un aviso independiente; versiones servidor por UUID evitan duplicados, con huella del contenido para comentarios
legados. Un comentario eliminado/vacío o una técnica retirada deja de generar avisos. Mostrar posición, técnica y vista
previa; al abrir, marcar leído, abrir Mis técnicas, limpiar búsqueda y enfocar/desplazar a su técnica. Abrir la campana
no marca leídos los demás.

Persistencia IndexedDB v4 por usuario/dispositivo, separada de datos pendientes; recepción de versiones/avisos y
aceptación de comentarios en una transacción. Actualizar conserva cambios offline y usa los comentarios locales como
referencia para no notificar antiguos ya descargados. Una instalación nueva muestra los comentarios existentes recibidos
en la primera restauración. Leídos se conservan en ese dispositivo entre sesiones; no se sincronizan entre dispositivos
y se pierden al borrar los datos del navegador. Sin cambios en API, permisos, planes, generador ni PDF.

### Nombre del autor en comentarios de técnicas (16/10/2026)

Petición del propietario: en Mis técnicas sustituir «Entrenador:» por el nombre y apellidos del entrenador que escribió
el comentario. Guardar trainerName opcional por comentario, asignado exclusivamente desde el perfil autenticado en
Worker al cambiar el texto. Conservar autor de comentarios sin cambios, aunque otro entrenador guarde el documento o un
cliente omita/falsee ese campo. Comentarios históricos sin autor mantienen «Entrenador» hasta que cambie su texto; no
atribuirlos por suposición. Mantener versiones, notificaciones, permisos, offline y CAS. No modificar planes/PDF ni sus
instantáneas históricas.

### Entrenamientos por día en Mis planes (16/10/2026)

Petición del propietario: situar primero Mi entrenamiento del día con calendario y todas las sesiones propias para esa
fecha, incluso varias competiciones el mismo día. Fecha automática: primera sesión estrictamente posterior a hoy Madrid
entre planes activos (torneo >= hoy), igual que Entrenamiento del día del entrenador. Consulta explícita permite
cualquier fecha e incluye planes históricos; mostrar estado vacío si no hay sesiones. No agrupar ni deduplicar sesiones
de distintos planes; identificar el torneo y conservar ejercicios, textos y tiempos guardados. Mostrar sesiones
abiertas.

Debajo, separación visual clara y sección Planes completos con el selector Mi plan existente y todas las sesiones del
plan elegido, PDF sin cambios. Ambas selecciones son independientes. Calcular exclusivamente desde planes sincronizados
del usuario de sesión; uso offline, sin nuevas peticiones, tablas ni modificaciones al generador o snapshots. Reset de
fecha automática al volver a entrar en la pestaña/cambiar de cuenta.

### Tarjetas compactas de Mis técnicas (16/10/2026)

Petición del propietario: posiciones cerradas inicialmente, con nombre, prioridad, cantidad de técnicas, progreso de
descripciones y marca con número/nombre por técnica. Descripción no vacía tras trim define completada. Ámbar, círculo y
texto para pendientes; verde, check y texto para completadas. Una posición sin técnicas no se considera completa. Abrir
por resumen nativo accesible; editor inline a ancho completo con campos etiquetados, bloques por técnica, estado
individual y comentarios con su autor. Conservar orden, prioridad, altas, borrado y guardado existentes. Nueva posición
se abre para editar.

Mantener guía visual pizarra/azul, foco, teclado, 44 px y movimiento reducido. Estado de apertura por UUID solo en
sesión UI, conservado entre búsquedas y pestañas, reiniciado al cerrar sesión/recargar. Notificación abre la posición
cerrada antes de desplazar y enfocar su técnica. Sin cambios en API, persistencia, permisos, generador, planes ni PDF.

### Control de prioridad discreto (16/10/2026)

El propietario pide compactar el control y permite sustituir +/− si es necesario. Se conservan ambos dentro de una sola
cápsula neutra, sin botones azules independientes, con etiqueta en línea y número centrado. Mantener áreas táctiles 44
px, foco, mínimo 1 y pasos enteros. Retirar el distintivo P duplicado de la cabecera editable; conservarlo en el
resumen. Solo CSS, sin cambiar guardado ni comportamiento.

### Prioridad como subtítulo discreto (16/10/2026)

Petición del propietario: retirar abreviaturas P1/P2 de posiciones/técnicas en toda la app y PDF. Mostrar «Prioridad N»
debajo del nombre, en letra menor y tono secundario: resumen de Mis técnicas, sesiones completas/día y planes del
entrenador, ficha de técnicas del alumno y detalle de cobertura. Control editable conserva su cápsula, situada debajo
del nombre. En la tabla agregada Cobertura por prioridad, la columna Prioridad muestra solo el número; no hay nombre al
que asociar un subtítulo.

PDF: nombre de posición y pasada, seguido de Prioridad N en 7,5 pt frente a 10 pt del nombre. Medir, paginar y dibujar
cada fila con su tamaño real; mantener nombre/prioridad/técnica juntos cuando caben y conservar continuación para
sesiones largas. No modificar prioridades guardadas, orden, distribución ni textos de las instantáneas.

### Participantes nuevos visibles en Entrenamiento del día (16/10/2026)

Corrección por incidencia del propietario: antes el alta/asignación solo actualizaba índices y los snapshots iniciales
dependían de sincronizar cada alumno, por lo que no aparecían en el panel. Al guardar competición/participantes, crear
únicamente planes inexistentes de participantes nuevos, con fuentes autorizadas, CAS create-only y concurrencia máxima
4. Compartir esa creación con la restauración habitual; nunca regenerar ni sobrescribir snapshots existentes. Comprobar
catálogo para no conservar una creación que fue desasignada durante la operación. Catálogo sin técnicas o plan demasiado
grande conservan avisos recuperables, sin planes vacíos.

GET training-day sigue siendo de lectura de planes/derivados. POST training-day, exclusivo de entrenador, prepara los
snapshots que falten para asignaciones relevantes y devuelve el mismo informe; permite reparar altas anteriores sin
esperar login del alumno. Los índices de estructura siguen perezosos y vinculados a SHA. UI consulta GET al
entrar/cambiar fecha/Actualizar entrenamientos y usa POST solo si el informe señala planes pendientes; las consultas
normales no consumen el presupuesto de escrituras. Conserva caché offline. Guardar competición/asignación/borrado
invalida trainerDays solo de ese actor y una generación de peticiones evita que respuestas previas vuelvan a escribir
caché antigua. Sustituye para esta recuperación la prohibición previa de crear snapshots al consultar el panel, sin
extender autorización a recalcular planes existentes. Sin datos de negocio en DO ni cambios en permisos o algoritmo.

## Política obligatoria de ramas, entornos y despliegues

Política vigente del propietario (19/10/2026). Sustituye las instrucciones anteriores incompatibles de creación de
ramas, pushes, despliegue manual/automático y autorizaciones, también en documentación histórica. Los antecedentes se
conservan; no conceden permisos operativos actuales. Esta política no autoriza modificar ahora el workflow PRO ni
desplegar producción.

### Ramas y promoción selectiva

- `main` representa exclusivamente producción autorizada, está protegida y es la base de TODAS las nuevas `feature/*`,
  salvo excepción expresa del propietario. Las features NO nacen de `develop` por defecto.
- `develop` es integración y pruebas DEV, recibe features mediante PR y despliega automáticamente solo DEV cuando el
  CI/CD esté configurado y habilitado. Puede contener funcionalidades no autorizadas para PRO; nunca debe desplegar PRO.
- Ningún agente realiza commits o pushes directos a `main` o `develop`, ni fusiona en `main` sin autorización expresa y
  específica del propietario. Respetar protecciones sin eludirlas: no force push, excepciones ni cambios directos como
  atajos.
- Flujo: actualizar referencias remotas; comprobar `main`; crear `feature/<nombre>` desde el `main` actual y verificar
  su SHA base; implementar solo el alcance solicitado; probar; abrir PR feature → develop; integrar únicamente con las
  condiciones siguientes; probar en DEV; esperar autorización expresa de promoción; preparar PR selectiva a main;
  revisar diff completo y pruebas antes de fusionar.
- La promoción es por funcionalidad, nunca por rama de integración. Nunca abrir una PR general develop → main ni
  fusionar todo develop para promocionar una funcionalidad. Si develop contiene A/B/C, promover B debe excluir A/C.
- Preferir PR desde la feature original a main si historial y diff son limpios. Si incorpora develop u otras
  funcionalidades, crear rama limpia desde main actualizado y trasladar solo cambios/commits autorizados, con
  cherry-pick cuando proceda. Comprobar dependencias, no asumir independencia. Detener promoción si no puede
  garantizarse el alcance del diff.
- Tras promover, comprobar relación main/develop/features pendientes e incorporar correcciones exclusivas de PRO
  necesarias a develop mediante PR/procedimiento controlado; no hacer push directo.
- No merges/rebases indiscriminados: decidir si actualizar desde main o incorporar dependencias concretas. No incorporar
  todo develop por comodidad. Resolver conflictos preservando cambios de terceros. Si cambia el alcance de una PR,
  revisar otra vez el diff y repetir pruebas afectadas.

### Autorizaciones

Work puede leer/analizar, crear features, modificar código/documentación dentro del alcance, probar, crear commits de
trabajo, abrir PR a develop, revisar CI y preparar DEV.

Work puede integrar en develop únicamente si el propietario ha autorizado previamente tanto el alcance como su
integración DEV, las validaciones obligatorias pasan, no hay conflictos/dependencias pendientes ni cambios fuera de
alcance. Respetar cualquier orden de detenerse antes del merge.

Sin autorización expresa y específica del propietario, ningún agente puede fusionar en main, desplegar PRO, modificar
Worker PRO, Durable Objects, SQLite, bindings, migraciones, secretos, permisos o mecanismos de despliegue de producción,
alterar datos reales ni provocar indirectamente un deploy PRO. Una autorización de desarrollo, corrección, integración o
despliegue DEV nunca autoriza producción. Los cambios DEV nunca deben alterar recursos PRO. Ante incertidumbre de
entorno o alcance, detenerse y preguntar.

### Entornos y secretos

| Destino | Rama    | Worker               | Configuración      | Sesiones                          |
|---------|---------|----------------------|--------------------|-----------------------------------|
| PRO     | main    | pgt-github-probe     | wrangler.jsonc     | SECURITY / ProbeSecurity de PRO   |
| DEV     | develop | pgt-github-probe-dev | wrangler.dev.jsonc | namespace y SQLite propios de DEV |

DEV sirve frontend y API desde su Worker y usa exclusivamente usuarios de prueba. Temporalmente ambos usan
dmda92/pgt-bjj-data privado por decisión expresa: esto NO autoriza tocar datos de alumnos reales. No introducir Firebase
ni migraciones de datos sin otro encargo. La separación de sesiones no implica aislamiento de datos de negocio.

Secretos nunca en código, ejemplos con valores reales, documentación, bundles o logs. No reutilizar credenciales PRO sin
identificar/documentar permisos y obtener autorización. Guía operativa DEV: `docs/DEV_ENVIRONMENT.md`.

Antes de CADA despliegue comprobar Worker, configuración Wrangler, rama, cuenta, bindings y destino. La autorización DEV
no autoriza PRO. La tarea inicial feature/dev-environment termina con PR hacia develop, SIN merge automático ni primer
despliegue DEV.

### Comprobaciones obligatorias de inicio y cierre

Al iniciar: identificar rama actual y entorno afectado; clasificar desarrollo/integración DEV/promoción PRO; confirmar
feature nacida de main; leer reglas aplicables de AGENTS.md; verificar alcance autorizado antes de modificar archivos.

Al cerrar: documentar pruebas ejecutadas y resultados, archivos modificados, origen/destino de PR, revisión del diff,
recursos externos afectados, ausencia de operaciones PRO cuando corresponda y riesgos/pasos manuales pendientes. Antes
de cualquier PR a main revisar TODO el diff y confirmar que contiene exclusivamente cambios autorizados.

## Encargo Firestore y tiempo real — 20/10/2026, exclusivamente DEV

El propietario autoriza sustituir GitHub por Firestore como fuente de verdad y eliminar sincronización manual/edición
offline en DEV, manteniendo IndexedDB como caché, login, permisos y comportamiento funcional. Sustituye las
restricciones históricas incompatibles de persistencia; **no autoriza cambiar el algoritmo**, main, Worker PRO, secretos
PRO ni datos reales. Proyectos: pgt-bjj-dev autorizado; pgt-bjj-pro fuera de alcance. Toda feature nace de main y su PR
va a develop.

Plan original en docs/FIRESTORE_PLAN_2026-10-20.md; auditoría/decisión inicial en docs/FIRESTORE_AUDITORIA_DEV.md;
configuración manual y evidencias en docs/FIRESTORE_CONFIGURACION_DEV.md y docs/FIRESTORE_VALIDACION_DEV.md. Estado
inicial: solo auditoría y regresiones, sin implementación/despliegue de Firestore. Antes de implementar completar el
gate de infraestructura DEV del plan; no declarar superado con mocks. PR borrador hasta superar las fases pendientes.
Los fixtures de tests/fixtures/firestore congelan resultados del main base; no regenerarlos para acomodar el backend ni
retirar el guard de integridad del dominio.

### Implementación Firestore DEV — gate de infraestructura completado

Conexión remota verificada por Actions 39507963337, `(default)`, europe-west1, STANDARD/FIRESTORE_NATIVE, CRUD/CAS y
limpieza sintética. Propietario aporta reglas deny-all completas; referencia firestore.dev.rules, sin publicación nueva
ni permiso admin para runtime. Autorizado continuar PR #6. El backend DEV se inyecta mediante worker/dev.ts sin tocar
worker/index.ts ni application.ts/domain. DEV online requiere VITE_PERSISTENCE=firestore-dev; build sin bandera conserva
cliente previo. Ejecutar además test-firestore-app-runtime y test-firestore-online-browser sobre build DEV. El workflow
de despliegue DEV hace preflight y test-firestore-dev-live con identidades exclusivamente sintéticas. No confundir
transporte interceptado con Google remoto, ni ventanas móviles con dispositivos físicos. Operación y diferencias de la
propuesta inicial en docs/FIRESTORE_OPERACION_DEV.md. No migrar datos reales, borrar controles de origen sintético ni
presentar fixtures como catálogo oficial.

## Rediseño estructurado DEV — encargo 21/10/2026

Sustituye el almacenamiento opaco y las restricciones históricas incompatibles en DEV. Feature nueva desde main;
dependencias DEV importadas explícitamente. No cambiar dominio ni PRO. Datos nativos y entidades legibles, catálogo
original permitido sin cuentas reales; limpieza DEV autorizada tras inventario/clasificación. Flujo obligatorio: PR a
develop; despliegue DEV exclusivamente desde develop, nunca desde feature/*. El 21/10/2026 el propietario autoriza
explícitamente fusionar la PR #12 en develop para desplegar y completar la validación real. Esta autorización sustituye
para esa PR la orden anterior de no fusionar; no autoriza main ni PRO. Conservar las reglas del Environment development
y no crear excepciones para features. Auditoría en docs/FIRESTORE_STRUCTURED_AUDIT.md. No presentar publicación en
feature como despliegue, ni tests simulados como Google real.

El propietario amplía expresamente la autorización de integración DEV el 21/10/2026: «mergea/PR en dev para el
despliegue si lo necesitas». Abarca las correcciones necesarias de este rediseño, después de validar y siempre por PR a
develop; no autoriza pushes directos, despliegues desde feature, main ni PRO. PR #13/#14/#15 siguen ese flujo. Los
informes finales pueden quedar en una PR documental para revisión sin provocar otro despliegue.

## Optimización Spark — instrucción vigente 21/10/2026

Sustituye las instrucciones anteriores de ejecutar preflight CRUD/QA/inventario/limpieza reales tras cada deploy. CI y
navegador usan transportes aislados por defecto. La batería extensa nunca puede apuntar a Google. Sin pruebas de
carga/volumen/rendimiento reales, bucles de alta/borrado, inventarios completos por prueba ni reintentos automáticos de
QA fallida. No ampliar facturación. Mantener feature/firestore-structured-model y PR a develop **sin merge automático**
conforme al último encargo.

Prueba real mínima solo con cuota actual fiable y plan local que incluya limpieza: 200 lecturas estimadas, 150
escrituras (ampliación expresa del propietario para incluir alta), 50 eliminaciones, dos usuarios sintéticos y una
ejecución por cambio relevante. Cuota desconocida/cercana al límite: continuar offline y posponer Google. El contador
por instancia no es un presupuesto global de DO; no habilitar runner remoto hasta integrar esa garantía. Estado,
mediciones y límites en docs/FIRESTORE_CONSUMO_DEV.md. No tocar cuentas/planes creados por el propietario ni borrar
datos no clasificados.

El contador global privado ExecutionBudget ya usa un ledger SQLite compartido y una reserva de limpieza, probado en
runtime aislado. Esto no habilita un runner público real: debe propagar el mismo contexto a todas sus operaciones y
pasar el gate de cuota antes de activar cualquier HTTP Google. No describir la API ordinaria como presupuestada mientras
esa entrada siga deshabilitada.

El propietario ordena posteriormente «terminsa y despliega en desarrollo». Autoriza completar la prueba mínima, fusionar
la PR de esta feature en develop tras CI y desplegar exclusivamente DEV; sustituye para esta entrega la espera de
revisión sin merge. No autoriza main/PRO ni pruebas reales con cuota desconocida. La prueba mínima está conectada a
/api/dev/budget-smoke, solo administración autenticada, un usuario por build, cuota reciente y contador compartido con
limpieza reservada. workflow_dispatch operation=smoke es explícito; push/deploy no ejecutan Google QA.

## Altas estructurales futuras DEV — autorización 22/10/2026

El propietario autoriza modificar requisitos y código y desplegar en desarrollo: nuevas técnicas y nuevas posiciones con
técnicas recalculan exclusivamente sesiones posteriores a hoy Madrid. Hoy y pasado permanecen protegidos. Posiciones
vacías no alteran planes; su primera técnica activa el recálculo. Continuar desde cursor protegido, sin reiniciar
prioridades ni cambiar fechas/N/Tábata. Posiciones completadas esperan siguiente pasada; inserciones anteriores al
cursor esperan siguiente pasada. Una prioridad nueva entra en el anillo ordenado al terminar la aparición actual,
conservando fase -1/+2. Fuente normativa: apartado 11.3 y docs/PLAN_ADICIONES_DEV.md. Este encargo sustituye las
restricciones históricas que dejaban las altas pendientes, sin activar cambios aislados de prioridad/reordenación. Se
autoriza PR y merge a develop tras CI, exclusivamente DEV. Feature nace de main antes de incorporar develop. No
modificar main/PRO ni ejecutar Google QA sin cuota fiable.

## Corrección de nombres en planes DEV — 22/10/2026

El propietario reporta que al crear y renombrar una técnica a «Otra mas», el plan conserva «Nueva técnica», y ordena
corregirlo. Autorizado corregir nombres visibles de técnicas/posiciones por UUID únicamente en sesiones > hoy Madrid y
desplegar mediante PR a develop tras CI. No regenerar distribución ni modificar pasado/hoy, prioridades, continuidad,
descripciones, comentarios, fechas o parámetros. Reparación perezosa de nombres ya desactualizados al consultar planes
autorizados; sin barridos ni pruebas Google. Requisitos 11.4 y docs/PLAN_NOMBRES_DEV.md. Feature nueva desde main,
incorporar DEV después; main/PRO intactos.

## Firestore V2 — encargo vigente 26/10/2026

El propietario ordena ejecutar el plan integral y usar la rama existente fetaure/optimizacionFirestore.
Se autoriza refactorizar DEV con Firestore único, caché volátil y consultas/comandos selectivos,
sin cambiar algoritmo ni resultados de negocio. El origen de migración es GitHub PRO pgt-bjj-data
fijado por commit, solo lectura; no Firestore DEV. No modificar/borrar el origen ni mezclar DEV anterior.
Conservar importador read-only independiente para el futuro corte PRO; fuera del runtime.
Roles/contraseñas por vía controlada, offline de consulta completo tras descarga.
No ejecutar Google ni importación/activación sin inventario y presupuesto fiable; no desplegar PRO.
Plan y evidencia: docs/FIRESTORE_V2_IMPLEMENTACION.md y docs/VALIDACION_FIRESTORE_V2.md.

### Integración y despliegue DEV V2 autorizados — 26/10/2026

El propietario autoriza integrar estos cambios de la rama existente en develop mediante
PR y desplegar exclusivamente DEV tras CI. Sustituye la orden previa de no desplegar.
No autoriza main/PRO, modificar datos GitHub de producción, ni omitir el inventario,
cuota fiable y gates necesarios para importar/activar datos reales en Firestore DEV.
Publicar el código no equivale a activar la importación V2 ni a probar login remoto.

### Migración y puesta en servicio DEV autorizadas — 26/10/2026

El propietario ordena ejecutar la migración desde GitHub PRO sin alterar el origen
y dejar DEV lista para pruebas. Autoriza captura privada, importación/activación
exclusivamente pgt-bjj-dev, credenciales DEV independientes, verificación mínima
y reinicio mediante despliegue desde develop por PR tras CI. Se mantienen los
gates de inventario, cuota actual, presupuesto compartido e índices; no se amplía
IAM del runtime ni se autoriza main/PRO. Datos GitHub siempre de solo lectura.

### Equipo y participantes — encargo DEV 26/10/2026

El propietario solicita editar el cinturón de alumnos desde Administración del entrenador;
operación exclusiva de entrenador, limitada a cinturón, con CAS y permisos vigentes.
Equipo/Técnicas comparte tarjetas compactas desplegables con Mis técnicas; nombres y
descripciones del alumno son de solo lectura y comentarios editables con guardado explícito,
sin autoguardado ni notificaciones por pulsación. Conservar borradores ante fallo/conflicto.
Equipo y participantes ordenados por nombre con comparación española; participantes con
nombre y apellidos y tarjetas de selección adaptables, incluidos entrenadores competidores.
Autoriza integrar por PR a develop y desplegar DEV junto al arreglo PAYLOAD_INVALID del
editor, tras validaciones. Sustituye la pausa anterior; no autoriza main/PRO ni modificar
datos reales para QA. Evidencia: docs/CAMBIOS_EQUIPO_2026-10-26.md.


## Preparacion Firestore PRO ? encargo 28/10/2026

El propietario autoriza auditar y preparar soporte PRO, migrador y validador de solo lectura,
con pruebas locales en una rama aislada basada expresamente en develop. Es una excepcion
a la base main habitual y permite preparar posteriormente la promocion develop -> main;
no autoriza todavia PR/merge/despliegue real. Conservar los cambios locales ajenos.

Origen privado pgt-bjj-data, solo lectura y SHA fijo: la aplicacion GitHub sigue funcionando.
No congelar escrituras, detener Worker, conciliar incrementos ni repetir la migracion para
incorporar cambios posteriores. Estos cambios quedan excluidos por decision expresa.

Detenerse antes de la primera escritura Firestore PRO, cambios activos de secretos/bindings,
despliegues reales, merge a main u operaciones destructivas. Las reglas historicas de solo DEV
se sustituyen exclusivamente para esta preparacion; no conceden permisos remotos adicionales.
No reparar fuentes inconsistentes automaticamente, regenerar historico o restablecer claves PRO.
Evidencia y pendientes en docs/PRO_PREPARACION_2026-10-28.md.

### Decisiones posteriores del propietario: migración y preparación de release

El propietario autorizó expresamente carga/verificación/activación del SHA fijo en
Firestore PRO, realizada y verificada según docs/PRO_MIGRACION_RESULTADO_2026-10-28.md.
Decidió omitir el validador temporal y avanzar hacia publicación normal. Preparar PR
de soporte a develop y promoción develop -> main; pedir autorización específica antes
del merge a main que activa despliegue. No repetir migración ni conciliar cambios GitHub.
El propietario añadió FIRESTORE_SERVICE_ACCOUNT_JSON al Worker PRO, republicando
la versión antigua sin cambiar sus bindings. Conservar secretos y DO históricos.
