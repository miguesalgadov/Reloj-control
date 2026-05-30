#!/usr/bin/env node
// Ejecuta un archivo SQL contra la base usando DATABASE_URL o MIGRATION_DATABASE_URL.
// Preprocesa el archivo eliminando metacomandos de psql (\echo, \set, etc.)
// que el driver pg no entiende.
//
// Uso: node scripts/run-sql.js <archivo.sql> [--url-var VAR_NAME]
//   --url-var  Variable de entorno que contiene la connection string.
//              Por defecto usa MIGRATION_DATABASE_URL.

'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Client } = require('pg');

// ---------- args ----------
const args    = process.argv.slice(2);
const urlVarIdx = args.indexOf('--url-var');
const urlVar  = urlVarIdx !== -1 ? args[urlVarIdx + 1] : 'MIGRATION_DATABASE_URL';
const sqlFile = args.find(a => {
  if (a.startsWith('--')) return false;
  if (urlVarIdx !== -1 && a === args[urlVarIdx + 1]) return false;
  return true;
});

if (!sqlFile) {
  console.error('Uso: node scripts/run-sql.js <archivo.sql> [--url-var VAR]');
  process.exit(1);
}

const connStr = process.env[urlVar];
if (!connStr) {
  console.error(`Variable de entorno "${urlVar}" no está definida.`);
  process.exit(1);
}

// ---------- leer y preprocesar ----------
const filePath   = path.resolve(sqlFile);
const rawContent = fs.readFileSync(filePath, 'utf8');

// Elimina lineas que empiezan con backslash (metacomandos psql: \echo, \set, \i, etc.)
const sql = rawContent
  .split('\n')
  .filter(line => !line.trimStart().startsWith('\\'))
  .join('\n');

// ---------- ejecutar ----------
async function main() {
  const client = new Client({ connectionString: connStr });
  await client.connect();
  console.log(`\n▶  Ejecutando ${path.basename(filePath)} …\n`);
  try {
    // Ejecutar como bloque unico para que los SET LOCAL de los BEGIN/COMMIT funcionen
    const result = await client.query(sql);
    // pg devuelve un array si hay varios statements, o un objeto si es uno solo
    const rows = Array.isArray(result) ? result : [result];
    for (const r of rows) {
      if (r.rows && r.rows.length > 0) {
        console.table(r.rows);
      }
    }
    console.log('\n✔  OK\n');
  } catch (err) {
    console.error('\n✖  Error ejecutando SQL:\n', err.message);
    if (err.detail)   console.error('   Detail :', err.detail);
    if (err.hint)     console.error('   Hint   :', err.hint);
    if (err.position) console.error('   Pos    :', err.position);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
