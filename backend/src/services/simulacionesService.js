const { getMongoDB } = require('../database/mongodb');

// Guardar resumen de simulacion
async function guardarResumen(resumen) {

    // Obtener conexion existente a MongoDB
    const database = getMongoDB();

    // Seleccionar coleccion de simulaciones
    const coleccion = database.collection('simulaciones');

    // Insertar resumen
    const resultado = await coleccion.insertOne({
        ...resumen,
        fecha: new Date()
    });

    return {
        ok: true,
        id_simulacion: resultado.insertedId
    };
}

module.exports = {
    guardarResumen
};