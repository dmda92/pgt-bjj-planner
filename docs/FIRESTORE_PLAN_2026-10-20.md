# PGT BJJ Planner — Plan de modernización de persistencia y tiempo real (solo DEV)

**Fecha:** 20/10/2026
**Repositorio:** `dmda92/pgt-bjj-planner`
**Proyectos Firebase existentes:** DEV `pgt-bjj-dev`, PRO `pgt-bjj-pro`
**Alcance autorizado:** desarrollo y validación en DEV. **Prohibido modificar o desplegar producción.**

## 0. Objetivo y restricciones innegociables

Reemplazar el repositorio GitHub de datos como almacenamiento operativo por Cloud Firestore y convertir la actualización de información en automática y en tiempo real entre dispositivos, **sin modificar el comportamiento funcional de la aplicación**. Eliminar el proceso funcional de sincronización manual, las colas de cambios pendientes y la dependencia de funcionamiento offline. Conservar datos locales como caché y para continuidad de interfaz, no como autoridad ni para permitir modificaciones offline.

- Mantener las mismas pantallas, permisos, operaciones, validaciones, resultados, cálculos y algoritmos; particularmente **no alterar el algoritmo de generación ni de recálculo de planes** (orden, prioridades, fechas, ejercicios, restricciones y tratamiento de cambios futuros/pasados).
- Se autoriza refactorizar ampliamente estructura, arquitectura, modelos de persistencia, interfaces, adaptadores, servicios, pruebas y código legado; no introducir funcionalidades nuevas ni cambios de producto.
- Preservar datos, UUID, referencias, contraseñas y hashes, roles, comentarios, descripciones, planes, asignaciones, revisiones y semántica de borrado. No forzar restablecimiento de contraseñas ni nuevas cuentas.
- Las operaciones online deben confirmar su persistencia antes de mostrarse como guardadas; si falla la red, mostrar error recuperable y no simular éxito ni encolar escrituras silenciosamente.
- Mantener IndexedDB como caché local opcional/útil; invalidar y actualizar mediante eventos de servidor. Evitar que datos locales antiguos sobrescriban cambios nuevos.
- Separación estricta entre `pgt-bjj-dev` y `pgt-bjj-pro` en identidades, permisos, variables, credenciales, bases, Workers y despliegues. En esta ejecución **NO acceder, escribir, desplegar ni cambiar secretos de PRO**.
- **Flujo de ramas obligatorio:** toda `feature/*` nace de `main` (NO de `develop`). Abrir PR de `feature/*` hacia `develop`. No fusionar a `main`, no desplegar PRO. Respetar protecciones, revisiones y CI existentes. Antes de crear rama, comprobar divergencia entre `main` y `develop` y planificar integración sin sobrescribir trabajo existente.

## 1. Investigación previa obligatoria (no asumir implementación)

Auditar en la versión actual del repositorio `main`, `develop`, workflows, Workers y cliente:

1. Identificar cómo se ejecutan actualmente el cálculo, recálculo, asignación de alumnos y actualizaciones de técnicas; documentar ubicación exacta del código y contratos funcionales. **No reescribir el algoritmo.**
2. Inventariar rutas, modelos, tamaños y relaciones de todos los documentos JSON almacenados en GitHub, incluidas estructuras por usuario, índices, catálogo maestro, planes, tombstones, revisiones y comentarios.
3. Revisar IndexedDB/Dexie, caché, estado React, sincronización al iniciar y manual, control de concurrencia mediante SHA, conflictos y estado offline. Detectar todos los consumidores y puntos de escritura.
4. Revisar autenticación actual, sesiones en Cloudflare Durable Object, permisos de entrenador/alumno y seguridad por recurso.
5. Auditar límites de tamaño de Firestore (máximo de documento), límites de escrituras/transacciones, listeners, índices, cuotas, costes, autenticación Cloudflare→Firestore y restricciones de conexión desde Workers.
6. Examinar workflows de DEV/PRO y las reglas de ramas reales. Registrar el commit base y una línea base de pruebas.
7. Proponer un esquema de datos Firestore optimizado sin obligación de replicar los JSON como documentos monolíticos. Debe soportar consultas eficientes, actualizaciones parciales, listeners específicos y permisos sin exposiciones entre usuarios.

**Entregable:** informe de auditoría, mapa de dependencias y propuesta de arquitectura con decisiones justificadas, antes de implementar.

## 2. Decisión técnica: comunicación en tiempo real

Evaluar y documentar dos alternativas, seleccionando la que cumpla mejor seguridad, simplicidad y costes:

**A. SDK Firestore en cliente con `onSnapshot`** para lecturas/suscripciones; requiere diseñar autenticación Firebase vinculada a la sesión actual y reglas Firestore que respeten exactamente permisos entrenador/alumno. No exponer credenciales de servicio al cliente. Las escrituras pueden seguir pasando por Worker si resulta conveniente.

