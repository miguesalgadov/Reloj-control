# Paso E — Ajustes Administrativos de Marcaciones

> **Estado:** Cerrado para implementación.
> **Audiencia:** Desarrollador implementador (humano o Claude Code).
> **Precondiciones:** Pasos 1–4, A, B, C, F y D completos.
>   - 124 tests e2e + 112 unitarios + 5 SQL verdes.
>   - 4 reportes mensuales operativos.
> **Última revisión:** 2026-06-03.

Este documento es la **fuente de verdad** del Paso E. Lo implementado
debe coincidir con lo descrito acá.

---

## 1. Propósito

El Paso E resuelve dos clases de problemas:

**Problema 1 (principal): ajustes administrativos**
Hoy las marcaciones son append-only e inmutables. Esto es correcto
para cumplimiento legal pero crea fricción operativa real:
- Trabajador olvida marcar entrada → falsa inasistencia.
- Trabajador marca con dispositivo equivocado o con GPS impreciso →
  marcación fuera de geocerca.
- Doble tap accidental → dos entradas seguidas.

La Res. Ex. 38/2024 permite ajustes administrativos siempre que: (a)
queden trazables, (b) no reemplacen físicamente el registro original,
(c) tengan justificación documentada. El campo `tipo='ajuste'` existe
en `rc.marcaciones` desde el Paso 1; el Paso E le da API y semántica.

**Problema 2 (limpieza): dos bugs latentes del Paso D**
- `@IsUUID('4')` de `class-validator` v13 rechaza UUIDs válidos
  generados por `gen_random_uuid()`. El Paso D usa `@Matches(UUID_RE)`
  pero los DTOs de los Pasos B y C siguen con `@IsUUID` y tienen el
  bug latente.
- El cálculo de zona horaria Chile usa offset `-4h` hardcoded en al
  menos un punto del Paso D. Chile cambia a `-3h` en septiembre con el
  horario de verano. Si el código está en producción se rompe; si está
  solo en test, queda como deuda.

---

## 2. Alcance

### 2.1 Bloque 0 — Limpieza de bugs del Paso D

Trabajo de saneamiento antes de empezar funcionalidad nueva.

| Tarea | Resultado |
|---|---|
| Auditar uso de `@IsUUID` en todos los DTOs del proyecto | Reemplazar por `@Matches(UUID_RE)` en una constante compartida |
| Auditar uso de offsets hardcoded para zona horaria Chile | Reemplazar por uso de `date-fns-tz` con `America/Santiago` |

### 2.2 Bloque principal — Ajustes administrativos

Endpoints nuevos:

| Endpoint | Propósito |
|---|---|
| `POST /api/ajustes` | Crear un ajuste (3 sub-tipos: creación, corrección, anulación) |
| `GET /api/ajustes` | Listar ajustes del tenant con filtros |
| `GET /api/ajustes/:id` | Ver detalle de un ajuste específico |

Actualización del Paso D:
- Los 4 reportes actualizan su lógica para considerar marcaciones
  efectivas (originales + ajustes aplicados según reglas de §6.4).

### 2.3 Fuera de alcance

- PATCH o DELETE de ajustes (los ajustes también son append-only;
  para corregir un ajuste se crea otro).
- Workflow de aprobación multi-paso (un admin aprueba, otro ejecuta).
  En v1 el admin que crea ejecuta. Si una empresa lo pide → futuro.
- Notificación al trabajador cuando se ajusta su marcación → Paso H.
- Vista de "histórico de ajustes" en el frontend → Paso G.

---

## 3. Decisiones arquitectónicas

### 3.1 Modelo de ajuste: nueva marcación que reemplaza

Los ajustes son marcaciones nuevas con `tipo='ajuste'` que apuntan a la
marcación original mediante `marcacion_original_id` (campo ya en el
schema desde Paso 1). Los reportes y el evaluador del Paso 4 leen la
marcación efectiva.

**Justificación:**
- Mantiene todo en una sola tabla → cadena hash íntegra.
- El esquema ya está modelado.
- Una sola lógica de auditoría y verificación.

### 3.2 Solo `admin_empresa` puede crear ajustes

Los ajustes cambian horas trabajadas, atrasos, y por tanto liquidación
de sueldos. Es una operación de responsabilidad formal que no delega
en supervisor.

### 3.3 Restricciones temporales

- **Plazo máximo:** 60 días hacia atrás. Marcaciones más antiguas no
  son ajustables vía API (requeriría intervención manual de InnovaDX).
