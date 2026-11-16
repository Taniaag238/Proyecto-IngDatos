// Seed de PostgreSQL (ventas_operaciones)
// 5 sucursales + 40,000 inventarios + ventas historicas + detalles + movimientos
// Requiere que MySQL ya tenga los 8,000 productos (lee sus precios reales).

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const { Client } = require('pg');
const mysql = require('mysql2/promise');
const { fakerES_MX: faker } = require('@faker-js/faker');

const SUCURSALES = 5;
const PRODUCTOS = 8000;
const CLIENTES = 22000;
const VENTAS = Number(process.env.SEED_VENTAS || 5000);
const BATCH = Number(process.env.SEED_BATCH || 1000);
const RESET = process.argv.includes('--reset');

const TABLAS = ['sucursales', 'inventario', 'ventas', 'detalle_venta', 'movimientos_inventario'];

const NOMBRES_SUCURSAL = [
    ['Sucursal Centro', 'Aguascalientes, Ags.'],
    ['Sucursal Norte', 'Aguascalientes, Ags.'],
    ['Sucursal Sur', 'Aguascalientes, Ags.'],
    ['Sucursal Oriente', 'Jesus Maria, Ags.'],
    ['Sucursal Poniente', 'San Francisco de los Romo, Ags.']
];

// Precios reales (en centavos) desde MySQL
async function cargarPrecios() {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    try {
        const [rows] = await conn.query('SELECT id_producto, precio FROM productos ORDER BY id_producto');
        if (rows.length !== PRODUCTOS || rows[0].id_producto !== 1 || rows[rows.length - 1].id_producto !== PRODUCTOS) {
            throw new Error(`MySQL debe tener productos 1..${PRODUCTOS}. Encontrados: ${rows.length}. Ejecuta primero npm run seed:mysql`);
        }
        const precios = new Array(PRODUCTOS + 1);
        for (const r of rows) {
            precios[r.id_producto] = Math.round(Number(r.precio) * 100);
        }
        return precios;
    } finally {
        await conn.end();
    }
}

// Inserta filas por lotes con parametros ($1, $2, ...)
async function insertarEnLotes(client, tabla, columnas, filas) {
    for (let i = 0; i < filas.length; i += BATCH) {
        const lote = filas.slice(i, i + BATCH);
        const params = [];
        const grupos = lote.map((fila, f) => {
            const marcadores = fila.map((valor, c) => {
                params.push(valor);
                return `$${f * columnas.length + c + 1}`;
            });
            return `(${marcadores.join(', ')})`;
        });
        await client.query(
            `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES ${grupos.join(', ')}`,
            params
        );
    }
    console.log(`  ${tabla}: ${filas.length} filas insertadas`);
}

async function contar(client, tabla) {
    const r = await client.query(`SELECT COUNT(*)::int AS total FROM ${tabla}`);
    return r.rows[0].total;
}

