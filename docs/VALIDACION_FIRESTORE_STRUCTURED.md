# Validación Firestore estructurado — 21/10/2026

## Estado antes del despliegue

Implementación exclusiva en feature/firestore-structured-model, creada desde main y con importación posterior y trazable del árbol DEV de PR #6/#10/#11. La PR #12 tiene destino develop. El propietario autorizó explícitamente su integración el 21/10/2026 para completar DEV. No se modificaron src/domain, Worker/API/provider PRO, wrangler.jsonc ni el workflow PRO respecto de main.

Validación local: 165 pruebas unitarias satisfactorias, incluidos doce oráculos completos congelados y siete pruebas nuevas del repositorio nativo. Typecheck, build PWA, compilación Worker, runtimes anteriores, diagnóstico DEV interceptado y runtime nativo satisfactorios. Este último verifica alta pública, roles, aislamiento, WebSocket autorizado, plan generado exacto, cambios futuros, eliminación estructural, histórico protegido, CAS, desasignación y limpieza física de cuentas, credenciales, revisiones y referencias de QA. Cada llamada comprueba el límite Free de 50 subrequests. El bundle DEV excluye el provider de archivos GitHub y las plantillas sintéticas de tests.

Estas pruebas usan Google interceptado. No acreditan todavía integración real, limpieza remota ni aceptación en navegador. Chromium se ejecuta en Actions Ubuntu 24.04 porque el navegador no está instalado en el contenedor de trabajo. No afirmar aceptación Safari/iOS ni dispositivos físicos.

## Gate remoto preparado

El workflow DEV ejecuta todas las pruebas históricas de navegador/PDF y el escenario online aislado antes de desplegar. Solo develop puede desplegar en el Worker DEV, con cuenta esperada, HEAD actual, proyecto fijo y credencial limitada a DEV. Requiere integrar primero la PR autorizada en develop.

Después del deploy: diagnóstico Firestore real; inventario completo y legado; eliminación condicional de legado autorizado; carga y roundtrip del catálogo original privado (17 posiciones/36 técnicas); QA real con tres contextos de navegador; limpieza de todos los datos de esa ejecución; inventario final sin legado, QA ni padres huérfanos. Los informes de artifacts/ contienen conteos, huellas, resultados y latencias sin credenciales ni el catálogo privado.

La QA de navegador cubre alta pública, catálogo recibido, perfil persistente, rechazo de elevación por payload, asignación/revocación de rol y sesión, autenticación de entrenador, doce autosaves recibidos sin refrescar, borrador fallido/exportación/reintento explícito, aislamiento, competición/inscripción, plan exacto, PDF descargable, comentario, recálculo de eliminación, histórico protegido, conflicto 409, desconexión sin replay, desasignación y revocación de WebSocket. El borrado administrativo de cuentas tiene comprobación física en runtime e inventario final real. No se añadió una funcionalidad pública nueva de borrado de cuentas.

## Evidencia remota

Commit validado: d1ae7e7add4753545a9a654c45860a9727484fed. Ejecución push [39582999031](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39582999031): validate y validate-online satisfactorios. La ejecución PR [39583006598](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39583006598) también pasó. Se conservan las evidencias aisladas en [evidence/structured-isolated-2026-10-21](evidence/structured-isolated-2026-10-21/firestore-local-browser.json): tres contextos Chromium, 12 cambios, p50 934 ms/p95 942 ms, PDF, permisos, autenticación y limpieza satisfactorios. **Google interceptado; estas medidas no son latencias de Firestore DEV.** Las capturas emparejadas contienen únicamente el texto sintético de la descripción, sin publicar el catálogo privado.

El job deploy-dev fue rechazado antes de iniciar un runner. Anotación literal de GitHub: `Branch "feature/firestore-structured-model" is not allowed to deploy to development due to environment protection rules.` La segunda anotación indica `The deployment was rejected or didn't satisfy other protection rules.` No se ejecutó Wrangler ni se realizó inventario, limpieza, carga del catálogo o integración real de esta implementación.

Corrección del propietario (21/10/2026): el intento de desplegar directamente una feature fue incorrecto. No se deben modificar las reglas del Environment. Se retira la excepción tanto del workflow como de los scripts administrativos y se autoriza explícitamente fusionar la PR #12 en develop después de validar. El push resultante a develop será el único origen del despliegue DEV. Se mantiene prohibida toda modificación de main/PRO. La indicación anterior de permitir la feature en el Environment queda retirada.

Comprobación final antes de documentar el bloqueo: main permanece en 3b8125cb362f665f908e4028d54514f65f00459a y develop en f0080f89889503cdd25cc7d2f0b42f183c423b40. La PR #12 está abierta y sin conflictos; no se fusionó. **La tarea sigue pendiente de operaciones y aceptación reales en DEV.**

