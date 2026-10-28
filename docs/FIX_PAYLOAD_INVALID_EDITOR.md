# PAYLOAD_INVALID al crear y renombrar técnicas — 26/10/2026

## Reproducción y causa

Con la PWA y el Worker reales ejecutados localmente sobre transporte sintético:
añadir posición, añadir técnica, borrar el nombre provisional y esperar más que
el debounce. El autoguardado enviaba tipo="" y recibía HTTP 400 PAYLOAD_INVALID.
Completar nombre/descripción y pulsar Reintentar funcionaba. Un nombre de posición
vacío tiene el mismo problema. No fue necesario un fallo de red ni de Firestore.

La UI solo validaba prioridades antes de programar un envío; el dominio exige
nombres no vacíos. OnlineDraft trataba este estado intermedio de escritura como
un fallo remoto permanente hasta reintento manual. No se afirma haber observado
la petición concreta del propietario; se reproduce una secuencia compatible con
su informe y se cubre también la carrera con un ACK anterior.

## Cambio

Validación de borrador en el cliente mediante el mismo validateTechniques del
dominio. El editor conserva íntegros los campos incompletos, muestra un aviso junto
al nombre (required, aria-invalid y aria-describedby), y no llama al servidor.
Completar los nombres reanuda el debounce automáticamente. Se conserva el UUID,
la descripción y la base CAS, incluida la revisión de una operación que estaba
en vuelo. No se trunca texto ni se inventan nombres para publicar el documento.

Un flush con datos incompletos no autoriza acciones dependientes ni logout que
descarten ese borrador. Los conflictos y errores remotos reales siguen requiriendo
revisión manual. Se mantienen las reglas de offline, RATE_LIMIT, negocio e histórico.
El Worker y validateTechniques no cambian: nombres vacíos enviados por otros clientes
se siguen rechazando antes de IO de negocio.

## Validación

- npm test: 336/336 correctas.
- typecheck, build, check:worker y tres suites test:runtime correctos.
- Pruebas de borrador incompleto, conservación literal de espacios/textos largos,
  ACK concurrente y persistencia posterior con la base correcta.
- Chromium: crear posición/técnica, vaciar cada nombre durante más del debounce,
  cero POST de repertorio mientras están vacíos, ninguna petición de reintento manual,
  completar y guardar todo mediante un solo POST válido. Conflicto entre entrenadores,
  recuperación RATE_LIMIT, sincronización de dos dispositivos y PDF offline conservados.
- Capturas de escritorio/móvil para estados incompletos; revisión de avisos de campo.

Solo pruebas locales aisladas; sin escrituras en DEV/Google o GitHub PRO. La evidencia
original de reproducción está en un artefacto local ignorado, sin datos personales.

## Estado de entrega

El propietario solicitó primero agrupar más cambios y detenerse antes del despliegue.
Después autorizó integrar y desplegar DEV junto a los cambios de Equipo/Competiciones.
Entrega preparada en la feature existente fetaure/optimizacionFirestore mediante PR
a develop, tras CI. No se altera main/PRO. Validación conjunta y estado operativo en
[CAMBIOS_EQUIPO_2026-10-26.md](CAMBIOS_EQUIPO_2026-10-26.md).
La modificación previa de .agents/skills/frontend-design/SKILL.md queda intacta
y fuera del alcance. Archivos: editor/main, validación application, pruebas y docs.
