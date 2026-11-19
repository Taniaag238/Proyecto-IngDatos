const axios = require('axios');
const path = require('path');
const { execFileSync } = require('child_process');
const { performance } = require('perf_hooks');
const { MongoClient } = require('mongodb');

// CARGAR LAS VARIABLES DE ENTORNO DEL BACKEND
require('dotenv').config({
    path: path.resolve(__dirname, '../backend/.env')
});

const API_URL = 'http://localhost:3000/api/ventas';

// CONFIGURACION DEL SIMULADOR
const TOTAL_VENTAS = Number(process.argv[2] || 10);
const CONCURRENCIA = Number(process.argv[3] || 1);
const SEED = Number(process.argv[4] || 2026);

// VALIDAR LA CONFIGURACION
function validarConfiguracion() {
    if (!Number.isInteger(TOTAL_VENTAS) ||
        TOTAL_VENTAS < 1 ||
        TOTAL_VENTAS > 1000) {
        throw new Error('El total de ventas debe estar entre 1 y 1000.');
    }

    if (!Number.isInteger(CONCURRENCIA) ||
        CONCURRENCIA < 1 ||
        CONCURRENCIA > 100) {
        throw new Error('La concurrencia debe estar entre 1 y 100.');
    }

    if (!Number.isInteger(SEED) ||
        SEED < 0 ||
        SEED > 4294967295) {
        throw new Error('La semilla debe ser un entero entre 0 y 4294967295.');
    }
}

// CREAR UN GENERADOR DE NUMEROS ALEATORIOS REPRODUCIBLE
function crearGenerador(seed) {
    let estado = seed >>> 0;

    return function () {
        estado = (estado * 1664525 + 1013904223) >>> 0;
        return estado / 4294967296;
    };
}

// GENERAR UN NUMERO ALEATORIO ENTRE MIN Y MAX
function numeroAleatorio(min, max, random) {
    return Math.floor(random() * (max - min + 1)) + min;
}

// GENERAR UNA VENTA ALEATORIA
function generarVenta(random) {
    const id_cliente = numeroAleatorio(1, 22000, random);
    const id_sucursal = numeroAleatorio(1, 5, random);

    const cantidadProductos = numeroAleatorio(1, 4, random);
    const productos = [];
    const productosUtilizados = [];

    while (productos.length < cantidadProductos) {
        const id_producto = numeroAleatorio(1, 8000, random);

        if (!productosUtilizados.includes(id_producto)) {
            productosUtilizados.push(id_producto);

            productos.push({
                id_producto: id_producto,
                cantidad: numeroAleatorio(1, 3, random)
            });
        }
    }

    return {
        id_cliente,
        id_sucursal,
        productos
    };
}

// OBTENER LA VERSION ACTUAL DE GIT
function obtenerInformacionGit() {
    const carpetaProyecto = path.resolve(__dirname, '..');

    let version_commit = 'no_disponible';
    let cambios_sin_commit = null;

    try {
        version_commit = execFileSync(
            'git',
            ['rev-parse', 'HEAD'],
            {
                cwd: carpetaProyecto,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }
        ).trim();

        const estadoGit = execFileSync(
            'git',
            ['status', '--porcelain'],
            {
                cwd: carpetaProyecto,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }
        ).trim();

        cambios_sin_commit = estadoGit.length > 0;

    } catch (error) {
        console.log('No fue posible obtener la informacion de Git.');
    }

    return {
        version_commit,
        cambios_sin_commit
    };
}

// ENVIAR UNA VENTA A LA API Y MEDIR SU LATENCIA
async function enviarVenta(venta) {
    const tiempoInicio = performance.now();

    try {
        const respuesta = await axios.post(API_URL, venta);

        const latencia = Number(
            (performance.now() - tiempoInicio).toFixed(2)
        );

        console.log(
            `Venta ${respuesta.data.venta.id_venta} registrada correctamente.`
        );

        return {
            exitosa: true,
            id_venta: respuesta.data.venta.id_venta,
            status_http: respuesta.status,
            codigo_error: null,
            latencia_ms: latencia
        };

    } catch (error) {
        const latencia = Number(
            (performance.now() - tiempoInicio).toFixed(2)
        );

        const status = error.response
            ? error.response.status
            : null;

        const codigo = error.response?.data?.codigo ||
            (status ? `HTTP_${status}` : error.code || 'ERROR_DESCONOCIDO');

        const mensaje = error.response
            ? error.response.data.mensaje
            : error.message;

        console.log(`Venta rechazada (${codigo}): ${mensaje}`);

        return {
            exitosa: false,
            id_venta: null,
            status_http: status,
            codigo_error: codigo,
            latencia_ms: latencia
        };
    }
}

// CALCULAR UN PERCENTIL DE LAS LATENCIAS
function calcularPercentil(latencias, percentil) {
    if (latencias.length === 0) {
        return 0;
    }

    const valoresOrdenados = [...latencias].sort((a, b) => a - b);

    const posicion = Math.ceil(
        percentil * valoresOrdenados.length
    ) - 1;

    return Number(valoresOrdenados[posicion].toFixed(2));
}

