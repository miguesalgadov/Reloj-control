# Convenciones de Base de Datos

> **Estado:** Vigente.
> **Audiencia:** Cualquier desarrollador (humano o IA) que escriba SQL contra
> este proyecto.
> **Cumplimiento obligatorio:** sí. Estas convenciones existen para evitar
> bugs específicos que ya costaron tiempo de diagnóstico (ver §1.4).

---

## 1. Schemas y extensiones

### 1.1 Schemas del proyecto

| Schema | Contiene | Quién puede crear objetos |
|---|---|---|
| `rc` | Tablas, tipos, funciones, vistas de la aplicación | `admin_migrate` |
| `extensions` | `pgcrypto`, `citext` (cuando la plataforma lo permite) | Nadie en runtime |
| `public` | PostGIS siempre; pgcrypto y citext en Neon | Nadie en runtime |

### 1.2 Schema de las extensiones según plataforma

| Extensión | Plataforma local / self-managed | Neon |
|---|---|---|
| `pgcrypto` | `extensions` | `public` (restricción de Neon — ver §1.4) |
| `citext` | `extensions` | `public` (restricción de Neon — ver §1.4) |
| `postgis` | `public` | `public` |

Esta asimetría es **deuda de plataforma**, no deuda de código. La migración
009 detecta dinámicamente dónde viven las extensiones y blinda el
`search_path` con el valor correcto. Ningún código de aplicación tiene que
saber en qué plataforma corre.

### 1.3 Convención sobre `public`

`public` no se usa como schema de aplicación. La aplicación nunca crea
tablas, tipos, vistas ni funciones ahí.

En Neon, `public` aloja `pgcrypto` y `citext` por restricción de plataforma,
pero esto **no es un permiso para usar `public` para otras cosas**. Es solo
el lugar donde la extensión vive por la limitación documentada en §1.4.

### 1.4 Historial del problema y el límite encontrado

| Fecha | Síntoma | Causa | Resolución |
|---|---|---|---|
| Paso 3 | `buscar_usuario_para_login` no encontraba `citext` | `search_path` sin `public` (donde estaba `citext`) | Parche puntual |
| Paso 4 | `registrar_evento_login` warning con `digest()` | Mismo problema, transitivo | Tragado por `.catch()` |
| Paso A v1 | Migración 009 intentó `ALTER EXTENSION ... SET SCHEMA` | El rol que corre migraciones no es owner de las funciones | Migración fallida y revertida |
| Paso A v2 | Script manual con `neondb_owner` | `neondb_owner` aparece como owner de la extensión pero NO de las funciones individuales. En Neon, funciones como `pgp_sym_decrypt` son owned por un rol interno de plataforma. `ALTER EXTENSION SET SCHEMA` falla con "must be owner of function" incluso desde el SQL Editor con la credencial más privilegiada accesible | Imposible mover extensiones en Neon |
| Paso A v3 | Migración 009 tolerante con ambos schemas | — | Aceptado como deuda de plataforma |

### 1.5 Por qué `public` en `search_path` es seguro en este proyecto

La razón clásica por la que se evita `public` en funciones `SECURITY
DEFINER` es el ataque de hijacking: un usuario malicioso crea una función
en `public` con el mismo nombre que algo invocado por la definer, y la
definer la ejecuta con privilegios elevados.

En este proyecto el ataque no aplica porque:

1. **PostgreSQL 15+ revoca `CREATE ON SCHEMA public FROM PUBLIC` por
   defecto**. Solo roles con `CREATE` explícito pueden crear ahí.
2. **`app_user` no tiene `CREATE` en `public`**. El bootstrap solo otorga
   `USAGE` (lectura/ejecución), no `CREATE`.
3. **`public` no contiene objetos de aplicación**. Solo `pgcrypto`, `citext`
   y `postgis`, todos owned por roles privilegiados que la aplicación no
   asume.

