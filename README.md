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

## Laboratorio local de replicación de PostgreSQL 17

Desde PowerShell y Docker Desktop en modo Linux, copia `docker/postgresql-cluster/.env.example` a `docker/postgresql-cluster/.env.local`. Asigna contraseñas distintas a `PG_ADMIN_PASSWORD`, `PG_APP_PASSWORD`, `PG_REPL_PASSWORD` y `PG_CHECK_PASSWORD`. Usa de 12 a 128 caracteres del conjunto `A–Z a–z 0–9 _ ! @ % + = . , -`. Para ejecutar otro laboratorio, asigna un nombre de proyecto, puertos, subred y directorio `PG_STATE_DIR` exclusivos.

```powershell
$pgEnv = 'docker/postgresql-cluster/.env.local'
$pgProject = 'ventas-pg-repl-local'
$pgArgs = @{ EnvFile = $pgEnv; Project = $pgProject }
& docker/postgresql-cluster/cluster.ps1 @pgArgs -Action Initialize
& docker/postgresql-cluster/cluster.ps1 @pgArgs -Action Verify
```

`Initialize` aplica el esquema existente al primario vacío, crea el secundario con `pg_basebackup -R` y levanta HAProxy. Para cargar el catálogo histórico usa `npm.cmd run seed:postgres` desde `backend/` con un primario vacío. Ajusta en el entorno de ese proceso `POSTGRES_HOST=127.0.0.1`, `POSTGRES_PORT` al valor de `PG_WRITER_PORT`, `POSTGRES_USER=ventas_app`, `POSTGRES_PASSWORD` al valor de `PG_APP_PASSWORD` y `POSTGRES_DATABASE=ventas_operaciones`. Configura también `MYSQL_*` para consultar el catálogo de 8 000 productos. Omite `--reset`. La misma configuración PostgreSQL conecta la API a HAProxy.

Antes de promover, pausa las escrituras para una conmutación planificada y usa `Verify` para esperar el LSN del primario en el secundario. Una caída imprevista puede perder commits aún ausentes del WAL recibido por el secundario. HAProxy comprueba por SQL `pg_is_in_recovery()` y `transaction_read_only` además de la autorización.

**La replicación es asíncrona, la promoción es manual y HAProxy es un punto único de fallo.** Si HAProxy cae, el backend pierde su endpoint aunque el primario siga operativo. El pool registra los fallos de conexiones ociosas. Los errores de consultas y transacciones activas se devuelven al llamador, que decide cómo recuperarse.

```powershell
& docker/postgresql-cluster/cluster.ps1 @pgArgs -Action Promote -Target pg2
& docker/postgresql-cluster/cluster.ps1 @pgArgs -Action Rewind
& docker/postgresql-cluster/cluster.ps1 @pgArgs -Action Verify
& docker/postgresql-cluster/cluster.ps1 @pgArgs -Action Stop
& docker/postgresql-cluster/cluster.ps1 @pgArgs -Action Start
```

`Promote` detiene HAProxy y el escritor anterior, verifica que ese contenedor esté detenido, revoca su autorización, promueve al candidato y reabre el acceso por el mismo puerto. Si se interrumpe después de revocar la autorización, conserva el estado cerrado, comprueba los dos roles y aísla el antiguo primario antes de intervenir. El archivo `writer` puede autorizar solo al nodo que se haya comprobado como primario después de resolver el incidente. Conserva el directorio de autoridad junto con los volúmenes.

`Rewind` reincorpora el antiguo escritor. Si falla por falta de WAL, conserva el volumen y el directorio de autoridad. Mantén el primario actual operativo. En el mismo archivo de entorno, asigna un nombre de volumen nuevo al nodo que será secundario, mediante `PG1_VOLUME` o `PG2_VOLUME`. El nombre debe empezar por el proyecto y un guion bajo. Por ejemplo, usa `PG1_VOLUME=ventas-pg-repl-local_pg1_replacement` si `pg2` es el primario. Ejecuta los comandos con ese archivo de entorno, también en arranques posteriores.

```powershell
& docker/postgresql-cluster/cluster.ps1 @pgArgs -Action Clone
& docker/postgresql-cluster/cluster.ps1 @pgArgs -Action Verify
```

La copia base exige un volumen vacío. Un segundo `Clone` con el mismo volumen de destino es rechazado. `Stop` da hasta 120 s para el cierre y `Start` verifica la réplica y el endpoint. Los resultados de la recuperación y el reinicio están en la [bitácora](docs/bitacora.md).

El laboratorio usa SCRAM-SHA-256, checksums de datos y `wal_log_hints`. Mantiene WAL reciente con `PG_WAL_KEEP_MB`, configura `max_wal_size=512MB` como objetivo de checkpoint y prescinde de slots persistentes. Si se recicla WAL requerido por un nodo ausente, habrá que volver a clonarlo.

Los identificadores lógicos `pg1` y `pg2` representan inicialmente PC2 y PC3. `PG_NODE1_HOST`, `PG_NODE2_HOST` y sus puertos permiten usar DNS o IPv4 accesibles entre equipos. Los tres CIDR se aplican al inicializar `pg_hba.conf`. En un volumen existente, cambiar las reglas requiere actualizar y recargar ese archivo. Si cambia la dirección del primario para una réplica existente, actualiza también su `primary_conninfo` y su archivo de contraseña. El script PowerShell opera en un solo motor Docker. La promoción física requerirá adaptar el aislamiento del escritor y la distribución de la autorización entre equipos.

## Estado actual

El backend registra ventas e inventario en PostgreSQL, usa el catálogo de MySQL y publica eventos en MongoDB mediante Outbox. El repositorio incluye seeds, un simulador y laboratorios locales de MySQL con ProxySQL y PostgreSQL con HAProxy. El despliegue en tres computadoras, el sharding de MongoDB y el monitoreo centralizado siguen pendientes.

## Integrantes

- Tania Paola Garcia Meza
- Lorenzo Antonio Pacheco Leyva
- Maria Fernanda Resendiz Mejia
- Miguel de Jesus Zavala Romo
