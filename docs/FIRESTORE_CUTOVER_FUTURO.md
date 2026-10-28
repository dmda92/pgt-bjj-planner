# Procedimiento futuro — no ejecutar en esta tarea

No hay autorización de PRO ni datos reales. Este documento no concede esa autorización.

Antes de cualquier promoción: cerrar QA DEV con pruebas reales, revisar alcance selectivo desde feature/main, recursos y
diferencias acumuladas; disponer de exportación local autorizada del catálogo oficial y datos completos con tratamiento
privado, inventario, tamaño y relaciones. El migrador actual está bloqueado a identidades sintéticas; ampliar ese guard
requiere un encargo y revisión independientes. No eliminarlo como atajo.

Diseñar ventana de congelación de escrituras en el backend anterior y bloqueo explícito de clientes antiguos; no
mantener dos autoridades escribiendo. Exportación final cifrada fuera del repo con hashes por entidad y conteos,
conservar contraseñas hasheadas, UUID, orden y snapshots originales. Ejecutar dry-run y verificar integridad antes de
importar. Publicación create-only, informe de lectura de vuelta y comparación exacta; rechazar datos ya existentes
distintos. Probar cuentas/roles/recálculo y dos clientes con versión nueva antes de liberar escrituras.

Rollback anterior a liberar escrituras: retirar build nuevo, conservar exportación y registros de importación, restaurar
aplicación anterior y descongelar repositorio previo tras validación. Después de admitir escrituras en Firestore, no
volver al backend anterior sin exportar, reconciliar y verificar esos cambios; se perderían datos. Definir ventana,
responsables y procedimiento antes de habilitar esa fase. No aplicar el workflow DEV ni credencial DEV a PRO.

Mantener en DEV la versión anterior mediante git y build sin bandera únicamente como referencia de regresión. Un
rollback de aplicación debe conservar el backend Firestore y sus versiones mientras contenga cambios aceptados; no
volver silenciosamente a GitHub como fuente de verdad. Para una incidencia DEV, detener nuevas escrituras y corregir
mediante PR, sin tocar PRO.
