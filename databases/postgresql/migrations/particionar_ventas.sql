BEGIN;

-- Seguro: se cancela todo si hay datos o si ya esta particionada
DO $$
BEGIN
    IF (SELECT relkind FROM pg_class WHERE oid = 'ventas'::regclass) <> 'r' THEN
        RAISE EXCEPTION 'ventas ya no es una tabla normal (quizas ya esta particionada). Migracion cancelada.';
    END IF;
    IF EXISTS (SELECT 1 FROM ventas) OR EXISTS (SELECT 1 FROM detalle_venta) THEN
        RAISE EXCEPTION 'ventas o detalle_venta tienen datos. Migracion cancelada: hacer respaldo primero.';
    END IF;
END
$$;

-- Recrear (estan vacias). detalle_venta primero porque depende de ventas.
DROP TABLE detalle_venta;
DROP TABLE ventas;

CREATE TABLE ventas (
    id_venta SERIAL,
    id_cliente INT NOT NULL,
    id_sucursal INT NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    estado VARCHAR(30) DEFAULT 'completada',
    PRIMARY KEY (id_venta, id_sucursal),
    FOREIGN KEY (id_sucursal)
        REFERENCES sucursales(id_sucursal)
) PARTITION BY LIST (id_sucursal);

CREATE TABLE ventas_s1 PARTITION OF ventas FOR VALUES IN (1);
CREATE TABLE ventas_s2 PARTITION OF ventas FOR VALUES IN (2);
CREATE TABLE ventas_s3 PARTITION OF ventas FOR VALUES IN (3);
CREATE TABLE ventas_s4 PARTITION OF ventas FOR VALUES IN (4);
CREATE TABLE ventas_s5 PARTITION OF ventas FOR VALUES IN (5);

CREATE TABLE detalle_venta (
    id_detalle SERIAL PRIMARY KEY,
    id_venta INT NOT NULL,
    id_sucursal INT NOT NULL,
    id_producto INT NOT NULL,
    cantidad INT NOT NULL CHECK (cantidad > 0),
    precio_unitario NUMERIC(10,2) NOT NULL CHECK (precio_unitario >= 0),
    FOREIGN KEY (id_venta, id_sucursal)
        REFERENCES ventas(id_venta, id_sucursal)
);

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

COMMIT;