// Migration: Add event_end_time column to clients table
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
  try {
    console.log('Running migration: Add event_end_time column...');

    await pool.query(`
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS event_end_time TIME;
    `);

    console.log('✅ Migration complete: event_end_time column added');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
