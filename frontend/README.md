# Reloj Control — Frontend del Trabajador

PWA mobile-first para que los trabajadores marquen su asistencia desde el celular.
Construida con Next.js 16 (App Router), Tailwind CSS y TanStack Query.

## Requisitos

- Node.js 20+
- Backend `reloj-control` corriendo en `http://localhost:3000`

## Instalación

```bash
cd frontend
npm install
cp .env.local.example .env.local   # editar si el backend usa otro puerto
npm run dev                         # inicia en http://localhost:3001
```

## Variables de entorno

| Variable | Descripción | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | URL base del backend | `http://localhost:3000` |

## Pantallas

| Ruta | Descripción |
|---|---|
| `/login` | Formulario de login con JWT |
| `/` | Jornada del día + botón de marcaje con GPS |
| `/marcaciones` | Historial de marcaciones con paginación |

## Estructura

```
app/            Next.js App Router (pages)
components/
  auth/         AuthGuard
  marcaje/      JornadaCard, EstadoActual, BotonMarcar, MarcacionItem
  shared/       Header, NavBottom, Spinner, QueryProvider
  ui/           Componentes base (Button, Card, Input, Label)
lib/
  api.ts        Cliente HTTP unificado con auto-inject JWT
  auth.ts       login / logout / getToken
  geolocation.ts Wrapper de navigator.geolocation
  types.ts      Tipos TypeScript compartidos
  queries/      Hooks de TanStack Query
public/
  manifest.json PWA manifest
  icons/        Iconos SVG placeholder (reemplazar con PNG en producción)
```

## Marcaje

El flujo de marcaje requiere permiso de geolocalización del navegador.
Si el permiso es denegado, se muestra un mensaje con instrucciones.
Sin conexión a internet, la operación falla con mensaje explícito.

## Notas de producción

- **Iconos PWA**: reemplazar `public/icons/*.svg` con PNG de 192×192 y 512×512.
- **JWT en localStorage**: deuda registrada — migrar a cookies HTTP-only antes de producción real.
- **CORS**: configurar `FRONTEND_URL` en el backend con la URL de producción.
