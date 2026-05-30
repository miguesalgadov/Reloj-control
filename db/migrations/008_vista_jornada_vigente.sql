-- Up Migration
-- =============================================================================
-- 008_vista_jornada_vigente.sql
-- Vista que resuelve, para un par (trabajador, fecha), su jornada pactada.
-- Combina contrato vigente + jornada pactada del dia de semana + tolerancia.
-- Si el trabajador no tiene contrato vigente o no tiene jornada pactada para
-- ese dia, la vista no devuelve fila (= dia no laborable para ese trabajador).
-- =============================================================================

CREATE OR REPLACE VIEW rc.v_jornada_vigente AS
SELECT
    t.id                          AS trabajador_id,
    t.tenant_id,
    c.id                          AS contrato_id,
    c.tipo_contrato,
    c.horas_semanales             AS horas_semanales_pactadas,
    c.permite_horas_extras,
    jp.id                         AS jornada_pactada_id,
    jp.dia_semana,
    jp.hora_inicio,
    jp.hora_termino,
    jp.colacion_inicio,
    jp.colacion_termino,
    jp.tolerancia_minutos         AS tolerancia_override
FROM rc.trabajadores t
JOIN rc.contratos c
    ON c.trabajador_id = t.id
   AND c.tenant_id     = t.tenant_id
   AND c.estado        = 'vigente'
JOIN rc.jornadas_pactadas jp
    ON jp.contrato_id = c.id
   AND jp.tenant_id   = t.tenant_id;

COMMENT ON VIEW rc.v_jornada_vigente IS
'Jornada pactada por dia para cada trabajador con contrato vigente. Se filtra por dia_semana al consumir.';

GRANT SELECT ON rc.v_jornada_vigente TO app_user;
GRANT SELECT ON rc.v_jornada_vigente TO fiscalizador_dt;

-- Nota sobre RLS: las vistas en Postgres NO tienen RLS propio, heredan la
-- RLS de las tablas subyacentes. Como trabajadores, contratos y
-- jornadas_pactadas tienen RLS por tenant_id, la vista hereda ese filtro.


-- Down Migration
DROP VIEW IF EXISTS rc.v_jornada_vigente;
