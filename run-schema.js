// Quick script to run schema.sql on Railway PostgreSQL
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.argv[2] || process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('Usage: node run-schema.js <DATABASE_URL>');
    process.exit(1);
}

async function runSchema() {
    const client = new Client({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Connecting to database...');
        await client.connect();
        console.log('Connected!');

        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        console.log('Running schema...');
        await client.query(schema);
        console.log('Schema created successfully!');

        // Verify tables
        const result = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);

        console.log('\nTables created:');
        result.rows.forEach(row => console.log('  - ' + row.table_name));

    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

runSchema();
