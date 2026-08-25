// CommonJS on purpose: sequelize-cli runs migrations in its own runtime and
// does not understand the TypeScript ESM the rest of the backend uses
// (research.md D9). This file reads the SAME root .env as backend/src/config/env.ts.
const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const base = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  dialect: 'mysql',
  define: {
    underscored: true,
    timestamps: true,
  },
};

module.exports = {
  development: { ...base },
  test: { ...base },
  production: { ...base },
};
