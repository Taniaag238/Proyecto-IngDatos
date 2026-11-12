
-- Sistema de Ventas e Inventarios
-- Base de datos: MySQL

CREATE DATABASE IF NOT EXISTS ventas_catalogo;

USE ventas_catalogo;

-- Categorías de productos
CREATE TABLE IF NOT EXISTS categorias (
    id_categoria INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT
);

-- Proveedores
CREATE TABLE IF NOT EXISTS proveedores (
    id_proveedor INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    telefono VARCHAR(20)
);

-- Clientes
CREATE TABLE IF NOT EXISTS clientes (
    id_cliente INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Información de contacto de clientes
CREATE TABLE IF NOT EXISTS clientes_contacto (
    id_cliente INT PRIMARY KEY,
    correo VARCHAR(150),
    telefono VARCHAR(20),
    direccion VARCHAR(255),

    FOREIGN KEY (id_cliente)
        REFERENCES clientes(id_cliente)
);

-- Productos
CREATE TABLE IF NOT EXISTS productos (
    id_producto INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    precio DECIMAL(10,2) NOT NULL,

    id_categoria INT NOT NULL,
    id_proveedor INT NOT NULL,

    FOREIGN KEY (id_categoria)
        REFERENCES categorias(id_categoria),

    FOREIGN KEY (id_proveedor)
        REFERENCES proveedores(id_proveedor)
);
