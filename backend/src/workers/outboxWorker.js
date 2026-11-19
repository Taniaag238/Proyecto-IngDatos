
const postgres = require('../database/postgresql');
const { connectMongoDB } = require('../database/mongodb');
const { publicarEvento } = require('../services/eventosService');

let workerActivo = false;
let temporizador = null;
let tiempoEspera = 5000;

//Procesar los eventos pendientes
async function procesarEventos() {

    if (workerActivo) {
        return;
    }

    workerActivo = true;

    let client;
    let huboErrores = false;

    try {

        //Conectar a PostgreSQL
        client = await postgres.connect();

        await client.query('BEGIN');

        //Obtener eventos pendientes
        const resultado = await client.query(`
            SELECT id_evento, coleccion, payload
            FROM eventos_pendientes
            WHERE estado = 'pendiente'
            ORDER BY creado_en ASC
            LIMIT 10
            FOR UPDATE SKIP LOCKED
        `);

        //Procesar cada evento
        for (const evento of resultado.rows) {

            try {

                //Conectar a MongoDB
                await connectMongoDB();

                //Publicar evento
                await publicarEvento(
                    evento.coleccion,
                    evento.payload
                );

                //Marcar como procesado
                await client.query(`
                    UPDATE eventos_pendientes
                    SET estado = 'procesado',
                        procesado_en = CURRENT_TIMESTAMP,
                        ultimo_error = NULL
                    WHERE id_evento = $1
                `, [evento.id_evento]);

                console.log(
                    `[OUTBOX] Evento procesado: ${evento.id_evento}`
                );

            } catch (error) {

                huboErrores = true;

                //Registrar el error
                await client.query(`
                    UPDATE eventos_pendientes
                    SET intentos = intentos + 1,
                        ultimo_error = $2
                    WHERE id_evento = $1
                `, [
                    evento.id_evento,
                    error.message
                ]);

                console.error(
                    `[OUTBOX] Error en ${evento.id_evento}:`,
                    error.message
                );
            }
        }

        await client.query('COMMIT');

        //Ajustar el tiempo de espera
        if (huboErrores) {
            tiempoEspera = Math.min(tiempoEspera * 2, 60000);
        } else {
            tiempoEspera = 5000;
        }

    } catch (error) {

        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }

        //Aumentar espera si falla el procesamiento general
        tiempoEspera = Math.min(tiempoEspera * 2, 60000);

        console.error(
            '[OUTBOX] Error al procesar eventos:',
            error.message
        );

    } finally {

        if (client) {
            client.release();
        }

        workerActivo = false;
    }
}

//Programar la siguiente ejecución
function programarSiguienteEjecucion() {

    if (temporizador) {
        clearTimeout(temporizador);
    }

    temporizador = setTimeout(async () => {

        temporizador = null;

        await procesarEventos();

        programarSiguienteEjecucion();

    }, tiempoEspera);
}

//Iniciar el worker
function iniciarOutboxWorker() {

    if (temporizador || workerActivo) {
        return;
    }

    console.log('[OUTBOX] Worker iniciado.');

    procesarEventos().finally(() => {
        programarSiguienteEjecucion();
    });
}

//Detener el worker
function detenerOutboxWorker() {

    if (temporizador) {
        clearTimeout(temporizador);
        temporizador = null;
    }

    console.log('[OUTBOX] Worker detenido.');
}

module.exports = {
    iniciarOutboxWorker,
    detenerOutboxWorker,
    procesarEventos
};