async function main() {
    const client = new Client({
        host: process.env.POSTGRES_HOST,
        port: Number(process.env.POSTGRES_PORT || 5432),
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DATABASE
    });

    try {
        await client.connect();
        console.log(`Conectado a PostgreSQL, base: ${process.env.POSTGRES_DATABASE}`);

        // 1) Proteccion contra duplicados
        const existentes = {};
        for (const t of TABLAS) existentes[t] = await contar(client, t);
        const hayDatos = Object.values(existentes).some((n) => n > 0);

        if (hayDatos && !RESET) {
            console.log('Las tablas ya tienen datos. No se inserta nada:');
            console.table(existentes);
            console.log('Para repetir desde cero: npm run seed:postgres -- --reset');
            return;
        }
        if (hayDatos && RESET) {
            console.log('--reset: se vaciaran sucursales, inventario, ventas, detalle, movimientos y eventos_pendientes');
            await client.query(
                'TRUNCATE detalle_venta, ventas, movimientos_inventario, inventario, sucursales, eventos_pendientes RESTART IDENTITY'
            );
        }

        // 2) Precios reales desde MySQL
        console.log('Leyendo precios de MySQL...');
        const precios = await cargarPrecios();

        // 3) Generar todo en memoria (el stock se descuenta antes de guardar el inventario)
        faker.seed(2026);
        const idx = (s, p) => (s - 1) * PRODUCTOS + (p - 1);
        const stock = new Int32Array(SUCURSALES * PRODUCTOS);
        for (let i = 0; i < stock.length; i++) {
            stock[i] = faker.number.int({ min: 100, max: 300 });
        }

        const ventas = [];
        const detalles = [];
        const movimientos = [];
        let idDetalle = 0;
        let idMov = 0;
        const desde = new Date('2025-01-01T00:00:00Z');
        const hasta = new Date('2026-11-01T00:00:00Z');

        for (let idVenta = 1; idVenta <= VENTAS; idVenta++) {
            const idSuc = faker.number.int({ min: 1, max: SUCURSALES });
            const idCli = faker.number.int({ min: 1, max: CLIENTES });
            const fecha = faker.date.between({ from: desde, to: hasta });
            const cuantos = faker.number.int({ min: 1, max: 4 });

            const items = [];
            const usados = new Set();
            let intentos = 0;
            while (items.length < cuantos && intentos < 30) {
                intentos++;
                const p = faker.number.int({ min: 1, max: PRODUCTOS });
                if (usados.has(p)) continue;
                const disponible = stock[idx(idSuc, p)];
                if (disponible <= 0) continue;
                const cant = Math.min(faker.number.int({ min: 1, max: 5 }), disponible);
                usados.add(p);
                stock[idx(idSuc, p)] -= cant;
                items.push({ p, cant });
            }
            if (items.length === 0) { idVenta--; continue; }

            let totalCentavos = 0;
            for (const it of items) {
                const precio = precios[it.p];
                totalCentavos += precio * it.cant;
                detalles.push([++idDetalle, idVenta, idSuc, it.p, it.cant, (precio / 100).toFixed(2)]);
                movimientos.push([++idMov, it.p, idSuc, 'VENTA', it.cant, fecha]);
            }
            ventas.push([idVenta, idCli, idSuc, fecha, (totalCentavos / 100).toFixed(2), 'completada']);
        }

        const inventario = [];
        let idInv = 0;
        for (let s = 1; s <= SUCURSALES; s++) {
            for (let p = 1; p <= PRODUCTOS; p++) {
                inventario.push([++idInv, s, p, stock[idx(s, p)]]);
            }
        }

        // 4) Insertar en el orden obligatorio, en una sola transaccion
        console.log(`Insertando datos (lotes de ${BATCH})...`);
        await client.query('BEGIN');

        await insertarEnLotes(client, 'sucursales',
            ['id_sucursal', 'nombre', 'ubicacion'],
            NOMBRES_SUCURSAL.map((s, i) => [i + 1, s[0], s[1]]));
        await insertarEnLotes(client, 'inventario',
            ['id_inventario', 'id_sucursal', 'id_producto', 'existencia'], inventario);
        await insertarEnLotes(client, 'ventas',
            ['id_venta', 'id_cliente', 'id_sucursal', 'fecha', 'total', 'estado'], ventas);
        await insertarEnLotes(client, 'detalle_venta',
            ['id_detalle', 'id_venta', 'id_sucursal', 'id_producto', 'cantidad', 'precio_unitario'], detalles);
        await insertarEnLotes(client, 'movimientos_inventario',
            ['id_movimiento', 'id_producto', 'id_sucursal', 'tipo', 'cantidad', 'fecha'], movimientos);

        // Como se usaron IDs explicitos, ajustar las secuencias SERIAL
        const secuencias = [
            ['sucursales', 'id_sucursal'],
            ['inventario', 'id_inventario'],
            ['ventas', 'id_venta'],
            ['detalle_venta', 'id_detalle'],
            ['movimientos_inventario', 'id_movimiento']
        ];
        for (const [tabla, col] of secuencias) {
            await client.query(
                `SELECT setval(pg_get_serial_sequence('${tabla}', '${col}'), (SELECT MAX(${col}) FROM ${tabla}))`
            );
        }

        await client.query('COMMIT');
        console.log('Transaccion confirmada (COMMIT)');

        // 5) Verificaciones
        console.log('\n=== CONTEOS ===');
        const conteos = {};
        let suma = 0;
        for (const t of TABLAS) {
            conteos[t] = await contar(client, t);
            suma += conteos[t];
        }
        conteos.TOTAL_POSTGRESQL = suma;
        console.table(conteos);

        console.log('=== VENTAS POR PARTICION ===');
        const part = await client.query(
            'SELECT tableoid::regclass::text AS particion, COUNT(*)::int AS ventas FROM ventas GROUP BY 1 ORDER BY 1'
        );
        console.table(part.rows);

        console.log('=== INTEGRIDAD (los 0 deben ser 0) ===');
        const consultas = [
            ['ventas con total distinto al detalle',
                `SELECT COUNT(*)::text AS v FROM ventas v JOIN (
                    SELECT id_venta, id_sucursal, SUM(cantidad * precio_unitario) AS t
                    FROM detalle_venta GROUP BY 1, 2) d
                 USING (id_venta, id_sucursal) WHERE v.total <> d.t`],
            ['ventas sin detalle',
                `SELECT COUNT(*)::text AS v FROM ventas v LEFT JOIN detalle_venta d
                 ON d.id_venta = v.id_venta AND d.id_sucursal = v.id_sucursal WHERE d.id_detalle IS NULL`],
            ['inventario con existencia negativa',
                'SELECT COUNT(*)::text AS v FROM inventario WHERE existencia < 0'],
            ['combinaciones unicas sucursal-producto (40000)',
                'SELECT COUNT(DISTINCT (id_sucursal, id_producto))::text AS v FROM inventario'],
            ['diferencia movimientos VENTA vs detalle',
                `SELECT ((SELECT COALESCE(SUM(cantidad),0) FROM movimientos_inventario WHERE tipo = 'VENTA')
                       - (SELECT COALESCE(SUM(cantidad),0) FROM detalle_venta))::text AS v`],
            ['detalles con producto fuera de 1-8000',
                `SELECT COUNT(*)::text AS v FROM detalle_venta WHERE id_producto NOT BETWEEN 1 AND ${PRODUCTOS}`],
            ['ventas con cliente fuera de 1-22000',
                `SELECT COUNT(*)::text AS v FROM ventas WHERE id_cliente NOT BETWEEN 1 AND ${CLIENTES}`],
            ['ultimo valor de la secuencia de ventas',
                "SELECT last_value::text AS v FROM pg_sequences WHERE sequencename = 'ventas_id_venta_seq'"]
        ];
        const integridad = {};
        for (const [etiqueta, sql] of consultas) {
            const r = await client.query(sql);
            integridad[etiqueta] = r.rows[0] ? r.rows[0].v : 'n/d';
        }
        console.table(integridad);
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (e) { /* sin transaccion */ }
        console.error('ERROR en el seed de PostgreSQL:', error.message);
        process.exitCode = 1;
    } finally {
        await client.end();
    }
}

main();