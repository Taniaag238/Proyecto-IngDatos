const mysql = require('../database/mysql');
const postgres = require('../database/postgresql');
const crypto = require('crypto');

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

// GENERAR HASH DE UNA SOLICITUD NORMALIZADA
function generarHashSolicitud(datos) {

    const solicitudNormalizada = {
        id_cliente: datos.id_cliente,
        id_sucursal: datos.id_sucursal,
        productos: [...datos.productos]
            .sort((a, b) => a.id_producto - b.id_producto)
            .map(producto => ({
                id_producto: producto.id_producto,
                cantidad: producto.cantidad
            }))
    };

    return crypto
        .createHash('sha256')
        .update(JSON.stringify(solicitudNormalizada))
        .digest('hex');
}

// BUSCAR UNA VENTA MEDIANTE SU CLAVE DE IDEMPOTENCIA
async function buscarVentaPorClave(id_sucursal, idempotencyKey) {

    const resultado = await postgres.query(
        `SELECT
            id_venta,
            id_sucursal,
            total,
            request_hash
         FROM ventas
         WHERE id_sucursal = $1
         AND idempotency_key = $2`,
        [id_sucursal, idempotencyKey]
    );

    return resultado.rows[0] || null;
}

//Procesar una venta
async function procesarVenta(datos, idempotencyKey = null) {

    const { id_cliente, id_sucursal, productos } = datos;

    // CALCULAR EL HASH DE LA SOLICITUD
    const hashSolicitud = idempotencyKey
        ? generarHashSolicitud(datos)
        : null;

    // COMPROBAR SI LA VENTA YA FUE REGISTRADA
    if (idempotencyKey) {

        let ventaExistente;

        try {
            ventaExistente = await buscarVentaPorClave(
                id_sucursal,
                idempotencyKey
            );

        } catch (error) {
            throw crearError(
                503,
                'POSTGRESQL_NO_DISPONIBLE',
                'No fue posible verificar la clave de idempotencia.'
            );
        }

        if (ventaExistente) {

            // COMPARAR EL CONTENIDO DE LA SOLICITUD
            if (ventaExistente.request_hash !== hashSolicitud) {
                throw crearError(
                    409,
                    'IDEMPOTENCY_KEY_REUTILIZADA',
                    'La clave de idempotencia ya fue utilizada con datos diferentes.'
                );
            }

            // DEVOLVER LA VENTA ORIGINAL
            return {
                venta: {
                    id_venta: ventaExistente.id_venta,
                    id_sucursal: ventaExistente.id_sucursal,
                    total: Number(ventaExistente.total)
                },
                eventos: 'pendientes',
                repetida: true
            };
        }
    }

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

        // BLOQUEAR SOLICITUDES SIMULTANEAS CON LA MISMA CLAVE
        if (idempotencyKey) {

            const claveBloqueo = `${id_sucursal}:${idempotencyKey}`;

            await client.query(
                `SELECT pg_advisory_xact_lock(
                    hashtextextended($1, 0)
                )`,
                [claveBloqueo]
            );

            // VOLVER A COMPROBAR LA VENTA DENTRO DE LA TRANSACCION
            const ventaExistente = await client.query(
                `SELECT
                    id_venta,
                    id_sucursal,
                    total,
                    request_hash
                FROM ventas
                WHERE id_sucursal = $1
                AND idempotency_key = $2`,
                [id_sucursal, idempotencyKey]
            );

            if (ventaExistente.rowCount > 0) {

                const ventaOriginal = ventaExistente.rows[0];

                if (ventaOriginal.request_hash !== hashSolicitud) {
                    throw crearError(
                        409,
                        'IDEMPOTENCY_KEY_REUTILIZADA',
                        'La clave de idempotencia ya fue utilizada con datos diferentes.'
                    );
                }

                await client.query('COMMIT');
                transaccionIniciada = false;

                return {
                    venta: {
                        id_venta: ventaOriginal.id_venta,
                        id_sucursal: ventaOriginal.id_sucursal,
                        total: Number(ventaOriginal.total)
                    },
                    eventos: 'pendientes',
                    repetida: true
                };
            }
        }


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
        // REGISTRAR VENTA Y SU CLAVE DE IDEMPOTENCIA
        const ventaInsertada = await client.query(
            `INSERT INTO ventas
                (id_cliente, id_sucursal, total, estado,
                idempotency_key, request_hash)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id_venta, id_sucursal, total`,
            [
                id_cliente,
                id_sucursal,
                total,
                'completada',
                idempotencyKey,
                hashSolicitud
            ]
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

        // CANCELAR LA TRANSACCION SI SIGUE ACTIVA
        if (transaccionIniciada) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error(
                    'Error al ejecutar ROLLBACK:',
                    rollbackError.message
                );
            }

            transaccionIniciada = false;
        }

        // VERIFICAR SI LA VENTA SE CONFIRMO A PESAR DEL ERROR
        if (idempotencyKey) {

            try {
                const ventaRecuperada = await buscarVentaPorClave(
                    id_sucursal,
                    idempotencyKey
                );

                if (ventaRecuperada) {

                    // COMPROBAR QUE SEA LA MISMA SOLICITUD
                    if (ventaRecuperada.request_hash !== hashSolicitud) {
                        throw crearError(
                            409,
                            'IDEMPOTENCY_KEY_REUTILIZADA',
                            'La clave de idempotencia ya fue utilizada con datos diferentes.'
                        );
                    }

                    console.log(
                        `Venta ${ventaRecuperada.id_venta} recuperada mediante idempotencia.`
                    );

                    return {
                        venta: {
                            id_venta: ventaRecuperada.id_venta,
                            id_sucursal: ventaRecuperada.id_sucursal,
                            total: Number(ventaRecuperada.total)
                        },
                        eventos: 'pendientes',
                        repetida: true
                    };
                }

            } catch (errorRecuperacion) {

                if (errorRecuperacion.codigo === 'IDEMPOTENCY_KEY_REUTILIZADA') {
                    throw errorRecuperacion;
                }

                console.error(
                    'No fue posible recuperar la venta:',
                    errorRecuperacion.message
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
