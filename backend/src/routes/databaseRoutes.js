
const express = require('express');
const router = express.Router();

const mysql = require('../database/mysql');
const postgres = require('../database/postgresql');
const { MongoClient } = require('mongodb');

// Verificar conexión a MySQL
router.get('/mysql', async (req, res) => {
    try {
        await mysql.query('SELECT 1');

        res.json({
            database: 'MySQL',
            status: 'conectado'
        });
    } catch (error) {
        res.status(500).json({
            database: 'MySQL',
            status: 'error',
            message: error.message
        });
    }
});

// Verificar conexión a PostgreSQL
router.get('/postgresql', async (req, res) => {
    try {
        await postgres.query('SELECT 1');

        res.json({
            database: 'PostgreSQL',
            status: 'conectado'
        });
    } catch (error) {
        res.status(500).json({
            database: 'PostgreSQL',
            status: 'error',
            message: error.message
        });
    }
});

// Verificar conexión a MongoDB
router.get('/mongodb', async (req, res) => {
    const client = new MongoClient(process.env.MONGO_URI);

    try {
        await client.connect();
        await client.db('admin').command({ ping: 1 });

        res.json({
            database: 'MongoDB',
            status: 'conectado'
        });
    } catch (error) {
        res.status(500).json({
            database: 'MongoDB',
            status: 'error',
            message: error.message
        });
    } finally {
        await client.close();
    }
});

module.exports = router;
