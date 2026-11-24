const ventasService = require('../services/ventasService');
const erroresService = require('../services/erroresService');

//Respuesta estandarizada para errores
function responderError(res, status, codigo, mensaje) {
    return res.status(status).json({
        ok: false,
        codigo,
        mensaje
    });
}

//Validar los datos recibidos
function validarSolicitud(datos) {

    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
        return 'El cuerpo de la solicitud debe ser un objeto JSON.';
    }

    const { id_cliente, id_sucursal, productos } = datos;

    //Cliente
    if (!Number.isInteger(id_cliente) ||
        id_cliente < 1 || id_cliente > 22000) {
        return 'El id_cliente debe ser un entero entre 1 y 22000.';
    }

    //Sucursal
    if (!Number.isInteger(id_sucursal) ||
        id_sucursal < 1 || id_sucursal > 5) {
        return 'El id_sucursal debe ser un entero entre 1 y 5.';
    }

    //Arreglo de productos
    if (!Array.isArray(productos) || productos.length === 0) {
        return 'La venta debe contener al menos un producto.';
    }

    const productosRegistrados = new Set();

    for (const producto of productos) {

        if (!producto || typeof producto !== 'object' ||
            Array.isArray(producto)) {
            return 'Cada producto debe ser un objeto válido.';
        }

        const { id_producto, cantidad } = producto;

        // Validar identificador d eproducto
        if (!Number.isInteger(id_producto) ||
            id_producto < 1 || id_producto > 8000) {
            return 'Cada id_producto debe ser un entero entre 1 y 8000.';
        }

        //Validar cantidad
        if (!Number.isInteger(cantidad) || cantidad <= 0) {
            return 'La cantidad de cada producto debe ser un entero positivo.';
        }

        //Rechazar productos duplicados
        if (productosRegistrados.has(id_producto)) {
            return `El producto ${id_producto} está repetido en la solicitud.`;
        }

        productosRegistrados.add(id_producto);
    }

    return null;
}

//Crear una venta
async function crearVenta(req, res) {

    try {

        const errorValidacion = validarSolicitud(req.body);

        if (errorValidacion) {
            res.locals.resultadoMetrica = 'validacion';

            return responderError(
                res,
                400,
                'SOLICITUD_INVALIDA',
                errorValidacion
            );
        }

        const { id_cliente, id_sucursal, productos } = req.body;

        // OBTENER LA CLAVE DE IDEMPOTENCIA DEL ENCABEZADO
        const idempotencyKey = req.get('Idempotency-Key')?.trim() || null;

        // VALIDAR LONGITUD DE LA CLAVE
        if (idempotencyKey && idempotencyKey.length > 120) {
            res.locals.resultadoMetrica = 'validacion';
            return responderError(
                res,
                400,
                'IDEMPOTENCY_KEY_INVALIDA',
                'La clave de idempotencia no puede superar los 120 caracteres.'
            );
        }

        // PROCESAR LA VENTA
        const resultado = await ventasService.procesarVenta(
            {
                id_cliente,
                id_sucursal,
                productos
            },
            idempotencyKey
        );

        // CLASIFICAR EL RESULTADO PARA LAS METRICAS
        res.locals.resultadoMetrica = resultado.repetida
            ? 'repetida'
            : 'ok';

        // DEVOLVER 200 SI ES REPETIDA O 201 SI ES NUEVA
        const status = resultado.repetida ? 200 : 201;

        return res.status(status).json({
            ok: true,
            ...resultado
        });

    } catch (error) {

         //Registrar errores de negocio en MongoDB
        const erroresNegocio = [
            'CLIENTE_NO_EXISTE',
            'PRODUCTO_NO_EXISTE',
            'STOCK_INSUFICIENTE',
            'SUCURSAL_NO_EXISTE'
        ];

        if (error.codigo === 'STOCK_INSUFICIENTE') {
            res.locals.resultadoMetrica = 'sin_stock';
        } else if (error.codigo === 'IDEMPOTENCY_KEY_REUTILIZADA') {
            res.locals.resultadoMetrica = 'conflicto';
        } else if (erroresNegocio.includes(error.codigo)) {
            res.locals.resultadoMetrica = 'validacion';
        } else {
            res.locals.resultadoMetrica = 'error';
        }

        if (erroresNegocio.includes(error.codigo)) {
            try {
                await erroresService.registrarErrorNegocio(error, req.body);
            } catch (errorRegistro) {
                console.error(
                    'No fue posible registrar el error de negocio:',
                    errorRegistro.message
                );
            }
        }
       
        console.error('Error al procesar la venta:', error.message);

        return responderError(
            res,
            error.status || 500,
            error.codigo || 'ERROR_INTERNO',
            error.mensaje || 'Ocurrió un error al procesar la venta.'
        );
    }
}

module.exports = {
    crearVenta
};
