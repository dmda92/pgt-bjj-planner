# Actualizaciones estructurales futuras — análisis previo

Estado vigente (14/10/2026): eliminación de técnicas y posiciones APROBADA e implementada. Las restantes decisiones estructurales de la tabla siguen pendientes. La actualización de descripciones y comentarios futuros sí está implementada. Ninguna sesión de fecha igual o anterior a hoy en Europe/Madrid puede alterarse automáticamente. Una competición de fecha igual o anterior a hoy está finalizada.

## Decisión confirmada: planes de solo lectura (14/10/2026)

El alumno no puede editar manualmente el plan. Esto se aplica también a un entrenador que participa como competidor: no se introduce un permiso de edición manual del plan. Los cambios se realizan en las técnicas del alumno y los comentarios del entrenador; el sistema los traslada a las sesiones futuras según las reglas aprobadas, manteniendo intactos pasado, hoy y competiciones finalizadas.

Esta decisión elimina la disyuntiva de preservar o sustituir nuevas sesiones futuras editadas manualmente. El recálculo estructural futuro trabajará desde esas fuentes y el cursor validado; no habrá excepciones por nuevas ediciones manuales. El recálculo por eliminaciones está activado conforme a la decisión definitiva siguiente; las demás decisiones de esta tabla siguen pendientes.

Implementación en el mismo commit que esta decisión: retirar controles de edición del frontend, bloquear escrituras de planes en la API y en el cliente local, impedir sobrescrituras de planes desde una copia JSON, conservar consulta/PDF y verificar que la actualización automática de textos continúa funcionando. Los borradores pendientes de versiones anteriores se conservan para exportación y requieren elegir explícitamente la versión remota; no se suben ni se descartan silenciosamente. Los planes ya guardados y sus sesiones históricas se conservan.

## Viabilidad y continuidad

Es viable recalcular únicamente el sufijo futuro, manteniendo fechas y parámetros de cada plan y exactamente N ejercicios por sesión. No basta con llamar otra vez a generatePlan: eso reiniciaría la secuencia y podría repetir técnicas ya consumidas. Hay que conservar un cursor de la última sesión protegida: aparición de prioridad, fase del movimiento circular, lista de prioridades de referencia, posición y técnica por UUID, y posiciones/técnicas consumidas en esa aparición.

Para planes existentes, los campos prioridad/pass/positionId/techniqueId/positionComplete permiten reconstruir muchas situaciones. Se debe verificar la reconstrucción, especialmente cuando el alumno editó manualmente la distribución. No inferir continuidad si las marcas se contradicen: conservar el plan y mostrar un caso que necesita revisión. Los planes nuevos deberían guardar un cursor verificable en cada frontera de sesión para permitir futuras actualizaciones sin depender de nombres, índices actuales o UUID eliminados.

El cursor incorpora también la sesión de hoy como protegida. El nuevo flujo solo rellena las fechas posteriores a hoy que ya existen. No añadir entrenamientos ni aumentar N para hacer caber más contenido. Si se agotan las fechas, dejar el contenido pendiente e informar; una posición ya completada no se reabre para insertar una nueva técnica, sino que la incorpora en la siguiente aparición que corresponda.

## Casos y decisiones

| Cambio                                                    | Tratamiento propuesto                                                                                                                             | Decisión pendiente                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Técnica añadida a posición ya completada                  | Esperar a la siguiente pasada de esa posición                                                                                                     | Regla ya expresada por el propietario                                                                    |
| Técnica añadida tras el cursor de una posición incompleta | Incluir en el resto futuro de la pasada siguiendo el array actual                                                                                 | Confirmar criterio para inserciones anteriores al cursor                                                 |
| Técnica añadida antes del cursor                          | Proponer diferirla a la siguiente pasada, evitando retroceder o repetir                                                                           | ¿Diferir o admitirla al final de la pasada actual?                                                       |
| Posición añadida antes de una posición ya consumida       | Proponer siguiente aparición de su prioridad                                                                                                      | Confirmar cómo tratar una inserción anterior al cursor                                                   |
| Técnica/posición eliminada                                | Retirarla de todas las sesiones futuras; saltar al siguiente UUID pendiente y conservar el histórico                                           | **APROBADA: retirada inmediata, también en posiciones parcialmente entrenadas**                                                |
| Cambios de prioridad y reordenación                       | Proponer conservar el contexto de la aparición en curso; aplicar la nueva prioridad/orden a la siguiente aparición y al contenido aún no empezado | ¿Aplicarlos inmediatamente al sufijo pendiente o diferir hasta la siguiente pasada?                      |
| Prioridad nueva                | Pendiente definir cuándo se incorpora una nueva prioridad a la lista circular                                | La incorporación de prioridades nuevas sigue pendiente; para desapariciones aplica la regla aprobada siguiente |
| Catálogo sin técnicas entrenables                         | No existe un flujo capaz de mantener N ejercicios válidos sin inventar ni repetir para rellenar                                                   | **APROBADA: conservar el plan anterior y mostrar actualización bloqueada**        |

Los nombres y tipos modificados son estructurales: actualizar solo futuras apariciones por UUID y documentar qué pasa si se renombra mientras hay una pasada en curso. Una posición o técnica eliminada nunca debe resucitar en la colección actual por existir en el histórico. Ningún cambio puede afectar a otro alumno.

## Propuesta de implementación tras resolver decisiones