- **Mes anterior cerrado:** ajustes sobre marcaciones del mes anterior
  requieren confirmación explícita (`confirmacion_mes_cerrado=true` en
  el body) para evitar ajustes accidentales sobre períodos liquidados.
- **Mes actual:** ajustes con confirmación normal (solo `motivo`).

### 3.4 Justificación obligatoria con mínimo de caracteres

Campo `motivo` obligatorio, mínimo 30 caracteres. Sin esto retorna 400.
Es deliberadamente estricto para forzar documentación de calidad.

### 3.5 Tres sub-tipos de ajuste

| Sub-tipo | Cuándo usar | Datos requeridos |
|---|---|---|
| `creacion` | Crear marcación faltante (olvido) | tipo_marcacion, timestamp_local, motivo |
| `correccion` | Corregir hora/datos de marcación existente | marcacion_original_id, timestamp_local_corregido, motivo |
| `anulacion` | Anular marcación que no debió existir | marcacion_original_id, motivo |

El campo `tipo_ajuste` se almacena en el JSONB `datos_ajuste` del registro
(ya existe en el schema).

### 3.6 Append-only de ajustes

Los ajustes mismos no se editan ni borran. Si un ajuste fue mal hecho,
se crea otro ajuste sobre el mismo registro original. Esto preserva la
historia completa de decisiones administrativas.

### 3.7 Auditoría obligatoria

Cada ajuste registra evento en `audit_log` con categoría
`ajuste_marcacion` que incluye: marcación original (si aplica), datos
del ajuste, motivo, admin responsable, IP, user-agent.

---

## 4. Matriz de permisos

| Endpoint | admin_empresa | supervisor | trabajador |
|---|:---:|:---:|:---:|
| POST /ajustes | ✅ | ❌ | ❌ |
| GET /ajustes | ✅ | ✅ | ❌ |
| GET /ajustes/:id | ✅ | ✅ | ❌ |

El supervisor puede **ver** ajustes (transparencia operativa) pero no
crearlos.

---

## 5. Endpoints

### 5.1 POST /api/ajustes

Crea un ajuste.

**Auth:** JWT + rol `admin_empresa`.

**Body:**

```json
{
  "tipo_ajuste": "creacion | correccion | anulacion",
  "trabajador_id": "uuid",
  "motivo": "string (mínimo 30 caracteres)",
  "confirmacion_mes_cerrado": false,

  // Solo si tipo_ajuste = 'creacion':
  "tipo_marcacion": "entrada | salida | inicio_colacion | fin_colacion",
  "timestamp_local": "2026-06-01T08:07:00",
  "latitud": -36.8201,
  "longitud": -73.0444,

  // Solo si tipo_ajuste = 'correccion' o 'anulacion':
  "marcacion_original_id": "uuid",

  // Solo si tipo_ajuste = 'correccion':
  "timestamp_local_corregido": "2026-06-01T08:07:00"
}
```

**Validaciones:**

- `motivo`: string, longitud mínima 30 caracteres, máxima 500.
- Según `tipo_ajuste`:
  - `creacion`: requiere `tipo_marcacion`, `timestamp_local`, opcionales
    `latitud`/`longitud`.
  - `correccion`: requiere `marcacion_original_id` y
    `timestamp_local_corregido`. El original debe existir, ser del
    tenant, no estar ya anulado.
  - `anulacion`: requiere `marcacion_original_id`. Mismas validaciones.
- `timestamp_local` o `timestamp_local_corregido`:
  - No más de 60 días atrás.
  - No en el futuro.
  - Si está en mes anterior al actual, requiere
    `confirmacion_mes_cerrado: true`.
- `trabajador_id`: debe pertenecer al tenant.

**Side effects:**

- Inserta nueva fila en `rc.marcaciones` con `tipo='ajuste'`.
- Setea `marcacion_original_id` (si aplica).
- Setea `datos_ajuste` JSONB con: `{ tipo_ajuste, motivo, admin_id, timestamp_corregido_si_aplica }`.
- Cadena hash de marcaciones se actualiza naturalmente (es la lógica
  ya existente del Paso 1).
- Registra evento en `audit_log` con categoría `ajuste_marcacion`.

**Response 201:**

