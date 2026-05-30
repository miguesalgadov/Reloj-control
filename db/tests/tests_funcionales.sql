-- =============================================================================
-- tests_funcionales.sql
-- Cada bloque que usa SET LOCAL va envuelto en BEGIN/COMMIT como ocurriria
-- en el codigo real de NestJS (un request = una transaccion).
-- =============================================================================

\echo
\echo '######################################################################'
\echo '# TEST 1: Insertar marcaciones y verificar cadena hash'
\echo '######################################################################'

BEGIN;
SET LOCAL ROLE admin_migrate;

SELECT 'Marcacion 1 (A):' AS evento, secuencia, substr(hash_actual, 1, 16) AS hash, dentro_geocerca
FROM rc.registrar_marcacion(
    p_tenant_id     := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    p_trabajador_id := 'a4444444-4444-4444-4444-444444444444',
    p_tipo          := 'entrada',
    p_fuente        := 'movil',
    p_centro_trabajo_id := 'a1111111-1111-1111-1111-111111111111',
    p_latitud       := -36.8270,
    p_longitud      := -73.0498,
    p_precision_metros := 8.5,
    p_ip_origen     := '190.45.12.34'::inet
);

SELECT 'Marcacion 2 (A):' AS evento, secuencia, substr(hash_actual, 1, 16) AS hash, dentro_geocerca
FROM rc.registrar_marcacion(
    p_tenant_id     := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    p_trabajador_id := 'a4444444-4444-4444-4444-444444444444',
    p_tipo          := 'inicio_colacion',
    p_fuente        := 'movil',
    p_centro_trabajo_id := 'a1111111-1111-1111-1111-111111111111',
    p_latitud       := -36.8271,
    p_longitud      := -73.0499
);

SELECT 'Marcacion 3 (A, FUERA):' AS evento, secuencia, substr(hash_actual, 1, 16) AS hash, dentro_geocerca
FROM rc.registrar_marcacion(
    p_tenant_id     := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    p_trabajador_id := 'a4444444-4444-4444-4444-444444444444',
    p_tipo          := 'fin_colacion',
    p_fuente        := 'movil',
    p_centro_trabajo_id := 'a1111111-1111-1111-1111-111111111111',
    p_latitud       := -36.7000,
    p_longitud      := -73.0498
);

SELECT 'Marcacion 4 (A, huellero):' AS evento, secuencia, substr(hash_actual, 1, 16) AS hash
FROM rc.registrar_marcacion(
    p_tenant_id     := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    p_trabajador_id := 'a5555555-5555-5555-5555-555555555555',
    p_tipo          := 'entrada',
    p_fuente        := 'dispositivo',
    p_centro_trabajo_id := 'a1111111-1111-1111-1111-111111111111',
    p_device_id     := 'ZKT-PLAZA-01'
);

SELECT 'Marcacion 1 (B):' AS evento, secuencia, substr(hash_actual, 1, 16) AS hash, dentro_geocerca
FROM rc.registrar_marcacion(
    p_tenant_id     := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    p_trabajador_id := 'b4444444-4444-4444-4444-444444444444',
    p_tipo          := 'entrada',
    p_fuente        := 'web',
    p_centro_trabajo_id := 'b1111111-1111-1111-1111-111111111111',
    p_latitud       := -37.4697,
    p_longitud      := -72.3539
);

\echo '--- Cadena tenant A ---'
SELECT secuencia, tipo,
       substr(hash_anterior, 1, 16) AS prev_hash,
       substr(hash_actual, 1, 16)   AS curr_hash,
       dentro_geocerca
FROM rc.marcaciones
WHERE tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
ORDER BY secuencia;

\echo '--- Cadena tenant B (secuencia independiente, arranca en 1) ---'
SELECT secuencia, tipo, substr(hash_actual, 1, 16) AS curr_hash
FROM rc.marcaciones
WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
ORDER BY secuencia;

