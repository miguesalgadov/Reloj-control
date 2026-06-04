-- Up Migration

-- =============================================================================
-- 010_marcaciones_ajuste.sql
-- Agrega infraestructura de DB para el Paso E (ajustes administrativos).
--
-- Cambios:
--   1. Columna datos_ajuste jsonb en rc.marcaciones.
--   2. Reemplaza la constraint marc_ajuste_requiere_original (que exigía
--      marcacion_original_id IS NOT NULL para todo tipo='ajuste') por dos
--      constraints más precisas que permiten el sub-tipo 'creacion'
--      (que no tiene original) pero siguen exigiendo el original para
--      'correccion' y 'anulacion'.
--   3. Función rc.registrar_ajuste(): igual que registrar_marcacion pero
--      acepta datos_ajuste jsonb, usa fuente='manual' y delega el cálculo
--      de hash a _payload_marcacion (misma función que usa verificar_cadena_hash,
--      garantizando que la cadena queda íntegra).
-- =============================================================================

-- 1. Columna
ALTER TABLE rc.marcaciones ADD COLUMN datos_ajuste jsonb;

-- 2. Reemplazar constraint
ALTER TABLE rc.marcaciones DROP CONSTRAINT marc_ajuste_requiere_original;

-- tipo='ajuste' siempre requiere datos_ajuste con tipo_ajuste definido
ALTER TABLE rc.marcaciones ADD CONSTRAINT marc_ajuste_requiere_datos
    CHECK (
        tipo <> 'ajuste'
        OR (datos_ajuste IS NOT NULL AND (datos_ajuste->>'tipo_ajuste') IS NOT NULL)
    );

-- correccion y anulacion requieren marcacion_original_id
ALTER TABLE rc.marcaciones ADD CONSTRAINT marc_ajuste_correccion_requiere_original
    CHECK (
        tipo <> 'ajuste'
        OR datos_ajuste IS NULL
        OR (datos_ajuste->>'tipo_ajuste') NOT IN ('correccion', 'anulacion')
        OR marcacion_original_id IS NOT NULL
    );

-- =============================================================================
-- 3. Función registrar_ajuste
-- =============================================================================
CREATE OR REPLACE FUNCTION rc.registrar_ajuste(
    p_tipo_marcacion         rc.tipo_marcacion,
    p_trabajador_id          uuid,
    p_timestamp_utc          timestamptz,
    p_datos_ajuste           jsonb,
    p_marcacion_original_id  uuid    DEFAULT NULL,
    p_latitud                numeric DEFAULT NULL,
    p_longitud               numeric DEFAULT NULL,
    p_admin_id               uuid    DEFAULT NULL,
    p_ip_origen              inet    DEFAULT NULL,
    p_user_agent             text    DEFAULT NULL
)
RETURNS rc.marcaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id       uuid;
    v_lock_key        bigint;
    v_secuencia       bigint;
    v_hash_anterior   text;
    v_lat_canonica    numeric(10, 7);
    v_lng_canonica    numeric(10, 7);
    v_ubicacion       geography(POINT, 4326);
    v_hash_actual     text;
    v_marcacion       rc.marcaciones;
    v_motivo          text;
BEGIN
    v_tenant_id := rc.current_tenant_id();

    IF NOT EXISTS (
        SELECT 1 FROM rc.trabajadores
        WHERE id = p_trabajador_id AND tenant_id = v_tenant_id
    ) THEN
        RAISE EXCEPTION 'Trabajador % no pertenece al tenant %', p_trabajador_id, v_tenant_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF p_latitud IS NOT NULL AND p_longitud IS NOT NULL THEN
        v_lat_canonica := p_latitud::numeric(10, 7);
        v_lng_canonica := p_longitud::numeric(10, 7);
        v_ubicacion := ST_SetSRID(ST_MakePoint(v_lng_canonica, v_lat_canonica), 4326)::geography;
    END IF;

    v_motivo := p_datos_ajuste->>'motivo';

    -- Serializa hash chain por tenant
    v_lock_key := ('x' || substr(md5(v_tenant_id::text), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    SELECT COALESCE(MAX(secuencia), 0) + 1,
           COALESCE(
               (SELECT hash_actual FROM rc.marcaciones
                 WHERE tenant_id = v_tenant_id
                 ORDER BY secuencia DESC LIMIT 1),
               repeat('0', 64)
           )
      INTO v_secuencia, v_hash_anterior
      FROM rc.marcaciones
     WHERE tenant_id = v_tenant_id;

    -- Usa la misma función canónica que registrar_marcacion y verificar_cadena_hash
    v_hash_actual := encode(
        digest(
            rc._payload_marcacion(
                v_hash_anterior, v_tenant_id, v_secuencia, p_trabajador_id,
                p_tipo_marcacion, 'manual', p_timestamp_utc, NULL,
                v_lat_canonica, v_lng_canonica,
                p_marcacion_original_id, NULL
            ),
            'sha256'
        ),
        'hex'
    );

    INSERT INTO rc.marcaciones (
        tenant_id, secuencia, trabajador_id, tipo, fuente, timestamp_utc,
        latitud, longitud, ubicacion,
        marcacion_original_id, justificacion,
        usuario_registrador_id,
        datos_ajuste,
        hash_anterior, hash_actual,
        ip_origen, user_agent
    ) VALUES (
        v_tenant_id, v_secuencia, p_trabajador_id, p_tipo_marcacion, 'manual', p_timestamp_utc,
        v_lat_canonica, v_lng_canonica, v_ubicacion,
        p_marcacion_original_id, v_motivo,
        p_admin_id,
        p_datos_ajuste,
        v_hash_anterior, v_hash_actual,
        p_ip_origen, p_user_agent
    )
    RETURNING * INTO v_marcacion;

    RETURN v_marcacion;
END;
$$;

COMMENT ON FUNCTION rc.registrar_ajuste IS
'Inserta una marcación administrativa (ajuste). Reutiliza _payload_marcacion para
mantener la cadena hash íntegra. Usa fuente=manual y almacena metadatos en datos_ajuste.';

GRANT EXECUTE ON FUNCTION rc.registrar_ajuste TO app_user;


-- Down Migration

DROP FUNCTION IF EXISTS rc.registrar_ajuste(
    rc.tipo_marcacion, uuid, timestamptz, jsonb, uuid, numeric, numeric, uuid, inet, text
);

ALTER TABLE rc.marcaciones DROP CONSTRAINT IF EXISTS marc_ajuste_requiere_datos;
ALTER TABLE rc.marcaciones DROP CONSTRAINT IF EXISTS marc_ajuste_correccion_requiere_original;

ALTER TABLE rc.marcaciones ADD CONSTRAINT marc_ajuste_requiere_original
    CHECK (tipo <> 'ajuste' OR marcacion_original_id IS NOT NULL);

ALTER TABLE rc.marcaciones DROP COLUMN IF EXISTS datos_ajuste;