Revisión adicional independiente: runtime con cinco planes activos simultáneos dentro del presupuesto de 50 subrequests por petición; limpieza física también de revisiones de planes interrumpidos conocidos por el marcador QA. El inventario final preparado detecta documentos sintéticos nativos además de marcadores QA y padres huérfanos. Estas comprobaciones adicionales siguen siendo aisladas hasta integrar la PR autorizada y desplegar desde develop.


## Primera integración real desde develop

El propietario autorizó integrar en develop. PR #12 fusionada en ac2bfb4db10588bbc3162ed30c3575f1ca416b9b. Actions [39589079506](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39589079506) pasó ambas validaciones y publicó exclusivamente pgt-github-probe-dev, versión 84a81df7-56bc-48b8-ab82-d15ec51f4021. Preflight real satisfactorio: pgt-bjj-dev/(default), europe-west1, STANDARD/FIRESTORE_NATIVE, CRUD/CAS, rechazo anónimo y borrado diagnóstico.

Inventario: pgt_resources 62 documentos; pgt_qa_runs 3; sin padres huérfanos. Clasificación de perfiles heredados: 2 registros DEV de prueba del propietario y 9 sintéticos. Inventario aprobado con huella f3e0a29781dceb99c5854c91c8e5036e6b864c38. El recorrido de borrado terminó y bootstrap confirmó ausencia de colecciones heredadas; falló después al leer el catálogo original: REFERENCE_CATALOG_READ_FAILED. No se ejecutó aún QA real de la aplicación. Se mantiene el modo de mantenimiento hasta inicializar correctamente la referencia.

Corrección preparada: la petición GitHub omitía el User-Agent obligatorio, a diferencia del provider anterior. Se añade el identificador de la aplicación, diagnóstico HTTP sin contenido privado y fixture que rechaza la ausencia de ese header y devuelve Base64 con saltos de línea como GitHub. El importador sigue limitado al archivo original fijo y no escribe en GitHub. El proceso administrativo conserva ahora un informe parcial después del inventario y después del borrado, incluso si falla una fase posterior. Revalidación y segunda integración DEV pendientes.


## Catálogo original verificado y recuperación de lectura

PR #13 integrada en develop d1ab0f0572782a20d70e23f292bb660a452481bc. Actions [39590675347](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39590675347) publicó el Worker DEV af8f4d98-ca49-4488-93f2-fe6e1c709d66, pasó preflight real, confirmó cero legado y cargó el catálogo original: 17 posiciones/36 técnicas, roundtrip exacto, checksum 29f35baf4def20d6f05aee1f0542d3706124282d y structureChecksum e4548c153edce4f973388e155af01ceebdb58f81. El repositorio privado solo recibió GET al catálogo fijo.

QA real: altas/perfiles/roles/permisos correctos; doce guardados recibidos por otro navegador sin refrescar, muestras entre 3061 y 3179 ms. Después de crear/asignar una competición, una consulta snapshot devolvió 503 y el alumno no recibió el plan en su caché dentro del plazo. La prueba falló y ejecutó su limpieza; no se presenta como aceptación completa. Se prepara recuperación acotada exclusivamente de GET (máximo tres reintentos), sin repetir PUT/POST ni guardar cambios offline. El ensayo inyecta un 503 de lectura tras la asignación y exige recuperación automática; conserva códigos seguros de errores sin publicar contenido privado. El fixture ordena mapas como Firestore para cubrir diferencias con el transporte real. La verificación de residuos se ejecuta también cuando falla QA, conservando el resultado fallido.


## Aceptación funcional real y presupuesto Cloudflare

PR #14 integrada en develop 09d838a0f967b1052eb6e82add60453577581c62. Actions [39593963698](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39593963698) pasó validación, despliegue y QA real, con Worker DEV 3da5c013-b7f1-4e35-85e5-6362035c9171. Tres contextos Chromium comprobaron los escenarios descritos arriba, incluido PDF y comparación exacta con el dominio congelado. Doce autosaves: p50 3388 ms, p95 4503 ms (incluyen debounce de 700 ms, commit, WebSocket y lectura/render autorizado). No representa dispositivos físicos ni Safari.

Inventario final real: settings 2 documentos, technique_catalog 55 documentos; cero legado, QA, documentos de prueba u huérfanos. Catálogo original 17 posiciones/36 técnicas, mismas huellas publicadas en la sección anterior. Producción permaneció fuera de alcance.

El informe también registró cuatro errores FIRESTORE_SUBREQUEST_LIMIT recuperados por GET. Por ello el éxito funcional no se considera aún aceptación de estabilidad. Se prepara una consulta Firestore nativa por revisión que reúne sus tablas hijas inmediatas, en lugar de una consulta por cada tabla. Mantiene documentos, orden, CAS y publicación atómica; también reduce consultas al retirar revisiones. La prueba aislada comprueba alcance, caché e invalidación y el gate real pasa a rechazar cualquier FIRESTORE_SUBREQUEST_LIMIT, aunque el cliente lo recupere. Pendiente nueva integración DEV y resultado real de esta corrección.