\echo '--- Verificacion integridad tenant A (debe ser VACIO) ---'
SELECT * FROM rc.verificar_cadena_hash('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

\echo '--- Verificacion integridad tenant B (debe ser VACIO) ---'
SELECT * FROM rc.verificar_cadena_hash('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

COMMIT;

\echo
\echo '######################################################################'
\echo '# TEST 2: Inmutabilidad. UPDATE y DELETE deben fallar.'
\echo '######################################################################'

BEGIN;
SET LOCAL ROLE admin_migrate;

DO $$
BEGIN
    UPDATE rc.marcaciones SET tipo = 'salida' WHERE secuencia = 1
      AND tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    RAISE NOTICE 'FALLO: el UPDATE no debio prosperar';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK: UPDATE bloqueado -> %', SQLERRM;
END $$;

DO $$
BEGIN
    DELETE FROM rc.marcaciones WHERE secuencia = 1
      AND tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    RAISE NOTICE 'FALLO: el DELETE no debio prosperar';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK: DELETE bloqueado -> %', SQLERRM;
END $$;

COMMIT;

\echo
\echo '######################################################################'
\echo '# TEST 3: Aislamiento RLS multi-tenant'
\echo '######################################################################'

\echo '--- app_user con tenant_id = A: solo ve A ---'
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SELECT tenant_id, COUNT(*) AS marcaciones_visibles
FROM rc.marcaciones
GROUP BY tenant_id;
COMMIT;

\echo '--- app_user con tenant_id = B: solo ve B ---'
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
SELECT tenant_id, COUNT(*) AS marcaciones_visibles
FROM rc.marcaciones
GROUP BY tenant_id;
COMMIT;

\echo '--- Sin tenant seteado: 0 filas (fail-safe) ---'
BEGIN;
SET LOCAL ROLE app_user;
SELECT COUNT(*) AS marcaciones_sin_tenant FROM rc.marcaciones;
COMMIT;

\echo '--- Cross-tenant INSERT (sesion=A, insertar para B): debe fallar ---'
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
DO $$
BEGIN
    PERFORM rc.registrar_marcacion(
        p_tenant_id     := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        p_trabajador_id := 'b4444444-4444-4444-4444-444444444444',
        p_tipo          := 'entrada',
        p_fuente        := 'web'
    );
    RAISE NOTICE 'FALLO: cross-tenant INSERT prospero';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK: cross-tenant INSERT bloqueado -> %', SQLERRM;
END $$;
COMMIT;

\echo
\echo '######################################################################'
\echo '# TEST 4: Deteccion de corrupcion en la cadena hash'
\echo '######################################################################'

\echo '--- Antes: cadena integra (0 filas devueltas) ---'
SELECT * FROM rc.verificar_cadena_hash('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

\echo '--- Simular alteracion ---'
ALTER TABLE rc.marcaciones DISABLE TRIGGER tg_marcaciones_no_update;
UPDATE rc.marcaciones
   SET tipo = 'salida'
 WHERE tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND secuencia = 2;
ALTER TABLE rc.marcaciones ENABLE TRIGGER tg_marcaciones_no_update;

\echo '--- Despues: verificacion DETECTA la corrupcion ---'
SELECT * FROM rc.verificar_cadena_hash('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

\echo
\echo '######################################################################'
\echo '# TEST 5: Audit log'
\echo '######################################################################'

BEGIN;
SET LOCAL ROLE admin_migrate;

SELECT 'evento 1:' AS e, secuencia, categoria, substr(hash_actual, 1, 16) AS hash
FROM rc.registrar_evento(
    p_tenant_id        := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    p_categoria        := 'autenticacion',
    p_accion           := 'login_exitoso',
    p_actor_tipo       := 'usuario',
    p_actor_id         := 'a3333333-3333-3333-3333-333333333333',
    p_actor_descripcion := 'Juan Perez (trabajador)',
    p_payload          := '{"metodo": "password", "mfa": false}'::jsonb,
    p_ip_origen        := '190.45.12.34'::inet
);

SELECT 'evento 2:' AS e, secuencia, categoria, substr(hash_actual, 1, 16) AS hash
FROM rc.registrar_evento(
    p_tenant_id  := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    p_categoria  := 'acceso_fiscalizador',
    p_accion     := 'consulta_reporte_asistencia',
    p_actor_tipo := 'fiscalizador',
    p_actor_id   := 'fiscalizador-dt-001',
    p_payload    := '{"periodo": "2026-04", "trabajadores": 25}'::jsonb
);

\echo '--- Verificacion integridad audit_log (debe ser VACIO) ---'
SELECT * FROM rc.verificar_cadena_audit('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

COMMIT;

\echo
\echo '######################################################################'
\echo '# RESUMEN'
\echo '######################################################################'
SELECT
    (SELECT COUNT(*) FROM rc.marcaciones)   AS total_marcaciones,
    (SELECT COUNT(*) FROM rc.audit_log)     AS total_eventos_audit,
    (SELECT COUNT(*) FROM rc.tenants)       AS total_tenants,
    (SELECT COUNT(*) FROM rc.trabajadores)  AS total_trabajadores;
