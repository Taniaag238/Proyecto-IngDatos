// Seed de MongoDB (ventas_eventos)
// Genera eventos coherentes a partir de las ventas REALES de PostgreSQL.
// eventos_ventas (4 por venta) + auditoria (4 por venta) + cambios_inventario (1 por detalle)

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const { MongoClient } = require('mongodb');
const { Client } = require('pg');

const BATCH = Number(process.env.SEED_BATCH || 1000);
const RESET = process.argv.includes('--reset');
const COLECCIONES = ['eventos_ventas', 'auditoria', 'cambios_inventario'];

// Tipos de evento por venta: [tipo, sufijo del id_evento, milisegundos despues de la venta]
const EVENTOS_VENTA = [
    ['VENTA_CREADA', 'creada', 0],
    ['CLIENTE_VALIDADO', 'cliente_validado', 5],
    ['STOCK_VERIFICADO', 'stock_verificado', 10],
    ['VENTA_CONFIRMADA', 'confirmada', 15]
];
const EVENTOS_AUDITORIA = [
    ['VENTA_REGISTRADA', 'registrada', 20],
    ['TOTAL_CALCULADO', 'total_calculado', 25],
    ['INVENTARIO_ACTUALIZADO', 'inventario_actualizado', 30],
    ['TRANSACCION_CONFIRMADA', 'transaccion_confirmada', 35]
];

async function leerVentasDePostgres() {
    const pg = new Client({
        host: process.env.POSTGRES_HOST,
        port: Number(process.env.POSTGRES_PORT || 5432),
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DATABASE
    });
    await pg.connect();
    try {
        const v = await pg.query(
            'SELECT id_venta, id_cliente, id_sucursal, fecha, total FROM ventas ORDER BY id_venta'
        );
        const d = await pg.query(
            'SELECT id_venta, id_sucursal, id_producto, cantidad, precio_unitario FROM detalle_venta ORDER BY id_detalle'
        );
        const detallesPorVenta = new Map();
        for (const fila of d.rows) {
            const clave = `${fila.id_venta}-${fila.id_sucursal}`;
            if (!detallesPorVenta.has(clave)) detallesPorVenta.set(clave, []);
            detallesPorVenta.get(clave).push({
                id_producto: fila.id_producto,
                cantidad: fila.cantidad,
                precio_unitario: Number(fila.precio_unitario)
            });
        }
        return { ventas: v.rows, detallesPorVenta, totalDetalles: d.rows.length };
    } finally {
        await pg.end();
    }
}

