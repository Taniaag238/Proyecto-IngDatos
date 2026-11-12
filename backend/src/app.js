
const express = require('express');
const cors = require('cors');

const databaseRoutes = require('./routes/databaseRoutes');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

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

module.exports = app;
