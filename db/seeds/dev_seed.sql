-- =============================================================================
-- 007_seed_demo.sql
-- Datos de demostracion para validar el modelo end-to-end.
-- DOS tenants distintos para probar el aislamiento RLS.
--
-- Tenant A: "Constructora del Sur SpA" (RUT 76.123.456-5)
-- Tenant B: "Servicios InnovaDX Ltda" (RUT 77.234.567-K)
--
-- Cada uno con: 1 admin, 2 trabajadores, 1 centro de trabajo con geocerca,
-- contratos vigentes y jornadas pactadas. Las marcaciones se generan en el
-- script de test (no aqui) para validar la funcion registrar_marcacion.
-- =============================================================================

-- Como esta migracion se ejecuta con admin_migrate (BYPASSRLS), no necesitamos
-- setear app.tenant_id. En produccion los seeds reales corren igual.

-- =============================================================================
-- TENANT A: Constructora del Sur SpA
-- =============================================================================
INSERT INTO rc.tenants (id, rut, razon_social, nombre_fantasia, giro, comuna, region, email_contacto, plan)
VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '76123456-0',
    'Constructora del Sur SpA',
    'Constructora del Sur',
    'Construccion de obras civiles',
    'Concepcion',
    'Biobio',
    'contacto@constructoradelsur.cl',
    'business'
);

-- Centro de trabajo: obra en Concepcion centro (lat -36.8270, lng -73.0498)
INSERT INTO rc.centros_trabajo (id, tenant_id, nombre, direccion, comuna, region, ubicacion, radio_metros)
VALUES (
    'a1111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Obra Plaza Independencia',
    'Plaza Independencia 100',
    'Concepcion',
    'Biobio',
    ST_SetSRID(ST_MakePoint(-73.0498, -36.8270), 4326)::geography,
    150
);

-- Usuario administrador
INSERT INTO rc.usuarios (id, tenant_id, email, password_hash, rol, nombres, apellidos)
VALUES (
    'a2222222-2222-2222-2222-222222222222',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'admin@constructoradelsur.cl',
    '$argon2id$v=19$m=65536,t=3,p=4$placeholder',
    'admin_empresa',
    'Maria',
    'Gonzalez Soto'
);

-- Trabajador 1 (con cuenta de usuario)
INSERT INTO rc.usuarios (id, tenant_id, email, password_hash, rol, nombres, apellidos)
VALUES (
    'a3333333-3333-3333-3333-333333333333',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'juan.perez@constructoradelsur.cl',
    '$argon2id$v=19$m=65536,t=3,p=4$placeholder',
    'trabajador',
    'Juan',
    'Perez Rojas'
);

INSERT INTO rc.trabajadores (id, tenant_id, usuario_id, rut, nombres, apellido_paterno, apellido_materno, centro_trabajo_id, fecha_ingreso)
VALUES (
    'a4444444-4444-4444-4444-444444444444',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'a3333333-3333-3333-3333-333333333333',
    '15876543-8',
    'Juan',
    'Perez',
    'Rojas',
    'a1111111-1111-1111-1111-111111111111',
    '2024-03-15'
);

-- Trabajador 2 (sin cuenta de usuario, solo marca en huellero)
INSERT INTO rc.trabajadores (id, tenant_id, rut, nombres, apellido_paterno, apellido_materno, centro_trabajo_id, fecha_ingreso)
VALUES (
    'a5555555-5555-5555-5555-555555555555',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '16234567-2',
    'Pedro',
    'Soto',
    'Mella',
    'a1111111-1111-1111-1111-111111111111',
    '2024-06-01'
);

-- Contrato para Juan Perez
INSERT INTO rc.contratos (id, tenant_id, trabajador_id, tipo_contrato, cargo, fecha_inicio, horas_semanales, sueldo_base, permite_horas_extras)
VALUES (
    'a6666666-6666-6666-6666-666666666666',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'a4444444-4444-4444-4444-444444444444',
    'indefinido',
    'Maestro carpintero',
    '2024-03-15',
    44.00,
    750000,
    true
);

-- Jornada lunes a viernes 08:00-18:00 con colacion 13:00-14:00 para Juan
INSERT INTO rc.jornadas_pactadas (tenant_id, contrato_id, dia_semana, hora_inicio, hora_termino, colacion_inicio, colacion_termino)
SELECT
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'a6666666-6666-6666-6666-666666666666',
    dia,
    '08:00'::time,
    '18:00'::time,
    '13:00'::time,
    '14:00'::time
FROM generate_series(1, 5) AS dia;

-- =============================================================================
-- TENANT B: Servicios InnovaDX Ltda
-- =============================================================================
INSERT INTO rc.tenants (id, rut, razon_social, giro, comuna, region, email_contacto, plan)
VALUES (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '77234567-4',
    'Servicios InnovaDX Ltda',
    'Servicios tecnologicos',
    'Los Angeles',
    'Biobio',
    'contacto@innovadx.cl',
    'enterprise'
);

INSERT INTO rc.centros_trabajo (id, tenant_id, nombre, direccion, comuna, region, ubicacion, radio_metros)
VALUES (
    'b1111111-1111-1111-1111-111111111111',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'Oficina Central Los Angeles',
    'Av. Alemania 850',
    'Los Angeles',
    'Biobio',
    ST_SetSRID(ST_MakePoint(-72.3539, -37.4697), 4326)::geography,
    50
);

INSERT INTO rc.usuarios (id, tenant_id, email, password_hash, rol, nombres, apellidos)
VALUES (
    'b2222222-2222-2222-2222-222222222222',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'admin@innovadx.cl',
    '$argon2id$v=19$m=65536,t=3,p=4$placeholder',
    'admin_empresa',
    'Carlos',
    'Munoz Vergara'
);

INSERT INTO rc.trabajadores (id, tenant_id, rut, nombres, apellido_paterno, apellido_materno, centro_trabajo_id, fecha_ingreso)
VALUES (
    'b4444444-4444-4444-4444-444444444444',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '17345678-6',
    'Andrea',
    'Lagos',
    'Pino',
    'b1111111-1111-1111-1111-111111111111',
    '2025-01-10'
);

INSERT INTO rc.contratos (id, tenant_id, trabajador_id, tipo_contrato, cargo, fecha_inicio, horas_semanales, sueldo_base, permite_horas_extras)
VALUES (
    'b6666666-6666-6666-6666-666666666666',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'b4444444-4444-4444-4444-444444444444',
    'indefinido',
    'Desarrolladora full-stack',
    '2025-01-10',
    40.00,
    1800000,
    false
);

INSERT INTO rc.jornadas_pactadas (tenant_id, contrato_id, dia_semana, hora_inicio, hora_termino, colacion_inicio, colacion_termino)
SELECT
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'b6666666-6666-6666-6666-666666666666',
    dia,
    '09:00'::time,
    '18:00'::time,
    '13:30'::time,
    '14:30'::time
FROM generate_series(1, 5) AS dia;
