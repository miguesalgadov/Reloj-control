-- Up Migration

-- =============================================================================
-- 005_audit_log.sql
-- Bitacora inmutable de eventos. Mismo patron que marcaciones:
--   - Tabla append-only con triggers
--   - Cadena hash via funcion canonica _payload_audit
--   - Secuencia monotonica por tenant (UUID cero = tenant "global" para
--     eventos cross-tenant del sistema)
-- =============================================================================

CREATE TYPE rc.audit_categoria AS ENUM (
    'autenticacion',
    'gestion_trabajador',
    'gestion_contrato',
    'gestion_jornada',
    'gestion_centro',
    'gestion_usuario',
    'gestion_dispositivo',
    'marcacion_creada',
    'marcacion_ajustada',
    'reporte_generado',
    'reporte_exportado',
    'acceso_fiscalizador',
    'config_tenant',
    'sistema'
);

CREATE TYPE rc.audit_actor_tipo AS ENUM (
    'usuario',
    'fiscalizador',
    'dispositivo',
    'sistema',
    'api_externa'
);

CREATE TABLE rc.audit_log (
    id              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid                REFERENCES rc.tenants(id) ON DELETE RESTRICT,
    secuencia       bigint              NOT NULL,
    categoria       rc.audit_categoria  NOT NULL,
    accion          text                NOT NULL,
    actor_tipo      rc.audit_actor_tipo NOT NULL,
    actor_id        text,
    actor_descripcion text,
    entidad_tipo    text,
    entidad_id      uuid,
    payload         jsonb               NOT NULL DEFAULT '{}'::jsonb,
    ip_origen       inet,
    user_agent      text,
    request_id      text,
    hash_anterior   text                NOT NULL,
    hash_actual     text                NOT NULL,
    created_at      timestamptz         NOT NULL DEFAULT now(),

    CONSTRAINT audit_hash_formato
        CHECK (hash_actual ~ '^[a-f0-9]{64}$' AND hash_anterior ~ '^[a-f0-9]{64}$'),
    CONSTRAINT audit_secuencia_positiva
        CHECK (secuencia > 0)
);

CREATE UNIQUE INDEX uq_audit_tenant_secuencia
    ON rc.audit_log (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), secuencia);

CREATE UNIQUE INDEX uq_audit_hash_actual ON rc.audit_log(hash_actual);

CREATE INDEX idx_audit_tenant_ts ON rc.audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_categoria ON rc.audit_log(tenant_id, categoria, created_at DESC);
CREATE INDEX idx_audit_entidad ON rc.audit_log(tenant_id, entidad_tipo, entidad_id);
CREATE INDEX idx_audit_actor ON rc.audit_log(actor_tipo, actor_id);
CREATE INDEX idx_audit_payload ON rc.audit_log USING GIN (payload);

COMMENT ON TABLE rc.audit_log IS
'Bitacora inmutable cross-modulo. Append-only con cadena hash. Replica a S3 WORM en produccion.';

