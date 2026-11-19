const { getMongoDB } = require('../database/mongodb');

//Registrar errores de negocio en MongoDB
async function registrarErrorNegocio(error, datos) {

    try {

        const db = getMongoDB();

        const registro = {
            fecha: new Date(),
            codigo: error.codigo,
            estado_http: error.status,
            mensaje: error.mensaje,
            resumen: {
                id_cliente: datos.id_cliente,
                id_sucursal: datos.id_sucursal,
                productos: datos.productos.map(producto => ({
                    id_producto: producto.id_producto,
                    cantidad: producto.cantidad
                }))
            }
        };

        await db.collection('errores_sistema').insertOne(registro);

        console.log('Error de negocio registrado en MongoDB.');

    } catch (errorMongo) {

        console.error(
            'No fue posible registrar el error en MongoDB:',
            errorMongo.message
        );
    }
}

module.exports = {
    registrarErrorNegocio
};