```json
{
  "id": "uuid del ajuste recién creado",
  "tipo_ajuste": "correccion",
  "trabajador_id": "uuid",
  "marcacion_original_id": "uuid",
  "tipo_marcacion": "entrada",
  "timestamp_local": "2026-06-01T08:07:00",
  "timestamp_utc": "2026-06-01T11:07:00Z",
  "creado_por": { "id": "uuid", "nombre": "Ana Admin" },
  "motivo": "Trabajador olvidó marcar entrada por...",
  "created_at": "2026-06-03T19:00:00Z"
}
```

**Errores específicos:**

- 400: motivo < 30 caracteres → `"El motivo debe tener al menos 30 caracteres descriptivos."`
- 400: timestamp > 60 días atrás → `"No se pueden ajustar marcaciones de más de 60 días atrás."`
- 400: mes anterior sin confirmación → `"Marcación del mes anterior. Requiere confirmacion_mes_cerrado: true para proceder."`
- 404: marcación original no encontrada o ya anulada → `"Marcación original no encontrada o ya fue anulada."`
- 422: combinación de campos inválida (ej. `creacion` con `marcacion_original_id`) → mensaje específico.

### 5.2 GET /api/ajustes

Lista ajustes del tenant con filtros.

**Auth:** JWT + rol `admin_empresa` o `supervisor`.

**Query params:**

- `trabajador_id` (opcional, UUID).
- `tipo_ajuste` (opcional): `creacion | correccion | anulacion`.
- `desde` (opcional, `YYYY-MM-DD`).
- `hasta` (opcional, `YYYY-MM-DD`).
- `creado_por_id` (opcional, UUID): filtra por admin que creó el ajuste.
- `limit` (default 50, max 200).
- `offset` (default 0).

**Response 200:**

```json
{
  "data": [
    {
      "id": "uuid",
      "tipo_ajuste": "correccion",
      "trabajador": { "id": "uuid", "rut": "12345678-9", "nombre_completo": "Juan Pérez" },
      "tipo_marcacion": "entrada",
      "timestamp_original_local": "2026-06-01T08:30:00",
      "timestamp_corregido_local": "2026-06-01T08:07:00",
      "motivo": "Trabajador olvidó...",
      "creado_por": { "id": "uuid", "nombre": "Ana Admin" },
      "created_at": "2026-06-03T19:00:00Z"
    }
  ],
  "total": 12,
  "limit": 50,
  "offset": 0
}
```

### 5.3 GET /api/ajustes/:id

Detalle de un ajuste.

**Auth:** JWT + rol `admin_empresa` o `supervisor`.

**Response 200:** mismo objeto del listado + campos adicionales:
- `marcacion_original_completa`: si aplica, datos de la marcación
  original.
- `audit_log_id`: referencia al evento de auditoría asociado.

**Response 404:** si no existe o RLS lo oculta (mismo error para no
filtrar info entre tenants).

---

## 6. Cambios en otros módulos

### 6.1 Actualización del evaluador del Paso 4

El evaluador hoy recibe `marcaciones[]` y opera sobre ellas. Tras Paso
E, recibe marcaciones efectivas:

```typescript
// Antes (Paso 4):
function evaluarJornadaDia(jornadaPactada, marcaciones[], config) { ... }

// Después (Paso E):
function evaluarJornadaDia(jornadaPactada, marcacionesEfectivas[], config) { ... }
```

La función helper `obtenerMarcacionesEfectivas(marcaciones[])` aplica
las reglas de §6.4 y devuelve solo las marcaciones a considerar.

**Decisión:** la función helper vive en `src/jornada/evaluator/` y se
exporta para que reportes (Paso D) y supervisión (Paso C) también la
usen.

### 6.2 Actualización de reportes (Paso D)

Los 4 reportes del Paso D actualizan su query base para incluir tanto
marcaciones originales como ajustes, y luego pasan todo por
`obtenerMarcacionesEfectivas()`.

### 6.3 Actualización de supervisión (Paso C)

El endpoint `/api/supervision/dia/` y la alerta `colacion_no_marcada`
deben considerar ajustes. Si un admin marca creación de entrada
faltante, el trabajador deja de aparecer como "ausente" en la vista
del supervisor.

### 6.4 Reglas de marcación efectiva

Dado un set de marcaciones `M` para un trabajador en un día:

```
Para cada par (tipo_marcacion, momento_del_día):
  1. Buscar el ajuste tipo 'correccion' más reciente con marcacion_original_id
     apuntando a una marcación de ese par. Si existe → usar el ajuste.
  2. Si no hay corrección, buscar la marcación original.
     2a. Si la original está referenciada por un ajuste tipo 'anulacion'
         → ignorar la original (no hay marcación efectiva).
     2b. Si no, usar la original.
  3. Adicionalmente, incluir todos los ajustes tipo 'creacion' como
     marcaciones efectivas independientes.
```

