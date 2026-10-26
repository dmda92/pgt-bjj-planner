# Equipo y participantes — DEV 26/10/2026

## Alcance autorizado

Petición del propietario: editar cinturón en Administración de alumnos, compartir
tarjetas desplegables de Mis técnicas con Equipo/Técnicas, mantener comentarios con
guardado explícito, participantes con nombres completos y presentación adaptable,
y orden alfabético por nombre en Equipo y Competiciones. Autoriza entregar en
develop junto a [PAYLOAD_INVALID](FIX_PAYLOAD_INVALID_EDITOR.md), sustituyendo la
pausa anterior. Rama existente fetaure/optimizacionFirestore por elección del propietario.

## Implementación

- `UserService` añade comando DEV `belt`: entrenador autenticado, destino alumno,
  campos permitidos estrictos, validación de cinturón, CAS e idempotencia. Publica
  perfil y roster atómicamente solo cuando cambian. No revoca sesiones ni cambia
  contraseña, rol, planes o repertorio. El cambio se propaga por el tiempo real existente.
- `StudentBeltEditor` conserva selección y base si falla; un conflicto requiere revisar
  la versión actual. Solo se escribe al pulsar Guardar cinturón.
- `RepertoirePosition` comparte literalmente cabecera, progreso, estados y tarjetas
  compactas entre ambas vistas. Equipo mantiene campos del alumno readOnly, no disabled.
  Abrir/cerrar y búsqueda conservan el editor de comentarios montado.
- `CommentEditor` conserva botón explícito y textarea editable durante la petición;
  una respuesta propia permite avanzar la base del texto nuevo sin enviarlo. Una
  modificación de otro entrenador continúa siendo conflicto, nunca último escritor.
  Etiquetas asociadas por UUID. Ningún envío por pulsación, búsqueda o despliegue.
- `ParticipantChoices` comparte tarjetas para alta y edición; conserva entrenadores
  competidores, borrador local y Guardar datos. `sortedUsers` usa comparación española
  por nombre, apellido y correo para desempate; no muta arrays de negocio.

## Validación local

- Chromium con PWA y Worker DEV reales locales y Firestore interceptado sintético:
  orden con Álvaro/Ana, apellidos largos, readonly, tarjetas cerradas inicialmente,
  comentarios explícitos, ACK perdido con reintento idempotente, escritura durante
  guardado, conflicto de otro entrenador y exactamente una notificación al alumno.
- Cinturón sin petición hasta guardar; HTTP 503 conserva borrador, reintento actualiza
  ficha, roster y perfil del alumno sin invalidar su sesión. Runtime HTTP verifica
  alumno denegado y entrenador autorizado.
- Seguridad unitaria: cinturón inválido, inyección de campos, alumno no autorizado,
  destino entrenador y CAS obsoleto no escriben; replay no vuelve a escribir.
- Competiciones alta/edición con nombre completo y orden idéntico; seleccionar sin
  Guardar datos no escribe. Entrenadores siguen seleccionables.
- Capturas de escritorio y móvil revisadas: tarjetas, comentarios, participantes y
  cinturón; sin desbordamiento horizontal. Chromium no equivale a Safari/iOS físico.
- Regresiones de sincronización entre dispositivos, RATE_LIMIT, consumo cero en foco/
  inactividad y PDF offline incluidas. Nombres incompletos no generan POST inválidos.

Resultado local: npm test 339/339; typecheck, build, check:worker, las tres suites
test:runtime y test:browser correctos. Pruebas aisladas: no consumen cuota de Google,
no modifican usuarios reales. CI e integración se verifican después, sin equipararlos
a esta validación local.

## Entrega

Destino exclusivo develop → pgt-github-probe-dev, wrangler.dev.jsonc, pgt-bjj-dev.
Sin cambios en configuración, recursos o datos PRO. Sin cambios de datos GitHub.
El cambio previo del propietario en `.agents/skills/frontend-design/SKILL.md`
permanece intacto y fuera de la entrega. Pendientes CI, integración por PR y
verificación de versión publicada; no se presentan como ejecutados anticipadamente.
