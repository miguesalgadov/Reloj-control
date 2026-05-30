-- Up Migration
-- =============================================================================
-- 009_consolidar_search_path.sql (v3)
--
-- PROPÓSITO:
-- Blindar el search_path de las funciones del schema rc que usan extensiones
-- (pgcrypto, citext) o son SECURITY DEFINER.
--
-- TOLERANCIA DE PLATAFORMA:
-- Esta migración detecta dinámicamente en qué schema viven pgcrypto y citext
-- y construye el search_path adecuado:
--
--   - En Neon: las extensiones quedan en `public` por restricción de la
--     plataforma (las funciones individuales como pgp_sym_decrypt son owned
--     por un rol interno al que neondb_owner no puede asumir; ALTER EXTENSION
--     SET SCHEMA falla con "must be owner of function"). Las funciones del
--     proyecto reciben search_path = rc, public, pg_catalog.
--
--   - En bases creadas con el bootstrap actualizado (Docker local, Postgres
--     self-managed): las extensiones nacen en `extensions`. Las funciones
--     reciben search_path = rc, extensions, pg_catalog.
--
-- La protección contra hijacking de search_path se mantiene en ambos casos
-- porque:
--   1) Postgres 15+ revoca CREATE ON SCHEMA public FROM PUBLIC por defecto.
--   2) En Neon, app_user no tiene CREATE en public.
--   3) public deja de contener cualquier objeto de aplicación (todo vive en rc).
--
-- Si en el futuro Neon habilita ALTER EXTENSION SET SCHEMA, se ejecuta una
-- vez como neondb_owner y esta migración no requiere cambios (detecta el
-- nuevo schema y se readapta).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Detectar schemas reales de pgcrypto y citext, construir search_path
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    schema_pgcrypto    text;
    schema_citext      text;
    schema_extensiones text;
    search_path_dst    text;
BEGIN
    SELECT n.nspname INTO schema_pgcrypto
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'pgcrypto';

    SELECT n.nspname INTO schema_citext
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'citext';

    IF schema_pgcrypto IS NULL THEN
        RAISE EXCEPTION 'pgcrypto no esta instalado. Revisar bootstrap.';
    END IF;
    IF schema_citext IS NULL THEN
        RAISE EXCEPTION 'citext no esta instalado. Revisar bootstrap.';
    END IF;

    -- Las dos extensiones deben coexistir en el mismo schema. Si por alguna
    -- razon estan en schemas distintos, la migracion falla pidiendo
    -- correccion manual (caso raro pero posible si alguien hizo ALTER
    -- EXTENSION a una sola).
    IF schema_pgcrypto <> schema_citext THEN
        RAISE EXCEPTION 'pgcrypto esta en "%" pero citext esta en "%". Mover ambas al mismo schema antes de continuar.',
            schema_pgcrypto, schema_citext;
    END IF;

    schema_extensiones := schema_pgcrypto;
    search_path_dst := format('rc, %I, pg_catalog', schema_extensiones);

    RAISE NOTICE 'Detectado schema de extensiones: %', schema_extensiones;
    RAISE NOTICE 'Aplicando search_path = % a las funciones del schema rc', search_path_dst;

    -- Asegurar USAGE para los roles. En Neon (schema=public) ya esta concedido.
    -- En el resto, lo otorga el bootstrap. Aca defensivo.
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO app_user, fiscalizador_dt, admin_migrate',
        schema_extensiones);

    -- Guardamos el search_path en una variable de sesion para que las sentencias
    -- ALTER FUNCTION que siguen lo usen.
    PERFORM set_config('rc.search_path_extensiones', search_path_dst, true);
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Recrear funciones SECURITY DEFINER con search_path dinamico
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    sp text := current_setting('rc.search_path_extensiones');
BEGIN
    -- buscar_usuario_para_login (SECURITY DEFINER, lee citext)
    EXECUTE format($func$
        CREATE OR REPLACE FUNCTION rc.buscar_usuario_para_login(p_email text)
        RETURNS TABLE (
            id              uuid,
            tenant_id       uuid,
            email           text,
            password_hash   text,
            rol             text,
            estado          text,
            nombres         text,
            apellidos       text,
            trabajador_id   uuid
        )
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = %s
        AS $body$
        BEGIN
            RETURN QUERY
            SELECT
                u.id,
                u.tenant_id,
                u.email::text,
                u.password_hash,
                u.rol,
                u.estado,
                u.nombres,
                u.apellidos,
                (SELECT t.id
                   FROM rc.trabajadores t
                  WHERE t.usuario_id = u.id
                  LIMIT 1)
            FROM rc.usuarios u
            WHERE u.email = p_email::citext
              AND u.estado = 'activo';
        END;
        $body$
    $func$, sp);

    -- registrar_evento_login (SECURITY DEFINER, llama a registrar_evento que usa digest)
    EXECUTE format($func$
        CREATE OR REPLACE FUNCTION rc.registrar_evento_login(
            p_tenant_id   uuid,
            p_email       text,
            p_exitoso     boolean,
            p_actor_id    text,
            p_ip_origen   inet,
            p_user_agent  text
        )
        RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = %s
        AS $body$
        BEGIN
            PERFORM rc.registrar_evento(
                p_tenant_id   := p_tenant_id,
                p_categoria   := 'autenticacion'::rc.audit_categoria,
                p_accion      := CASE WHEN p_exitoso THEN 'login_exitoso' ELSE 'login_fallido' END,
                p_actor_tipo  := 'usuario'::rc.audit_actor_tipo,
                p_actor_id    := p_actor_id,
                p_payload     := jsonb_build_object('email', p_email, 'exitoso', p_exitoso),
                p_ip_origen   := p_ip_origen,
                p_user_agent  := p_user_agent
            );

            IF p_exitoso AND p_actor_id IS NOT NULL THEN
                UPDATE rc.usuarios
                   SET ultimo_login = now()
                 WHERE id = p_actor_id::uuid
                   AND tenant_id = p_tenant_id;
            END IF;
        END;
        $body$
    $func$, sp);
