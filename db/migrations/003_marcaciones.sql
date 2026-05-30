-- Up Migration

-- =============================================================================
-- 004_marcaciones.sql
-- LA tabla critica del sistema. Aqui vive la fuente de verdad legal.
--
-- Garantias:
--   1. APPEND-ONLY: nunca UPDATE ni DELETE.
--   2. CADENA HASH: SHA-256(payload anterior + datos propios).
--   3. SECUENCIA MONOTONICA POR TENANT.
--   4. GEOCERCA VALIDADA contra centro asignado.
--   5. AUDITABILIDAD COMPLETA.
--
-- DECISION DE DISENO IMPORTANTE:
-- El payload del hash se construye en UNA SOLA funcion (rc._payload_marcacion)
-- que es invocada tanto por registrar_marcacion (al insertar) como por
-- verificar_cadena_hash (al validar). Esto elimina la clase entera de bugs
-- donde la verificacion construye un payload distinto al original.
--
-- Las coordenadas se almacenan como columnas numeric(10,7) EXPLICITAS, no
-- como derivacion del campo geography. PostGIS al roundtrippear lat/lng
-- pierde representacion textual (e.g., -36.8270 vuelve como -36.827) lo que
-- rompe el hash. La columna geography existe solo para queries espaciales
-- (ST_DWithin para geocerca).
-- =============================================================================

CREATE TYPE rc.tipo_marcacion AS ENUM (
    'entrada',
    'salida',
    'inicio_colacion',
    'fin_colacion',
    'ajuste'
);

CREATE TYPE rc.fuente_marcacion AS ENUM (
    'web',
    'movil',
    'dispositivo',
    'manual'
);

-- =============================================================================
-- Tabla principal
-- =============================================================================
CREATE TABLE rc.marcaciones (
    id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid                NOT NULL REFERENCES rc.tenants(id) ON DELETE RESTRICT,
    secuencia           bigint              NOT NULL,
    trabajador_id       uuid                NOT NULL REFERENCES rc.trabajadores(id) ON DELETE RESTRICT,
    tipo                rc.tipo_marcacion   NOT NULL,
    fuente              rc.fuente_marcacion NOT NULL,
    timestamp_utc       timestamptz         NOT NULL DEFAULT now(),
    centro_trabajo_id   uuid                REFERENCES rc.centros_trabajo(id),
    -- Coordenadas como columnas EXPLICITAS. Fuente de verdad para el hash.
    -- 7 decimales = ~11mm de precision, suficiente para cualquier GPS.
    latitud             numeric(10, 7),
    longitud            numeric(10, 7),
    -- Geografia derivada de lat/lng. Para ST_DWithin (geocerca).
    -- Se mantiene sincronizada por la funcion registrar_marcacion.
    ubicacion           geography(POINT, 4326),
    precision_metros    numeric(8, 2),
    dentro_geocerca     boolean,
    marcacion_original_id uuid              REFERENCES rc.marcaciones(id),
    justificacion       text,
    device_id           text,
    ip_origen           inet,
    user_agent          text,
    usuario_registrador_id uuid             REFERENCES rc.usuarios(id),
    hash_anterior       text                NOT NULL,
    hash_actual         text                NOT NULL,
    created_at          timestamptz         NOT NULL DEFAULT now(),

    CONSTRAINT marc_ajuste_requiere_original
        CHECK (tipo <> 'ajuste' OR marcacion_original_id IS NOT NULL),
    CONSTRAINT marc_ajuste_o_manual_requiere_justificacion
        CHECK (
            (tipo NOT IN ('ajuste') AND fuente <> 'manual')
            OR (justificacion IS NOT NULL AND length(trim(justificacion)) >= 10)
        ),
    CONSTRAINT marc_manual_requiere_registrador
        CHECK (fuente <> 'manual' OR usuario_registrador_id IS NOT NULL),
    CONSTRAINT marc_hash_formato
        CHECK (hash_actual ~ '^[a-f0-9]{64}$' AND hash_anterior ~ '^[a-f0-9]{64}$'),
    CONSTRAINT marc_secuencia_positiva
        CHECK (secuencia > 0),
    CONSTRAINT marc_lat_lng_juntos
        CHECK ((latitud IS NULL) = (longitud IS NULL)),
    UNIQUE (tenant_id, secuencia),
    UNIQUE (hash_actual)
);

