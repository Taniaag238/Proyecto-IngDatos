const simulacionesService = require('../services/simulacionesService');

// Respuesta estandarizada para errores
function responderError(res, status, codigo, mensaje) {
    return res.status(status).json({
        ok: false,
        codigo,
        mensaje
    });
}

// Validar los datos del resumen
function validarResumen(datos) {

    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
        return 'El cuerpo debe ser un objeto JSON.';
    }

    const {
        total,
        exitosas,
        fallidas,
        duracion_ms,
        concurrencia,
        p50_ms,
        p95_ms
    } = datos;

    if (!Number.isInteger(total) || total < 1) {
        return 'El total debe ser un entero positivo.';
    }

    if (!Number.isInteger(exitosas) || exitosas < 0) {
        return 'Las ventas exitosas deben ser un entero no negativo.';
    }

    if (!Number.isInteger(fallidas) || fallidas < 0) {
        return 'Las ventas fallidas deben ser un entero no negativo.';
    }

    if (exitosas + fallidas !== total) {
        return 'La suma de ventas exitosas y fallidas debe coincidir con el total.';
    }

    if (!Number.isFinite(duracion_ms) || duracion_ms < 0) {
        return 'La duracion debe ser un numero no negativo.';
    }

    if (!Number.isInteger(concurrencia) || concurrencia < 1) {
        return 'La concurrencia debe ser un entero positivo.';
    }

    if (!Number.isFinite(p50_ms) || p50_ms < 0) {
        return 'El P50 debe ser un numero no negativo.';
    }

    if (!Number.isFinite(p95_ms) || p95_ms < 0) {
        return 'El P95 debe ser un numero no negativo.';
    }

    if (p50_ms > p95_ms) {
        return 'El P50 no puede ser mayor que el P95.';
    }

    return null;
}

// Registrar resumen de simulacion
async function registrarResumen(req, res) {

    try {

        const errorValidacion = validarResumen(req.body);

        if (errorValidacion) {
            return responderError(
                res,
                400,
                'RESUMEN_INVALIDO',
                errorValidacion
            );
        }

        const resultado = await simulacionesService.guardarResumen(req.body);

        return res.status(201).json(resultado);

    } catch (error) {

        console.error('Error al guardar el resumen:', error.message);

        return responderError(
            res,
            500,
            'ERROR_INTERNO',
            'No fue posible guardar el resumen de simulacion.'
        );
    }
}

module.exports = {
    registrarResumen
};