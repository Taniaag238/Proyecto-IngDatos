# Contrato de Integración
## Sistema de Ventas e Inventarios

**Proyecto:** Ingeniería de Datos  
**Módulo:** Lógica de negocio y generación de datos  
**Versión:** 1.0

---

## 1. Objetivo

Establecer las reglas y estructuras de datos necesarias para integrar los tres motores de bases de datos del sistema de ventas e inventarios:

- **MySQL:** almacenamiento y validación de clientes y productos.
- **PostgreSQL:** registro de ventas, detalles e inventario.
- **MongoDB:** almacenamiento de eventos, auditoría y errores del sistema.

El objetivo es garantizar que una venta se procese correctamente y que la información se mantenga consistente entre los motores.

## 2. Identificadores y rangos

| Entidad | Identificador |    Rango   |
|---------|---------------|------------|
|Clientes |   id_cliente  | 1 a 22,000 |
|Productos|  id_producto  | 1 a 8,000  |
|Sucursales| id_sucursal  |    1 a 5   |
| Ventas  |   id_venta    | Generado por PostgreSQL |

La identidad de una venta estará compuesta por `(id_venta, id_sucursal)`.

## 3. Reglas de negocio

1. El cliente debe existir en MySQL.
2. Los productos solicitados deben existir en MySQL.
3. La sucursal debe existir en PostgreSQL.
4. La cantidad de cada producto debe ser un número entero positivo.
5. No se permitirán productos duplicados en una misma solicitud; deberán rechazarse o consolidarse.
6. El precio de los productos se obtendrá desde MySQL y nunca se confiará en el precio enviado por el cliente.
7. El inventario nunca podrá tener existencias negativas.
8. Las operaciones de venta e inventario deberán realizarse mediante una transacción en PostgreSQL.
9. Los eventos de una venta deberán registrarse en MongoDB o quedar pendientes para su recuperación posterior.

## 4. Endpoint de ventas

**Método:** POST

**Ruta:** `/api/ventas`

**Content-Type:** `application/json`

### 4.1. Estructura de la solicitud

```json
{
  "id_cliente": 15,
  "id_sucursal": 2,
  "productos": [
    {
      "id_producto": 41,
      "cantidad": 2
    },
    {
      "id_producto": 77,
      "cantidad": 1
    }
  ]
}
```

### 4.2. Respuesta exitosa

**Código HTTP:** 201 Created

```json
{
  "ok": true,
  "venta": {
    "id_venta": 123,
    "id_sucursal": 2,
    "total": 450.00
  },
  "eventos": "registrados"
}
```

Si PostgreSQL confirma la venta, pero MongoDB no está disponible, la respuesta seguirá siendo 201 y el campo `eventos` indicará `"pendientes"`.

## 5. Códigos de respuesta HTTP

| Código | Descripción |
|---|---|
| 201 | Venta creada correctamente. |
| 400 | Solicitud inválida o datos incorrectos. |
| 404 | Cliente, producto o sucursal inexistente. |
| 409 | Stock insuficiente. |
| 500 | Error inesperado del servidor. |
| 503 | Servicio indispensable no disponible. |

### 5.1. Ejemplo de respuesta de error

```json
{
  "ok": false,
  "codigo": "STOCK_INSUFICIENTE",
  "mensaje": "No existe suficiente inventario para completar la venta."
}
```

## 6. Contrato de eventos MongoDB

Cada evento deberá contener la siguiente estructura:

```json
{
  "id_evento": "venta:123:2:creada",
  "tipo": "VENTA_CREADA",
  "id_venta": 123,
  "id_sucursal": 2,
  "fecha": "2026-11-13T12:00:00.000Z",
  "detalle": {
    "id_cliente": 15,
    "total": 450.00
  }
}
```

### 6.1. Tipos de eventos

| Evento | Colección MongoDB |
|---|---|
| VENTA_CREADA | eventos_ventas |
| VENTA_REGISTRADA | auditoria |
| INVENTARIO_DESCONTADO | cambios_inventario |

Los eventos deberán contar con un identificador único para evitar duplicados durante los reintentos.

## 7. Manejo de errores

Cuando ocurra un error de negocio, como un cliente inexistente, producto inexistente o falta de inventario:

- Se devolverá el código HTTP correspondiente.
- No se deberán dejar modificaciones parciales en PostgreSQL.
- Se registrará el error en la colección `errores_sistema` cuando MongoDB esté disponible.
- Si MongoDB no está disponible, se registrará en los logs y se considerará un mecanismo de recuperación.

## 8. Consistencia de datos

La venta deberá cumplir las siguientes condiciones:

1. Validar clientes y productos en MySQL.
2. Validar y descontar inventario en PostgreSQL.
3. Registrar la venta y sus detalles en PostgreSQL.
4. Generar los eventos correspondientes para MongoDB.
5. Si MongoDB falla después de confirmar PostgreSQL, conservar los eventos pendientes para procesarlos posteriormente.

---

**Fin del contrato de integración.**