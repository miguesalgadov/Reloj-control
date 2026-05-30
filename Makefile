# =============================================================================
# Makefile — Reloj Control
# Orquesta base de datos (Neon cloud), migraciones, seeds, tests y API.
# Uso: make <target>. Ejecutar `make help` para ver todo.
# =============================================================================

include .env
export

MIGRATE  = npx node-pg-migrate --migration-file-language sql -m db/migrations \
           --database-url-var MIGRATION_DATABASE_URL

NODE_SQL = node scripts/run-sql.js

.PHONY: help db-up migrate migrate-down seed test-db db-reset api-dev api-build api-start

help: ## Muestra esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# --- Base de datos ---

db-up: ## Corre el bootstrap contra Neon (extensiones, roles, schema rc)
	$(NODE_SQL) db/bootstrap/000_bootstrap.sql

migrate: ## Aplica migraciones pendientes (db/migrations)
	$(MIGRATE) up

migrate-down: ## Revierte la ultima migracion
	$(MIGRATE) down

seed: ## Carga datos de demo (solo dev)
	$(NODE_SQL) db/seeds/dev_seed.sql

test-db: ## Corre la suite de validacion funcional
	$(NODE_SQL) db/tests/tests_funcionales.sql

db-reset: ## DESTRUCTIVO: re-aplica bootstrap, migra y siembra
	$(NODE_SQL) db/bootstrap/000_bootstrap.sql
	$(MIGRATE) up
	$(NODE_SQL) db/seeds/dev_seed.sql
	@echo "Base reseteada, migrada y sembrada."

# --- API NestJS ---

api-dev: ## Levanta la API en modo watch (desarrollo)
	npm run start:dev

api-build: ## Compila TypeScript a dist/
	npm run build

api-start: ## Levanta la API en modo produccion (requiere build previo)
	npm run start
