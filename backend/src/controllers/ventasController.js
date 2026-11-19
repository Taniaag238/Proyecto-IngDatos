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
            return responderError(
                res,
                400,
                'SOLICITUD_INVALIDA',
                errorValidacion
            );
        }

        const { id_cliente, id_sucursal, productos } = req.body;

        //Enviar datos validados
        const resultado = await ventasService.procesarVenta({
            id_cliente,
            id_sucursal,
            productos
        });

        return res.status(201).json({
            ok: true,
            venta: resultado.venta,
            eventos: resultado.eventos
        });

    } catch (error) {

         //Registrar errores de negocio en MongoDB
        const erroresNegocio = [
            'CLIENTE_NO_EXISTE',
            'PRODUCTO_NO_EXISTE',
            'STOCK_INSUFICIENTE',
            'SUCURSAL_NO_EXISTE'
        ];

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
