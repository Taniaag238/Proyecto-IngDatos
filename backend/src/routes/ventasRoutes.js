const express = require('express');
const router = express.Router();

const ventasController = require('../controllers/ventasController');
const {
    ventasSolicitudes,
    ventasDuracion
} = require('../metrics/metrics');

// Medir cada solicitud de venta
function medirSolicitudVenta(req, res, next) {
    const inicio = process.hrtime.bigint();

    res.on('finish', () => {
        let resultado = res.locals.resultadoMetrica;

        if (!resultado) {
            if (res.statusCode >= 500) {
                resultado = 'error';
            } else if (res.statusCode >= 400) {
                resultado = 'validacion';
            } else {
                resultado = 'ok';
            }
        }

        const duracion = Number(process.hrtime.bigint() - inicio) / 1e9;

        ventasSolicitudes.labels(resultado).inc();
        ventasDuracion.labels(resultado).observe(duracion);
    });

    next();
}

// Registrar una venta
router.post('/', medirSolicitudVenta, ventasController.crearVenta);

module.exports = router;
