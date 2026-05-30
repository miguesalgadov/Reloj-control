-- Up Migration
-- =============================================================================
-- 007_configuracion_jornada.sql
-- Configuracion del Motor de Jornada por tenant. Cada empresa cliente ajusta
-- los parametros operativos (tolerancia de atrasos, mins de colacion, etc.)
-- sin tocar codigo.
-- =============================================================================

CREATE TYPE rc.modo_redondeo AS ENUM ('abajo', 'arriba', 'cercano');

CREATE TABLE rc.configuracion_jornada (
    tenant_id                              uuid        PRIMARY KEY
                                                       REFERENCES rc.tenants(id) ON DELETE CASCADE,

    -- Reglas 1 y 2: atraso de entrada y salida anticipada.
    tolerancia_atraso_minutos              smallint    NOT NULL DEFAULT 5
                                                       CHECK (tolerancia_atraso_minutos BETWEEN 0 AND 60),
    tolerancia_salida_anticipada_minutos   smallint    NOT NULL DEFAULT 5
                                                       CHECK (tolerancia_salida_anticipada_minutos BETWEEN 0 AND 60),

    -- Regla 4: cumplimiento de colacion.
    duracion_minima_colacion_minutos       smallint    NOT NULL DEFAULT 30
                                                       CHECK (duracion_minima_colacion_minutos BETWEEN 0 AND 240),
    duracion_maxima_colacion_minutos       smallint    NOT NULL DEFAULT 90
                                                       CHECK (duracion_maxima_colacion_minutos BETWEEN 0 AND 240),
    colacion_es_imputable_jornada          boolean     NOT NULL DEFAULT false,

    -- Regla 3: inasistencia.
    umbral_inasistencia_sin_marcacion_horas smallint   NOT NULL DEFAULT 2
                                                       CHECK (umbral_inasistencia_sin_marcacion_horas BETWEEN 0 AND 24),

    -- Reglas 5 y 7: jornada extendida y horas extra.
    umbral_jornada_extendida_minutos       smallint    NOT NULL DEFAULT 15
                                                       CHECK (umbral_jornada_extendida_minutos BETWEEN 0 AND 60),
    redondeo_horas_extra_minutos           smallint    NOT NULL DEFAULT 15
                                                       CHECK (redondeo_horas_extra_minutos IN (1, 5, 10, 15, 30, 60)),
    redondeo_horas_extra_modo              rc.modo_redondeo NOT NULL DEFAULT 'abajo',

    -- Configuracion semanal.
    dias_laborables                        smallint[]  NOT NULL DEFAULT ARRAY[1,2,3,4,5]
                                                       CHECK (
                                                           array_length(dias_laborables, 1) BETWEEN 1 AND 7
                                                           AND dias_laborables <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
                                                       ),

    -- Reservado para v2. Columna existe; logica aun no.
    horario_marcaje_anticipado_minutos     smallint    NOT NULL DEFAULT 30
                                                       CHECK (horario_marcaje_anticipado_minutos BETWEEN 0 AND 240),

    -- Coherencia: max colacion >= min colacion.
    CHECK (duracion_maxima_colacion_minutos >= duracion_minima_colacion_minutos),

    created_at                             timestamptz NOT NULL DEFAULT now(),
    updated_at                             timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tg_configuracion_jornada_updated_at
    BEFORE UPDATE ON rc.configuracion_jornada
    FOR EACH ROW EXECUTE FUNCTION rc.tg_set_updated_at();

COMMENT ON TABLE rc.configuracion_jornada IS
'Parametros del Motor de Jornada por tenant. Una fila por empresa cliente.';

-- =============================================================================
-- RLS: misma politica que el resto. App ve solo su tenant; fiscalizador
-- solo tenants autorizados.
-- =============================================================================
ALTER TABLE rc.configuracion_jornada ENABLE ROW LEVEL SECURITY;
ALTER TABLE rc.configuracion_jornada FORCE ROW LEVEL SECURITY;

CREATE POLICY configuracion_jornada_app_tenant ON rc.configuracion_jornada
    FOR ALL
    TO app_user
    USING (tenant_id = rc.current_tenant_id())
    WITH CHECK (tenant_id = rc.current_tenant_id());

CREATE POLICY configuracion_jornada_fiscalizador_read ON rc.configuracion_jornada
    FOR SELECT
    TO fiscalizador_dt
    USING (tenant_id = ANY(rc.current_fiscalizador_tenants()));

GRANT SELECT, INSERT, UPDATE, DELETE ON rc.configuracion_jornada TO app_user;
GRANT SELECT ON rc.configuracion_jornada TO fiscalizador_dt;

-- =============================================================================
-- Seed: filas default para los tenants existentes. Para tenants nuevos en
-- el futuro, la API debe crear esta fila al onboarding (no asumir nulls).
-- =============================================================================
INSERT INTO rc.configuracion_jornada (tenant_id)
SELECT id FROM rc.tenants
ON CONFLICT (tenant_id) DO NOTHING;


-- Down Migration
DROP TABLE IF EXISTS rc.configuracion_jornada CASCADE;
DROP TYPE IF EXISTS rc.modo_redondeo;
