const promClient = require('prom-client');

// Crear registro de metricas
const register = new promClient.Registry();

// Registrar metricas generales de Node.js
promClient.collectDefaultMetrics({ register });

// Contador de solicitudes de venta
const ventasSolicitudes = new promClient.Counter({
    name: 'ventas_solicitudes_total',
    help: 'Total de solicitudes de venta recibidas',
    labelNames: ['resultado'],
    registers: [register]
});

// Histograma de duracion de solicitudes
const ventasDuracion = new promClient.Histogram({
    name: 'ventas_duracion_segundos',
    help: 'Duracion de las solicitudes de venta en segundos',
    labelNames: ['resultado'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register]
});

// Indicador de eventos pendientes en PostgreSQL
const eventosPendientes = new promClient.Gauge({
    name: 'eventos_pendientes',
    help: 'Cantidad de eventos pendientes de procesar',
    registers: [register]
});

module.exports = {
    register,
    ventasSolicitudes,
    ventasDuracion,
    eventosPendientes
};