// EJECUTAR EL SIMULADOR
async function iniciarSimulador() {
    validarConfiguracion();

    // VALIDAR LA CONFIGURACION DE MONGODB
    const mongoUri = process.env.MONGO_URI;
    const mongoDatabase = process.env.MONGO_DATABASE;

    if (!mongoUri || !mongoDatabase) {
        throw new Error('No se encontraron las variables de MongoDB en backend/.env');
    }

    const mongoClient = new MongoClient(mongoUri);

    try {
        // CONECTAR CON MONGODB
        await mongoClient.connect();

        const database = mongoClient.db(mongoDatabase);
        const coleccion = database.collection('simulaciones');

        console.log('Conectado a MongoDB correctamente.');

        // PREPARAR LA INFORMACION DE LA EJECUCION
        const random = crearGenerador(SEED);
        const informacionGit = obtenerInformacionGit();

        let exitosas = 0;
        let fallidas = 0;

        const latencias = [];
        const errores_por_codigo = {};

        const tiempoInicio = performance.now();

        console.log('\n====================================');
        console.log('       SIMULADOR DE VENTAS');
        console.log('====================================');
        console.log(`Ventas solicitadas: ${TOTAL_VENTAS}`);
        console.log(`Concurrencia: ${CONCURRENCIA}`);
        console.log(`Semilla: ${SEED}\n`);

        // PROCESAR VENTAS EN LOTES CON CONCURRENCIA CONTROLADA
        for (let i = 0; i < TOTAL_VENTAS; i += CONCURRENCIA) {

            const lote = [];

            const cantidadLote = Math.min(
                CONCURRENCIA,
                TOTAL_VENTAS - i
            );

            // GENERAR LAS VENTAS DEL LOTE
            for (let j = 0; j < cantidadLote; j++) {
                const venta = generarVenta(random);

                console.log(
                    `Procesando venta ${i + j + 1} de ${TOTAL_VENTAS}...`
                );

                lote.push(venta);
            }

            // ENVIAR TODAS LAS VENTAS DEL LOTE SIMULTANEAMENTE
            const resultados = await Promise.all(
                lote.map(venta => enviarVenta(venta))
            );

            // CONTABILIZAR LOS RESULTADOS
            resultados.forEach(resultado => {
                latencias.push(resultado.latencia_ms);

                if (resultado.exitosa) {
                    exitosas++;
                } else {
                    fallidas++;

                    const codigo = resultado.codigo_error;

                    errores_por_codigo[codigo] =
                        (errores_por_codigo[codigo] || 0) + 1;
                }
            });
        }

        // CALCULAR LAS METRICAS FINALES
        const duracion_ms = Number(
            (performance.now() - tiempoInicio).toFixed(2)
        );

        const total = exitosas + fallidas;

        const latencia_promedio_ms = latencias.length > 0
            ? Number(
                (latencias.reduce((suma, valor) => suma + valor, 0) /
                    latencias.length).toFixed(2)
            )
            : 0;

        const ventas_por_segundo = duracion_ms > 0
            ? Number((exitosas / (duracion_ms / 1000)).toFixed(2))
            : 0;

        // CREAR EL RESUMEN DE LA SIMULACION
        const resumen = {
            fecha: new Date(),
            total,
            solicitadas: TOTAL_VENTAS,
            exitosas,
            fallidas,
            duracion_ms,
            concurrencia: CONCURRENCIA,
            seed: SEED,
            version_commit: informacionGit.version_commit,
            cambios_sin_commit: informacionGit.cambios_sin_commit,
            ventas_por_segundo,
            latencia_promedio_ms,
            latencia_p50_ms: calcularPercentil(latencias, 0.50),
            latencia_p95_ms: calcularPercentil(latencias, 0.95),
            errores_por_codigo
        };

        // GUARDAR EL RESUMEN EN MONGODB
        const resultadoMongo = await coleccion.insertOne(resumen);

        console.log('\n====================================');
        console.log('       RESULTADOS FINALES');
        console.log('====================================');
        console.log(`Ventas exitosas: ${exitosas}`);
        console.log(`Ventas fallidas: ${fallidas}`);
        console.log(`Total procesadas: ${total}`);
        console.log(`Tiempo total: ${duracion_ms} ms`);
        console.log(`Ventas por segundo: ${ventas_por_segundo}`);
        console.log(`Latencia promedio: ${latencia_promedio_ms} ms`);
        console.log(`Latencia P50: ${resumen.latencia_p50_ms} ms`);
        console.log(`Latencia P95: ${resumen.latencia_p95_ms} ms`);

        console.log('\nResumen guardado en MongoDB.');
        console.log(`ID de simulacion: ${resultadoMongo.insertedId}`);

    } finally {
        // CERRAR LA CONEXION CON MONGODB
        await mongoClient.close();
        console.log('\nConexion con MongoDB cerrada.');
    }
}

// INICIAR EL SIMULADOR
iniciarSimulador().catch(error => {
    console.error('\nError al ejecutar el simulador:', error.message);
    process.exitCode = 1;
});
