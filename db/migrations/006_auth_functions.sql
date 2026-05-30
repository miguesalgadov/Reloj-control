-- Up Migration
-- =============================================================================
-- 006_auth_functions.sql
-- Funciones SECURITY DEFINER para el flujo de autenticacion.
--
-- POR QUE SE NECESITAN:
-- El endpoint de login NO conoce el tenant cuando el usuario manda email +
-- password. RLS, por defecto, devuelve 0 filas sin app.tenant_id seteado. Una
-- funcion SECURITY DEFINER corre con los privilegios del DUENO (postgres en
-- nuestro setup), no del invocador, bypaseando RLS de manera CONTROLADA.
--
-- SEGURIDAD:
-- - search_path explicito (no se puede inyectar via mutating search_path).
-- - La funcion solo retorna las columnas necesarias para login. No se
--   exponen datos completos del usuario.
-- - Solo se otorga EXECUTE a app_user. Sin acceso directo a usuarios desde
--   esta ruta privilegiada.
-- =============================================================================

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
SET search_path = rc, public, pg_catalog
AS $$
BEGIN
    -- Email es unico por (tenant, email). En MVP asumimos que el email
    -- identifica univocamente al usuario; si dos tenants comparten email,
    -- retornariamos multiples filas y la API rechazaria con "ambiguo".
    -- En version futura: incluir slug de empresa en el login.
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
$$;

COMMENT ON FUNCTION rc.buscar_usuario_para_login IS
'SECURITY DEFINER: usado por el endpoint de login antes de conocer el tenant. Bypasea RLS controladamente.';

GRANT EXECUTE ON FUNCTION rc.buscar_usuario_para_login(text) TO app_user;

-- =============================================================================
-- Funcion auxiliar: registrar login exitoso o fallido en audit_log.
-- Tambien SECURITY DEFINER porque se llama antes/durante login (sin tenant
-- en el contexto de sesion). Pero recibe explicitamente el tenant_id como
-- parametro para evitar abuso.
-- =============================================================================
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
SET search_path = rc, pg_catalog
AS $$
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

    -- Actualizar ultimo_login si fue exitoso
    IF p_exitoso AND p_actor_id IS NOT NULL THEN
        UPDATE rc.usuarios
           SET ultimo_login = now()
         WHERE id = p_actor_id::uuid
           AND tenant_id = p_tenant_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION rc.registrar_evento_login TO app_user;


-- Down Migration
-- =============================================================================
-- ATENCION: en produccion no corras este down si ya hay eventos de login
-- registrados — los necesitas para auditoria.
-- =============================================================================
DROP FUNCTION IF EXISTS rc.registrar_evento_login(uuid, text, boolean, text, inet, text);
DROP FUNCTION IF EXISTS rc.buscar_usuario_para_login(text);
