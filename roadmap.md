# Roadmap del Proyecto

> **Propósito:** Mapa maestro del desarrollo de la plataforma. Este
> documento sobrevive a conversaciones y reemplazos de herramientas. Si
> entrás al proyecto sin contexto previo (humano o IA), empezá leyendo
> este archivo.
> **Última actualización:** 2026-06-05.

---

## Cómo leer este documento

Cada **Paso** es una unidad de trabajo cerrada con sus criterios de
aceptación, su documento de diseño cuando aplica, y un estado:

- 🟢 **Completado** — implementado, validado, mergeado.
- 🟡 **En progreso** — diseño cerrado, implementación en curso o
  pendiente de Claude Code.
- ⚪ **Pendiente** — no diseñado todavía.
- 🔵 **Continuo** — actividad permanente, no termina nunca.

Los pasos numerados (1-4) son trabajo de bootstrap inicial. Los pasos
con letra (A, B, C…) son el orden definido tras cerrar el bootstrap.

---

## Estado actual

**Última actividad:** cierre del Paso E. Backend completo — la API puede
operar una empresa piloto sin asistencia técnica.
**Próximo paso:** Paso G (frontend admin) o pausa estratégica para mostrar
al cliente piloto antes de invertir en UI.
**Tests vigentes:** 160 e2e + 131 unitarios + 5 SQL — todos verdes.
**Repositorio:** GitHub privado.
**Plataforma BD:** Neon (Postgres serverless).

---

## Pasos completados

### 1 — Modelo de datos 🟢

Migraciones 001-005 + bootstrap. Tablas core, RLS multi-tenant, cadena
hash append-only en `marcaciones` y `audit_log`, funciones canónicas de
payload, vistas auxiliares.

**Artefactos:** `db/migrations/001-005`, `db/bootstrap/000_bootstrap.sql`,
seed demo, tests funcionales SQL.

### 2 — Esqueleto NestJS 🟢

Estructura del proyecto, `package.json` con NestJS 10 + pg + argon2 +
class-validator. Configuración de TypeScript, ESLint, Docker. Repo
inicializado.

**Artefactos:** estructura `src/`, Docker Compose con Postgres+PostGIS.

### 3 — Vertical slice login + marcaje 🟢

Endpoint `POST /auth/login` con JWT + argon2, `POST /marcaciones`
llamando a `rc.registrar_marcacion` a través del `TenantInterceptor`,
`GET /marcaciones/mias` con RLS aplicado, health check.

**Artefactos:** módulos `auth`, `marcaciones`, `health`, interceptor
de tenant.

### 3-bis — Tests e2e 🟢

Infraestructura completa de testing e2e con Jest + Supertest, suite de
33 tests cubriendo autenticación, marcaje, listado, aislamiento RLS,
inmutabilidad append-only.

**Artefactos:** `test/`, `jest-e2e.config.js`, helpers de base de datos
de test.

### 4 — Motor de Jornada v1 🟢

Evaluador de 7 reglas básicas (atraso, salida anticipada, inasistencia,
colación, horas trabajadas, semanales, extra). Endpoints `/jornadas/hoy`,
`/jornadas/:fecha`, `/jornadas/semana/:inicio`. Configuración por tenant
en `rc.configuracion_jornada` con endpoint `PATCH /configuracion/jornada`.

**Artefactos:** [`docs/motor-jornada.md`](./motor-jornada.md) (referencia
histórica), módulos `jornada` y `configuracion`, 53 tests unitarios del
evaluador, 12 tests e2e.

### A — Consolidación search_path 🟢

Resolución de deuda técnica: todas las funciones `SECURITY DEFINER` y las
que usan extensiones tienen `search_path` explícito. Tolerante a la
plataforma (Neon vs self-managed).

**Decisión registrada:** las extensiones quedan en `public` en Neon por
limitación de plataforma (ver `docs/convenciones-bd.md` §1.4). El código
funciona idénticamente en ambos casos.

**Artefactos:** migración 009, [`docs/convenciones-bd.md`](./convenciones-bd.md),
[`docs/operaciones-bd.md`](./operaciones-bd.md).

---

## ✅ Pasos completados — corto plazo: API operable

**Estado:** COMPLETADO con el cierre del Paso E (2026-06-05).
**Objetivo cumplido:** la API puede operar una empresa piloto sin asistencia
técnica. Todos los Pasos B–E están cerrados y mergeados en `main`.

### B — CRUD del admin de empresa 🟢

Endpoints de gestión para que un `admin_empresa` pueda dar de alta y
mantener trabajadores, contratos, jornadas, centros de trabajo y
usuarios sin SQL manual.

**Alcance:** ver [`docs/paso-b-crud-admin.md`](./paso-b-crud-admin.md).

**Fecha de cierre:** 2026-06-01.

