const express = require('express');
const router = express.Router();

const simulacionesController = require('../controllers/simulacionesController');
const verificarApiKey = require('../middlewares/apiKeyMiddleware');

// Registrar resumen de simulacion (protegido)
router.post(
    '/resumen',
    verificarApiKey,
    simulacionesController.registrarResumen
);

module.exports = router;