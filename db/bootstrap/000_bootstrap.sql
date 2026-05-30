-- =============================================================================
-- 000_bootstrap.sql
-- BOOTSTRAP: se ejecuta UNA VEZ por base de datos, como SUPERUSUARIO.
-- En local lo corre automaticamente docker-compose (carpeta initdb.d).
-- En produccion lo corre el DBA / script de aprovisionamiento privilegiado.
--
-- NO es una migracion versionada. No pasa por el runner. Crea las
-- precondiciones que las migraciones asumen: extensiones, roles, schemas.
--
-- CONVENCION DE SCHEMAS (ver docs/convenciones-bd.md):
--   - public:     vacio en runtime. PostGIS lo usa internamente porque no
--                 soporta ALTER EXTENSION SET SCHEMA.
--   - extensions: pgcrypto, citext. Aisladas para que funciones SECURITY
--                 DEFINER puedan referenciarlas con search_path acotado y
--                 sin exponer public.
--   - rc:         schema de la aplicacion (tablas, tipos, funciones).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schemas
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS rc AUTHORIZATION CURRENT_USER;

-- -----------------------------------------------------------------------------
-- Extensiones
-- -----------------------------------------------------------------------------
-- pgcrypto y citext: en schema extensions (aislado).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext   WITH SCHEMA extensions;

-- PostGIS: en public, por limitacion de la propia extension. Documentado.
CREATE EXTENSION IF NOT EXISTS postgis;

-- -----------------------------------------------------------------------------
-- Roles de permisos (NOLOGIN). No se conectan directamente; se asumen via
-- SET ROLE o membresia.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiscalizador_dt') THEN
        CREATE ROLE fiscalizador_dt NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_migrate') THEN
        CREATE ROLE admin_migrate NOLOGIN BYPASSRLS;
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Rol de LOGIN de la aplicacion. Miembro de app_user; la API hace
-- `SET LOCAL ROLE app_user` por transaccion para que RLS aplique.
--
-- CAMBIA LA CLAVE antes de cualquier despliegue. En produccion usa un secreto
-- gestionado.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_login') THEN
        CREATE ROLE app_login LOGIN PASSWORD 'cambiar_esta_clave' IN ROLE app_user;
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Permisos sobre schemas
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA rc         TO app_user, fiscalizador_dt, admin_migrate;
GRANT USAGE ON SCHEMA extensions TO app_user, fiscalizador_dt, admin_migrate;
GRANT CREATE ON SCHEMA rc        TO admin_migrate;

-- Default privileges: cualquier objeto creado a futuro en rc otorga acceso
-- total a admin_migrate automaticamente.
ALTER DEFAULT PRIVILEGES IN SCHEMA rc GRANT ALL ON TABLES TO admin_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA rc GRANT ALL ON SEQUENCES TO admin_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA rc GRANT EXECUTE ON FUNCTIONS TO admin_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA rc GRANT USAGE ON TYPES TO admin_migrate;

-- Timezone a nivel de base. UTC interno; conversion a hora local solo en
-- queries de presentacion.
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO ''UTC''', current_database());
END
$$;
