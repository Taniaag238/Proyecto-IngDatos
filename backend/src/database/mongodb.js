const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

let database = null;
let connectionPromise = null;

//Conectar a MongoDB
async function connectMongoDB() {

    //Reutilizar conexion si exisite
    if (database) {
        return database;
    }

    //vitar intentos de conexion simultanea si es que existe
    if (!connectionPromise) {

        connectionPromise = client.connect()
            .then(() => {

                database = client.db(process.env.MONGO_DATABASE);

                console.log('MongoDB conectado correctamente');

                return database;

            })
            .catch((error) => {

                connectionPromise = null;

                throw error;
            });
    }

    return connectionPromise;
}

//Obtener base de datos
function getMongoDB() {

    if (!database) {
        throw new Error('MongoDB no está conectado');
    }

    return database;
}

//Cerrar la conexion
async function closeMongoDB() {

    await client.close();

    database = null;
    connectionPromise = null;

    console.log('Conexión a MongoDB cerrada');
}

module.exports = {
    connectMongoDB,
    getMongoDB,
    closeMongoDB
};