CREATE INDEX idx_marcaciones_tenant_ts
    ON rc.marcaciones(tenant_id, timestamp_utc DESC);
CREATE INDEX idx_marcaciones_trabajador_ts
    ON rc.marcaciones(trabajador_id, timestamp_utc DESC);
CREATE INDEX idx_marcaciones_tenant_secuencia
    ON rc.marcaciones(tenant_id, secuencia);
CREATE INDEX idx_marcaciones_ubicacion
    ON rc.marcaciones USING GIST (ubicacion)
    WHERE ubicacion IS NOT NULL;

COMMENT ON TABLE rc.marcaciones IS
'Fuente de verdad legal de marcajes. Append-only. Cadena hash garantiza inalterabilidad (Res. Ex. 38/2024 DT).';

-- =============================================================================
-- HELPER CANONICO: construye el payload string para hash.
-- UNICO punto donde se define el formato. Si esta funcion cambia, toda la
-- cadena historica se invalida; por eso esta documentada y es STABLE/IMMUTABLE
-- (no depende de filas externas).
--
-- Reglas de normalizacion:
--   - lat/lng: to_char con 7 decimales fijos. Padding con ceros.
--   - timestamp: epoch con 6 decimales (microsegundos) en formato fijo.
--   - NULLs: string vacio.
--   - Separador: pipe '|'. No puede aparecer en los datos (uuids, enums,
--     numeros) asi que es seguro.
-- =============================================================================
CREATE OR REPLACE FUNCTION rc._payload_marcacion(
    p_hash_anterior      text,
    p_tenant_id          uuid,
    p_secuencia          bigint,
    p_trabajador_id      uuid,
    p_tipo               rc.tipo_marcacion,
    p_fuente             rc.fuente_marcacion,
    p_timestamp_utc      timestamptz,
    p_centro_trabajo_id  uuid,
    p_latitud            numeric,
    p_longitud           numeric,
    p_marcacion_original_id uuid,
    p_device_id          text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_hash_anterior
        || '|' || p_tenant_id::text
        || '|' || p_secuencia::text
        || '|' || p_trabajador_id::text
        || '|' || p_tipo::text
        || '|' || p_fuente::text
        || '|' || to_char(extract(epoch from p_timestamp_utc)::numeric, 'FM9999999999.000000')
        || '|' || COALESCE(p_centro_trabajo_id::text, '')
        || '|' || COALESCE(to_char(p_latitud,  'FM999999990.0000000'), '')
        || '|' || COALESCE(to_char(p_longitud, 'FM999999990.0000000'), '')
        || '|' || COALESCE(p_marcacion_original_id::text, '')
        || '|' || COALESCE(p_device_id, '');
$$;

COMMENT ON FUNCTION rc._payload_marcacion IS
'Construye el payload canonico para hash de marcaciones. Usado por registrar Y por verificar; cambiarlo invalida la cadena historica entera.';

-- =============================================================================
-- FUNCION: registrar_marcacion
-- Unico punto de entrada para insertar marcaciones.
-- =============================================================================
CREATE OR REPLACE FUNCTION rc.registrar_marcacion(
    p_tenant_id              uuid,
    p_trabajador_id          uuid,
    p_tipo                   rc.tipo_marcacion,
    p_fuente                 rc.fuente_marcacion,
    p_centro_trabajo_id      uuid    DEFAULT NULL,
    p_latitud                numeric DEFAULT NULL,
    p_longitud               numeric DEFAULT NULL,
    p_precision_metros       numeric DEFAULT NULL,
    p_marcacion_original_id  uuid    DEFAULT NULL,
    p_justificacion          text    DEFAULT NULL,
    p_device_id              text    DEFAULT NULL,
    p_ip_origen              inet    DEFAULT NULL,
    p_user_agent             text    DEFAULT NULL,
    p_usuario_registrador_id uuid    DEFAULT NULL
)
RETURNS rc.marcaciones
LANGUAGE plpgsql
AS $$
DECLARE
    v_lock_key        bigint;
    v_secuencia       bigint;
    v_hash_anterior   text;
    v_lat_canonica    numeric(10, 7);
    v_lng_canonica    numeric(10, 7);
    v_ubicacion       geography(POINT, 4326);
    v_dentro_geocerca boolean;
    v_centro_geom     geography(POINT, 4326);
    v_centro_radio    integer;
    v_hash_actual     text;
    v_marcacion       rc.marcaciones;
    v_ts              timestamptz := now();
BEGIN
    -- Validar trabajador pertenece al tenant
    IF NOT EXISTS (
        SELECT 1 FROM rc.trabajadores
        WHERE id = p_trabajador_id AND tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'Trabajador % no pertenece al tenant %', p_trabajador_id, p_tenant_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- Cast a la precision canonica. CRITICO: lat/lng se almacenan con
    -- precision fija para que el hash sea determinista.
    IF p_latitud IS NOT NULL AND p_longitud IS NOT NULL THEN
        v_lat_canonica := p_latitud::numeric(10, 7);
        v_lng_canonica := p_longitud::numeric(10, 7);
        v_ubicacion := ST_SetSRID(ST_MakePoint(v_lng_canonica, v_lat_canonica), 4326)::geography;
    END IF;

    -- Validar geocerca
    IF v_ubicacion IS NOT NULL AND p_centro_trabajo_id IS NOT NULL THEN
        SELECT ubicacion, radio_metros
          INTO v_centro_geom, v_centro_radio
          FROM rc.centros_trabajo
         WHERE id = p_centro_trabajo_id AND tenant_id = p_tenant_id;

        IF v_centro_geom IS NULL THEN
            RAISE EXCEPTION 'Centro de trabajo % no encontrado para tenant %',
                p_centro_trabajo_id, p_tenant_id;
        END IF;

        v_dentro_geocerca := ST_DWithin(v_ubicacion, v_centro_geom, v_centro_radio);
    END IF;

    -- Advisory lock por tenant: serializa el calculo de hash entre llamadas
    -- concurrentes del mismo tenant, sin afectar a otros tenants.
    v_lock_key := ('x' || substr(md5(p_tenant_id::text), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    SELECT COALESCE(MAX(secuencia), 0) + 1,
           COALESCE(
               (SELECT hash_actual FROM rc.marcaciones
                 WHERE tenant_id = p_tenant_id
                 ORDER BY secuencia DESC LIMIT 1),
               repeat('0', 64)
           )
      INTO v_secuencia, v_hash_anterior
      FROM rc.marcaciones
     WHERE tenant_id = p_tenant_id;

    -- HASH via funcion canonica
    v_hash_actual := encode(
        digest(
            rc._payload_marcacion(
                v_hash_anterior, p_tenant_id, v_secuencia, p_trabajador_id,
                p_tipo, p_fuente, v_ts, p_centro_trabajo_id,
                v_lat_canonica, v_lng_canonica,
                p_marcacion_original_id, p_device_id
            ),
            'sha256'
        ),
        'hex'
    );

    INSERT INTO rc.marcaciones (
        tenant_id, secuencia, trabajador_id, tipo, fuente, timestamp_utc,
        centro_trabajo_id, latitud, longitud, ubicacion, precision_metros,
        dentro_geocerca, marcacion_original_id, justificacion, device_id,
        ip_origen, user_agent, usuario_registrador_id, hash_anterior, hash_actual
    ) VALUES (
        p_tenant_id, v_secuencia, p_trabajador_id, p_tipo, p_fuente, v_ts,
        p_centro_trabajo_id, v_lat_canonica, v_lng_canonica, v_ubicacion,
        p_precision_metros, v_dentro_geocerca, p_marcacion_original_id,
        p_justificacion, p_device_id, p_ip_origen, p_user_agent,
        p_usuario_registrador_id, v_hash_anterior, v_hash_actual
    )
    RETURNING * INTO v_marcacion;

    RETURN v_marcacion;
END;
$$;

COMMENT ON FUNCTION rc.registrar_marcacion IS
'Unico punto de entrada para crear marcaciones. Calcula secuencia y hash chain con advisory lock por tenant.';

-- =============================================================================
-- TRIGGERS DE INMUTABILIDAD
-- =============================================================================
CREATE OR REPLACE FUNCTION rc.tg_marcaciones_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Tabla rc.marcaciones es append-only. Usar tipo=ajuste para correcciones.'
            USING ERRCODE = 'insufficient_privilege';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Tabla rc.marcaciones es append-only. DELETE no permitido.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_marcaciones_no_update
    BEFORE UPDATE ON rc.marcaciones
    FOR EACH ROW EXECUTE FUNCTION rc.tg_marcaciones_append_only();

CREATE TRIGGER tg_marcaciones_no_delete
    BEFORE DELETE ON rc.marcaciones
    FOR EACH ROW EXECUTE FUNCTION rc.tg_marcaciones_append_only();

-- =============================================================================
-- FUNCION DE VERIFICACION: reusa rc._payload_marcacion. Es IMPOSIBLE que
-- diverja del INSERT porque ambas rutas pasan por la misma funcion.
-- =============================================================================
CREATE OR REPLACE FUNCTION rc.verificar_cadena_hash(p_tenant_id uuid)
RETURNS TABLE (
    secuencia_corrupta bigint,
    marcacion_id       uuid,
    hash_esperado      text,
    hash_almacenado    text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    r              rc.marcaciones%ROWTYPE;
    v_hash_prev    text := repeat('0', 64);
    v_hash_calc    text;
BEGIN
    FOR r IN
        SELECT * FROM rc.marcaciones
         WHERE tenant_id = p_tenant_id
         ORDER BY secuencia ASC
    LOOP
        IF r.hash_anterior <> v_hash_prev THEN
            secuencia_corrupta := r.secuencia;
            marcacion_id       := r.id;
            hash_esperado      := v_hash_prev;
            hash_almacenado    := r.hash_anterior;
            RETURN NEXT;
            RETURN;
        END IF;

        v_hash_calc := encode(
            digest(
                rc._payload_marcacion(
                    r.hash_anterior, r.tenant_id, r.secuencia, r.trabajador_id,
                    r.tipo, r.fuente, r.timestamp_utc, r.centro_trabajo_id,
                    r.latitud, r.longitud,
                    r.marcacion_original_id, r.device_id
                ),
                'sha256'
            ),
            'hex'
        );

        IF v_hash_calc <> r.hash_actual THEN
            secuencia_corrupta := r.secuencia;
            marcacion_id       := r.id;
            hash_esperado      := v_hash_calc;
            hash_almacenado    := r.hash_actual;
            RETURN NEXT;
            RETURN;
        END IF;

        v_hash_prev := r.hash_actual;
    END LOOP;

    RETURN;
END;
$$;

COMMENT ON FUNCTION rc.verificar_cadena_hash IS
'Recalcula la cadena hash completa de un tenant usando _payload_marcacion. Retorna fila si encuentra corrupcion, vacio si esta integra.';

-- =============================================================================
-- Permisos
-- =============================================================================
GRANT SELECT, INSERT ON rc.marcaciones TO app_user;
GRANT SELECT ON rc.marcaciones TO fiscalizador_dt;
GRANT EXECUTE ON FUNCTION rc.registrar_marcacion TO app_user;
GRANT EXECUTE ON FUNCTION rc.verificar_cadena_hash TO app_user, fiscalizador_dt;
GRANT EXECUTE ON FUNCTION rc._payload_marcacion TO app_user, fiscalizador_dt;

-- Down Migration

-- ⚠️  ADVERTENCIA: En producción NUNCA ejecutar este down.
-- rc.marcaciones es append-only por mandato legal (Res. Ex. 38/2024 DT).
-- Solo usar en desarrollo para resetear el entorno.
DROP TABLE IF EXISTS rc.marcaciones CASCADE;
DROP FUNCTION IF EXISTS rc.verificar_cadena_hash(uuid);
DROP FUNCTION IF EXISTS rc.registrar_marcacion(uuid, uuid, rc.tipo_marcacion, rc.fuente_marcacion, uuid, numeric, numeric, numeric, uuid, text, text, inet, text, uuid);
DROP FUNCTION IF EXISTS rc.tg_marcaciones_append_only();
DROP FUNCTION IF EXISTS rc._payload_marcacion(text, uuid, bigint, uuid, rc.tipo_marcacion, rc.fuente_marcacion, timestamptz, uuid, numeric, numeric, uuid, text);
DROP TYPE IF EXISTS rc.fuente_marcacion;
DROP TYPE IF EXISTS rc.tipo_marcacion;