Esta lógica vive en función pura `obtenerMarcacionesEfectivas()`.

---

## 7. Estructura del módulo NestJS

```
src/ajustes/
├── ajustes.module.ts
├── ajustes.controller.ts
├── ajustes.service.ts
├── ajustes.repository.ts
└── dto/
    ├── crear-ajuste.dto.ts
    ├── listar-ajustes.dto.ts
    └── responses.ts

src/jornada/evaluator/
└── marcaciones-efectivas.ts  # función pura compartida
```

**Importaciones requeridas:**
- `JornadaModule` (para usar `obtenerMarcacionesEfectivas`).
- `DatabaseModule`.

**Sin nuevas migraciones**. El schema del Paso 1 ya cubre todo.

---

## 8. DTOs

### CrearAjusteDto

```typescript
import {
  IsEnum, IsString, IsOptional, MinLength, MaxLength, Matches,
  ValidateIf, IsBoolean, IsDateString, IsNumber, Min, Max
} from 'class-validator';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class CrearAjusteDto {
  @IsEnum(['creacion', 'correccion', 'anulacion'])
  tipo_ajuste!: 'creacion' | 'correccion' | 'anulacion';

  @Matches(UUID_RE)
  trabajador_id!: string;

  @IsString()
  @MinLength(30)
  @MaxLength(500)
  motivo!: string;

  @IsOptional()
  @IsBoolean()
  confirmacion_mes_cerrado?: boolean = false;

  // Solo creacion
  @ValidateIf(o => o.tipo_ajuste === 'creacion')
  @IsEnum(['entrada', 'salida', 'inicio_colacion', 'fin_colacion'])
  tipo_marcacion?: string;

  @ValidateIf(o => o.tipo_ajuste === 'creacion' || o.tipo_ajuste === 'correccion')
  @IsDateString()
  timestamp_local?: string;

  @ValidateIf(o => o.tipo_ajuste === 'creacion')
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud?: number;

  @ValidateIf(o => o.tipo_ajuste === 'creacion')
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud?: number;

  // Solo correccion y anulacion
  @ValidateIf(o => o.tipo_ajuste === 'correccion' || o.tipo_ajuste === 'anulacion')
  @Matches(UUID_RE)
  marcacion_original_id?: string;

  // Solo correccion
  @ValidateIf(o => o.tipo_ajuste === 'correccion')
  @IsDateString()
  timestamp_local_corregido?: string;
}
```

### ListarAjustesDto

```typescript
export class ListarAjustesDto {
  @IsOptional()
  @Matches(UUID_RE)
  trabajador_id?: string;

  @IsOptional()
  @IsEnum(['creacion', 'correccion', 'anulacion'])
  tipo_ajuste?: string;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

  @IsOptional()
  @Matches(UUID_RE)
  creado_por_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
```

---

## 9. Constante compartida UUID_RE

Crear archivo `src/common/validators/uuid.ts`:

```typescript
export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
```

Reemplazar **todos** los usos de `@IsUUID('4')` y `@IsUUID()` en el
proyecto por `@Matches(UUID_RE)` importando esta constante.

Auditar específicamente:
- `src/usuarios/dto/`
- `src/trabajadores/dto/`
- `src/centros/dto/`
- `src/contratos/dto/`
- `src/supervision/dto/`
- `src/reportes/dto/`

---

## 10. Tests

### 10.1 Tests unitarios (~15 tests)

**`AjustesService.crear()`:**
- Happy path para los 3 tipos (creacion, correccion, anulacion).
- Validación de plazo > 60 días → rechaza.
- Validación de mes anterior sin confirmación → rechaza.
- Validación de marcación original ya anulada → rechaza.
- Transaccionalidad: si falla la inserción de auditoría, rollback total.

**`obtenerMarcacionesEfectivas()`:**
- Marcaciones sin ajustes → retorna originales.
- Marcación con corrección → retorna corrección, ignora original.
- Marcación con anulación → no retorna esa marcación.
- Creación de marcación nueva → retorna creación + cualquier original
  que no fue tocada.
- Múltiples ajustes sobre la misma marcación → toma el más reciente.

### 10.2 Tests e2e (~15 tests)

