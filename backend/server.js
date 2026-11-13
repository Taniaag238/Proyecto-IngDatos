
require('dotenv').config();

const app = require('./src/app');
const { connectMongoDB } = require('./src/database/mongodb');

const PORT = process.env.PORT || 3000;

async function iniciarServidor() {
    try {
        await connectMongoDB();

        app.listen(PORT, () => {
            console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error('Error al iniciar el servidor:', error.message);
        process.exit(1);
    }
}

iniciarServidor();
