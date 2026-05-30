# Migraciones SQL — Reloj Control (MVP)

Modelo de datos del sistema de reloj control para el cumplimiento de la
Resolución Exenta N° 38/2024 de la Dirección del Trabajo.

## Resumen del modelo

| Migración | Contenido |
|---|---|
| `001_extensions_and_roles.sql` | Extensiones (`pgcrypto`, `postgis`, `citext`), schema `rc`, roles `app_user` / `fiscalizador_dt` / `admin_migrate`, default privileges |
| `002_core_tables.sql` | `tenants`, `usuarios`, `centros_trabajo` (con geocerca PostGIS), `trabajadores`. Incluye validador modulo-11 de RUT chileno |
| `003_contratos_jornadas.sql` | `contratos`, `jornadas_pactadas` semanales |
| `004_marcaciones.sql` | **Tabla crítica.** Append-only con cadena hash SHA-256, función `registrar_marcacion`, helper canónico `_payload_marcacion`, verificador `verificar_cadena_hash` |
| `005_audit_log.sql` | Bitácora inmutable con mismo patrón de cadena hash |
| `006_rls_policies.sql` | Row Level Security multi-tenant. Helpers `current_tenant_id()` y `current_fiscalizador_tenants()` |
| `007_seed_demo.sql` | Dos tenants de prueba para validar aislamiento RLS |

Ejecutar `tests_funcionales.sql` para validar el comportamiento end-to-end.

## Cómo aplicar las migraciones

### Opción 1: con `psql` directo (entorno de desarrollo)

```bash
createdb reloj_control
for f in migrations/0*.sql; do
    psql -d reloj_control -v ON_ERROR_STOP=1 -f "$f"
done
psql -d reloj_control -f migrations/tests_funcionales.sql
```

### Opción 2: con `node-pg-migrate` (recomendado en proyecto NestJS)

```bash
npm install --save-dev node-pg-migrate pg
```

`package.json`:
```json
{
  "scripts": {
    "migrate:up":   "node-pg-migrate up   -m migrations --migration-file-language sql",
    "migrate:down": "node-pg-migrate down -m migrations --migration-file-language sql"
  }
}
```

Renombrar archivos al formato `<timestamp>_<nombre>.sql` que exige el runner
(o usar `--ignore-pattern` y aplicar con orden custom). Cada archivo debe
incluir bloques `-- Up Migration` y `-- Down Migration`.

### Opción 3: con TypeORM (si el equipo ya está acoplado a TypeORM)

```typescript
// src/migrations/1700000001-CoreSchema.ts
import { MigrationInterface, QueryRunner } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export class CoreSchema1700000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const files = [
      '001_extensions_and_roles.sql',
      '002_core_tables.sql',
      '003_contratos_jornadas.sql',
      '004_marcaciones.sql',
      '005_audit_log.sql',
      '006_rls_policies.sql',
    ];
    for (const f of files) {
      const sql = fs.readFileSync(
        path.join(__dirname, '../../migrations', f),
        'utf8'
      );
      await queryRunner.query(sql);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP SCHEMA rc CASCADE;');
  }
}
```

Las migraciones SQL siguen siendo la fuente de verdad; TypeORM solo las ejecuta
y lleva el control de cuáles fueron aplicadas en `migrations` table.

## Integración con la API NestJS

### Patrón de conexión multi-tenant (crítico)

La API debe conectarse a PostgreSQL con el rol `app_user` (no superuser, no
admin_migrate). En cada request, antes de ejecutar queries de negocio:

```typescript
// src/database/tenant.interceptor.ts
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    const tenantId: string = req.user?.tenantId;
    if (!tenantId) throw new UnauthorizedException();

    return defer(async () => {
      const qr = this.dataSource.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      // SET LOCAL aplica solo a esta transaccion.
      await qr.query("SET LOCAL ROLE app_user");
      await qr.query("SET LOCAL app.tenant_id = $1", [tenantId]);
      req.queryRunner = qr;
      try {
        const result = await next.handle().toPromise();
        await qr.commitTransaction();
        return result;
      } catch (err) {
        await qr.rollbackTransaction();
        throw err;
      } finally {
        await qr.release();
      }
    });
  }
}
```

**Si la API olvida setear `app.tenant_id`, las queries devuelven 0 filas
(fail-safe).** Nunca habrá leak entre tenants.

### Crear marcaciones desde la API

NUNCA hacer `INSERT INTO rc.marcaciones` directo. SIEMPRE via la función:

```typescript
const result = await qr.query(`
  SELECT * FROM rc.registrar_marcacion(
    p_tenant_id     := $1,
    p_trabajador_id := $2,
    p_tipo          := $3::rc.tipo_marcacion,
    p_fuente        := $4::rc.fuente_marcacion,
    p_centro_trabajo_id := $5,
    p_latitud       := $6,
    p_longitud      := $7,
    p_precision_metros := $8,
    p_ip_origen     := $9,
    p_user_agent    := $10
  )
