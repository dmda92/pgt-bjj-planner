# Actualizaciones estructurales futuras — análisis previo

Estado: propuesta; no se activa el recálculo estructural con esta entrega. La actualización de descripciones y comentarios futuros sí está implementada. Ninguna sesión de fecha igual o anterior a hoy en Europe/Madrid puede alterarse automáticamente. Una competición de fecha igual o anterior a hoy está finalizada.

## Decisión confirmada: planes de solo lectura (14/10/2026)

El alumno no puede editar manualmente el plan. Esto se aplica también a un entrenador que participa como competidor: no se introduce un permiso de edición manual del plan. Los cambios se realizan en las técnicas del alumno y los comentarios del entrenador; el sistema los traslada a las sesiones futuras según las reglas aprobadas, manteniendo intactos pasado, hoy y competiciones finalizadas.

Esta decisión elimina la disyuntiva de preservar o sustituir nuevas sesiones futuras editadas manualmente. El recálculo estructural futuro trabajará desde esas fuentes y el cursor validado; no habrá excepciones por nuevas ediciones manuales. No se activa aún dicho recálculo: siguen pendientes las demás decisiones de esta tabla.

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
| Técnica/posición eliminada                                | Proponer retirarla de las sesiones futuras; saltar al siguiente UUID pendiente y conservar el histórico                                           | ¿Retirada inmediata incluso si la posición está a medias?                                                |
| Cambios de prioridad y reordenación                       | Proponer conservar el contexto de la aparición en curso; aplicar la nueva prioridad/orden a la siguiente aparición y al contenido aún no empezado | ¿Aplicarlos inmediatamente al sufijo pendiente o diferir hasta la siguiente pasada?                      |
| Prioridad nueva o prioridad que desaparece                | Hay que definir cuándo cambia la lista circular y cómo anclar la operación -1/+2 si desaparece la prioridad actual                                | Recomendar conservar la lista de la aparición en curso y adoptar la nueva al avanzar; confirmar política |
| Catálogo sin técnicas entrenables                         | No existe un flujo capaz de mantener N ejercicios válidos sin inventar ni repetir para rellenar                                                   | Proponer conservar el sufijo anterior y marcar actualización bloqueada hasta corregir el catálogo        |

Los nombres y tipos modificados son estructurales: actualizar solo futuras apariciones por UUID y documentar qué pasa si se renombra mientras hay una pasada en curso. Una posición o técnica eliminada nunca debe resucitar en la colección actual por existir en el histórico. Ningún cambio puede afectar a otro alumno.

## Propuesta de implementación tras resolver decisiones

1. Comparar versiones del catálogo para detectar cambios estructurales reales, separados de textos.
2. Obtener la fecha Madrid y bloquear competiciones finalizadas.
3. Conservar las sesiones protegidas literalmente, incluso sus marcas y textos.
4. Recuperar un cursor validado y construir el flujo pendiente según la política aprobada.
5. Rellenar exactamente las fechas futuras existentes, con N ejercicios por sesión, sin alterar Tábata.
6. Guardar por SHA con relectura/revalidación si otro dispositivo modificó el plan; conflictos manuales reales requieren revisión.
7. Registrar versión estructural aplicada, cursor y motivos de contenido pendiente. Recuperar operaciones interrumpidas sin reescribir el histórico.

Pruebas previstas: adiciones antes/después del cursor y a posiciones cerradas; posiciones partidas entre días; eliminación del cursor; prioridades no consecutivas y una sola prioridad; altas/bajas de prioridades; cambios de orden; planes legados con ediciones anteriores; bloqueo de nuevas ediciones manuales; cero sesiones futuras; insuficiencia de calendario; cambio de día en Madrid; conflictos/offline; aislamiento de alumnos. Estas pruebas pertenecen al futuro recálculo, no a la actualización de textos entregada ahora.
