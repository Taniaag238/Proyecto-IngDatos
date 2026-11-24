// Verificar API Key del simulador
function verificarApiKey(req, res, next) {

    const apiKey = req.headers['x-api-key'];
    const apiKeyConfigurada = process.env.SIMULADOR_API_KEY;

    // Verificar que exista una clave configurada
    if (!apiKeyConfigurada) {
        return res.status(500).json({
            ok: false,
            codigo: 'API_KEY_NO_CONFIGURADA',
            mensaje: 'La clave de acceso no esta configurada.'
        });
    }

    // Comparar la clave recibida con la configurada
    if (!apiKey || apiKey !== apiKeyConfigurada) {
        return res.status(401).json({
            ok: false,
            codigo: 'API_KEY_INVALIDA',
            mensaje: 'No tienes autorizacion para realizar esta solicitud.'
        });
    }

    next();
}

module.exports = verificarApiKey;