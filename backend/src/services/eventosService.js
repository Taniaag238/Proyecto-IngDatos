const { getMongoDB } = require('../database/mongodb');

//Colecciones para los eventos
const COLECCIONES_PERMITIDAS = [
    'eventos_ventas',
    'auditoria',
    'cambios_inventario'
];

//Publicar evento en MongoDb
async function publicarEvento(coleccion, payload) {

    //Validar la coleccion destino
    if (!COLECCIONES_PERMITIDAS.includes(coleccion)) {
        throw new Error(
            `Coleccion de eventos no permitida: ${coleccion}`
        );
    }

    //Validar identiifcador del evento
    if (!payload || !payload.id_evento) {
        throw new Error(
            'El evento debe contener un id_evento.'
        );
    }

    //Conexion a MongoDb
    const database = getMongoDB();

    //Seleccionar coleccion
    const coleccionMongo = database.collection(coleccion);

    //Insertar
    const resultado = await coleccionMongo.updateOne(
        {
            id_evento: payload.id_evento
        },
        {
            $setOnInsert: payload
        },
        {
            upsert: true
        }
    );

    return {
        ok: true,
        id_evento: payload.id_evento,
        coleccion,
        insertado: resultado.upsertedCount === 1
    };
}

module.exports = {
    publicarEvento
};
