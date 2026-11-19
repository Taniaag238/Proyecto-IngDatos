const mysql = require('../database/mysql');
const postgres = require('../database/postgresql');

//Crear errores https
function crearError(status, codigo, mensaje) {
    const error = new Error(mensaje);

    error.status = status;
    error.codigo = codigo;
    error.mensaje = mensaje;

    return error;
}

//Convertir precio a centavos
function convertirACentavos(precio) {
    return Math.round(Number(precio) * 100);
}

//Centavos como precio decimal
function formatearPrecio(centavos) {
    return (centavos / 100).toFixed(2);
}

//Procesar una venta
async function procesarVenta(datos) {

    const { id_cliente, id_sucursal, productos } = datos;

    //Validar cliente en MySQL
    let clientes;

    try {
        const [filas] = await mysql.query(
            `SELECT id_cliente
             FROM clientes
             WHERE id_cliente = ?`,
            [id_cliente]
        );

        clientes = filas;

    } catch (error) {
        throw crearError(
            503,
            'MYSQL_NO_DISPONIBLE',
            'No fue posible consultar los clientes en MySQL.'
        );
    }

    if (clientes.length === 0) {
        throw crearError(
            404,
            'CLIENTE_NO_EXISTE',
            'El cliente indicado no existe.'
        );
    }

    //Consultar producto y precio
    const idsProductos = productos.map(
        producto => producto.id_producto
    );

    const placeholders = idsProductos.map(() => '?').join(', ');

    let productosBD;

    try {
        const [filas] = await mysql.query(
            `SELECT
                p.id_producto,
                p.nombre,
                p.precio,
                ca.id_categoria,
                pr.id_proveedor
             FROM productos p
             INNER JOIN categorias ca
                ON ca.id_categoria = p.id_categoria
             INNER JOIN proveedores pr
                ON pr.id_proveedor = p.id_proveedor
             WHERE p.id_producto IN (${placeholders})`,
            idsProductos
        );

        productosBD = filas;

    } catch (error) {
        throw crearError(
            503,
            'MYSQL_NO_DISPONIBLE',
            'No fue posible consultar los productos en MySQL.'
        );
    }

    //Verificar que todos los productos existan
    if (productosBD.length !== productos.length) {
        const encontrados = new Set(
            productosBD.map(producto => producto.id_producto)
        );

        const faltantes = idsProductos.filter(
            id => !encontrados.has(id)
        );

        throw crearError(
            404,
            'PRODUCTO_NO_EXISTE',
            `No existen los siguientes productos: ${faltantes.join(', ')}.`
        );
    }

    //Preparar precios y calcular total

    const mapaPrecios = new Map();

    for (const producto of productosBD) {
        mapaPrecios.set(
            producto.id_producto,
            convertirACentavos(producto.precio)
        );
    }

    let totalCentavos = 0;

    for (const producto of productos) {
        const precio = mapaPrecios.get(producto.id_producto);

        totalCentavos += precio * producto.cantidad;
    }

    const total = formatearPrecio(totalCentavos);

    //Obtener conexion con PostgreSQL
    let client;

    try {
        client = await postgres.connect();
    } catch (error) {
        throw crearError(
            503,
            'POSTGRESQL_NO_DISPONIBLE',
            'No fue posible conectar con PostgreSQL.'
        );
    }

    let transaccionIniciada = false;

    try {

        //Iniciar transaccion
        await client.query('BEGIN');
        transaccionIniciada = true;

        //Validar sucursal
        const sucursal = await client.query(
            `SELECT id_sucursal
             FROM sucursales
             WHERE id_sucursal = $1`,
            [id_sucursal]
        );

        if (sucursal.rowCount === 0) {
            throw crearError(
                404,
                'SUCURSAL_NO_EXISTE',
                'La sucursal indicada no existe.'
            );
        }

       //Consultar y bloquer inventario
        const inventario = await client.query(
            `SELECT id_producto, existencia
             FROM inventario
             WHERE id_sucursal = $1
             AND id_producto = ANY($2::int[])
             ORDER BY id_producto
             FOR UPDATE`,
            [id_sucursal, idsProductos]
        );

        //Mapear exitencias
        const mapaInventario = new Map();

        for (const fila of inventario.rows) {
            mapaInventario.set(
                fila.id_producto,
                fila.existencia
            );
        }

        //Comprobar existencias
        for (const producto of productos) {

            const existencia = mapaInventario.get(
                producto.id_producto
            );

            if (
                existencia === undefined ||
                existencia < producto.cantidad
            ) {
                throw crearError(
                    409,
                    'STOCK_INSUFICIENTE',
                    `No existe suficiente inventario del producto ${producto.id_producto}.`
                );
            }
        }

        //Registrar venta
        const ventaInsertada = await client.query(
            `INSERT INTO ventas
                (id_cliente, id_sucursal, total, estado)
             VALUES ($1, $2, $3, $4)
             RETURNING id_venta, id_sucursal, total`,
            [id_cliente, id_sucursal, total, 'completada']
        );

        const venta = ventaInsertada.rows[0];

        const id_venta = venta.id_venta;

        //Registrar detalles de venta
        for (const producto of productos) {

            const precioCentavos = mapaPrecios.get(
                producto.id_producto
            );

            const precioUnitario = formatearPrecio(
                precioCentavos
            );

            await client.query(
                `INSERT INTO detalle_venta
                    (id_venta, id_sucursal, id_producto,
                     cantidad, precio_unitario)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    id_venta,
                    id_sucursal,
                    producto.id_producto,
                    producto.cantidad,
                    precioUnitario
                ]
            );
        }

        //Descontar inventario
        for (const producto of productos) {

            const actualizacion = await client.query(
                `UPDATE inventario
                 SET existencia = existencia - $1
                 WHERE id_sucursal = $2
                 AND id_producto = $3
                 AND existencia >= $1`,
                [
                    producto.cantidad,
                    id_sucursal,
                    producto.id_producto
                ]
            );

            if (actualizacion.rowCount !== 1) {
                throw crearError(
                    409,
                    'STOCK_INSUFICIENTE',
                    `No fue posible descontar el inventario del producto ${producto.id_producto}.`
                );
            }
        }

        //Registrar moviemiento en el inventario
        for (const producto of productos) {

            await client.query(
                `INSERT INTO movimientos_inventario
                    (id_producto, id_sucursal, tipo, cantidad)
                 VALUES ($1, $2, $3, $4)`,
                [
                    producto.id_producto,
                    id_sucursal,
                    'VENTA',
                    -producto.cantidad
                ]
            );
        }

        //Construir los tres eventos de outbox
        const fecha = new Date().toISOString();

        const prefijo = `venta:${id_venta}:${id_sucursal}`;

        const detalleVenta = {
            id_cliente,
            total: Number(total),
            lineas: productos.length
        };

        const eventoVenta = {
            id_evento: `${prefijo}:creada`,
            tipo: 'VENTA_CREADA',
            id_venta,
            id_sucursal,
            fecha,
            detalle: detalleVenta
        };

        const eventoAuditoria = {
            id_evento: `${prefijo}:registrada`,
            tipo: 'VENTA_REGISTRADA',
            id_venta,
            id_sucursal,
            fecha,
            detalle: detalleVenta
        };

        const eventoInventario = {
            id_evento: `${prefijo}:inventario`,
            tipo: 'INVENTARIO_DESCONTADO',
            id_venta,
            id_sucursal,
            fecha,
            detalle: {
                productos: productos.map(producto => ({
                    id_producto: producto.id_producto,
                    cantidad: producto.cantidad
                }))
            }
        };

        //Guardar eventos de outbox
        const eventos = [
            {
                coleccion: 'eventos_ventas',
                payload: eventoVenta
            },
            {
                coleccion: 'auditoria',
                payload: eventoAuditoria
            },
            {
                coleccion: 'cambios_inventario',
                payload: eventoInventario
            }
        ];

        for (const evento of eventos) {

            await client.query(
                `INSERT INTO eventos_pendientes
                    (id_evento, id_venta, id_sucursal,
                     coleccion, payload)
                 VALUES ($1, $2, $3, $4, $5::jsonb)`,
                [
                    evento.payload.id_evento,
                    id_venta,
                    id_sucursal,
                    evento.coleccion,
                    JSON.stringify(evento.payload)
                ]
            );
        }

        //Confirmar transaccion
        await client.query('COMMIT');
        transaccionIniciada = false;

        console.log(
            `Venta ${id_venta} registrada correctamente.`
        );

        return {
            venta: {
                id_venta,
                id_sucursal,
                total: Number(total)
            },
            eventos: 'pendientes'
        };

    } catch (error) {

        //Si algo falla se cancela la venta
        if (transaccionIniciada) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error(
                    'Error al ejecutar ROLLBACK:',
                    rollbackError.message
                );
            }
        }

        throw error;

    } finally {

        //Devolver la conexion al pool
        client.release();
    }
}

module.exports = {
    procesarVenta
};
