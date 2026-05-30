-- Up Migration

-- =============================================================================
-- 006_rls_policies.sql
-- Row Level Security: aislamiento real entre tenants a nivel de base de datos.
--
-- Patron:
--   - La API hace SET LOCAL app.tenant_id = '<uuid>' al inicio de cada
--     transaccion, despues de autenticar al usuario.
--   - Cada politica filtra WHERE tenant_id = current_setting('app.tenant_id')::uuid.
--   - Si la API olvida setear el GUC, las queries no devuelven nada (FAIL-SAFE).
--   - Para el rol fiscalizador_dt agregamos politicas adicionales que permiten
--     lectura cross-tenant pero filtradas por app.fiscalizador_tenants (lista
--     de tenants autorizados para la sesion).
--   - admin_migrate tiene BYPASSRLS (ver migracion 001), solo para migraciones
--     y procesos batch del sistema.
--
-- IMPORTANTE: RLS NO aplica al owner de la tabla (postgres/superuser).
-- En produccion, las tablas deben ser owned por admin_migrate y la API conecta
-- como app_user, garantizando que las politicas siempre apliquen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: obtener tenant actual desde GUC. Lanza excepcion si no esta seteado
-- y la app NO esta operando en modo cross-tenant explicito.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rc.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_tenant text;
BEGIN
    -- current_setting con missing_ok=true retorna '' si la variable no existe
    v_tenant := current_setting('app.tenant_id', true);
    IF v_tenant IS NULL OR v_tenant = '' THEN
        RETURN NULL;  -- el filtro RLS lo interpreta como "no acceso"
    END IF;
    RETURN v_tenant::uuid;
END;
$$;

-- Helper para fiscalizador: lista de tenants autorizados en la sesion
CREATE OR REPLACE FUNCTION rc.current_fiscalizador_tenants()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_lista text;
BEGIN
    v_lista := current_setting('app.fiscalizador_tenants', true);
    IF v_lista IS NULL OR v_lista = '' THEN
        RETURN ARRAY[]::uuid[];
    END IF;
    RETURN string_to_array(v_lista, ',')::uuid[];
END;
$$;

GRANT EXECUTE ON FUNCTION rc.current_tenant_id TO app_user, fiscalizador_dt;
GRANT EXECUTE ON FUNCTION rc.current_fiscalizador_tenants TO fiscalizador_dt;

-- =============================================================================
-- TENANTS: caso especial. app_user solo ve SU tenant (filtrado por id = tenant).
-- Fiscalizador puede leer la lista de tenants autorizados.
-- =============================================================================
ALTER TABLE rc.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE rc.tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_app_self ON rc.tenants
    FOR ALL
    TO app_user
    USING (id = rc.current_tenant_id())
    WITH CHECK (id = rc.current_tenant_id());

CREATE POLICY tenants_fiscalizador_read ON rc.tenants
    FOR SELECT
    TO fiscalizador_dt
    USING (id = ANY(rc.current_fiscalizador_tenants()));

-- =============================================================================
-- Macro pattern para tablas tenant-scoped.
-- Aplica la misma logica a usuarios, trabajadores, centros, contratos, etc.
-- =============================================================================
DO $$
DECLARE
    t text;
    tablas text[] := ARRAY[
        'usuarios',
        'centros_trabajo',
        'trabajadores',
        'contratos',
        'jornadas_pactadas',
        'marcaciones',
        'audit_log'
    ];
BEGIN
    FOREACH t IN ARRAY tablas LOOP
        EXECUTE format('ALTER TABLE rc.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('ALTER TABLE rc.%I FORCE ROW LEVEL SECURITY;', t);

        -- Politica para app_user: solo su tenant
        EXECUTE format($p$
            CREATE POLICY %I_app_tenant ON rc.%I
                FOR ALL
                TO app_user
                USING (tenant_id = rc.current_tenant_id())
                WITH CHECK (tenant_id = rc.current_tenant_id())
        $p$, t, t);

        -- Politica para fiscalizador_dt: solo lectura de tenants autorizados
        EXECUTE format($p$
            CREATE POLICY %I_fiscalizador_read ON rc.%I
                FOR SELECT
                TO fiscalizador_dt
                USING (tenant_id = ANY(rc.current_fiscalizador_tenants()))
        $p$, t, t);
    END LOOP;
END
$$;

-- =============================================================================
-- audit_log: politica adicional para eventos globales (tenant_id IS NULL).
-- Solo admin_migrate los ve. app_user y fiscalizador nunca.
-- (La politica anterior los excluye automaticamente porque NULL <> any uuid.)
-- =============================================================================
-- (no requiere politica adicional, el comportamiento por defecto es correcto)

-- =============================================================================
-- Comentario importante para los devs:
-- En NestJS/TypeORM, el interceptor de tenant debe ejecutar al inicio de cada
-- request:
--
--   await queryRunner.query("SET LOCAL app.tenant_id = $1", [user.tenantId]);
--
-- Usar SET LOCAL (no SET) para que aplique solo a la transaccion actual y se
-- limpie al volver al pool. Olvidar esto = 0 filas (fail-safe, no leak).
-- =============================================================================

-- Down Migration

-- Políticas en rc.tenants (definidas explícitamente, no en el DO loop)
DROP POLICY IF EXISTS tenants_app_self          ON rc.tenants;
DROP POLICY IF EXISTS tenants_fiscalizador_read  ON rc.tenants;
ALTER TABLE rc.tenants DISABLE ROW LEVEL SECURITY;

-- Políticas en tablas tenant-scoped (generadas por el DO loop)
DROP POLICY IF EXISTS usuarios_app_tenant              ON rc.usuarios;
DROP POLICY IF EXISTS usuarios_fiscalizador_read        ON rc.usuarios;
ALTER TABLE rc.usuarios DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS centros_trabajo_app_tenant        ON rc.centros_trabajo;
DROP POLICY IF EXISTS centros_trabajo_fiscalizador_read ON rc.centros_trabajo;
ALTER TABLE rc.centros_trabajo DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trabajadores_app_tenant           ON rc.trabajadores;
DROP POLICY IF EXISTS trabajadores_fiscalizador_read    ON rc.trabajadores;
ALTER TABLE rc.trabajadores DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contratos_app_tenant              ON rc.contratos;
DROP POLICY IF EXISTS contratos_fiscalizador_read       ON rc.contratos;
ALTER TABLE rc.contratos DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jornadas_pactadas_app_tenant           ON rc.jornadas_pactadas;
DROP POLICY IF EXISTS jornadas_pactadas_fiscalizador_read    ON rc.jornadas_pactadas;
ALTER TABLE rc.jornadas_pactadas DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marcaciones_app_tenant            ON rc.marcaciones;
DROP POLICY IF EXISTS marcaciones_fiscalizador_read     ON rc.marcaciones;
ALTER TABLE rc.marcaciones DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_app_tenant              ON rc.audit_log;
DROP POLICY IF EXISTS audit_log_fiscalizador_read       ON rc.audit_log;
ALTER TABLE rc.audit_log DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS rc.current_fiscalizador_tenants();
DROP FUNCTION IF EXISTS rc.current_tenant_id();
