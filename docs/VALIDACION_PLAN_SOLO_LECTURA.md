# Planes de solo lectura — 14/10/2026

Decisión del propietario documentada en ANALISIS_CAMBIOS_ESTRUCTURALES.md y apartado 12 de REQUISITOS_PGT_APP.md. Se elimina la edición manual de planes de participantes, incluidos entrenadores competidores. Los cambios se hacen en las técnicas o comentarios y se aplican al futuro con las reglas vigentes; el recálculo estructural sigue pendiente del resto de decisiones.

Cambios del mismo commit:

- PlanView muestra descripciones como texto, sin textarea ni callback de edición. Consulta, sesiones plegables, PDF y uso offline se mantienen.
- La API rechaza PUT de plan con 403 PLAN_READ_ONLY para usuarios autenticados. Los permisos previos de lectura, técnicas propias y comentarios del entrenador se mantienen. Las actualizaciones automáticas escriben por la vía interna del Worker.
- El cliente rechaza edit de plan:* y no envía borradores manuales antiguos. Estos se conservan como conflictos exportables, sin borrado silencioso ni posibilidad de subir la versión local. Elegir remoto resuelve el borrador explícitamente.
- Importar una copia valida los planes pero no los aplica como ediciones; perfil y técnicas conservan restauración. No se sobrescriben planes remotos ni históricos desde JSON modificado.
- No hay migración destructiva de planes ya guardados o históricos. Las excepciones por nuevas ediciones manuales futuras dejan de ser una decisión pendiente del análisis.

Validación: 63 pruebas automatizadas, TypeScript, build y compilación local de Worker. Runtime workerd/SQLite verifica bloqueo de escritura, propagación automática futura, histórico protegido, asignación y PDF/lectura mediante la batería de navegador local. Chromium comprueba ausencia de controles editables, entrenador participante, intento de importación de plan modificado, borrador heredado conservado/exportable, resolución remota y continuación de la sincronización. Se mantienen los flujos de perfiles, técnicas, comentarios, conflictos, PDF offline y responsive. Datos sintéticos; no se prueba aceptación en teléfonos físicos ni integración remota real.

No se accede a Cloudflare ni se despliega desde Work. El propietario debe desplegar esta versión para activar el nuevo bloqueo en la aplicación publicada.
