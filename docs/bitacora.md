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

---

# Fase 2 — Mejoras opcionales

## 13. Implementación de métricas con Prometheus

Se integró la dependencia `prom-client` en el backend para recopilar métricas de funcionamiento y rendimiento.

Se creó el archivo `backend/src/metrics/metrics.js`, donde se definieron las siguientes métricas:

| Métrica | Tipo | Descripción |
|---|---|---|
| ventas_solicitudes_total | Counter | Total de solicitudes de venta clasificadas por resultado |
| ventas_duracion_segundos | Histogram | Duración de las solicitudes de venta |
| eventos_pendientes | Gauge | Cantidad de eventos pendientes de procesamiento |

Se configuraron etiquetas de resultado para clasificar las solicitudes: `ok`, `repetida`, `conflicto`, `sin_stock`, `validacion` y `error`.

También se incorporó la recopilación de métricas generales del proceso de Node.js.

Se habilitó el endpoint:

`GET /metrics`

Este endpoint expone las métricas en el formato compatible con Prometheus.

El indicador de eventos pendientes se actualiza durante los ciclos del worker Outbox. En caso de error al consultar PostgreSQL, se evita conservar un valor anterior como si fuera actual.

## 14. Cálculo de percentiles en el simulador

Se incorporó el cálculo de los percentiles P50 y P95 en `simulator/simulador.js`.

Se utilizó el método Nearest-Rank, ordenando las latencias y seleccionando la posición correspondiente al percentil solicitado.

Los resultados se incorporan al resumen de cada simulación mediante los campos:

- `p50_ms`
- `p95_ms`

Se verificó que el simulador pudiera calcular y mostrar ambos valores durante su ejecución.

## 15. Endpoint protegido para registrar simulaciones

Se implementó el endpoint:

`POST /api/simulaciones/resumen`

Se agregó un middleware de autenticación mediante una clave API enviada en el encabezado `x-api-key`.

La clave se configura mediante la variable de entorno `SIMULADOR_API_KEY`, evitando incluir credenciales directamente en el código fuente.

Se realizaron las siguientes validaciones:

- Comprobación de la clave de acceso.
- Validación de los campos numéricos del resumen.
- Comprobación de que las ventas exitosas y fallidas coincidan con el total.
- Validación de que P50 no sea mayor que P95.
- Límite de tamaño de 16 KB para las solicitudes JSON.

Los resúmenes se almacenan en la colección `simulaciones` de MongoDB.

Se modificó el simulador para enviar sus resultados al backend mediante este endpoint, eliminando su conexión directa con MongoDB.

Se comprobó el funcionamiento mediante una solicitud autorizada y una ejecución completa del simulador.

## 16. Implementación de idempotencia en las ventas

Se incorporó un mecanismo de idempotencia para evitar que una misma solicitud de venta se registre más de una vez cuando se repite su envío.

La funcionalidad utiliza el encabezado:

`Idempotency-Key`

Se agregaron los siguientes campos a la tabla particionada `ventas`:

- `idempotency_key`: identifica la solicitud.
- `request_hash`: almacena el hash SHA-256 del contenido normalizado de la solicitud.

Se agregó una restricción de unicidad sobre la combinación de sucursal y clave de idempotencia:

`UNIQUE (id_sucursal, idempotency_key)`

También se creó la migración:

`databases/postgresql/migrations/agregar_idempotencia_ventas.sql`

La migración se ejecutó correctamente y se verificó la conservación de las cinco particiones de ventas.

El servicio de ventas calcula el hash del contenido normalizado y comprueba si la clave ya fue utilizada.

El comportamiento implementado es:

- Una clave nueva permite registrar una venta.
- Una clave repetida con el mismo contenido devuelve la venta original.
- Una clave repetida con contenido diferente genera un conflicto HTTP 409.
- Las solicitudes sin clave conservan el comportamiento anterior.
- Las solicitudes simultáneas con la misma clave no generan ventas ni eventos duplicados.

La lógica utiliza bloqueos transaccionales y comprobaciones posteriores a errores para atender posibles colisiones o resultados de confirmación ambiguos.

## 17. Adaptación del simulador para idempotencia y reintentos

Se modificó `simulator/simulador.js` para generar un identificador único por ejecución y una clave de idempotencia diferente para cada venta.

Cuando ocurre un error de red, timeout o respuesta HTTP 5xx, el simulador puede realizar hasta tres intentos.

Los reintentos conservan la misma clave de idempotencia de la solicitud original.

Se configuró un timeout de 10 segundos y esperas progresivas entre intentos.

Los errores HTTP 4xx no se reintentan, ya que normalmente representan errores de validación o conflictos que requieren corregir la solicitud.

## 18. Pruebas de idempotencia

Se realizaron pruebas para verificar el comportamiento del mecanismo:

| Escenario | Resultado |
|---|---|
| Repetición de una solicitud con el mismo contenido | Se recuperó la venta original |
| Misma clave con contenido diferente | HTTP 409 |
| Dos solicitudes simultáneas con la misma clave | Una venta registrada y una respuesta repetida |
| Reutilización de la clave en otra sucursal | Permitida |
| Solicitud sin clave de idempotencia | Funcionamiento normal |
| Repetición después de reiniciar el backend | Se recuperó la venta original |

Durante la prueba de concurrencia se verificó que las dos solicitudes devolvieran el mismo identificador de venta y que el inventario disminuyera únicamente una vez.

También se comprobó que se generara un solo conjunto de tres eventos Outbox para esa venta.

La prueba posterior al reinicio devolvió HTTP 200 y el identificador de la venta original, con `repetida: true`.

## 19. Prueba del simulador con las mejoras de la fase 2

Se ejecutó el siguiente comando:

`node simulator\simulador.js 10 1 2026`

Resultados obtenidos:

| Métrica | Resultado |
|---|---:|
| Ventas exitosas | 10 |
| Ventas fallidas | 0 |
| Total procesadas | 10 |
| Duración | 490.49 ms |
| Ventas por segundo | 20.39 |
| Latencia promedio | 48.33 ms |
| P50 | 35.32 ms |
| P95 | 133.84 ms |

El resumen se envió correctamente al endpoint protegido y se almacenó en MongoDB.

## 20. Conclusión de la fase 2

Durante la segunda fase se incorporaron mecanismos adicionales de observabilidad, protección y confiabilidad.

Se integraron métricas compatibles con Prometheus, cálculo de percentiles, registro protegido de simulaciones e idempotencia en las operaciones de venta.

Las pruebas realizadas comprobaron la repetición segura de solicitudes, el comportamiento ante solicitudes simultáneas, la conservación de la información después de reiniciar el backend y la integración del simulador con el nuevo endpoint.

Queda pendiente completar la revisión integral de los cambios, verificar las evidencias y preparar la entrega final del proyecto.