**B. API autenticada de Cloudflare Worker para lecturas/escrituras + canal de notificaciones (SSE/WebSocket u otro mecanismo soportado)** que publique cambios confirmados; los clientes refrescan datos afectados. Requiere diseñar fan-out, reconexión, autorización de suscripciones y coordinación multiinstancia.

No implementar un falso tiempo real basado únicamente en sincronización manual ni sondeo agresivo. Si se elige una solución híbrida, documentar sus fronteras. No añadir Firebase Authentication por inercia: solo si es necesario y preservando la experiencia de login existente.

La fuente de verdad es Firestore; las mutaciones deben pasar por una capa de dominio/aplicación que mantenga las validaciones actuales. Usar operaciones atómicas o transacciones para concurrencia y consistencia. Mantener control de versiones/revisiones cuando sea necesario. Los cambios externos deben refrescar automáticamente las vistas de profesor y alumno autorizadas.

## 3. Preparación de infraestructura DEV

- Confirmar proyecto `pgt-bjj-dev`, Firestore Standard, región, base de datos y modalidad de facturación. No crear recursos PRO.
- Crear identidad DEV de permisos mínimos, con mecanismo seguro de autenticación desde Cloudflare Worker; guardar secretos exclusivamente en el entorno DEV. No incluir claves en Git ni en bundles web.
- Configurar reglas de seguridad e IAM según arquitectura escogida; pruebas negativas para accesos indebidos y separación entre usuarios.
- Actualizar `wrangler.dev.jsonc` y workflow DEV de manera que apunten exclusivamente a `pgt-bjj-dev`; configurar variables necesarias y mantener PRO sin cambios.
- Si faltan acciones manuales o permisos, **detenerse y solicitar instrucciones concretas al propietario** sin improvisar accesos de producción.

## 4. Implementación por fases

### Fase A — Contratos y pruebas de regresión

- Congelar mediante pruebas de caracterización los algoritmos de generación y recálculo de planes y los flujos de negocio críticos. Añadir fixtures representativas, incluidos límites, múltiples prioridades, cambios de alumno, fechas pasadas, posiciones partidas y concurrencia.
- Documentar API/contratos existentes y resultados esperados. El criterio es equivalencia observable antes/después, no similitud del código.

### Fase B — Separar dominio de persistencia

- Extraer/adaptar repositorios y servicios de aplicación para que no dependan de GitHub SHA, rutas de ficheros ni sincronización. Se permite rediseño amplio y eliminación de código obsoleto.
- Conservar operaciones de dominio y su semántica. Evitar duplicar cálculos en cliente y servidor si genera resultados divergentes.
- Definir claves estables, revisiones, idempotencia y transacciones. Establecer límites de tamaño y estrategia de fragmentación de documentos.

### Fase C — Firestore y API DEV

- Implementar lectura, escritura, actualización parcial, eliminación, listados, consultas y transacciones en Firestore DEV.
- Preservar autorización por usuario/rol y errores funcionales existentes; verificar que no existen fugas de datos.
- Implementar pruebas de concurrencia: ediciones simultáneas, altas/bajas, cambios de asignación y recálculos de planes. No aceptar pérdidas silenciosas.

### Fase D — Actualización automática entre dispositivos

- Integrar suscripciones de tiempo real sobre los recursos necesarios y gestionar conexión, reconexión, duplicados, eventos fuera de orden, limpieza de listeners y cambios de sesión.
- Tras una escritura confirmada, reflejarla localmente y en otras sesiones abiertas sin recarga. Ejemplos: alumno modifica técnica→profesor ve cambio; profesor asigna alumno→se actualiza entrenamiento del día; comentarios y planes actualizados aparecen donde corresponda.
- Definir comportamiento al recuperar conexión: recarga de estado actual; **no reenvío automático de mutaciones offline**.

### Fase E — Caché local y eliminación de sincronización antigua

- Mantener IndexedDB para acelerar arranque y vistas si aporta valor, con aislamiento por usuario y validación frente al servidor.
- Deshabilitar/eliminar botones y procesos de sincronización manual, colas de escrituras pendientes, conflictos basados en GitHub SHA y lógica offline no necesaria, siempre que no afecte otras funcionalidades.
- En caso de pérdida de conexión, lectura de caché identificada como potencialmente desactualizada si procede; bloquear escritura y mostrar mensaje. Al reconectar, obtener datos vigentes.
- Mantener instalación PWA si existe; no exigir capacidad de edición offline.

### Fase F — Migrador y ensayo en DEV

- Crear herramienta repetible, auditable e idempotente para exportar datos de GitHub, validarlos y convertirlos al esquema Firestore; soportar modo `dry-run`, informes, conteos, hashes/checksums cuando corresponda y reintentos seguros.
- Ensayar solo con datos de prueba o copia expresamente autorizada en DEV. No leer ni copiar datos reales de PRO sin autorización explícita y un plan de tratamiento seguro.
- Verificar integridad referencial, UUID, credenciales, índices, técnicas, asignaciones, comentarios, planes, revisiones, tombstones y conteos. Identificar documentos mayores de 1 MiB y tratarlos sin pérdida.
- Preparar procedimiento futuro de cutover PRO, ventana de congelación de escrituras, exportación final, verificación, rollback y tratamiento de clientes con versiones anteriores; **documentarlo, no ejecutarlo**.