1. Comparar versiones del catálogo para detectar cambios estructurales reales, separados de textos.
2. Obtener la fecha Madrid y bloquear competiciones finalizadas.
3. Conservar las sesiones protegidas literalmente, incluso sus marcas y textos.
4. Recuperar un cursor validado y construir el flujo pendiente según la política aprobada.
5. Rellenar exactamente las fechas futuras existentes, con N ejercicios por sesión, sin alterar Tábata.
6. Guardar por SHA con relectura/revalidación si otro dispositivo modificó el plan; conflictos manuales reales requieren revisión.
7. Registrar versión estructural aplicada, cursor y motivos de contenido pendiente. Recuperar operaciones interrumpidas sin reescribir el histórico.

Pruebas previstas: adiciones antes/después del cursor y a posiciones cerradas; posiciones partidas entre días; eliminación del cursor; prioridades no consecutivas y una sola prioridad; altas/bajas de prioridades; cambios de orden; planes legados con ediciones anteriores; bloqueo de nuevas ediciones manuales; cero sesiones futuras; insuficiencia de calendario; cambio de día en Madrid; conflictos/offline; aislamiento de alumnos. Las pruebas de eliminaciones y de sus bloqueos ya están implementadas según la decisión definitiva siguiente; las pruebas de las demás políticas estructurales siguen pendientes de aprobación.

## Decisión definitiva APROBADA: eliminaciones (14/10/2026)

El alumno puede eliminar técnicas o posiciones por UUID incluso durante una pasada parcialmente completada. El catálogo local refleja la eliminación inmediatamente. Todos sus planes activos retiran los UUID de cada sesión posterior a hoy, según Europe/Madrid, completando exactamente N ejercicios mediante el flujo circular natural. Se conservan literalmente las sesiones anteriores y de hoy, las fechas existentes, los parámetros de Tábata y la totalidad de competiciones con fecha de torneo <= hoy. La instantánea histórica conserva técnicas borradas, nombres, prioridades, tipos, descripciones, comentarios y distribución.

### Cursor y prioridades desaparecidas

Los planes nuevos guardan `continuity`: catálogo ordenado de UUID y prioridades, y frontera de cada sesión con cursor (prioridad actual, siguiente movimiento, contadores de pasadas y UUID pendientes). Una firma de la distribución y un checksum del cursor detectan inconsistencias; además se coteja el cursor con las pasadas y técnicas consumidas del histórico. Estos metadatos pertenecen al servidor: la API de planes sigue siendo de solo lectura. El generador inicial utiliza el mismo motor de avance; se ha comprobado que produce la secuencia anterior sin modificaciones.

El sufijo futuro empieza en la frontera de la última sesión protegida. Se filtran los UUID retirados de la parte pendiente y se conservan los contadores y la fase del movimiento -1/+2. Las posiciones ya consumidas no se reabren. Al terminar la aparición en curso se adopta el anillo de prioridades sobrevivientes. Si desapareció la prioridad actual, se usa su ancla anterior para encontrar la siguiente aparición válida saltando prioridades desaparecidas con el movimiento pendiente, y después se adopta el anillo reducido. No se vuelve a la primera prioridad. Con una sola prioridad o un anillo de dos prioridades pueden existir repeticiones naturales de pasadas completas: no son relleno artificial. Se recalculan las marcas de fin de posición únicamente dentro del sufijo futuro.

### Legados, bloqueo y recuperación

Sin cursor guardado se intenta reproducir el plan completo desde el catálogo anterior a la primera eliminación (`deletionCatalog`, guardado por servidor sin textos). Esto permite migrar también planes cortos cuando coinciden exactamente con ese catálogo. Si no coincide, se reconstruye el catálogo desde las primeras pasadas del plan únicamente si hay evidencia de pasadas completas, y se reproduce y compara toda su distribución (UUID, prioridad, pasada y cierre de posición). Un plan corto sin catálogo de referencia fiable, ambiguo, modificado manualmente o con metadatos incompatibles queda intacto con un aviso recuperable para revisión por el entrenador. No se presenta un cursor supuesto como fiable.

Si no queda contenido entrenable con continuidad, el catálogo sí guarda la eliminación, pero el plan anterior se conserva con `structuralUpdateError`. No se inventan ejercicios ni se propagan otros textos sobre esa distribución bloqueada. Se muestra el aviso en el plan y la sincronización se identifica como incompleta. Restaurar técnicas compatibles del catálogo original permite reintentar; los casos ambiguos necesitan revisión del entrenador. Este requisito no autoriza cambiar silenciosamente las políticas pendientes para adiciones, reordenaciones o prioridades nuevas.

### Persistencia e idempotencia

El Worker registra `deletedIds` acumulados, calculados desde el catálogo previo; ignora tombstones enviados por el cliente. Cada plan guarda `appliedDeletions`. El borrado de un UUID que no aparece en el futuro solo actualiza su checkpoint, sin regenerar ejercicios. No se recalcula nuevamente un plan ya actualizado. Las proyecciones offline usan la misma función pura y no se suben como ediciones manuales de planes.

Los tombstones se guardan antes del fan-out. Una escritura interrumpida se recupera desde el siguiente snapshot; ante conflicto SHA se releen y revalidan las fuentes y el plan antes de reintentar. El cliente conserva sus cambios pendientes tras errores; solo consume la versión remota confirmada. No declara sincronización completada mientras existan planes bloqueados. Las rutas y comprobaciones de identidad restringen el fan-out a los planes del alumno correspondiente.

Cobertura de implementación: tests/plan-deletions.test.ts, prueba API de eliminaciones en tests/plan-text-api.test.ts y escenario offline/reload/segundo dispositivo/bloqueo en scripts/test-browser.mjs. Los datos utilizados son sintéticos; no se accede a los alumnos reales para validar estas pruebas.
