-- Up Migration

-- =============================================================================
-- 003_contratos_jornadas.sql
-- Contratos de trabajo y jornadas pactadas semanales.
--
-- Modelado conservador para MVP:
--   - Un contrato vigente por trabajador a la vez (en la realidad pueden
--     existir mas, pero para MVP basta).
--   - Jornada semanal modelada como filas dia-de-semana con horas inicio/fin
--     y colacion. El Motor de Jornada (proximo modulo) leera de aqui para
--     calcular cumplimiento, atrasos, etc.
--   - Para sistemas excepcionales (turnos rotativos, 4x4, etc.) en una fase
--     posterior agregar tabla rc.turnos_excepcionales con autorizacion DT.
-- =============================================================================

CREATE TABLE rc.contratos (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid        NOT NULL REFERENCES rc.tenants(id) ON DELETE RESTRICT,
    trabajador_id       uuid        NOT NULL REFERENCES rc.trabajadores(id) ON DELETE RESTRICT,
    tipo_contrato       text        NOT NULL
                                    CHECK (tipo_contrato IN (
                                        'indefinido',
                                        'plazo_fijo',
                                        'obra_faena',
                                        'parcial',
                                        'aprendizaje'
                                    )),
    cargo               text        NOT NULL,
    fecha_inicio        date        NOT NULL,
    fecha_termino       date,
    -- Horas semanales pactadas. Por Ley 21.561 el maximo legal hoy es 44h
    -- (baja gradual a 40h hasta 2028). Validamos rango razonable.
    horas_semanales     numeric(4,2) NOT NULL
                                    CHECK (horas_semanales > 0 AND horas_semanales <= 60),
    sueldo_base         numeric(12,0),  -- en pesos chilenos, sin decimales
    -- Tipo de jornada para reglas del Motor de Jornada
    tipo_jornada        text        NOT NULL DEFAULT 'ordinaria'
                                    CHECK (tipo_jornada IN (
                                        'ordinaria',
                                        'parcial',
                                        'excepcional',
                                        'sin_fiscalizacion'
                                    )),
    -- Pacto de horas extras vigente (art. 32). En MVP solo flag; en fase
    -- posterior tabla rc.pactos_horas_extras con vigencia y limites.
    permite_horas_extras boolean    NOT NULL DEFAULT false,
    estado              text        NOT NULL DEFAULT 'vigente'
                                    CHECK (estado IN ('vigente','terminado','anulado')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (fecha_termino IS NULL OR fecha_termino >= fecha_inicio)
);

CREATE INDEX idx_contratos_tenant ON rc.contratos(tenant_id);
CREATE INDEX idx_contratos_trabajador ON rc.contratos(trabajador_id);
CREATE INDEX idx_contratos_vigentes ON rc.contratos(tenant_id, trabajador_id)
    WHERE estado = 'vigente';

CREATE TRIGGER tg_contratos_updated_at
    BEFORE UPDATE ON rc.contratos
    FOR EACH ROW EXECUTE FUNCTION rc.tg_set_updated_at();

-- =============================================================================
-- JORNADAS_PACTADAS: detalle por dia de semana del contrato.
-- Una fila por cada dia laborable. Dias no incluidos se asumen libres.
-- =============================================================================
CREATE TABLE rc.jornadas_pactadas (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid        NOT NULL REFERENCES rc.tenants(id) ON DELETE RESTRICT,
    contrato_id         uuid        NOT NULL REFERENCES rc.contratos(id) ON DELETE CASCADE,
    -- 1=lunes, 2=martes ... 7=domingo (estandar ISO)
    dia_semana          smallint    NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
    hora_inicio         time        NOT NULL,
    hora_termino        time        NOT NULL,
    -- Colacion opcional. Si la jornada es continua < 6 horas no es obligatoria
    -- (art. 34). Validacion mas fina en el Motor de Jornada.
    colacion_inicio     time,
    colacion_termino    time,
    -- Minutos de tolerancia para no marcar atraso (configurable por empresa)
    tolerancia_minutos  smallint    NOT NULL DEFAULT 5
                                    CHECK (tolerancia_minutos BETWEEN 0 AND 30),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (contrato_id, dia_semana),
    -- Coherencia: termino > inicio, colacion dentro de la jornada
    CHECK (hora_termino > hora_inicio),
    CHECK (
        (colacion_inicio IS NULL AND colacion_termino IS NULL)
        OR (
            colacion_inicio IS NOT NULL
            AND colacion_termino IS NOT NULL
            AND colacion_termino > colacion_inicio
            AND colacion_inicio >= hora_inicio
            AND colacion_termino <= hora_termino
        )
    )
);

CREATE INDEX idx_jornadas_pactadas_tenant ON rc.jornadas_pactadas(tenant_id);
CREATE INDEX idx_jornadas_pactadas_contrato ON rc.jornadas_pactadas(contrato_id);

CREATE TRIGGER tg_jornadas_pactadas_updated_at
    BEFORE UPDATE ON rc.jornadas_pactadas
    FOR EACH ROW EXECUTE FUNCTION rc.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON rc.contratos TO app_user;
GRANT SELECT ON rc.contratos TO fiscalizador_dt;
GRANT SELECT, INSERT, UPDATE, DELETE ON rc.jornadas_pactadas TO app_user;
GRANT SELECT ON rc.jornadas_pactadas TO fiscalizador_dt;

-- Down Migration

DROP TABLE IF EXISTS rc.jornadas_pactadas CASCADE;
DROP TABLE IF EXISTS rc.contratos         CASCADE;
