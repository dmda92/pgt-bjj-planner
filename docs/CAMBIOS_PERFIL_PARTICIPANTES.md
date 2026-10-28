# Perfil sincronizado y entrenadores participantes — 14/10/2026

## PRO 01: perfil que no se refresca en otro dispositivo

La sincronización y el JSON remoto contenían los valores correctos, pero el formulario de perfil usaba controles no
controlados con `defaultValue`. En React esos controles conservan su valor inicial visible al recibir otro perfil,
especialmente texto y select; cerrar sesión desmontaba el formulario y hacía que apareciera el valor nuevo.

El formulario utiliza ahora valores controlados y un borrador por campo. Al recibir el perfil sincronizado, los campos
sin ediciones locales pendientes se actualizan; un campo que el usuario está escribiendo y aún no ha guardado conserva
su borrador. Después de guardar se reconoce la nueva referencia, incluida la normalización numérica del peso. No se
introduce ninguna escritura al refrescar la UI. Correo y rol siguen siendo texto de consulta para el alumno.

## Participantes de competiciones

El formulario de creación incluye todos los usuarios que devuelve el endpoint autorizado de equipo, tanto alumnos como
entrenadores, indicando su rol. Se elimina el filtro exclusivamente visual que excluía entrenadores. La API existente ya
admite ambos perfiles, sin cambios en permisos o almacenamiento. Un entrenador asignado recibe su propio plan mediante
su sincronización y lo consulta/edita en Mis planes. Desasignarlo conserva el plan individual ya recibido, igual que
para un alumno.

## Validación

- 55 pruebas automatizadas: tres nuevas de actualización de borrador y una de entrenador participante, recepción del
  plan propio, desasignación y reasignación.
- TypeScript, build, compilación local del Worker y runtime workerd/SQLite DO.
- Navegador con dos contextos independientes del mismo alumno: modificar los cinco campos en M1, guardar y sincronizar;
  mantener Perfil abierto en M2 y sincronizar sin cerrar sesión. Comprobar los cinco valores, correo/rol de consulta,
  ausencia de cambios en técnicas, comentarios, índice y planes, y preservación de un nombre aún sin guardar en M2
  mientras llegan apellidos actualizados.
- Navegador: creación de competición con alumno y entrenador seleccionados, dos asignaciones, sincronización del
  entrenador y plan propio con duración 32:10. Se mantienen los demás flujos de offline, conflictos, permisos,
  cobertura, PDF y contraseñas.

Pruebas locales con datos sintéticos; no equivalen a aceptación en teléfonos físicos. Sin acceso a Cloudflare ni
despliegue desde Work. Repetir PRO 01 en M1/M2 tras desplegar esta versión y probar asignar al entrenador a una
competición.
