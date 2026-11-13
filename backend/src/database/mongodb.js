
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

let database;

async function connectMongoDB() {
    if (!database) {
        await client.connect();

        database = client.db(process.env.MONGO_DATABASE);

        console.log('MongoDB conectado correctamente');
    }

    return database;
}

function getMongoDB() {
    if (!database) {
        throw new Error('MongoDB no está conectado');
    }

    return database;
}

async function closeMongoDB() {
    await client.close();
    database = null;
}

module.exports = {
    connectMongoDB,
    getMongoDB,
    closeMongoDB
};
