#!/bin/sh
set -eu
authorized=$(cat /authority/writer 2>/dev/null)
[ "$authorized" = "$HAPROXY_SERVER_NAME" ]
export PGPASSWORD="$PG_CHECK_PASSWORD" PGCONNECT_TIMEOUT=2 PGOPTIONS="-c statement_timeout=1500"
[ "$(psql -XAtw -h "$HAPROXY_SERVER_ADDR" -p "$HAPROXY_SERVER_PORT" -U pgcheck -d ventas_operaciones \
    -c "SELECT NOT pg_is_in_recovery() AND NOT current_setting('transaction_read_only')::boolean")" = t ]
