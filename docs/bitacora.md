# Bitácora de desarrollo
## Sistema de Ventas e Inventarios

**Proyecto:** Ingeniería de Datos  
**Módulo:** Lógica de negocio y generación de datos  
**Fase:** 1 — Implementación y validación  
**Estado:** En revisión de cierre

---

## 1. Objetivo

Documentar las actividades de desarrollo, configuración, pruebas y validación realizadas durante la primera fase del Sistema de Ventas e Inventarios.

Se registran las implementaciones realizadas, los resultados obtenidos y las actividades pendientes para completar la fase.

## 2. Infraestructura implementada

El sistema utiliza tres motores de bases de datos:

| Motor | Base de datos | Puerto local |
|---|---|---:|
| MySQL | ventas_catalogo | 3307 |
| PostgreSQL | ventas_operaciones | 5433 |
| MongoDB | ventas_eventos | 27018 |

El backend está desarrollado con Node.js y Express.

Se implementó comunicación entre los motores mediante los servicios del backend y un patrón Outbox para garantizar la recuperación de eventos.

## 3. Contrato de integración

Se creó el archivo `docs/contrato.md`, que establece:

- Estructura de las solicitudes y respuestas de la API.
- Reglas de validación de los datos.
- Códigos de error.
- Responsabilidades de cada motor de base de datos.
- Estructura de los eventos registrados en MongoDB.

## 4. Generación y carga de datos

Se ejecutaron los procesos de generación de datos iniciales en los tres motores.

Resultados registrados:

| Base de datos | Registros generados |
|---|---:|
| MySQL | 54,000 |
| PostgreSQL | 70,163 |
| MongoDB | 52,579 |

Los tres motores superan el requisito mínimo de 50,000 registros.

## 5. Implementación de la API de ventas

Se desarrolló el endpoint:

`POST /api/ventas`

Se implementaron las siguientes funcionalidades:

- Validación de identificadores de clientes y sucursales.
- Validación de productos y cantidades.
- Rechazo de productos duplicados.
- Consulta de clientes y productos existentes.
- Consulta de precios desde MySQL.
- Validación de inventario disponible.
- Bloqueo de registros de inventario durante las operaciones.
- Registro de ventas, detalles y movimientos de inventario.
- Uso de transacciones para mantener la integridad de los datos.
- Registro de eventos pendientes mediante Outbox.

## 6. Registro de errores de negocio

Se implementó el servicio `erroresService.js`, encargado de registrar errores de negocio en la colección `errores_sistema` de MongoDB.

Se probaron los siguientes escenarios:

| Escenario | Código | Resultado |
|---|---|---|
| Cliente inexistente | CLIENTE_NO_EXISTE | Registrado en MongoDB |
| Producto inexistente | PRODUCTO_NO_EXISTE | Registrado en MongoDB |
| Inventario insuficiente | STOCK_INSUFICIENTE | Registrado en MongoDB |

Se verificó que los errores de inventario insuficiente no modifican las existencias en PostgreSQL.

## 7. Implementación y pruebas del patrón Outbox

Se implementó el registro de eventos pendientes dentro de las transacciones de PostgreSQL.

Posteriormente, un worker procesa los eventos y los publica en las colecciones correspondientes de MongoDB.

Se realizaron pruebas de recuperación:

1. Se detuvo el contenedor de MongoDB.
2. Se realizaron operaciones de venta desde la API.
3. Se verificó que las ventas se registraran en PostgreSQL y que los eventos permanecieran pendientes.
4. Se inició nuevamente MongoDB.
5. Se comprobó que el worker recuperara y procesara los eventos pendientes.
6. Se verificó que los eventos no se duplicaran durante su procesamiento.

## 8. Simulador de ventas

Se desarrolló un simulador en Node.js para generar solicitudes de venta con datos controlados y distintos niveles de concurrencia.

Se ejecutaron pruebas de 10, 100 y 1,000 solicitudes.

### Resultados obtenidos

| Solicitudes | Exitosas | Fallidas | Duración |
|---:|---:|---:|---:|
| 10 | 10 | 0 | 69.85 ms |
| 100 | 100 | 0 | 403.66 ms |
| 1,000 | 1,000 | 0 | 3,376.22 ms |

### Métricas de rendimiento

