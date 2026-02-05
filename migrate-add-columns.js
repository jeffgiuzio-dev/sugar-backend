// Migration: Add missing columns to clients table
const { Client } = require('pg');

const DATABASE_URL = process.argv[2] || process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('Usage: node migrate-add-columns.js <DATABASE_URL>');
    process.exit(1);
}

async function migrate() {
    const client = new Client({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Connecting to database...');
        await client.connect();
        console.log('Connected!');

        console.log('Adding missing columns to clients table...');

        // Add columns if they don't exist
        const alterStatements = [
            'ALTER TABLE clients ADD COLUMN IF NOT EXISTS tasting_date DATE',
            'ALTER TABLE clients ADD COLUMN IF NOT EXISTS tasting_time TIME',
            'ALTER TABLE clients ADD COLUMN IF NOT EXISTS tasting_guests INTEGER',
            'ALTER TABLE clients ADD COLUMN IF NOT EXISTS event_time TIME',
            'ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE',
        ];

        for (const sql of alterStatements) {
            try {
                await client.query(sql);
                console.log('  ✓ ' + sql.split('ADD COLUMN IF NOT EXISTS ')[1]);
            } catch (err) {
                console.log('  - ' + err.message);
            }
        }

        console.log('\nMigration complete!');

        // Show current columns
        const result = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'clients'
            ORDER BY ordinal_position
        `);
        console.log('\nCurrent clients table columns:');
        result.rows.forEach(row => console.log('  - ' + row.column_name + ' (' + row.data_type + ')'));

    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

migrate();
