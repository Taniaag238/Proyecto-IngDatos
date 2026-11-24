
-- Sistema de Ventas e Inventarios
-- Base de datos: PostgreSQL

CREATE TABLE IF NOT EXISTS sucursales (
    id_sucursal SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    ubicacion VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS inventario (
    id_inventario SERIAL PRIMARY KEY,
    id_sucursal INT NOT NULL,
    id_producto INT NOT NULL,
    existencia INT NOT NULL DEFAULT 0,
    FOREIGN KEY (id_sucursal)
        REFERENCES sucursales(id_sucursal),
    UNIQUE (id_sucursal, id_producto)
);

-- ventas particionada por sucursal (LIST sobre id_sucursal)
CREATE TABLE IF NOT EXISTS ventas (
    id_venta SERIAL,
    id_cliente INT NOT NULL,
    id_sucursal INT NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    estado VARCHAR(30) DEFAULT 'completada',
    idempotency_key VARCHAR(120),
    request_hash CHAR(64),
    PRIMARY KEY (id_venta, id_sucursal),
    UNIQUE (id_sucursal, idempotency_key),
    FOREIGN KEY (id_sucursal)
        REFERENCES sucursales(id_sucursal)
) PARTITION BY LIST (id_sucursal);

CREATE TABLE IF NOT EXISTS ventas_s1 PARTITION OF ventas FOR VALUES IN (1);
CREATE TABLE IF NOT EXISTS ventas_s2 PARTITION OF ventas FOR VALUES IN (2);
CREATE TABLE IF NOT EXISTS ventas_s3 PARTITION OF ventas FOR VALUES IN (3);
CREATE TABLE IF NOT EXISTS ventas_s4 PARTITION OF ventas FOR VALUES IN (4);
CREATE TABLE IF NOT EXISTS ventas_s5 PARTITION OF ventas FOR VALUES IN (5);

CREATE TABLE IF NOT EXISTS detalle_venta (
    id_detalle SERIAL PRIMARY KEY,
    id_venta INT NOT NULL,
    id_sucursal INT NOT NULL,
    id_producto INT NOT NULL,
    cantidad INT NOT NULL CHECK (cantidad > 0),
    precio_unitario NUMERIC(10,2) NOT NULL CHECK (precio_unitario >= 0),
    FOREIGN KEY (id_venta, id_sucursal)
        REFERENCES ventas(id_venta, id_sucursal)
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id_movimiento SERIAL PRIMARY KEY,
    id_producto INT NOT NULL,
    id_sucursal INT NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    cantidad INT NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_sucursal)
        REFERENCES sucursales(id_sucursal)
);

-- Outbox: eventos que deben publicarse en MongoDB
CREATE TABLE IF NOT EXISTS eventos_pendientes (
    id_evento VARCHAR(120) PRIMARY KEY,
    id_venta BIGINT NOT NULL,
    id_sucursal INT NOT NULL,
    coleccion VARCHAR(60) NOT NULL,
    payload JSONB NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    intentos INT NOT NULL DEFAULT 0,
    ultimo_error TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    procesado_en TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eventos_pendientes_estado
    ON eventos_pendientes (estado, creado_en);