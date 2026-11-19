// Seed de MySQL (ventas_catalogo)
// Objetivo: 1,000 categorias + 1,000 proveedores + 22,000 clientes + 22,000 contactos + 8,000 productos = 54,000 filas

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const mysql = require('mysql2/promise');
const { fakerES_MX: faker } = require('@faker-js/faker');

const TOTAL = {
    categorias: 1000,
    proveedores: 1000,
    clientes: 22000,
    productos: 8000
};

const BATCH = Number(process.env.SEED_BATCH || 1000);
const RESET = process.argv.includes('--reset');

const TABLAS = ['categorias', 'proveedores', 'clientes', 'clientes_contacto', 'productos'];

// Inserta filas por lotes para no construir un arreglo gigante en memoria
async function insertarEnLotes(conn, tabla, columnas, total, crearFila) {
    for (let inicio = 1; inicio <= total; inicio += BATCH) {
        const fin = Math.min(inicio + BATCH - 1, total);
        const filas = [];
        for (let id = inicio; id <= fin; id++) {
            filas.push(crearFila(id));
        }
        await conn.query(
            `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES ?`,
            [filas]
        );
    }
    console.log(`  ${tabla}: ${total} filas insertadas`);
}

async function contar(conn, tabla) {
    const [rows] = await conn.query(`SELECT COUNT(*) AS total FROM ${tabla}`);
    return Number(rows[0].total);
}

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    try {
        console.log(`Conectado a MySQL, base: ${process.env.MYSQL_DATABASE}`);

        // 1) Proteccion: no duplicar datos
        const existentes = {};
        for (const t of TABLAS) {
            existentes[t] = await contar(conn, t);
        }
        const hayDatos = Object.values(existentes).some((n) => n > 0);

        if (hayDatos && !RESET) {
            console.log('Las tablas ya tienen datos. No se inserta nada:');
            console.table(existentes);
            console.log('Si quieres repetir la carga desde cero, ejecuta: npm run seed:mysql -- --reset');
            return;
        }

        if (hayDatos && RESET) {
            console.log('--reset: se vaciaran las 5 tablas del catalogo MySQL');
            await conn.query('SET FOREIGN_KEY_CHECKS = 0');
            for (const t of TABLAS) {
                await conn.query(`TRUNCATE TABLE ${t}`);
            }
            await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        }

        // 2) Carga en el orden obligatorio, dentro de una transaccion
        faker.seed(2026);
        console.log(`Cargando datos (lotes de ${BATCH})...`);
        await conn.beginTransaction();

        await insertarEnLotes(conn, 'categorias',
            ['id_categoria', 'nombre', 'descripcion'],
            TOTAL.categorias,
            (id) => [
                id,
                `Categoria ${id} - ${faker.commerce.department()}`,
                faker.commerce.productDescription()
            ]);

        await insertarEnLotes(conn, 'proveedores',
            ['id_proveedor', 'nombre', 'telefono'],
            TOTAL.proveedores,
            (id) => [
                id,
                faker.company.name(),
                faker.string.numeric(10)
            ]);

        await insertarEnLotes(conn, 'clientes',
            ['id_cliente', 'nombre', 'fecha_registro'],
            TOTAL.clientes,
            (id) => [
                id,
                faker.person.fullName(),
                faker.date.between({ from: '2023-01-01T00:00:00Z', to: '2026-11-01T00:00:00Z' })
            ]);

        // un contacto por cliente, con el mismo id_cliente
        await insertarEnLotes(conn, 'clientes_contacto',
            ['id_cliente', 'correo', 'telefono', 'direccion'],
            TOTAL.clientes,
            (id) => [
                id,
                faker.internet.email(),
                faker.string.numeric(10),
                `${faker.location.streetAddress()}, ${faker.location.city()}`
            ]);

        await insertarEnLotes(conn, 'productos',
            ['id_producto', 'nombre', 'precio', 'id_categoria', 'id_proveedor'],
            TOTAL.productos,
            (id) => [
                id,
                faker.commerce.productName(),
                faker.number.float({ min: 10, max: 5000, fractionDigits: 2 }),
                faker.number.int({ min: 1, max: TOTAL.categorias }),
                faker.number.int({ min: 1, max: TOTAL.proveedores })
            ]);

        await conn.commit();
        console.log('Transaccion confirmada (COMMIT)');

        // 3) Verificaciones
        console.log('\n=== CONTEOS ===');
        const conteos = {};
        let suma = 0;
        for (const t of TABLAS) {
            conteos[t] = await contar(conn, t);
            suma += conteos[t];
        }
        conteos.TOTAL_MYSQL = suma;
        console.table(conteos);

        console.log('=== INTEGRIDAD (todos deben ser 0, salvo rangos) ===');
        const consultas = [
            ['contactos sin cliente',
                'SELECT COUNT(*) AS v FROM clientes_contacto cc LEFT JOIN clientes c ON c.id_cliente = cc.id_cliente WHERE c.id_cliente IS NULL'],
            ['clientes sin contacto',
                'SELECT COUNT(*) AS v FROM clientes c LEFT JOIN clientes_contacto cc ON cc.id_cliente = c.id_cliente WHERE cc.id_cliente IS NULL'],
            ['productos sin categoria',
                'SELECT COUNT(*) AS v FROM productos p LEFT JOIN categorias c ON c.id_categoria = p.id_categoria WHERE c.id_categoria IS NULL'],
            ['productos sin proveedor',
                'SELECT COUNT(*) AS v FROM productos p LEFT JOIN proveedores v ON v.id_proveedor = p.id_proveedor WHERE v.id_proveedor IS NULL'],
            ['productos con precio <= 0',
                'SELECT COUNT(*) AS v FROM productos WHERE precio <= 0'],
            ['rango id_cliente (min-max)',
                "SELECT CONCAT(MIN(id_cliente), '-', MAX(id_cliente)) AS v FROM clientes"],
            ['rango id_producto (min-max)',
                "SELECT CONCAT(MIN(id_producto), '-', MAX(id_producto)) AS v FROM productos"]
        ];
        const integridad = {};
        for (const [etiqueta, sql] of consultas) {
            const [rows] = await conn.query(sql);
            integridad[etiqueta] = rows[0].v;
        }
        console.table(integridad);
    } catch (error) {
        try { await conn.rollback(); } catch (e) { /* sin transaccion activa */ }
        console.error('ERROR en el seed de MySQL:', error.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
}

main();