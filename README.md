# Sistema de Ventas e Inventarios

Proyecto final de la materia de Ingeniería de Datos 1.

## Descripción

Aplicación web para administrar productos, clientes, sucursales, inventarios y ventas, utilizando una arquitectura distribuida con tres gestores de bases de datos.

El proyecto contempla fragmentación, replicación, simulación de transacciones y monitoreo de servicios.

## Tecnologías

- **Backend:** Node.js y Express.
- **Frontend:** HTML, CSS y JavaScript.
- **Bases de datos:** MySQL, PostgreSQL y MongoDB.
- **Contenedores:** Docker y Docker Compose.
- **Monitoreo:** Prometheus y Grafana.
- **Control de versiones:** Git y GitHub.

## Estructura del proyecto

- `backend/`: API REST y conexiones a las bases de datos.
- `databases/`: scripts de inicialización.
- `docker/`: configuración de contenedores.
- `frontend/`: interfaz web.
- `simulator/`: simulador de transacciones.
- `monitoring/`: configuración de monitoreo.
- `docs/`: documentación técnica.

## Configuración inicial

**Requisitos:**
- Node.js y npm.
- Docker Desktop con Docker Compose.
- Git.

**Instalación:**

1. Clonar el repositorio.
2. Crear `docker/.env` a partir de `docker/.env.example` y configurar las contraseñas.
3. Crear `backend/.env` a partir de `backend/.env.example`, utilizando las mismas contraseñas.
4. Levantar las bases de datos:

   `docker compose -f docker/docker-compose.yml up -d`

5. Instalar las dependencias del backend:

   `cd backend`

   `npm install`

6. Ejecutar el servidor:

   `npm run dev`

El backend estará disponible en `http://localhost:3000`.

## Estado actual

La estructura inicial incluye el servidor Express, conexiones a los tres gestores, contenedores Docker y scripts de creación de tablas y colecciones.

**Pendiente:** funcionalidades de ventas e inventarios, generación masiva de registros, fragmentación distribuida, replicación, sharding, simulación de transacciones y monitoreo.

## Integrantes

- Tania Paola Garcia Meza
- Lorenzo Antonio Pacheco Leyva
- Maria Fernanda Resendiz Mejia
- Miguel de Jesus Zavala Romo
