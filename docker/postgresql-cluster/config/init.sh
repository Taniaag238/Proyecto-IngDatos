#!/bin/bash
set -euo pipefail
for cidr in "$PG_CLIENT_CIDR" "$PG_REPLICATION_CIDR" "$PG_REWIND_CIDR"; do
    [[ $cidr =~ ^[0-9A-Fa-f:.]+/[0-9]+$ ]]
done
cat > "$PGDATA/pg_hba.conf" <<EOF
local all pgadmin peer map=labadmin
local all all scram-sha-256
host ventas_operaciones ventas_app,pgcheck $PG_CLIENT_CIDR scram-sha-256
host postgres pgadmin $PG_REWIND_CIDR scram-sha-256
host replication pgrepl $PG_REPLICATION_CIDR scram-sha-256
EOF
printf 'labadmin postgres pgadmin\n' >> "$PGDATA/pg_ident.conf"
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password PG_APP_PASSWORD
\getenv check_password PG_CHECK_PASSWORD
\getenv repl_password PG_REPL_PASSWORD
CREATE ROLE ventas_app LOGIN PASSWORD :'app_password';
CREATE ROLE pgcheck LOGIN PASSWORD :'check_password';
CREATE ROLE pgrepl LOGIN REPLICATION PASSWORD :'repl_password';
REVOKE CONNECT ON DATABASE ventas_operaciones FROM PUBLIC;
GRANT CONNECT ON DATABASE ventas_operaciones TO ventas_app, pgcheck;
ALTER DATABASE ventas_operaciones OWNER TO ventas_app;
SET ROLE ventas_app;
\i /schema.sql
SQL
