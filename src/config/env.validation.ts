import * as Joi from 'joi';

/**
 * Schema de validacion del .env. Si falta una variable o esta malformada,
 * la app NO arranca. Esto evita el clasico "estaba en localhost mira porque
 * faltaba un env var".
 */
export const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  // Connection string que usa la API en runtime (rol app_login, RLS aplica).
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),

  // Solo lo usa node-pg-migrate; la API no debe abrirla.
  MIGRATION_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),

  // Secreto de firma JWT. Minimo 32 chars para resistir brute-force.
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('8h'),
});
