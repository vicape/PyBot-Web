# Dependencias del editor de lecciones

PyBotClass usa **BlockNote Community** (open-source) como motor del editor de lecciones en Mi Contenido.

No se copió el código fuente de BlockNote. Se consume únicamente como dependencia npm.

## Paquetes

| Paquete | Licencia | Uso |
| --- | --- | --- |
| `@blocknote/core` | MPL-2.0 | Motor del editor, schema, bloques nativos, localización |
| `@blocknote/react` | MPL-2.0 | Hooks y componentes React, custom blocks |
| `@blocknote/mantine` | MPL-2.0 | Vista UI (toolbar, slash menu, side menu) |
| `@mantine/core` | MIT | Dependencia de UI requerida por `@blocknote/mantine` |
| `@mantine/hooks` | MIT | Dependencia requerida por Mantine |

No se incluyen paquetes `@blocknote/xl-*`, BlockNote Cloud, BlockNote AI ni exporters XL.

La licencia general de PyBotClass no cambia por esta integración.