**Artefactos:** módulos `src/usuarios`, `src/trabajadores`, `src/centros`,
`src/contratos` (incluye jornadas pactadas).

**Métricas:** 91 tests e2e + 80 tests unitarios — todos verdes.

**Commit:** `a92ff7d`.

### C — Endpoints de supervisor 🟢

Lectura agregada para que un `supervisor` pueda monitorear su gente:
quién marcó hoy, quién no, atrasos del día, jornadas de la semana.

**Fecha de cierre:** 2026-06-03.

**Artefactos:** módulo `src/supervision` (controller, service, repository,
DTOs). Refactor de `JornadaService.evaluarSemanaParaTrabajador`.

**Métricas:** 109 tests e2e + 98 tests unitarios — todos verdes.

**Commit:** `dc5f949`.

### D — Reportes mensuales 🟢

Reportes exportables (JSON + XLSX) para liquidación de sueldos y
revisión DT: asistencia, atrasos acumulados, horas extra, ausencias.

**Fecha de cierre:** 2026-06-03.

**Artefactos:** módulo `src/reportes/` con 4 reportes (asistencia mensual
detallada, resumen trabajadores, resumen centros, libro de asistencia
formato DT). Generación JSON + XLSX vía ExcelJS. Dependencia nueva: `exceljs`.

**Métricas:** 124 tests e2e + 112 tests unitarios — todos verdes.

**Commit:** `44b6bc8`.

**Notas:** 3 bugs operativos encontrados y resueltos durante implementación:
path param con `ñ` no válido en Express (renombrado a `anio`), `@IsUUID()`
de class-validator/validator.js v13 más estricto de lo esperado (reemplazado
por `@Matches(UUID_RE)`), manejo de zona horaria `America/Santiago` en
comparación de fechas en tests de integración.

### E — Ajustes administrativos de marcaciones 🟢

3 sub-tipos (creacion, correccion, anulacion) con trazabilidad legal
completa, cadena hash íntegra y propagación a evaluador, reportes y
supervisión.

**Fecha de cierre:** 2026-06-03.

**Artefactos:**
- `src/ajustes/` — módulo completo (3 endpoints: POST, GET list, GET detalle).
- `src/jornada/evaluator/marcaciones-efectivas.ts` — función pura compartida.
- `src/common/validators/uuid.ts` — constante `UUID_RE`.
- Migración `010_marcaciones_ajuste.sql` — columna `datos_ajuste`, constraints
  `marc_ajuste_*` actualizados, función `rc.registrar_ajuste()` con cadena hash.
- Actualizaciones a `src/jornada/`, `src/reportes/`, `src/supervision/` para
  usar `obtenerMarcacionesEfectivas()` en todos los flujos de evaluación.

**Métricas:** 160 tests e2e + 131 tests unitarios — todos verdes.

**Commit range:** `55bd83b..4fd5b66`.

**Notas:** 2 bugs silenciosos encontrados y corregidos durante implementación
(Bloques 5 y 6): las correcciones devueltas por `obtenerMarcacionesEfectivas()`
tenían `tipo='ajuste'` en lugar de heredar el tipo de la original, por lo que
el evaluador, los reportes y la supervisión las descartaban sin error visible.
Corregido con `{ ...correccion, tipo: orig.tipo }`. Patrón obligatorio
documentado en [`docs/paso-e-ajustes-administrativos.md`](./paso-e-ajustes-administrativos.md)
§6.4 y §12.

---

## Pasos pendientes — mediano plazo: producto vendible

**Objetivo del bloque:** convertir la API en un producto comercializable
con UI completa y onboarding self-service.

### F — Frontend del trabajador (mobile-first) ⚪

Web app responsive: login, ver jornada del día, marcar entrada/salida/
colación con captura de GPS, consultar marcaciones recientes. Reemplaza
el huellero físico en el MVP.

**Stack a definir:** Next.js o Vite + React. Inclinación: Next.js por
SSR/SEO y compatibilidad con futuro panel admin.

**Tamaño estimado:** 2-3 sesiones.

### G — Frontend del admin de empresa ⚪

Dashboard con gestión completa: trabajadores, contratos, jornadas, centros
con mapa para geocerca, reportes, ajustes administrativos.

**Tamaño estimado:** 4-6 sesiones (pieza más grande del frontend).

### H — Notificaciones ⚪

Mailer service (SMTP), plantillas, primeros casos: inasistencia presunta,
marcaje fuera de geocerca repetido, reset de password.

**Decisión a tomar:** ¿qué proveedor SMTP? (Sendgrid, AWS SES, Resend,
Mailgun). Costo vs features.

**Tamaño estimado:** 2 sesiones.

### I — Onboarding self-service de empresa ⚪

Flujo de alta de tenant: registro, pago, configuración del primer admin,
listo para operar. Incluye integración con pasarela de pago.