Por endpoint:
- Happy path con `admin_empresa`.
- 401 sin token.
- 403 con `supervisor` o `trabajador` para POST.
- Aislamiento RLS.

Casos específicos:

- `[aju-1]` POST creacion con todos los campos → 201.
- `[aju-2]` POST creacion sin motivo → 400.
- `[aju-3]` POST creacion con motivo de 25 chars → 400.
- `[aju-4]` POST correccion sobre marcación ya anulada → 404.
- `[aju-5]` POST con timestamp > 60 días atrás → 400.
- `[aju-6]` POST sobre mes anterior sin confirmación → 400.
- `[aju-7]` POST sobre mes anterior con confirmación → 201.
- `[aju-8]` GET con filtro `tipo_ajuste=correccion` → solo correcciones.
- `[aju-9]` GET con filtro `trabajador_id` → solo ajustes de ese trabajador.
- `[aju-10]` Tras crear ajuste tipo creacion, `/api/jornadas/hoy` del
  trabajador refleja la nueva marcación efectiva.
- `[aju-11]` Tras crear ajuste tipo correccion, reporte de asistencia
  del mes refleja la hora corregida.
- `[aju-12]` Tras crear ajuste tipo anulacion, `/api/supervision/dia`
  ya no muestra la marcación anulada.
- `[aju-13]` Aislamiento: admin de tenant A intenta crear ajuste sobre
  marcación de tenant B → 404.
- `[aju-14]` audit_log registra evento con categoría `ajuste_marcacion`.
- `[aju-15]` verificar_cadena_hash sigue verde tras varios ajustes
  encadenados.

### 10.3 Test de integración

- `[aju-int-1]` Flujo completo: trabajador olvida marcar entrada
  (no se registra), admin crea ajuste tipo creacion con timestamp
  correcto, evaluador del Paso 4 ahora considera al trabajador
  "presente" para el día, reporte de asistencia del Paso D muestra
  el día como trabajado.

---

## 11. Criterios de aceptación

1. **Compilación limpia**: `npm run build` sin errores.
2. **Sin nuevas migraciones**: schema del Paso 1 cubre todo.
3. **Tests verdes**:
   - e2e: 124 (anteriores) + ~15 (Paso E) ≈ 139.
   - unitarios: 112 (anteriores) + ~15 (Paso E) ≈ 127.
4. **Cobertura del módulo `ajustes` > 85%**.
5. **Aislamiento RLS verificado** por test cross-tenant.
6. **Cadena hash íntegra**: tras crear varios ajustes en la suite,
   `verificar_cadena_hash` no detecta corrupción.
7. **Reportes actualizados**: los 4 reportes del Paso D consideran
   marcaciones efectivas (verificable con test que crea ajuste y
   consulta reporte).
8. **Auditoría completa**: cada ajuste deja evento en audit_log con
   categoría correcta y payload con motivo + admin responsable.
9. **Bug 1 resuelto**: no quedan usos de `@IsUUID` en el proyecto.
   Todos reemplazados por `@Matches(UUID_RE)` desde
   `src/common/validators/uuid.ts`.
10. **Bug 2 resuelto**: no quedan offsets hardcoded `-4h` o `-3h` en
    código de producción. Todas las conversiones a hora Chile usan
    `date-fns-tz` con `America/Santiago`.

---

## 12. Deuda técnica registrada

1. **Workflow de aprobación multi-paso**: si una empresa pide que un
   admin proponga y otro apruebe, agregar máquina de estado a ajustes.
2. **Notificación al trabajador**: cuando se ajusta su marcación,
   notificarle por email/push. Va en Paso H.
3. **Plazo de 60 días configurable por tenant**: hoy hardcoded; si
   alguna empresa pide rango distinto, mover a `configuracion_jornada`.
4. **Ajustes de meses cerrados de hace más de 60 días**: requieren
   intervención manual de InnovaDX. Si esto se vuelve frecuente,
   agregar endpoint con autorización especial.
5. **Vista "histórico de ajustes por trabajador"** en frontend admin
   → Paso G.

---

## 13. Implementación: orden recomendado

**REGLA CRÍTICA SOBRE COMMITS:** después de cerrar cada bloque,
ejecutar `git add` + `git commit` ANTES de avanzar al siguiente. Lo
mismo que en Pasos F y D (donde funcionó).

