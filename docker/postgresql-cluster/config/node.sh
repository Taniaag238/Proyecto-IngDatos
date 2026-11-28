#!/bin/bash
set -euo pipefail
authorized=$(cat /authority/writer 2>/dev/null || true)
case "${1:?action required}" in
start)
    if [[ ! -f "$PGDATA/standby.signal" && $authorized != "$PG_NODE" ]]; then
        echo "This data directory cannot start as an unauthorized writer." >&2
        exit 1
    fi
    if [[ ! -s "$PGDATA/PG_VERSION" && $PG_NODE != pg1 ]]; then
        echo 'Initialize the standby with a base backup first.' >&2
        exit 1
    fi
    if [[ $PG_NODE == pg1 ]]; then port=$PG_NODE1_PORT; else port=$PG_NODE2_PORT; fi
    exec docker-entrypoint.sh postgres -p "$port" -c listen_addresses='*' \
        -c password_encryption=scram-sha-256 -c wal_level=replica -c max_wal_senders=5 \
        -c "wal_keep_size=${PG_WAL_KEEP_MB}MB" -c max_wal_size=512MB \
        -c max_slot_wal_keep_size=256MB -c hot_standby=on -c wal_log_hints=on \
        -c shared_buffers=64MB -c max_connections=40
    ;;
inspect)
    if [[ -s "$PGDATA/PG_VERSION" ]]; then
        if [[ -e "$PGDATA/standby.signal" ]]; then echo standby; else echo existing; fi
    elif [[ -d "$PGDATA" && -n $(ls -A "$PGDATA") ]]; then echo partial
    else echo empty; fi
    ;;
basebackup|rewind)
    [[ $authorized == pg1 || $authorized == pg2 ]]
    [[ $authorized != "$PG_NODE" ]]
    if [[ $authorized == pg1 ]]; then host=$PG_NODE1_HOST port=$PG_NODE1_PORT
    else host=$PG_NODE2_HOST port=$PG_NODE2_PORT; fi
    [[ $host =~ ^[a-zA-Z0-9._-]+$ && $port =~ ^[0-9]+$ ]]
    install -d -o postgres -g postgres -m 0700 "$PGDATA"
    install -d -o postgres -g postgres -m 0700 /run/pg-lab
    passfile=/run/pg-lab/pgpass
    printf '%s:%s:*:pgrepl:%s\n' "$host" "$port" "$PG_REPL_PASSWORD" > "$passfile"
    chmod 0600 "$passfile"
    chown postgres:postgres "$passfile"
    if [[ $1 == basebackup ]]; then
        [[ -z $(ls -A "$PGDATA") ]] || { echo 'Base backup requires a new empty volume.' >&2; exit 1; }
        PGPASSFILE="$passfile" gosu postgres pg_basebackup -D "$PGDATA" -h "$host" -p "$port" -U pgrepl -X stream -R -w -P
    else
        [[ -s "$PGDATA/PG_VERSION" && ! -e "$PGDATA/standby.signal" ]]
        PGPASSWORD="$POSTGRES_PASSWORD" gosu postgres pg_rewind -D "$PGDATA" \
            --source-server="host=$host port=$port dbname=postgres user=pgadmin connect_timeout=5"
    fi
    sed -i '/^[[:space:]]*primary_conninfo[[:space:]]*=/d' "$PGDATA/postgresql.auto.conf"
    umask 077
    printf '%s:%s:*:pgrepl:%s\n' "$host" "$port" "$PG_REPL_PASSWORD" > "$PGDATA/.replication-pass"
    printf "primary_conninfo = 'host=%s port=%s user=pgrepl application_name=%s passfile=%s/.replication-pass connect_timeout=3'\n" \
        "$host" "$port" "$PG_NODE" "$PGDATA" >> "$PGDATA/postgresql.auto.conf"
    touch "$PGDATA/standby.signal"
    chown postgres:postgres "$PGDATA/.replication-pass" "$PGDATA/standby.signal" "$PGDATA/postgresql.auto.conf"
    ;;
*) exit 2 ;;
esac
