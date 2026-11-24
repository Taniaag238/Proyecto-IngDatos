const express = require('express');
const cors = require('cors');
const databaseRoutes = require('./routes/databaseRoutes');
const app = express();
const ventasRoutes = require('./routes/ventasRoutes');
const { register } = require('./metrics/metrics');
const simulacionesRoutes = require('./routes/simulacionesRoutes');

// Middlewares
app.use(cors());
app.use(express.json({ limit: '16kb' }));

// Endpoint de metricas para Prometheus
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

// Ruta principal
app.get('/', (req, res) => {
    res.send('Bienvenido al Sistema de Ventas e Inventarios');
});

// Verificar funcionamiento del servidor
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        message: 'API de Ventas e Inventarios funcionando'
    });
});

// Rutas para comprobar conexiones
app.use('/api/database', databaseRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/simulaciones', simulacionesRoutes);

module.exports = app;
