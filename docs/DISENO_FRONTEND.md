# Identidad visual PGT BJJ Planner

## Dirección aprobada por el propietario

El 14/10/2026 el propietario rechazó la paleta del logo PGT y eligió como referencia cuatro capturas: navegación lateral oscura, fondo claro, superficies blancas, títulos legibles, espacios generosos y detalle por posición. Esta petición prevalece sobre la dirección verde/dorada anterior. Se adopta una paleta pizarra con acento azul suave; el logo original se conserva para el PDF, no define la interfaz ni el icono PWA.

La app es un espacio de preparación de competición: repertorio personal editable, sesiones, perfiles y trabajo del entrenador. No añadir actividad, tendencias, asistencia ni gráficos ficticios. Los datos existentes determinan el contenido; las capturas son referencia de composición, no una nueva especificación funcional.

## Skill de referencia

Consultar [.agents/skills/frontend-design/SKILL.md](../.agents/skills/frontend-design/SKILL.md), skill original de Anthropic con licencia incluida. Fuente: https://github.com/anthropics/skills/tree/main/skills/frontend-design. Integración local en el repositorio, no instalación global en Work. Seguir la referencia elegida por el propietario y sus instrucciones más recientes.

## Sistema visual

| Token      | Valor   | Función                             |
| ---------- | ------- | ----------------------------------- |
| Tinta      | #20313f | Texto principal                     |
| Pizarra    | #202f3b | Navegación y acciones estructurales |
| Azul       | #365e7d | Acciones y progreso                 |
| Azul suave | #cbdce9 | Sección activa y marca              |
| Fondo      | #f6f7f9 | Canvas                              |
| Superficie | #ffffff | Lectura y formularios               |

Barlow local regular y semibold, también en títulos. Títulos principales 28–38 px, títulos de zona 23–28 px, lectura 16 px, metadatos 12–14 px. Texto alineado a la izquierda, cifras tabulares. Bordes finos y radios 6–10 px; no sombras repetidas ni gradientes. Los estados llevan texto, no dependen solo del color.

En escritorio, lateral pizarra persistente de 220 px y cabecera de sesión discreta. Repertorio en dos columnas cuando hay espacio, una en pantallas estrechas. Sesiones en dos columnas y apertura individual; conserva consulta de solo lectura, exportación y orden. Hasta 850 px, navegación superior; hasta 640 px, controles y sesiones en una columna. La tabla de cobertura tiene scroll interno en móvil sin desbordar la página.

## Entrenador

Tres áreas separadas: Equipo, Competiciones y Cobertura por fecha. Equipo conserva selección, búsqueda, perfiles, roles, contraseñas, descripciones y comentarios. Competiciones conserva creación, asignación y borrado con sus confirmaciones. Resumen calculado exclusivamente de los datos autorizados.

Cobertura es lectura exclusiva del entrenador: selecciona alumno y plan, fecha y opción de incluir ese día. Muestra técnicas diferentes, sesiones, ejercicios con repeticiones, posiciones completas, posiciones sin empezar, primeras fechas y apariciones; filtros de pendientes/parciales/sin empezar. Calcula desde el plan individual guardado, no desde las técnicas actuales ni un plan regenerado.

Los snapshots existentes no contienen una copia completa del catálogo original. El universo y denominador se limitan a técnicas presentes en las sesiones guardadas. Explicar este alcance en pantalla, sin confundirlo con cobertura del catálogo completo. Pasadas completas requieren todas las técnicas programadas de esa pasada y la marca de finalización guardada; distinguir parciales aunque exista alguna pasada completa anterior. No equivale a asistencia real.

## Accesibilidad y continuidad

Foco visible, controles táctiles de al menos 44 px, etiquetas reales, SVG decorativo oculto a lectores, navegación activa accesible y `prefers-reduced-motion`. Transiciones de color de 140 ms. Conservar errores, conflictos, sincronización y cambios pendientes. Recursos y fuentes locales precacheados; no CDN ni dependencias nuevas de ejecución.

No cambiar autenticación, permisos de API, modelos guardados, generador, sincronización, IndexedDB ni exportación PDF para obtener efectos visuales. La cobertura añade un cálculo puro de lectura y usa el endpoint de snapshot autorizado ya existente. No acceder a Cloudflare ni desplegar desde Work.

## Verificación

Ejecutar todas las verificaciones de AGENTS.md y `npm run test:browser`. Revisar acceso, repertorio, planes, perfil, equipo, competiciones y cobertura a 360, 390, 768, 1280 y 1440 px. Validar fechas inclusivas/exclusivas, repeticiones, parciales y que alumnos no vean el apartado exclusivo. Los datos sintéticos y anchos emulados no acreditan aceptación en dispositivos físicos o Safari/iOS.

## Exportación PDF del plan (petición expresa 14/10/2026)

La exportación adopta la misma paleta pizarra/azul y Barlow embebida. Resumen inicial con datos del snapshot, introducción literal y Tábata; sesiones en tarjetas por orden de lectura izquierda-derecha y arriba-abajo. Cada tarjeta muestra fecha, ordinal, posición/prioridad/pasada, tipos destacados y todos los textos guardados. No se imprimen encabezados del navegador ni URL de hosting. Logo original arriba a la derecha y páginas numeradas. Una sesión densa ocupa ancho completo y nunca se divide; si no cabe tras compactar, se informa antes de descargar. Esta autorización específica permite modificar el diseño PDF sin tocar datos ni planificación.

### PDF con sesiones largas

Las sesiones que exceden una página usan ancho completo y continúan en páginas adicionales a 10 pt, con fecha, número de sesión y Parte/Continuación. Se conserva íntegro el contenido y el orden; las sesiones cortas mantienen las tarjetas habituales. Se elimina el bloqueo que pedía acortar descripciones.

### Eliminaciones de catálogo y planes bloqueados

Los diálogos de eliminación explican que se recalculan sesiones futuras y se conserva el histórico. PlanView muestra un aviso accesible con role=alert cuando la actualización está bloqueada; el estado de sincronización indica que queda incompleta. Conservar la presentación de solo lectura y el diseño actual.

### Secciones de la ficha del alumno

Panel derecho con botones Técnicas, Planes y Administración. La ficha de identidad permanece; el contenido se muestra por sección. Técnicas es la vista inicial de cada selección. El selector conserva el resaltado durante carga; spinner y texto accesible sustituyen temporalmente el mensaje inicial, con movimiento reducido respetado. Error de carga conserva selección y ofrece reintento.

### Fichas locales y detalle de planes

La ficha guardada se muestra inmediatamente, con indicador discreto «Actualizando en segundo plano» durante la comprobación remota. La falta de copia usa el spinner del panel y no deshabilita toda la interfaz. Planes muestra primero un selector con fechas de competición y carga solo el plan elegido. Métricas del repertorio memoizadas. Mantener selección, secciones, permisos y textos completos.