`, [tenantId, trabajadorId, 'entrada', 'movil', centroId, lat, lng, precision, ip, ua]);
```

La función se encarga de:
- Validar geocerca
- Asignar número de secuencia
- Calcular hash encadenado
- Insertar atómicamente

### Verificar integridad ante una fiscalización

```typescript
const corruptas = await qr.query(
  "SELECT * FROM rc.verificar_cadena_hash($1)",
  [tenantId]
);
if (corruptas.length > 0) {
  // ALERTA: la cadena fue alterada. Notificar a InnovaDX inmediatamente.
}
```

Ejecutar este job diariamente sobre todos los tenants. Resultado vacío = OK.

### Registrar eventos en audit log

```typescript
await qr.query(`
  SELECT rc.registrar_evento(
    p_tenant_id        := $1,
    p_categoria        := $2::rc.audit_categoria,
    p_accion           := $3,
    p_actor_tipo       := $4::rc.audit_actor_tipo,
    p_actor_id         := $5,
    p_actor_descripcion := $6,
    p_entidad_tipo     := $7,
    p_entidad_id       := $8,
    p_payload          := $9,
    p_ip_origen        := $10
  )
`, [tenantId, 'gestion_trabajador', 'crear_trabajador', 'usuario',
    userId, userDesc, 'trabajador', newWorkerId, JSON.stringify(payload), ip]);
```

## Decisiones de diseño clave

### Por qué el payload del hash está en una función helper

Tanto `registrar_marcacion` como `verificar_cadena_hash` invocan
`rc._payload_marcacion()` para construir el string que se hashea. Si las dos
rutas construyeran el payload por separado, era inevitable que se
desincronizaran en algún cambio futuro y reportaran falsos positivos de
corrupción. Una sola función = un solo formato = imposible que diverjan.

Análogo para audit log: `rc._payload_audit()`.

### Por qué `latitud`/`longitud` son columnas separadas de `ubicacion`

PostGIS al hacer roundtrip `numeric → geography → ST_X/ST_Y` pierde
representación textual (`-36.8270` vuelve como `-36.827`). Eso cambia el
string del payload y rompe el hash. Solución: almacenar lat/lng como
`numeric(10,7)` (fuente de verdad para el hash) y mantener `ubicacion`
geography solo para queries espaciales (`ST_DWithin`).

### Por qué advisory lock por tenant y no `SERIALIZABLE`

El cálculo de la secuencia siguiente y el hash anterior debe ser atómico:
dos requests concurrentes del mismo tenant podrían leer la misma "última
marcación" y generar dos registros con la misma `secuencia`, o ambos
referenciando el mismo `hash_anterior`. Solución:
`pg_advisory_xact_lock(hash(tenant_id))` serializa SOLO dentro del mismo
tenant, sin bloquear inserciones de otros tenants. Mucho más performante
que `SERIALIZABLE` o que un lock sobre la tabla.

### Por qué el hash en columnas `text` y no `bytea`

Legibilidad en logs, dumps y herramientas de admin. La diferencia de
performance es despreciable (~64 bytes por marcación). El `CHECK` con regex
`^[a-f0-9]{64}$` evita basura.

### Por qué `tenant_id` también en tablas hijas (denormalización aparente)

Sí, en teoría se podría llegar al tenant via `trabajador → contrato → tenant`.
Pero para que RLS sea eficiente y simple, cada tabla debe tener su columna
`tenant_id` directa. El costo de espacio es despreciable (8 bytes UUID), el
beneficio es enorme: una política RLS de una línea por tabla, índices
compuestos `(tenant_id, ...)` que son los que la API va a usar, y queries
sin joins extra.

## Siguientes pasos

Las próximas migraciones (fuera del alcance del MVP inicial pero ya previstas):

- `008_dispositivos.sql` — dispositivos físicos (huelleros), certificación, vinculación a centros
- `009_sesiones_y_tokens.sql` — refresh tokens, sesiones activas, intentos de login
- `010_ajustes_y_aprobaciones.sql` — flujo de aprobación de ajustes administrativos
- `011_reportes_dt.sql` — vistas materializadas y funciones para los reportes que pide la DT
- `012_motor_jornada.sql` — cálculo de cumplimiento de jornada pactada vs marcaciones reales

## Convenciones del proyecto

- Lenguaje: **castellano** para tablas/columnas (alineado con la
  terminología legal chilena que usan los certificadores DT).
- IDs: UUID v4 (`gen_random_uuid()`). Nada de `serial`/`bigserial`.
- Timestamps: siempre `timestamptz`, almacenamiento UTC, conversión a hora
  local solo en queries de presentación con `AT TIME ZONE 'America/Santiago'`.
- Schema: todo en `rc`. El `public` queda vacío.
- Roles: la API conecta como `app_user` (RLS aplica). `admin_migrate` solo
  para migraciones y scripts batch. Nunca exponer un superuser a la API.
- Hash chain: cualquier cambio en `_payload_marcacion` o `_payload_audit`
  invalida la cadena histórica. No tocar sin estrategia de migración de
  hashes históricos.
