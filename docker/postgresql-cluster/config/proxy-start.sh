#!/bin/sh
set -eu
trap 'exit 0' TERM INT
while :; do
    HAPROXY_SERVER_NAME=$(cat /authority/writer 2>/dev/null || true)
    case "$HAPROXY_SERVER_NAME" in
        pg1) HAPROXY_SERVER_ADDR=$PG_NODE1_HOST HAPROXY_SERVER_PORT=$PG_NODE1_PORT disabled=pg2 ;;
        pg2) HAPROXY_SERVER_ADDR=$PG_NODE2_HOST HAPROXY_SERVER_PORT=$PG_NODE2_PORT disabled=pg1 ;;
        *) sleep 2; continue ;;
    esac
    export HAPROXY_SERVER_NAME HAPROXY_SERVER_ADDR HAPROXY_SERVER_PORT
    if /usr/local/bin/check-primary 2>/dev/null; then break; fi
    sleep 2
done
sed "/^    server $disabled /s/$/ disabled/" /etc/haproxy/haproxy.cfg > /tmp/pg-writer.cfg
unset HAPROXY_SERVER_NAME HAPROXY_SERVER_ADDR HAPROXY_SERVER_PORT
exec haproxy -db -f /tmp/pg-writer.cfg
