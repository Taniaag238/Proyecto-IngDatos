
const express = require('express');
const router = express.Router();

const mysql = require('../database/mysql');
const postgres = require('../database/postgresql');
const { getMongoDB } = require('../database/mongodb');

// VERIFICAR MYSQL
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

// VERIFICAR POSTGRESQL
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

// VERIFICAR MONGODB
router.get('/mongodb', async (req, res) => {
    try {
        const database = getMongoDB();

        await database.command({ ping: 1 });

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
    }
});

module.exports = router;
