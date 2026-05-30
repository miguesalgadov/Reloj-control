# =============================================================================
# Dockerfile multi-stage para la API NestJS.
#   - builder: instala todas las deps, compila TypeScript.
#   - runtime: solo node_modules de produccion + dist compilado.
# =============================================================================

FROM node:20-alpine AS builder

WORKDIR /app

# Dependencias necesarias para compilar argon2 (modulo nativo)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

# -----------------------------------------------------------------------------

FROM node:20-alpine AS runtime

WORKDIR /app

# Usuario no-root para reducir superficie de ataque
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./

USER app

EXPOSE 3000

CMD ["node", "dist/main.js"]
