# Operaciones de Base de Datos

> **Estado:** Vigente.
> **Audiencia:** Desarrolladores con acceso privilegiado a la base.
> **Propósito:** Documentar procedimientos que **no** corren como parte del
> flujo normal de migraciones y requieren un rol privilegiado o intervención
> manual.

---

## 1. Modelo de conexiones del proyecto

| Variable de entorno | Rol Postgres | Quién la usa | Para qué |
|---|---|---|---|
| `DATABASE_URL` | `app_login` (miembro de `app_user`) | API NestJS en runtime | Operaciones de negocio. RLS aplica. |
| `MIGRATION_DATABASE_URL` | `neondb_owner` en Neon / `postgres` local | Runner de migraciones (`node-pg-migrate`) | Aplicar migraciones versionadas. |
| `NEONDB_OWNER_URL` (opcional) | `neondb_owner` directo | Operaciones puntuales sobre Neon | Procedimientos privilegiados específicos. Nunca en código de aplicación. |

**Regla**: la credencial owner se usa solo para los procedimientos
documentados en este archivo. Si aparece la necesidad de un procedimiento
nuevo que la requiera, se documenta acá antes de ejecutarlo.

---

## 2. Procedimientos disponibles

### 2.1 Verificar estado de extensiones

**Cuándo**: como diagnóstico de salud de una base, o antes de aplicar
migraciones que dependan del schema de las extensiones.

**Cómo**:

```sql
SELECT extname, n.nspname AS schema, r.rolname AS owner
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  JOIN pg_roles r ON r.oid = e.extowner
 WHERE extname IN ('pgcrypto', 'citext', 'postgis');
```

**Estado esperado**:

| Plataforma | pgcrypto | citext | postgis |
|---|---|---|---|
| Neon | `public` | `public` | `public` |
| Self-managed / Docker local | `extensions` | `extensions` | `public` |

Ver §1.2 de `convenciones-bd.md` para detalles de por qué la asimetría.

---

## 3. Procedimientos retirados

### 3.1 Upgrade de extensiones a schema `extensions` en Neon ❌

**Status**: **NO ES POSIBLE EN NEON**. Documentado para referencia
histórica.

**Por qué se intentó**: las funciones `SECURITY DEFINER` con `search_path`
acotado a `rc, pg_catalog` no encontraban `digest()` ni `citext` cuando
esas extensiones vivían en `public`. La intención era moverlas a un schema
dedicado `extensions` y blindar el `search_path` con `rc, extensions,
pg_catalog`.

**Por qué falla**: `ALTER EXTENSION ... SET SCHEMA` requiere que el rol que
lo ejecuta sea owner de **cada función individual** de la extensión, no
solo de la extensión en sí. En Neon, funciones como `pgp_sym_decrypt` son
owned por un rol interno de la plataforma al que `neondb_owner` no puede
asumir. Falla con `must be owner of function pgp_sym_decrypt (SQLSTATE
42501)` incluso desde el SQL Editor del panel.

**Resolución actual**: la migración 009 detecta dinámicamente el schema
real de las extensiones y blinda el `search_path` con ese valor. En Neon
queda `rc, public, pg_catalog`; en bases self-managed queda `rc,
extensions, pg_catalog`. La seguridad se mantiene en ambos casos (ver §1.5
de `convenciones-bd.md`).

**Condiciones para reabrir**: si Neon habilita el upgrade en algún momento
(o migramos fuera de Neon), reabrir esta sección y agregar el procedimiento.

---

## 4. Convenciones para nuevos procedimientos privilegiados

Cualquier procedimiento que se agregue a `scripts/db/` o se documente acá
debe:

1. **Ser idempotente**: re-ejecutarlo debe ser seguro y reportar "nada que
   hacer" si ya está aplicado.
2. **Verificar privilegios al inicio**: el script falla rápido con mensaje
   claro si se ejecuta con el rol equivocado.
3. **Validar al final**: el script verifica que el estado deseado se
   alcanzó.
4. **Documentarse acá**: agregar una sección en §2 antes de ejecutar.

---

## 5. Anti-patrones a evitar

- **NO** ejecutar fragmentos sueltos de SQL como `neondb_owner` "para
  probar". Si requiere privilegios elevados, va en un script versionado.
- **NO** poner `NEONDB_OWNER_URL` en `MIGRATION_DATABASE_URL` "para que
  funcione". Las migraciones versionadas no deben requerir owner.
- **NO** compartir el connection string de `neondb_owner` por chat, Slack,
  email, o en repositorio. Solo en gestores de secretos locales.

---

## 6. Backlog de procedimientos previstos

Items que probablemente requieran un runbook acá en el futuro:

- Rotación periódica de contraseñas de roles aplicativos.
- Restauración desde backup punto-en-tiempo (Neon Branching).
- Vacuum y reindex sobre `marcaciones` cuando supere cierto volumen.
- Migración entre regiones de Neon (si aplica).
- Procedimiento de "freeze" para corte mensual de reportes DT.
- Si Neon habilita ALTER EXTENSION SET SCHEMA: procedimiento de upgrade.