async function main() {
    if (!process.env.MONGO_URI || !process.env.MONGO_DATABASE) {
        console.error('Faltan MONGO_URI o MONGO_DATABASE en backend/.env');
        process.exitCode = 1;
        return;
    }

    const client = new MongoClient(process.env.MONGO_URI);

    try {
        await client.connect();
        const db = client.db(process.env.MONGO_DATABASE);
        console.log(`Conectado a MongoDB, base: ${process.env.MONGO_DATABASE}`);

        const col = {};
        for (const nombre of COLECCIONES) col[nombre] = db.collection(nombre);

        // 1) Proteccion contra duplicados
        const existentes = {};
        for (const nombre of COLECCIONES) existentes[nombre] = await col[nombre].countDocuments({});
        const hayDatos = Object.values(existentes).some((n) => n > 0);

        if (hayDatos && !RESET) {
            console.log('Las colecciones ya tienen documentos. No se inserta nada:');
            console.table(existentes);
            console.log('Para repetir desde cero: npm run seed:mongo -- --reset');
            return;
        }
        if (hayDatos && RESET) {
            console.log('--reset: se vaciaran eventos_ventas, auditoria y cambios_inventario');
            for (const nombre of COLECCIONES) await col[nombre].deleteMany({});
        }

        // 2) Leer ventas reales de PostgreSQL
        console.log('Leyendo ventas de PostgreSQL...');
        const { ventas, detallesPorVenta, totalDetalles } = await leerVentasDePostgres();
        if (ventas.length === 0) {
            throw new Error('PostgreSQL no tiene ventas. Ejecuta primero npm run seed:postgres');
        }
        console.log(`  ${ventas.length} ventas y ${totalDetalles} detalles leidos`);

        // 3) Indices unicos sobre id_evento (idempotencia)
        for (const nombre of COLECCIONES) {
            await col[nombre].createIndex({ id_evento: 1 }, { unique: true, name: 'ux_id_evento' });
            await col[nombre].createIndex({ id_venta: 1, id_sucursal: 1 }, { name: 'ix_venta_sucursal' });
        }

        // 4) Generar e insertar por lotes
        console.log(`Insertando documentos (lotes de ${BATCH})...`);
        const buffers = { eventos_ventas: [], auditoria: [], cambios_inventario: [] };
        const insertados = { eventos_ventas: 0, auditoria: 0, cambios_inventario: 0 };

        async function vaciar(nombre, forzar) {
            if (buffers[nombre].length >= BATCH || (forzar && buffers[nombre].length > 0)) {
                await col[nombre].insertMany(buffers[nombre], { ordered: true });
                insertados[nombre] += buffers[nombre].length;
                buffers[nombre] = [];
            }
        }

        for (const venta of ventas) {
            const total = Number(venta.total);
            const lineas = detallesPorVenta.get(`${venta.id_venta}-${venta.id_sucursal}`) || [];
            const base = new Date(venta.fecha).getTime();
            const prefijo = `venta:${venta.id_venta}:${venta.id_sucursal}`;
            const detalleBase = { id_cliente: venta.id_cliente, total, lineas: lineas.length };

            for (const [tipo, sufijo, ms] of EVENTOS_VENTA) {
                buffers.eventos_ventas.push({
                    id_evento: `${prefijo}:${sufijo}`,
                    tipo,
                    id_venta: venta.id_venta,
                    id_sucursal: venta.id_sucursal,
                    fecha: new Date(base + ms),
                    detalle: detalleBase
                });
            }
            for (const [tipo, sufijo, ms] of EVENTOS_AUDITORIA) {
                buffers.auditoria.push({
                    id_evento: `${prefijo}:${sufijo}`,
                    tipo,
                    id_venta: venta.id_venta,
                    id_sucursal: venta.id_sucursal,
                    fecha: new Date(base + ms),
                    detalle: detalleBase
                });
            }
            for (const linea of lineas) {
                buffers.cambios_inventario.push({
                    id_evento: `${prefijo}:inventario:${linea.id_producto}`,
                    tipo: 'INVENTARIO_DESCONTADO',
                    id_venta: venta.id_venta,
                    id_sucursal: venta.id_sucursal,
                    fecha: new Date(base + 40),
                    detalle: {
                        id_producto: linea.id_producto,
                        cantidad: linea.cantidad,
                        precio_unitario: linea.precio_unitario
                    }
                });
            }

            for (const nombre of COLECCIONES) await vaciar(nombre, false);
        }
        for (const nombre of COLECCIONES) await vaciar(nombre, true);

        for (const nombre of COLECCIONES) {
            console.log(`  ${nombre}: ${insertados[nombre]} documentos insertados`);
        }

        // 5) Verificaciones
        console.log('\n=== CONTEOS ===');
        const conteos = {};
        let suma = 0;
        for (const nombre of COLECCIONES) {
            conteos[nombre] = await col[nombre].countDocuments({});
            suma += conteos[nombre];
        }
        conteos.TOTAL_MONGODB = suma;
        console.table(conteos);

        console.log('=== DOCUMENTOS POR TIPO ===');
        const porTipo = [];
        for (const nombre of COLECCIONES) {
            const filas = await col[nombre].aggregate([
                { $group: { _id: '$tipo', total: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]).toArray();
            for (const f of filas) porTipo.push({ coleccion: nombre, tipo: f._id, total: f.total });
        }
        console.table(porTipo);

        console.log('=== INTEGRIDAD CONTRA POSTGRESQL ===');
        const creadas = await col.eventos_ventas.countDocuments({ tipo: 'VENTA_CREADA' });
        const sumaMongo = await col.cambios_inventario.aggregate([
            { $group: { _id: null, cantidad: { $sum: '$detalle.cantidad' } } }
        ]).toArray();
        let sumaPostgres = 0;
        for (const lineas of detallesPorVenta.values()) {
            for (const l of lineas) sumaPostgres += l.cantidad;
        }
        const sinDetalle = await col.eventos_ventas.countDocuments({ detalle: { $exists: false } });
        const indices = {};
        for (const nombre of COLECCIONES) {
            const lista = await col[nombre].indexes();
            indices[nombre] = lista.some((i) => i.name === 'ux_id_evento' && i.unique) ? 'OK' : 'FALTA';
        }

        console.table({
            'ventas en PostgreSQL': ventas.length,
            'eventos VENTA_CREADA en Mongo': creadas,
            'diferencia (debe ser 0)': ventas.length - creadas,
            'detalles en PostgreSQL': totalDetalles,
            'cambios_inventario en Mongo': conteos.cambios_inventario,
            'unidades PostgreSQL vs Mongo (diferencia, debe ser 0)':
                sumaPostgres - (sumaMongo[0] ? sumaMongo[0].cantidad : 0),
            'eventos sin detalle (debe ser 0)': sinDetalle,
            'indice unico eventos_ventas': indices.eventos_ventas,
            'indice unico auditoria': indices.auditoria,
            'indice unico cambios_inventario': indices.cambios_inventario
        });
    } catch (error) {
        console.error('ERROR en el seed de MongoDB:', error.message);
        process.exitCode = 1;
    } finally {
        await client.close();
    }
}

main();