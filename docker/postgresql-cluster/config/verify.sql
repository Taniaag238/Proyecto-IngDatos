BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SELECT relid::regclass, parentrelid::regclass, isleaf, level FROM pg_partition_tree('ventas');
SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN ('sucursales'::regclass,'inventario'::regclass,'ventas'::regclass,
                   'detalle_venta'::regclass,'movimientos_inventario'::regclass,'eventos_pendientes'::regclass)
ORDER BY conrelid::regclass::text, conname;
SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname;
SELECT format('SELECT ''sequence'', %L, coalesce(pg_sequence_last_value(pg_get_serial_sequence(%L,%L)::regclass), 1) >= coalesce(max(%I),0) FROM %I',
              tab, tab, col, col, tab)
FROM (VALUES ('detalle_venta','id_detalle'), ('inventario','id_inventario'),
             ('movimientos_inventario','id_movimiento'), ('sucursales','id_sucursal'), ('ventas','id_venta')) AS s(tab,col)
ORDER BY tab
\gexec
SELECT format('SELECT %L, count(*), md5(coalesce(string_agg(md5(t::text), '''' ORDER BY md5(t::text)), '''')) FROM %I AS t',
              tablename, tablename)
FROM pg_tables WHERE schemaname='public'
ORDER BY tablename
\gexec
COMMIT;
