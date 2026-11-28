const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE
});

pool.on('error', (error) => {
    console.error('[PostgreSQL] Idle connection closed:', error.message);
});

module.exports = pool;