a. **Bloque 0a — Limpieza UUID**:
   - Crear `src/common/validators/uuid.ts` con `UUID_RE`.
   - Auditar todos los DTOs del proyecto que usen `@IsUUID`.
   - Reemplazar por `@Matches(UUID_RE)`.
   - Correr `npm run test` y `npm run test:e2e` → todos verdes (deben
     seguir verdes, esto no cambia lógica).
   Commit: `refactor: unificar validación de UUID con constante compartida`.

b. **Bloque 0b — Limpieza zona horaria**:
   - Buscar en todo el codebase: `grep -rn "\-4h\|offset.*chile\|offset.*-4\|offset.*-3"`.
   - Reemplazar cualquier offset hardcoded por uso de `date-fns-tz`
     con `America/Santiago`.
   - Si los hallazgos son solo en archivos `.spec.ts`, dejarlos pero
     documentarlos como deuda en el commit message.
   Commit: `fix: usar date-fns-tz para zona horaria Chile (evita bug horario verano)`.

c. **Bloque 1 — Función `obtenerMarcacionesEfectivas`**:
   - Crear `src/jornada/evaluator/marcaciones-efectivas.ts`.
   - Implementar la lógica de §6.4 como función pura.
   - Tests unitarios para la función.
   - Exportar desde `JornadaModule`.
   Commit: `feat(jornada): función obtenerMarcacionesEfectivas para ajustes`.

d. **Bloque 2 — Módulo ajustes esqueleto**:
   - `ajustes.module.ts` + controller con endpoints retornando 501.
   - DTOs (`CrearAjusteDto`, `ListarAjustesDto`).
   - Verificar routing y guards.
   Commit: `feat(ajustes): esqueleto del módulo + DTOs`.

e. **Bloque 3 — POST /api/ajustes**:
   - `AjustesService.crear()` con manejo de los 3 sub-tipos.
   - Validaciones de plazo, mes cerrado, motivo.
   - Inserción de marcación + registro de auditoría (transaccional).
   - Tests unitarios + tests e2e para POST.
   Commit: `feat(ajustes): POST endpoint con 3 sub-tipos y auditoría`.

f. **Bloque 4 — GET endpoints**:
   - `AjustesService.listar()` con filtros.
   - `AjustesService.detalle(id)`.
   - Tests e2e para GET y GET/:id.
   Commit: `feat(ajustes): GET endpoints con filtros y detalle`.

g. **Bloque 5 — Actualización evaluador del Paso 4**:
   - Modificar `JornadaService` para que use
     `obtenerMarcacionesEfectivas` antes de evaluar.
   - Tests existentes del Paso 4 deben seguir verdes.
   - Agregar tests específicos para casos con ajustes.
   Commit: `feat(jornada): evaluador considera marcaciones efectivas (con ajustes)`.

h. **Bloque 6 — Actualización reportes (Paso D)**:
   - Modificar los 4 reportes para usar `obtenerMarcacionesEfectivas`.
   - Tests existentes del Paso D deben seguir verdes.
   - Agregar tests específicos: reporte tras ajustes refleja datos
     corregidos.
   Commit: `feat(reportes): reportes consideran marcaciones efectivas`.

i. **Bloque 7 — Actualización supervisión (Paso C)**:
   - Modificar `/api/supervision/dia/` y alerta `colacion_no_marcada`
     para usar marcaciones efectivas.
   - Tests existentes del Paso C deben seguir verdes.
   - Test de integración `[aju-int-1]` end-to-end.
   Commit: `feat(supervision): vistas consideran marcaciones efectivas`.

**Total esperado: 9 commits.**

---

## 14. Decisiones registradas

| Decisión | Justificación |
|---|---|
| Ajustes como marcaciones nuevas tipo `ajuste` | Esquema ya modelado; cadena hash íntegra |
| Solo admin_empresa crea ajustes | Responsabilidad sobre datos de liquidación |
| Supervisor puede ver pero no crear | Transparencia sin dilución de responsabilidad |
| Plazo máximo 60 días | Cubre operación normal; ajustes más antiguos son excepcionales |
| Confirmación explícita para mes anterior | Defensa contra ajustes accidentales sobre períodos liquidados |
| Motivo mínimo 30 caracteres | Fuerza documentación de calidad |
| 3 sub-tipos: creacion/correccion/anulacion | Cubre los casos operativos reales |
| Append-only de ajustes | Coherencia con principio de auditoría |
| Función pura `obtenerMarcacionesEfectivas` | Reusable entre evaluador, reportes, supervisión |
| Limpieza de bugs latentes incluida | Mejor arreglar ahora que diagnosticar bajo presión |