**Decisión a tomar:** ¿pasarela de pago? Webpay vs Flow vs Stripe en Chile.
Cada uno tiene tradeoffs de costos y experiencia de checkout.

**Tamaño estimado:** 2-3 sesiones.

---

## Pasos pendientes — largo plazo: certificación y escala

### J — Portal del fiscalizador DT ⚪

El rol `fiscalizador_dt` ya está modelado en RLS. Falta el portal de
acceso y los reportes específicos que la DT exige. Audit fuerte de
"qué consultó el fiscalizador".

**Tamaño estimado:** 2 sesiones.

### K — Motor de Jornada v2 (reglas avanzadas) ⚪

Festivos, trabajo nocturno y recargos, sistemas excepcionales (turnos
4x4, 7x7), descanso entre jornadas (art. 38), permisos remunerados,
licencias médicas, feriado legal.

**Tamaño estimado:** 4-6 sesiones distribuidas, no consecutivas. Cada
"familia" de reglas (nocturno, turnos, permisos) puede ser una sesión.

### L — Integración con dispositivos físicos ⚪

Huelleros, lectores faciales, RFID. MQTT sobre TLS. Integración con
marcas chilenas (ZKTeco, Hikvision). Solo cuando un cliente lo pida.

**Tamaño estimado:** 3-4 sesiones.

### M — Proceso formal de certificación DT 🔵

No es código. Trámite con CESMEC, DICTUC u otra entidad acreditada.
4-6 meses calendario.

**Recomendación:** arrancar el contacto inicial **ya**, en paralelo con
desarrollo. Pregunta de inicio: "qué documentación técnica exigen para
sistemas bajo Res. Ex. 38/2024, plazo y costo".

### N — Escalabilidad ⚪

Cache de evaluaciones, particionamiento de `marcaciones`, read replicas
para reportes. Reactivo: se hace cuando un cliente real lo justifica.

---

## Actividades continuas 🔵

Trabajo que no termina nunca y se hace en paralelo con los pasos.

### Mantenimiento de deuda técnica

Items pendientes registrados a lo largo del desarrollo:

- ~~Marcaciones tipo `ajuste`: modelar reemplazo de la original (Paso 4).~~ ✅ Resuelto en Paso E.
- `redondeo_horas_extra_modo`: activar `'arriba'` y `'cercano'`.
- `horario_marcaje_anticipado_minutos`: activar lógica.
- Job nocturno que ejecute `verificar_cadena_hash` sobre todos los tenants.
- Pin de versiones de Node/NestJS/Postgres en CI.

### Tests y cobertura

Mantener verde la suite, agregar tests por cada nuevo endpoint, no
permitir regresiones.

### Documentación

Cada Paso cerrado deja su documento de diseño en `docs/` y se linkea
desde este roadmap. Las convenciones (`convenciones-bd.md`,
`operaciones-bd.md`) se actualizan cuando aparece una regla nueva.

---

## Decisiones arquitectónicas estratégicas registradas

Decisiones que afectan al producto entero. Cualquier persona que se
sume al proyecto debe entenderlas.

| Decisión | Justificación | Documento |
|---|---|---|
| SQL como fuente de verdad del schema | RLS, triggers, funciones complejas no encajan en ORM | Paso 1 |
| `pg.Pool` directo en vez de TypeORM | Menos fricción con RLS y funciones almacenadas | Paso 3 |
| Multi-tenant con RLS en cada tabla | Aislamiento real a nivel de base, no de aplicación | Paso 1 |
| Append-only en `marcaciones` y `audit_log` | Cumplimiento Res. Ex. 38/2024 + auditoría legal | Paso 1 |
| Cadena hash SHA-256 entre filas | Detección de manipulación de auditoría | Paso 1 |
| Motor de Jornada bajo demanda sin cache | Volumen MVP bajo, recálculo determinista | Paso 4 |
| Reglas en TS, parámetros en BD | Multi-tenant exige configurabilidad por empresa | Paso 4 |
| Borrado lógico (cambio de estado), nunca físico | Cumplimiento legal + integridad referencial | Paso B |
| Permisos granulares hardcodeados por rol | YAGNI sobre sistema configurable, sin urgencia real | Paso B |

---

## Onboarding rápido para cualquiera que llegue al proyecto

Si sos nuevo (humano o IA), leé en este orden:

1. Este archivo (`roadmap.md`) para entender dónde está parado el proyecto.
2. `convenciones-bd.md` para entender las reglas del schema.
3. `operaciones-bd.md` para entender procedimientos privilegiados.
4. El documento del **último Paso completado** según la sección "Estado
   actual" arriba.
5. El documento del **próximo Paso pendiente** si estás por trabajarlo.

Con eso reconstruís el contexto técnico del proyecto en ~30 minutos.
