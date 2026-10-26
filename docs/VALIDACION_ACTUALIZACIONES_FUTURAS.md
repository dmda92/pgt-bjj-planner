# Actualización de textos exclusivamente futuros — 14/10/2026

Implementada la corrección 2.1, apartado 11 de REQUISITOS_PGT_APP.md. El generador de distribución no cambia.
Descripciones y comentarios se relacionan por UUID y se aplican solo cuando sesión > hoy y competición > hoy, con fecha
Europe/Madrid. Se preservan literalmente todas las sesiones <= hoy, así como los planes de competiciones finalizadas.

## Persistencia y recuperación

Cada modificación de texto crea una versión por UUID en la misma escritura SHA de la fuente. Cada plan conserva qué
versiones aplicó. Se sobrescriben esos metadatos únicamente desde el Worker, nunca desde payloads del cliente. El
seguimiento no almacena datos de negocio en Durable Objects ni añade endpoints o servicios.

Después de guardar técnicas/comentarios se actualizan planes propios existentes. La lectura/sincronización recupera una
propagación que quedó interrumpida: vuelve a leer fuente y plan antes de CAS, reintenta conflictos de versión de forma
limitada y mantiene otros errores visibles. No se anuncia propagación completa ante una escritura fallida. Las
recuperaciones vuelven a calcular Madrid: una sesión que ahora es hoy o pasada permanece protegida, aunque fuese futura
cuando empezó la operación.

Una lectura repetida no vuelve a aplicar una versión ya procesada ni elimina ediciones manuales posteriores. Una nueva
modificación de la fuente sí cambia todas sus futuras apariciones. Las bajas de asignación siguen conservando planes
recibidos. Los borrados completos explícitos siguen su comportamiento anterior.

El cliente proyecta las nuevas descripciones en planes cacheados durante edición offline y guarda la proyección junto
con la fuente en una transacción IndexedDB. Mantiene SHA y checkpoint remoto, sin marcar como escritura independiente un
plan limpio. Al sincronizar envía primero técnicas, recupera versiones remotas de planes y descarga los resultados; las
ediciones manuales concurrentes conservan el mecanismo de conflicto. El comentario del entrenador se escribe con la
operación remota autorizada existente y los alumnos reciben el resultado al sincronizar.

## Pruebas

- `npm test`: 63/63 correctas, sin omitidas. Ocho pruebas nuevas: siete de dominio y una integración de API ampliada con
  múltiples casos.
- Dominio: Madrid con cambio de día UTC y horario de verano/invierno; todas las apariciones futuras; histórico y hoy con
  UUID coincidente protegidos; competición de hoy/pasada; eliminación/vaciado de comentario; idempotencia y edición
  manual posterior; adiciones/eliminaciones/prioridad/orden sin activar recálculo; proyección offline sin modificar
  checkpoints, fechas ni Tábata.
- API con adaptador GitHub interceptado: persistencia de fuente y planes, fallo 503 después de fuente guardada y
  recuperación posterior, conflicto CAS 409 con relectura, aislamiento de otro alumno, competición finalizada exacta,
  permisos de comentarios, rechazo de checkpoints falsificados y recuperación cuando una sesión antes futura ya
  corresponde al día actual. Múltiples apariciones del mismo UUID verificadas.
- TypeScript, build y compilación local esbuild del Worker correctos.
- `npm run test:runtime`: Worker real local workerd + SQLite DO y WebCrypto; actualizaciones de descripción/comentario
  futuras tras generación y preservación del histórico. Se conservan registro, roles, bootstrap, sesión, CAS, edición,
  asignación/desasignación, borrado y revocación. La prueba reorganiza sus operaciones existentes para respetar el
  límite de mutaciones por minuto; no se cambian los límites de producción.
- `npm run test:browser`: dos contextos independientes del mismo alumno, descripción editada sin conexión, reflejo en
  sesiones futuras locales, ausencia de escritura remota offline, sincronización y recepción en el segundo dispositivo,
  comentario autorizado del entrenador visible tras sincronizar, histórico exacto en ambos casos. Se conservan los
  flujos de perfiles, entrenadores competidores, conflictos, PDF offline y responsive. Capturas de escritorio/móvil
  locales revisadas.

Los datos son sintéticos y GitHub está interceptado en las pruebas locales. Queda repetir las pruebas de aceptación en
teléfonos físicos tras el despliegue del propietario. No se accede a Cloudflare ni se despliega desde Work.

## Cambios estructurales

Análisis en ANALISIS_CAMBIOS_ESTRUCTURALES.md, con cursor y propuesta de sufijo futuro. No se activa todavía la
incorporación/replanificación automática de posiciones o técnicas ni las eliminaciones/prioridad/orden. Las pruebas de
esta entrega demuestran ausencia de recálculo implícito y conservación de la secuencia con cambios de texto; no afirman
que exista ya un algoritmo de continuación estructural aprobado.