| Solicitudes | Ventas por segundo | Latencia promedio | P50 | P95 |
|---:|---:|---:|---:|---:|
| 10 | 143.16 | 49.96 ms | 50.23 ms | 55.97 ms |
| 100 | 247.73 | 31.93 ms | 28.17 ms | 68.48 ms |
| 1,000 | 296.22 | 26.88 ms | 26.06 ms | 37.68 ms |

Los resultados de las simulaciones se almacenaron en la colección `simulaciones` de MongoDB.

## 9. Prueba de integridad y concurrencia del inventario

Se realizó una prueba utilizando el producto 433 en la sucursal 1.

**Datos iniciales de la prueba:**

- Producto: Mesa Sin marca de Metal.
- Existencias iniciales: 85 unidades.
- Precio unitario: $3,945.43.

Primero se realizó una venta de 50 unidades, dejando 35 disponibles.

Posteriormente se prepararon dos solicitudes de venta de 25 unidades cada una.

**Resultados:**

- Una solicitud fue aceptada y registró la venta con ID 7625.
- La otra solicitud fue rechazada con el código `STOCK_INSUFICIENTE`.
- El inventario final quedó en 10 unidades.

Se consultó directamente PostgreSQL para verificar las existencias y los detalles de venta.

**Resultado:** no se registraron unidades negativas y la solicitud rechazada no consumió inventario.

## 10. Verificación de conectividad

Se probaron los siguientes endpoints:

| Endpoint | Resultado |
|---|---|
| GET /api/health | API funcionando |
| GET /api/database/mysql | Conectado |
| GET /api/database/postgresql | Conectado |
| GET /api/database/mongodb | Conectado |

Los cuatro endpoints respondieron correctamente.

## 11. Actividades pendientes

Antes de considerar cerrada la primera fase, se requiere:

- Revisar el mecanismo de reintentos progresivos del worker Outbox.
- Revisar que la respuesta del endpoint de ventas refleje correctamente el estado de los eventos.
- Completar la recopilación de evidencias de las pruebas.
- Revisar los cambios pendientes en Git.
- Verificar que los archivos innecesarios y las credenciales no se incluyan en el repositorio.
- Preparar la entrega de la rama y la solicitud de integración correspondiente.

## 12. Conclusión

Durante la primera fase se implementaron los componentes principales del Sistema de Ventas e Inventarios.

Se cuenta con tres motores de bases de datos conectados, procesos de generación de datos, una API transaccional, registro de errores de negocio, procesamiento de eventos mediante Outbox y un simulador de carga.

Las pruebas realizadas permitieron comprobar el funcionamiento de las operaciones de venta, la recuperación de eventos, la validación de inventario y la conectividad de los motores.

La fase se encuentra en revisión final, con actividades de documentación y ajustes técnicos pendientes.

## Prueba de resiliencia y recuperación del Outbox

**Fecha:** 18 de noviembre de 2026  
**Venta utilizada:** 7626  
**Objetivo:** Comprobar que el sistema pueda registrar ventas y recuperar los eventos pendientes cuando MongoDB deja de estar disponible temporalmente.

### Procedimiento

1. Se detuvo el contenedor `ventas-mongodb` mediante `docker stop ventas-mongodb`.
2. Con MongoDB desconectado, se envió una solicitud `POST /api/ventas`.
3. La API respondió correctamente y registró la venta 7626 en PostgreSQL, con un total de $1,587.72.
4. La respuesta indicó que los eventos estaban pendientes.
5. El worker intentó publicar los tres eventos, pero recibió errores `ECONNREFUSED` debido a que MongoDB estaba apagado.
6. Se inició nuevamente MongoDB mediante `docker start ventas-mongodb`.
7. El worker recuperó y publicó los tres eventos pendientes.

### Resultados

La consulta a `eventos_pendientes` confirmó:

| Evento | Estado final | Intentos |
|---|---|---:|
| venta:7626:1:creada | procesado | 3 |
| venta:7626:1:registrada | procesado | 2 |
| venta:7626:1:inventario | procesado | 2 |

Los tres eventos terminaron con estado `procesado` y contaron con fecha de procesamiento.

### Conclusión

La prueba fue satisfactoria. La desconexión temporal de MongoDB no impidió registrar la venta en PostgreSQL. Los eventos permanecieron almacenados en la tabla `eventos_pendientes` y fueron publicados correctamente cuando MongoDB volvió a estar disponible.

No fue necesario registrar nuevamente la venta para recuperar sus eventos.

**Observación:** Se comprobó la recuperación mediante reintentos, aunque queda pendiente medir y documentar formalmente los intervalos de espera progresiva del worker.
