require('dotenv').config();

const app = require('./src/app');
const { connectMongoDB } = require('./src/database/mongodb');
const {
    iniciarOutboxWorker,
    detenerOutboxWorker
} = require('./src/workers/outboxWorker');

const PORT = process.env.PORT || 3000;

async function iniciarServidor() {

    //Iniciar el servidor http
    const servidor = app.listen(PORT, () => {
        console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
    });

    //Intentar conectar con MongoDb sin tener API
    try {

        await connectMongoDB();

        console.log('Conexión a MongoDB establecida.');

    } catch (error) {

        console.error(
            'MongoDB no está disponible:',
            error.message
        );

        console.log(
            'Los eventos permanecerán pendientes hasta recuperar la conexión.'
        );
    }

    //Iniciar el procesamineto de eventos
    iniciarOutboxWorker();

    //Cierre del servidor
    process.on('SIGINT', () => {
        console.log('Cerrando servidor...');

        detenerOutboxWorker();
        servidor.close(() => process.exit(0));
    });

    process.on('SIGTERM', () => {
        detenerOutboxWorker();
        servidor.close(() => process.exit(0));
    });
}

iniciarServidor();