END
$$;

-- -----------------------------------------------------------------------------
-- 3. Blindar search_path en funciones INVOKER que usan extensiones
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    sp text := current_setting('rc.search_path_extensiones');
BEGIN
    EXECUTE format($q$
        ALTER FUNCTION rc.registrar_evento(
            uuid, rc.audit_categoria, text, rc.audit_actor_tipo,
            text, text, text, uuid, jsonb, inet, text, text
        ) SET search_path = %s
    $q$, sp);

    EXECUTE format($q$
        ALTER FUNCTION rc._payload_audit(
            text, uuid, bigint, rc.audit_categoria, text,
            rc.audit_actor_tipo, text, text, uuid, jsonb, timestamptz
        ) SET search_path = %s
    $q$, sp);

    EXECUTE format($q$
        ALTER FUNCTION rc.verificar_cadena_audit(uuid)
            SET search_path = %s
    $q$, sp);

    EXECUTE format($q$
        ALTER FUNCTION rc.registrar_marcacion(
            uuid, uuid, rc.tipo_marcacion, rc.fuente_marcacion,
            uuid, numeric, numeric, numeric, uuid, text, text, inet, text, uuid
        ) SET search_path = %s
    $q$, sp);

    EXECUTE format($q$
        ALTER FUNCTION rc._payload_marcacion(
            text, uuid, bigint, uuid, rc.tipo_marcacion, rc.fuente_marcacion,
            timestamptz, uuid, numeric, numeric, uuid, text
        ) SET search_path = %s
    $q$, sp);

    EXECUTE format($q$
        ALTER FUNCTION rc.verificar_cadena_hash(uuid)
            SET search_path = %s
    $q$, sp);
END
$$;

-- -----------------------------------------------------------------------------
-- 4. Guard: validar que ninguna funcion definer en rc quedo sin search_path
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    funcion_problematica record;
    contador integer := 0;
BEGIN
    FOR funcion_problematica IN
        SELECT p.proname, p.proconfig
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'rc'
           AND p.prosecdef = true
           AND (
               p.proconfig IS NULL
               OR NOT EXISTS (
                   SELECT 1 FROM unnest(p.proconfig) cfg
                   WHERE cfg LIKE 'search_path=%'
               )
           )
    LOOP
        contador := contador + 1;
        RAISE WARNING 'Funcion definer sin search_path explicito: rc.% (config: %)',
            funcion_problematica.proname, funcion_problematica.proconfig;
    END LOOP;

    IF contador > 0 THEN
        RAISE EXCEPTION 'Migracion 009 incompleta: % funcion(es) definer sin search_path explicito.',
            contador;
    END IF;

    RAISE NOTICE '=== Migracion 009 completada. Todas las funciones definer tienen search_path explicito. ===';
END
$$;


-- Down Migration
-- =============================================================================
-- Revierte el search_path explicito de todas las funciones afectadas.
-- Las funciones definer quedan con un search_path razonable (rc, public,
-- pg_catalog) para no romper su funcionamiento; las invoker quedan con
-- search_path heredado del invocador (RESET).
-- =============================================================================

ALTER FUNCTION rc.buscar_usuario_para_login(text)
    SET search_path = rc, public, pg_catalog;

ALTER FUNCTION rc.registrar_evento_login(uuid, text, boolean, text, inet, text)
    SET search_path = rc, public, pg_catalog;

ALTER FUNCTION rc.registrar_evento(
    uuid, rc.audit_categoria, text, rc.audit_actor_tipo,
    text, text, text, uuid, jsonb, inet, text, text
) RESET search_path;

ALTER FUNCTION rc._payload_audit(
    text, uuid, bigint, rc.audit_categoria, text,
    rc.audit_actor_tipo, text, text, uuid, jsonb, timestamptz
) RESET search_path;

ALTER FUNCTION rc.verificar_cadena_audit(uuid) RESET search_path;

ALTER FUNCTION rc.registrar_marcacion(
    uuid, uuid, rc.tipo_marcacion, rc.fuente_marcacion,
    uuid, numeric, numeric, numeric, uuid, text, text, inet, text, uuid
) RESET search_path;

ALTER FUNCTION rc._payload_marcacion(
    text, uuid, bigint, uuid, rc.tipo_marcacion, rc.fuente_marcacion,
    timestamptz, uuid, numeric, numeric, uuid, text
) RESET search_path;

ALTER FUNCTION rc.verificar_cadena_hash(uuid) RESET search_path;