### Fase G — QA integral DEV

- Ejecutar unit tests, integración, typecheck, build, comprobación Worker, pruebas de navegador y rendimiento, según scripts existentes.
- Probar en dos navegadores/dispositivos y dos roles: modificación de técnica, asignación de alumno, recálculo, eliminación, actualización de entrenamiento del día, planes futuros, cambio de sesión, cierre de sesión, conexión intermitente y concurrencia.
- Comparar planes generados antes y después mediante fixtures: igualdad de fechas, ejercicios, prioridades, técnicas, conteos y resultados, no solo ausencia de excepciones.
- Medir latencia real de propagación y costes aproximados de lecturas/escrituras/listeners; fijar umbrales razonables y documentar observaciones.
- Probar permisos negativos: un alumno no debe acceder a datos ajenos, un usuario no autorizado no puede escribir y DEV no puede consultar PRO.

## 5. Git, CI/CD y despliegue permitido

1. Leer estado actual de `main`, `develop`, ramas, PR y pipelines.
2. Crear `feature/firestore-realtime-dev` **a partir de `main`**; no a partir de `develop`.
3. Implementar y validar en esa rama; commits pequeños y trazables.
4. Abrir PR **`feature/firestore-realtime-dev` → `develop`**; resolver diferencias con `develop` sin cambiar semántica funcional.
5. Tras checks correctos y revisión, integrar en `develop` conforme a las protecciones existentes; desplegar **solo DEV** mediante el pipeline existente.
6. No crear PR hacia `main`, no fusionar `develop` en `main`, no disparar deploy PRO, no modificar secrets PRO y no activar Firestore PRO.
7. Si la configuración actual de workflows podría desplegar producción accidentalmente, bloquear y solicitar revisión antes de continuar.

## 6. Criterios de aceptación

- La experiencia funcional es idéntica excepto desaparición de sincronización manual y aparición de actualizaciones automáticas.
- El algoritmo de generación y recálculo no cambia y las pruebas comparativas dan resultados idénticos.
- Dos sesiones autorizadas observan cambios confirmados sin refrescar; el profesor recibe las modificaciones de sus alumnos y viceversa según permisos.
- Ninguna escritura se confirma falsamente; las desconexiones no provocan colas silenciosas ni pérdida de cambios.
- Caché local aislada por usuario y sin sobrescribir versiones recientes.
- Sin referencias operativas a GitHub como base de datos en la ejecución DEV, salvo migrador y herramientas de contingencia documentadas.
- Todos los tests y comprobaciones de seguridad pasan; no hay exposición de secretos en cliente o repositorio.
- DEV usa exclusivamente `pgt-bjj-dev`. Producción sigue intacta y operativa sobre GitHub.
- Documentación de arquitectura, esquema, índices, IAM/reglas, costes, operación, migrador, plan futuro PRO y rollback.

## 7. Entregables y protocolo de trabajo de Work

Work debe entregar:

1. Auditoría inicial y decisiones arquitectónicas justificadas.
2. Implementación en rama `feature/*` nacida de `main`.
3. PR hacia `develop`, con descripción, pruebas y riesgos.
4. DEV desplegado y validado, si dispone de permisos y se han configurado los secretos DEV.
5. Migrador preparado y probado en DEV, sin ejecutar migración PRO.
6. Evidencias de tests, prueba entre dos clientes, equivalencia del algoritmo y aislamiento DEV/PRO.
7. Lista exacta de acciones manuales restantes, sin solicitar ni mostrar claves privadas en el chat.

**Puntos de parada:** antes de crear credenciales o recursos que generen costes; ante cambios de autenticación visibles; si no se puede garantizar la preservación de datos; ante cualquier acción sobre PRO; ante cualquier necesidad de modificar `main` o el algoritmo. No declarar completada una fase sin pruebas reproducibles.

## 8. Instrucción de inicio para Work

«Ejecuta este plan sobre `dmda92/pgt-bjj-planner`. Empieza auditando el repositorio real, `main`, `develop`, los workflows y la arquitectura actual. Toda rama `feature/*` nace de `main` y se integra por PR a `develop`. Implementa Firestore y actualizaciones automáticas en DEV (`pgt-bjj-dev`), con libertad de refactorización interna pero sin cambiar ninguna funcionalidad ni el algoritmo de planes. Mantén caché local y elimina la sincronización manual y la edición offline. No toques PRO (`pgt-bjj-pro`), `main` ni los datos reales. Detente y solicita únicamente las acciones manuales imprescindibles. Aporta pruebas y evidencias de equivalencia y seguridad.»