El riesgo residual sería que alguien con privilegios elevados (Neon mismo
o un DBA con acceso a `neondb_owner`) creara una función maliciosa en
`public`. Eso es un compromiso del operador de la plataforma, no un vector
de ataque desde la aplicación.

---

## 2. Funciones SECURITY DEFINER

### 2.1 Regla obligatoria de `search_path`

**Toda función `SECURITY DEFINER` debe declarar `search_path` explícitamente,
incluyendo el schema donde viven las extensiones de esa base.**

El valor concreto depende de la plataforma:

- En Neon: `SET search_path = rc, public, pg_catalog`
- En base self-managed con bootstrap actualizado: `SET search_path = rc, extensions, pg_catalog`

**Cómo determinar el valor correcto al escribir una función nueva:**

```sql
SELECT extname, n.nspname AS schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
 WHERE extname IN ('pgcrypto', 'citext');
```

Lo que reporte como `schema` es lo que va en el `SET search_path`.

Lo importante es que **el `search_path` esté declarado**. Lo que NO debe
pasar nunca es una función definer sin `SET search_path` o con un
`search_path` que omita el schema de las extensiones que usa.

### 2.2 Plantilla (asumiendo Neon)

```sql
CREATE OR REPLACE FUNCTION rc.<nombre>(...)
RETURNS <tipo>
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = rc, public, pg_catalog
AS $$
BEGIN
    -- cuerpo
END;
$$;

GRANT EXECUTE ON FUNCTION rc.<nombre>(...) TO app_user;
```

### 2.3 Plantilla portable (recomendada para funciones nuevas)

Si querés que la función nazca portable entre plataformas, escribila
inicialmente con un `search_path` neutro y agregala como `ALTER FUNCTION`
en una migración aparte que detecte el schema dinámicamente, igual que la
migración 009. Para funciones simples, basta con declarar el `search_path`
con el valor que corresponde a la plataforma activa.

### 2.4 Razones para usar SECURITY DEFINER

Solo cuando la función necesita acceder a datos que el invocador no puede
ver bajo RLS. Casos legítimos:

- Endpoints de autenticación que buscan usuarios antes de saber el tenant.
- Funciones de auditoría llamadas desde contextos sin tenant.
- Operaciones administrativas que cruzan tenants (reportes globales).

Si no necesitás cross-tenant, usá `SECURITY INVOKER` (default). Cada
función definer es una superficie de ataque adicional.

### 2.5 Auditoría automática

La migración 009 incluye un guard que falla si alguna función definer en
`rc` queda sin `search_path` explícito. Toda migración futura que agregue
una función definer debe pasar este guard.

---

## 3. Funciones SECURITY INVOKER

### 3.1 Regla de `search_path`

Las funciones invoker **también deben declarar `search_path` explícito si
usan funciones de extensiones**. Si una función invoker es llamada desde
una función definer con `search_path` blindado, y la invoker usa `digest()`
sin tener su propio `search_path`, va a fallar.

La regla es: **cualquier función que use `digest()`, operadores de `citext`,
operadores de `pgcrypto`, etc., debe declarar su propio `search_path`.**

### 3.2 Excepción razonable

Funciones puras de manipulación de strings/números que no tocan extensiones
pueden omitir `SET search_path` para dar flexibilidad al planner.
Ejemplos: `rc.es_rut_valido`, `rc.normalizar_rut`.

---

## 4. RLS y multi-tenant

### 4.1 Toda tabla con `tenant_id` debe tener RLS habilitado

```sql
ALTER TABLE rc.<tabla> ENABLE ROW LEVEL SECURITY;
ALTER TABLE rc.<tabla> FORCE ROW LEVEL SECURITY;
```

`FORCE` aplica RLS incluso al dueño de la tabla.

### 4.2 Políticas estándar