-- =============================================================================
-- HELPER CANONICO para payload de audit. Mismo principio que en marcaciones:
-- UNA sola funcion define el formato, usada por insert y verify.
-- =============================================================================
CREATE OR REPLACE FUNCTION rc._payload_audit(
    p_hash_anterior     text,
    p_tenant_efectivo   uuid,    -- UUID cero para eventos globales
    p_secuencia         bigint,
    p_categoria         rc.audit_categoria,
    p_accion            text,
    p_actor_tipo        rc.audit_actor_tipo,
    p_actor_id          text,
    p_entidad_tipo      text,
    p_entidad_id        uuid,
    p_payload           jsonb,
    p_created_at        timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_hash_anterior
        || '|' || p_tenant_efectivo::text
        || '|' || p_secuencia::text
        || '|' || p_categoria::text
        || '|' || p_accion
        || '|' || p_actor_tipo::text
        || '|' || COALESCE(p_actor_id, '')
        || '|' || COALESCE(p_entidad_tipo, '')
        || '|' || COALESCE(p_entidad_id::text, '')
        -- jsonb se serializa siempre en orden canonico de claves (esto si lo
        -- garantiza Postgres para jsonb, a diferencia de json)
        || '|' || encode(digest(p_payload::text, 'sha256'), 'hex')
        || '|' || to_char(extract(epoch from p_created_at)::numeric, 'FM9999999999.000000');
$$;

COMMENT ON FUNCTION rc._payload_audit IS
'Construye payload canonico para hash de audit_log. Usado por registrar Y verificar.';

-- =============================================================================
-- FUNCION: registrar_evento
-- =============================================================================
CREATE OR REPLACE FUNCTION rc.registrar_evento(
    p_tenant_id        uuid,
    p_categoria        rc.audit_categoria,
    p_accion           text,
    p_actor_tipo       rc.audit_actor_tipo,
    p_actor_id         text DEFAULT NULL,
    p_actor_descripcion text DEFAULT NULL,
    p_entidad_tipo     text DEFAULT NULL,
    p_entidad_id       uuid DEFAULT NULL,
    p_payload          jsonb DEFAULT '{}'::jsonb,
    p_ip_origen        inet DEFAULT NULL,
    p_user_agent       text DEFAULT NULL,
    p_request_id       text DEFAULT NULL
)
RETURNS rc.audit_log
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_efectivo uuid;
    v_lock_key        bigint;
    v_secuencia       bigint;
    v_hash_anterior   text;
    v_hash_actual     text;
    v_evento          rc.audit_log;
    v_ts              timestamptz := now();
BEGIN
    v_tenant_efectivo := COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);

    v_lock_key := ('x' || substr(md5('audit:' || v_tenant_efectivo::text), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    SELECT COALESCE(MAX(secuencia), 0) + 1,
           COALESCE(
               (SELECT hash_actual FROM rc.audit_log
                 WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_tenant_efectivo
                 ORDER BY secuencia DESC LIMIT 1),
               repeat('0', 64)
           )
      INTO v_secuencia, v_hash_anterior
      FROM rc.audit_log
     WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_tenant_efectivo;

    v_hash_actual := encode(
        digest(
            rc._payload_audit(
                v_hash_anterior, v_tenant_efectivo, v_secuencia,
                p_categoria, p_accion, p_actor_tipo, p_actor_id,
                p_entidad_tipo, p_entidad_id, p_payload, v_ts
            ),
            'sha256'
        ),
        'hex'
    );

    INSERT INTO rc.audit_log (
        tenant_id, secuencia, categoria, accion, actor_tipo, actor_id,
        actor_descripcion, entidad_tipo, entidad_id, payload,
        ip_origen, user_agent, request_id, hash_anterior, hash_actual, created_at
    ) VALUES (
        p_tenant_id, v_secuencia, p_categoria, p_accion, p_actor_tipo, p_actor_id,
        p_actor_descripcion, p_entidad_tipo, p_entidad_id, p_payload,
        p_ip_origen, p_user_agent, p_request_id, v_hash_anterior, v_hash_actual, v_ts
    )
    RETURNING * INTO v_evento;

    RETURN v_evento;
END;
$$;

COMMENT ON FUNCTION rc.registrar_evento IS
'Unico punto de entrada para audit_log. Calcula secuencia y hash chain con advisory lock por tenant.';

-- =============================================================================
-- Triggers append-only
-- =============================================================================
CREATE OR REPLACE FUNCTION rc.tg_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Tabla rc.audit_log es append-only. % no permitido.', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER tg_audit_no_update
    BEFORE UPDATE ON rc.audit_log
    FOR EACH ROW EXECUTE FUNCTION rc.tg_audit_append_only();

CREATE TRIGGER tg_audit_no_delete
    BEFORE DELETE ON rc.audit_log
    FOR EACH ROW EXECUTE FUNCTION rc.tg_audit_append_only();

-- =============================================================================
-- Verificacion (reusa _payload_audit)
-- =============================================================================
CREATE OR REPLACE FUNCTION rc.verificar_cadena_audit(p_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (
    secuencia_corrupta bigint,
    evento_id          uuid,
    hash_esperado      text,
    hash_almacenado    text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    r                 rc.audit_log%ROWTYPE;
    v_hash_prev       text := repeat('0', 64);
    v_hash_calc       text;
    v_tenant_efectivo uuid;
BEGIN
    v_tenant_efectivo := COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);

    FOR r IN
        SELECT * FROM rc.audit_log
         WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_tenant_efectivo
         ORDER BY secuencia ASC
    LOOP
        IF r.hash_anterior <> v_hash_prev THEN
            secuencia_corrupta := r.secuencia;
            evento_id          := r.id;
            hash_esperado      := v_hash_prev;
            hash_almacenado    := r.hash_anterior;
            RETURN NEXT;
            RETURN;
        END IF;

        v_hash_calc := encode(
            digest(
                rc._payload_audit(
                    r.hash_anterior, v_tenant_efectivo, r.secuencia,
                    r.categoria, r.accion, r.actor_tipo, r.actor_id,
                    r.entidad_tipo, r.entidad_id, r.payload, r.created_at
                ),
                'sha256'
            ),
            'hex'
        );

        IF v_hash_calc <> r.hash_actual THEN
            secuencia_corrupta := r.secuencia;
            evento_id          := r.id;
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

GRANT SELECT, INSERT ON rc.audit_log TO app_user;
GRANT SELECT ON rc.audit_log TO fiscalizador_dt;
GRANT EXECUTE ON FUNCTION rc.registrar_evento TO app_user;
GRANT EXECUTE ON FUNCTION rc.verificar_cadena_audit TO app_user, fiscalizador_dt;
GRANT EXECUTE ON FUNCTION rc._payload_audit TO app_user, fiscalizador_dt;

-- Down Migration

-- ⚠️  ADVERTENCIA: En producción NUNCA ejecutar este down.
-- rc.audit_log es append-only por mandato legal (Res. Ex. 38/2024 DT).
-- Solo usar en desarrollo para resetear el entorno.
DROP TABLE IF EXISTS rc.audit_log CASCADE;
DROP FUNCTION IF EXISTS rc.verificar_cadena_audit(uuid);
DROP FUNCTION IF EXISTS rc.registrar_evento(uuid, rc.audit_categoria, text, rc.audit_actor_tipo, text, text, text, uuid, jsonb, inet, text, text);
DROP FUNCTION IF EXISTS rc.tg_audit_append_only();
DROP FUNCTION IF EXISTS rc._payload_audit(text, uuid, bigint, rc.audit_categoria, text, rc.audit_actor_tipo, text, text, uuid, jsonb, timestamptz);
DROP TYPE IF EXISTS rc.audit_actor_tipo;
DROP TYPE IF EXISTS rc.audit_categoria;