## Contexto I/O de Durable Objects

PR #15 integrada y desplegada desde develop f49a29656e7c43154a9b7b90e7b0adc1993e7443, Actions [39597010564](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39597010564), Worker f31cd780-b0af-4c4b-bca2-9dba6df88ff8. Google real aceptó la consulta nativa; todos los escenarios funcionales pasaron, pero el gate estricto rechazó un FIRESTORE_SUBREQUEST_LIMIT en training-day. Limpieza e inventario final satisfactorios (settings 2, catálogo 55, cero legado/QA/huérfanos).

La reducción de consultas por sí sola no aísla el presupuesto del contexto I/O compartido por solicitudes concurrentes al mismo Durable Object. Corrección preparada: entrada interna FirestoreIO, enlazada exclusivamente al mismo Worker DEV; cada llamada Google pertenece a una invocación Worker independiente. El DO conserva autorización, sesiones, CAS y coordinación; el servicio no expone rutas públicas, permite solo OAuth y la base fija DEV, y bloquea redirecciones. No requiere secretos ni servicios PRO ni cambia cuotas o planes. Se añade una ráfaga de doce lecturas simultáneas con más de cincuenta llamadas externas en total, y rechazo previo al transporte de destinos ajenos a DEV. Pendiente aceptación real.

Referencias: https://developers.cloudflare.com/changelog/post/2026-08-28-durable-objects-dynamic-workers-limit/ , https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/ y https://developers.cloudflare.com/workers/platform/limits/ .


## Operación completa por invocación

PR #16 integrada en develop 3eaa71562a20c96dc54fcfb8d30a9d87b3fc9e1a, Actions [39599386060](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39599386060), Worker 07b7dcbf-7815-4444-bc3c-69d49a652eb6. Todos los escenarios funcionales volvieron a pasar, pero tres FIRESTORE_SUBREQUEST_LIMIT provocaron el rechazo del gate. La entrada HTTP por llamada no resolvió el presupuesto compartido y se sustituye; inventario final limpio (settings 2, catálogo 55, cero legado/QA/huérfanos).

La nueva entrada privada DomainIO ejecuta una operación completa con repositorio y contexto propios. El coordinador conserva la serialización y recibe solo cambios de sesiones/checkpoints; los aplica mediante transacción SQLite antes de devolver la respuesta. Los datos funcionales nunca se replican en SQLite. La respuesta conserva su contexto RPC hasta consumirse, sin serializar el cuerpo funcional en un argumento RPC ni imponerle ese límite de tamaño. Las claves privadas aceptadas son únicamente app-session y plan-update; lectura defensiva y cambios finales tienen pruebas propias. No cambia la autorización ni las reglas de negocio.

La instrumentación del runtime interceptado agrupa las peticiones por invocación nativa y reserva cinco llamadas para OAuth/RPC; una operación lógica puede atravesar coordinador y Worker y su suma no representa un solo presupuesto. La cabecera de trazado solo se inyecta al compilar el test, nunca en el bundle desplegado. El contenedor local dejó de responder durante la validación; se continúa mediante PR y CI, sin integrar hasta superar las comprobaciones obligatorias y sin presentar el ensayo local interrumpido como satisfactorio. Pendiente aceptación real de esta corrección.


## Preservar autenticación y mutaciones en DO

PR #17 integrada en develop 6b870a79021cca5f12de2c52d7c3bf331f1b2d6f. CI pasó 168 pruebas y ambos jobs, con máximo interceptado 42 peticiones Firestore por invocación y reserva de cinco para OAuth/RPC. Actions [39603131833](https://github.com/dmda92/pgt-bjj-planner/actions/runs/39603131833) publicó Worker 8ae264d4-16cf-4a3c-9896-1c1a83be9041; diagnóstico/catálogo correctos, pero login devolvió FIRESTORE_DEV_UNAVAILABLE. QA no completó escenarios; limpieza e inventario final satisfactorios, sin datos sintéticos.

Se conserva la autenticación (incluida derivación de contraseña) y todas las mutaciones en el Durable Object, con su contexto original de CPU. Solo las consultas GET se ejecutan mediante DomainIO; los checkpoints privados que generen se aplican en SQLite antes de responder. No se cambia el hash ni se rebajan iteraciones. El fallo remoto anterior era genérico, por lo que no se atribuye una causa exacta sin evidencia. Se añade clasificación fija por etapa/recurso/serialización/I-O/desconexión, sin mensajes arbitrarios ni valores privados, para poder identificar un fallo de RPC. Pendiente nueva aceptación real.
