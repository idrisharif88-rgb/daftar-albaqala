import mysql from 'mysql2/promise';

// Shared connection pool to daftar_db. Credentials come from server/.env.
// timezone 'Z' keeps DATETIME reads/writes in UTC (we store everything as UTC).
export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
});
