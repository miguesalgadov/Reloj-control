-- Up Migration

-- =============================================================================
-- 002_core_tables.sql
-- Tablas centrales: tenants (empresas clientes), usuarios, trabajadores,
-- centros de trabajo con geocercas.
--
-- Convenciones:
--   - PKs siempre uuid (gen_random_uuid()) para evitar enumeracion y permitir
--     generacion client-side si se requiere offline-first en la app movil.
--   - tenant_id en TODAS las tablas tenant-scoped. Es la columna sobre la
--     cual aplica RLS.
--   - created_at/updated_at en timestamptz, default now() (UTC por el ALTER
--     DATABASE de la migracion 001).
--   - Nombres en castellano para alinear con el dominio legal chileno
--     (terminos del Codigo del Trabajo) y porque la Res. Ex. 38 exige
--     terminologia tecnica chilena.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funcion utilitaria: validador de RUT chileno (digito verificador modulo 11).
-- Acepta formato con o sin puntos y con guion. Retorna true si es valido.
-- Es funcion IMMUTABLE para poder usarla en CHECK constraints e indices.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rc.es_rut_valido(rut text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    rut_limpio text;
    cuerpo     text;
    dv_dado    char;
    suma       integer := 0;
    multiplo   integer := 2;
    i          integer;
    resto      integer;
    dv_calc    char;
BEGIN
    -- Normalizar: quitar puntos, guiones, espacios; pasar a mayuscula
    rut_limpio := upper(regexp_replace(rut, '[^0-9kK]', '', 'g'));

    IF length(rut_limpio) < 2 OR length(rut_limpio) > 9 THEN
        RETURN false;
    END IF;

    cuerpo  := substring(rut_limpio FROM 1 FOR length(rut_limpio) - 1);
    dv_dado := substring(rut_limpio FROM length(rut_limpio) FOR 1);

    IF cuerpo !~ '^[0-9]+$' THEN
        RETURN false;
    END IF;

    -- Calculo digito verificador modulo 11 (algoritmo SII)
    FOR i IN REVERSE length(cuerpo)..1 LOOP
        suma := suma + (substring(cuerpo FROM i FOR 1)::integer * multiplo);
        multiplo := multiplo + 1;
        IF multiplo > 7 THEN
            multiplo := 2;
        END IF;
    END LOOP;

    resto := 11 - (suma % 11);
    dv_calc := CASE resto
        WHEN 11 THEN '0'
        WHEN 10 THEN 'K'
        ELSE resto::text
    END;

    RETURN dv_dado = dv_calc;
END;
$$;

COMMENT ON FUNCTION rc.es_rut_valido(text) IS
'Valida RUT chileno con algoritmo modulo 11 del SII. Acepta con/sin puntos y guion.';

-- -----------------------------------------------------------------------------
-- Funcion utilitaria: normalizar RUT a formato canonico "12345678-9".
-- Sirve para almacenar siempre en el mismo formato y evitar duplicados.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rc.normalizar_rut(rut text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    rut_limpio text;
BEGIN
    rut_limpio := upper(regexp_replace(rut, '[^0-9kK]', '', 'g'));
    IF length(rut_limpio) < 2 THEN
        RETURN NULL;
    END IF;
    RETURN substring(rut_limpio FROM 1 FOR length(rut_limpio) - 1)
        || '-'
        || substring(rut_limpio FROM length(rut_limpio) FOR 1);
END;
$$;

-- -----------------------------------------------------------------------------
-- Trigger generico para mantener updated_at sincronizado.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rc.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- =============================================================================
-- TENANTS: empresas clientes del SaaS.
-- No tiene tenant_id (es la raiz). RLS no aplica aqui (todos los tenants
-- conviven en la tabla, el acceso se controla por permisos a nivel de rol y
-- por el filtro de la API).
-- =============================================================================
CREATE TABLE rc.tenants (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    rut             text        NOT NULL UNIQUE
                                CHECK (rc.es_rut_valido(rut)),
    razon_social    text        NOT NULL,
    nombre_fantasia text,
    giro            text,
    direccion       text,
    comuna          text,
    region          text,
    telefono        text,
    email_contacto  citext,
    -- Estado comercial del cliente
    estado          text        NOT NULL DEFAULT 'activo'
                                CHECK (estado IN ('activo','suspendido','cancelado','trial')),
    -- Plan contratado (para limites de uso). En MVP solo metadata informativa.
    plan            text        NOT NULL DEFAULT 'starter',
    -- Limite duro de trabajadores (validado en la API)
    limite_trabajadores integer NOT NULL DEFAULT 50,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tg_tenants_updated_at
    BEFORE UPDATE ON rc.tenants
    FOR EACH ROW EXECUTE FUNCTION rc.tg_set_updated_at();

COMMENT ON TABLE rc.tenants IS 'Empresas clientes del SaaS. Cada tenant es una empresa con su propio espacio de datos aislado por RLS.';

-- =============================================================================
-- USUARIOS: identidades autenticables. Pueden ser personal de la empresa
-- (admin_empresa, supervisor) o trabajadores con acceso al portal.
-- Los fiscalizadores DT viven en una tabla aparte (proxima migracion) porque
-- son cross-tenant y tienen un flujo de provisioning distinto.
-- =============================================================================
CREATE TABLE rc.usuarios (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid        NOT NULL REFERENCES rc.tenants(id) ON DELETE RESTRICT,
    email           citext      NOT NULL,
    -- Hash bcrypt/argon2id. La API decide cual; aqui solo guardamos el string.
    password_hash   text        NOT NULL,
    -- Roles posibles en MVP. Para granularidad fina, agregar tabla rc.permisos
    -- y rc.usuario_permisos en fases posteriores.
    rol             text        NOT NULL
                                CHECK (rol IN ('admin_empresa','supervisor','trabajador')),
    nombres         text        NOT NULL,
    apellidos       text        NOT NULL,
    mfa_enabled     boolean     NOT NULL DEFAULT false,
    mfa_secret      text,
    estado          text        NOT NULL DEFAULT 'activo'
                                CHECK (estado IN ('activo','suspendido','bloqueado')),
    ultimo_login    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- Email unico POR tenant (dos empresas distintas pueden tener el mismo email)
    UNIQUE (tenant_id, email)
);

CREATE INDEX idx_usuarios_tenant ON rc.usuarios(tenant_id);
CREATE INDEX idx_usuarios_email ON rc.usuarios(email);

CREATE TRIGGER tg_usuarios_updated_at
    BEFORE UPDATE ON rc.usuarios
    FOR EACH ROW EXECUTE FUNCTION rc.tg_set_updated_at();

-- =============================================================================
-- CENTROS_TRABAJO: ubicaciones fisicas con geocerca.
-- Usamos geography (no geometry) para que las distancias salgan en metros
-- directamente (calculo geodesico). Para Chile con sus dimensiones esto es
-- mas que suficiente y mas comodo que proyectar.
-- =============================================================================
CREATE TABLE rc.centros_trabajo (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid        NOT NULL REFERENCES rc.tenants(id) ON DELETE RESTRICT,
    nombre          text        NOT NULL,
    codigo          text,      -- codigo interno opcional de la empresa
    direccion       text        NOT NULL,
    comuna          text        NOT NULL,
    region          text        NOT NULL,
    -- Punto central del centro de trabajo (lat, lng en WGS84)
    ubicacion       geography(POINT, 4326) NOT NULL,
    -- Radio de la geocerca circular en metros. Si se requieren poligonos
    -- complejos, agregar columna ubicacion_poligono y validar contra ambas.
    radio_metros    integer     NOT NULL DEFAULT 100
                                CHECK (radio_metros BETWEEN 10 AND 5000),
    estado          text        NOT NULL DEFAULT 'activo'
                                CHECK (estado IN ('activo','inactivo')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, nombre)
);

CREATE INDEX idx_centros_trabajo_tenant ON rc.centros_trabajo(tenant_id);
-- Indice GIST sobre la geografia para queries espaciales rapidas (ST_DWithin).
CREATE INDEX idx_centros_trabajo_ubicacion ON rc.centros_trabajo USING GIST (ubicacion);

CREATE TRIGGER tg_centros_trabajo_updated_at
    BEFORE UPDATE ON rc.centros_trabajo
    FOR EACH ROW EXECUTE FUNCTION rc.tg_set_updated_at();

-- =============================================================================
-- TRABAJADORES: dependientes con contrato. Pueden o no tener cuenta de
-- usuario (un operario puede marcar solo en huellero sin acceso al portal).
-- =============================================================================
CREATE TABLE rc.trabajadores (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid        NOT NULL REFERENCES rc.tenants(id) ON DELETE RESTRICT,
    -- usuario_id opcional: no todos los trabajadores tienen portal.
    usuario_id          uuid        REFERENCES rc.usuarios(id) ON DELETE SET NULL,
    rut                 text        NOT NULL
                                    CHECK (rc.es_rut_valido(rut)),
    nombres             text        NOT NULL,
    apellido_paterno    text        NOT NULL,
    apellido_materno    text,
    fecha_nacimiento    date,
    nacionalidad        text        DEFAULT 'Chilena',
    email               citext,
    telefono            text,
    -- Centro de trabajo principal asignado. Para multi-centro extender con
    -- tabla rc.trabajador_centros (N:N) en una fase posterior.
    centro_trabajo_id   uuid        REFERENCES rc.centros_trabajo(id),
    fecha_ingreso       date        NOT NULL,
    fecha_termino       date,
    estado              text        NOT NULL DEFAULT 'activo'
                                    CHECK (estado IN ('activo','licencia','vacaciones','desvinculado')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    -- RUT unico por tenant (dos empresas distintas pueden tener al mismo RUT
    -- como trabajador de cada una; eso es valido en Chile).
    UNIQUE (tenant_id, rut)
);

CREATE INDEX idx_trabajadores_tenant ON rc.trabajadores(tenant_id);
CREATE INDEX idx_trabajadores_centro ON rc.trabajadores(centro_trabajo_id);
CREATE INDEX idx_trabajadores_usuario ON rc.trabajadores(usuario_id);
CREATE INDEX idx_trabajadores_rut ON rc.trabajadores(tenant_id, rut);

CREATE TRIGGER tg_trabajadores_updated_at
    BEFORE UPDATE ON rc.trabajadores
    FOR EACH ROW EXECUTE FUNCTION rc.tg_set_updated_at();

-- =============================================================================
-- Permisos granulares por tabla.
-- app_user: SELECT/INSERT/UPDATE/DELETE en operacion normal (RLS filtra).
-- fiscalizador_dt: SOLO SELECT (cross-tenant, mediado por RLS especifico).
-- =============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON rc.tenants TO app_user;
GRANT SELECT ON rc.tenants TO fiscalizador_dt;

GRANT SELECT, INSERT, UPDATE, DELETE ON rc.usuarios TO app_user;
GRANT SELECT ON rc.usuarios TO fiscalizador_dt;

GRANT SELECT, INSERT, UPDATE, DELETE ON rc.centros_trabajo TO app_user;
GRANT SELECT ON rc.centros_trabajo TO fiscalizador_dt;

GRANT SELECT, INSERT, UPDATE, DELETE ON rc.trabajadores TO app_user;
GRANT SELECT ON rc.trabajadores TO fiscalizador_dt;

-- Down Migration

DROP TABLE IF EXISTS rc.trabajadores     CASCADE;
DROP TABLE IF EXISTS rc.centros_trabajo  CASCADE;
DROP TABLE IF EXISTS rc.usuarios         CASCADE;
DROP TABLE IF EXISTS rc.tenants          CASCADE;
DROP FUNCTION IF EXISTS rc.tg_set_updated_at();
DROP FUNCTION IF EXISTS rc.normalizar_rut(text);
DROP FUNCTION IF EXISTS rc.es_rut_valido(text);