```sql
CREATE POLICY <tabla>_app_tenant ON rc.<tabla>
    FOR ALL
    TO app_user
    USING (tenant_id = rc.current_tenant_id())
    WITH CHECK (tenant_id = rc.current_tenant_id());

CREATE POLICY <tabla>_fiscalizador_read ON rc.<tabla>
    FOR SELECT
    TO fiscalizador_dt
    USING (tenant_id = ANY(rc.current_fiscalizador_tenants()));
```

### 4.3 `BYPASSRLS` es excepcional

Solo `admin_migrate` tiene `BYPASSRLS`. La API conecta como `app_login`
(miembro de `app_user`, sin BYPASSRLS).

---

## 5. Tipos y nomenclatura

### 5.1 Idioma

Castellano para nombres de tablas, columnas y funciones del dominio
laboral chileno. Inglés para nombres técnicos genéricos (`created_at`,
`updated_at`, `hash_actual`).

### 5.2 Pluralización

Tablas en plural: `trabajadores`, `marcaciones`, `contratos`.

### 5.3 Llaves primarias

`uuid` con `gen_random_uuid()`.

### 5.4 Timestamps

Siempre `timestamptz`, almacenamiento UTC.

### 5.5 Tipos enum

Usar `CREATE TYPE ... AS ENUM` cuando el dominio es cerrado y estable.

---

## 6. Append-only y auditoría

### 6.1 Tablas append-only

`marcaciones` y `audit_log` son append-only por ley (Res. Ex. 38/2024).
Triggers bloquean UPDATE/DELETE. Nunca eliminar estos triggers.

### 6.2 Cadena hash

El payload del hash se construye con UNA función helper canónica
(`_payload_marcacion`, `_payload_audit`) invocada tanto por insert como por
verificador. Nunca duplicar la construcción del payload.

---

## 7. Migraciones

### 7.1 Formato

`node-pg-migrate` con archivos SQL y marcadores `-- Up Migration` /
`-- Down Migration`. Numeradas: `00N_descripcion.sql`.

### 7.2 Down migrations

Toda migración debe tener `down`. Para tablas append-only, el down debe
incluir un comentario advirtiendo que en producción no se ejecuta.

### 7.3 Idempotencia y portabilidad

Migraciones que dependen de configuración de plataforma (como la 009
respecto al schema de las extensiones) deben **detectar el estado real**
en vez de asumir un valor fijo. Patrón: leer de `pg_extension` /
`pg_namespace` / `pg_proc` antes de aplicar cambios.

### 7.4 Guards

Migraciones que tocan elementos críticos deben incluir un guard al final
que valide el estado deseado y falle si no se cumple.

---

## 8. Backlog técnico vigente

Items documentados al cierre del Paso A v3:

1. **pgcrypto y citext en Neon están en `public` por limitación de
   plataforma**. Si Neon llega a habilitar `ALTER EXTENSION SET SCHEMA`
   con `neondb_owner`, o si migramos fuera de Neon, ejecutar `ALTER
   EXTENSION ... SET SCHEMA extensions` y reaplicar la migración 009 (se
   readapta automáticamente).
2. PostGIS sigue en `public` por limitación de la propia extensión.
3. Cualquier función nueva que use operadores PostGIS debe calificarlos
   como `public.<operador>` o vivir en un contexto donde `public` esté en
   el search_path del invocador.
4. Si se incorpora una extensión nueva, instalarla en `extensions` cuando
   la plataforma lo permita, o `public` en caso contrario. Actualizar el
   bootstrap.

---

## 9. Cómo aplicar esto

- **Funciones nuevas**: copiar la plantilla de §2.2.
- **Migraciones nuevas**: revisar checklist contra §7.
- **Tablas nuevas**: aplicar RLS de §4.
- **Code review**: rechazar PRs que violen estas convenciones sin
  justificación documentada.

Si una convención bloquea legítimamente algo necesario, abrir la discusión
y actualizar este documento, no hacer la excepción sin registro.
