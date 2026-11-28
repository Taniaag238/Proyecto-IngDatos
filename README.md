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

## Clúster local de MySQL y ProxySQL en Windows

Usa PowerShell, Docker Desktop en modo de contenedores Linux y las dependencias del backend instaladas con `npm.cmd ci` en `backend/`. Ejecuta los siguientes comandos desde la raíz del repositorio.

### Instalación desde cero

1. Copia `docker/.env.example` a un archivo local, por ejemplo `docker/local-cluster/.env.local`. Genera un valor para `MYSQL_GROUP_UUID` con `[guid]::NewGuid()`. Configura `MYSQL_ROOT_PASSWORD`, `MYSQL_REPL_PASSWORD`, `MYSQL_PASSWORD` (para `ventas_app`), `MYSQL_MONITOR_PASSWORD` y `PROXYSQL_ADMIN_PASSWORD`. Para instalaciones nuevas, usa contraseñas distintas de 12 a 128 caracteres del conjunto `A–Z a–z 0–9 _ ! @ % + = . , -`. Conserva el archivo local para los reinicios.
2. Para ejecutar otro clúster simultáneamente, usa un archivo de entorno, un nombre de proyecto y un UUID distintos. Cambia también los cuatro nombres de contenedor y los cinco puertos publicados en ese archivo. Los puertos siguen enlazados a `127.0.0.1`. Compose crea una red y volúmenes por proyecto. Las variables exportadas en la sesión de PowerShell tienen precedencia sobre el archivo de entorno.
3. Levanta Compose, inicializa y carga los datos.

```powershell
$clusterEnv = 'docker/local-cluster/.env.local'
$clusterProject = 'ventas-mysql-cluster-local'
docker --context desktop-linux compose --project-name $clusterProject --env-file $clusterEnv -f docker/local-cluster/docker-compose.yml up -d
& docker/local-cluster/cluster.ps1 -Action Initialize -EnvFile $clusterEnv -Project $clusterProject
& docker/local-cluster/cluster.ps1 -Action Seed -EnvFile $clusterEnv -Project $clusterProject
& docker/local-cluster/cluster.ps1 -Action Verify -EnvFile $clusterEnv -Project $clusterProject
```

`Initialize` prepara el usuario y canal de recuperación en cada nodo, arranca un solo fundador si los tres volúmenes MySQL carecen de GTID ejecutados y certificados, incorpora los secundarios, aplica el esquema y configura las cuentas y ProxySQL. Puede repetirse con los tres miembros en línea y las mismas credenciales. La configuración administrativa de ProxySQL se aplica al entorno de ejecución y se guarda en su volumen. Durante la primera instalación, el script usa la cuenta de arranque para establecer la contraseña administrativa desde dentro del contenedor. Para administrar ese proxy, ejecuta el cliente dentro de su contenedor.

El Compose local omite la importación de tablas de zonas horarias que realiza la imagen de MySQL al crear un volumen. El catálogo no usa esas tablas y la importación asignaría GTID independientes a los nodos antes de formar el grupo.

`Seed` ejecuta el seed existente a través del puerto de aplicación de ProxySQL solo si las cinco tablas están vacías. Con los 54 000 registros esperados, la acción verifica los datos y finaliza. Si encuentra una carga parcial, se detiene para que se revise el contenido. `Verify` comprueba las vistas del grupo, el escritor de ProxySQL, el acceso de `ventas_app`, los GTID y los conteos y checksums de las cinco tablas. Ejecuta la verificación con las escrituras del catálogo en pausa.

Para usar el clúster desde la API, configura `MYSQL_HOST=127.0.0.1`, `MYSQL_PORT` con el valor de `PROXYSQL_PORT` (6033 por defecto), `MYSQL_USER=ventas_app`, `MYSQL_DATABASE=ventas_catalogo` y la misma `MYSQL_PASSWORD` en el entorno del backend. Mantén la configuración correspondiente a tus instancias de PostgreSQL y MongoDB.

### Reinicio y recuperación

Para apagar el proyecto de forma controlada, usa `stop` con el mismo nombre de proyecto y archivo de entorno. Compose configura 120 s de espera para MySQL. El comando de apagado indica también ese límite de forma explícita. Para levantar el proyecto, usa `start` y ejecuta `Recover`.

```powershell
$composeArgs = @('--context', 'desktop-linux', 'compose', '--project-name', $clusterProject,
    '--env-file', $clusterEnv, '-f', 'docker/local-cluster/docker-compose.yml')
docker @composeArgs stop --timeout 120
docker @composeArgs start
& docker/local-cluster/cluster.ps1 -Action Recover -EnvFile $clusterEnv -Project $clusterProject
& docker/local-cluster/cluster.ps1 -Action Verify -EnvFile $clusterEnv -Project $clusterProject
```

Con dos miembros `ONLINE`, `Recover` reincorpora el tercero iniciado. Si los tres están `OFFLINE`, compara los GTID ejecutados y los recibidos en el canal de aplicación. Solo arranca un fundador si su conjunto combinado incluye los de todos los nodos y espera a que acepte escrituras antes de incorporar los secundarios. Si un arranque anterior dejó un solo miembro `ONLINE`, la recuperación continúa cuando ese nodo se ve a sí mismo como único integrante del grupo y es un primario habilitado para escritura. Si falta un contenedor o el grupo no cumple esas condiciones, revisa el estado antes de reintentar. Para un nodo que ya recibió tráfico, conserva el mismo volumen. Consulta la bitácora para ver el resultado de las pruebas de conmutación.

## Estado actual

El backend registra ventas e inventario en PostgreSQL, usa el catálogo de MySQL y publica eventos en MongoDB mediante Outbox. El repositorio incluye seeds, un simulador y un clúster local de MySQL con ProxySQL. El despliegue en tres computadoras, la replicación de PostgreSQL, el sharding de MongoDB y el monitoreo centralizado siguen pendientes.

## Integrantes

- Tania Paola Garcia Meza
- Lorenzo Antonio Pacheco Leyva
- Maria Fernanda Resendiz Mejia
- Miguel de Jesus Zavala Romo
