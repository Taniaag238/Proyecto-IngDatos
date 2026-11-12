const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGO_URI);

let database;

async function connectMongoDB() {
    await client.connect();

    database = client.db(process.env.MONGO_DATABASE);

    console.log('MongoDB conectado correctamente');
}

function getMongoDB() {
    if (!database) {
        throw new Error('MongoDB no está conectado');
    }

    return database;
}

module.exports = {
    connectMongoDB,
    getMongoDB
};