// Carga .env.test en process.env ANTES de que cualquier modulo NestJS sea
// importado. setupFiles corre antes de cada suite, garantizando que
// DATABASE_URL apunte a reloj_control_test y nunca a la DB de desarrollo.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.test') });
