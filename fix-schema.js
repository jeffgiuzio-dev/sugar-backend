// Comprehensive schema fix migration
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixSchema() {
  try {
    console.log('🔧 Starting comprehensive schema fix...');

    // Fix clients table - ensure correct column types
    console.log('Adding missing columns to clients table...');
    await pool.query(`
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS tasting_date DATE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS tasting_time TIME;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS tasting_guests INTEGER;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS event_time TIME;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS event_end_time TIME;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS tasting_end_time TIME;
    `);

    // Fix calendar_events table
    console.log('Adding event_end_time to calendar_events...');
    await pool.query(`
      ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS event_end_time TIME;
    `);

    // Clean up any invalid data
    console.log('Cleaning up invalid TIME values...');
    await pool.query(`
      UPDATE clients
      SET tasting_time = NULL
      WHERE tasting_time::text = '' OR tasting_time IS NULL;

      UPDATE clients
      SET tasting_end_time = NULL
      WHERE tasting_end_time::text = '' OR tasting_end_time IS NULL;

      UPDATE clients
      SET event_time = NULL
      WHERE event_time::text = '' OR event_time IS NULL;

      UPDATE clients
      SET event_end_time = NULL
      WHERE event_end_time::text = '' OR event_end_time IS NULL;
    `).catch(err => console.log('Cleanup warning:', err.message));

    console.log('✅ Schema fix complete!');
    console.log('\nVerifying columns...');

    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'clients'
      AND column_name IN ('tasting_time', 'tasting_end_time', 'event_time', 'event_end_time', 'tasting_guests')
      ORDER BY column_name;
    `);

    console.log('\nClients table columns:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    });

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Schema fix failed:', error);
    await pool.end();
    process.exit(1);
  }
}

fixSchema();
