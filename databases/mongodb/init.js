
// Sistema de Ventas e Inventarios
// Inicialización de MongoDB

const database = db.getSiblingDB('ventas_eventos');

const colecciones = [
    'eventos_ventas',
    'auditoria',
    'cambios_inventario',
    'simulaciones',
    'errores_sistema'
];

colecciones.forEach((nombre) => {
    if (!database.getCollectionNames().includes(nombre)) {
        database.createCollection(nombre);
        print(`Colección creada: ${nombre}`);
    } else {
        print(`Colección existente: ${nombre}`);
    }
});

print('Inicialización de MongoDB finalizada');
