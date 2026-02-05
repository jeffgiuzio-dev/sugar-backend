require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Kenna Giuzio Cake Portal API' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ============================================
// CLIENTS
// ============================================
app.get('/api/clients', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching clients:', err);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching client:', err);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

app.post('/api/clients', async (req, res) => {
  try {
    const { name, email, phone, status, event_date, event_type, guest_count, venue, source, notes, address } = req.body;
    const result = await pool.query(
      `INSERT INTO clients (name, email, phone, status, event_date, event_type, guest_count, venue, source, notes, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [name, email, phone, status || 'inquiry', event_date, event_type, guest_count, venue, source, notes, address]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating client:', err);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const { name, email, phone, status, event_date, event_type, guest_count, venue, source, notes, address } = req.body;
    const result = await pool.query(
      `UPDATE clients SET name=$1, email=$2, phone=$3, status=$4, event_date=$5, event_type=$6,
       guest_count=$7, venue=$8, source=$9, notes=$10, address=$11, updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [name, email, phone, status, event_date, event_type, guest_count, venue, source, notes, address, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating client:', err);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting client:', err);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// ============================================
// COMMUNICATIONS
// ============================================
app.get('/api/communications', async (req, res) => {
  try {
    const { client_id } = req.query;
    let query = 'SELECT * FROM communications';
    let params = [];

    if (client_id) {
      query += ' WHERE client_id = $1';
      params.push(client_id);
    }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching communications:', err);
    res.status(500).json({ error: 'Failed to fetch communications' });
  }
});

app.post('/api/communications', async (req, res) => {
  try {
    const { client_id, type, direction, subject, message, channel } = req.body;
    const result = await pool.query(
      `INSERT INTO communications (client_id, type, direction, subject, message, channel)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [client_id, type, direction || 'outbound', subject, message, channel || 'email']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating communication:', err);
    res.status(500).json({ error: 'Failed to create communication' });
  }
});

// ============================================
// INVOICES
// ============================================
app.get('/api/invoices', async (req, res) => {
  try {
    const { client_id, status } = req.query;
    let query = 'SELECT * FROM invoices';
    let conditions = [];
    let params = [];

    if (client_id) {
      params.push(client_id);
      conditions.push(`client_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching invoices:', err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

app.post('/api/invoices', async (req, res) => {
  try {
    const { client_id, type, amount, status, due_date, data } = req.body;
    const result = await pool.query(
      `INSERT INTO invoices (client_id, type, amount, status, due_date, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [client_id, type, amount, status || 'draft', due_date, JSON.stringify(data || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating invoice:', err);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

app.put('/api/invoices/:id', async (req, res) => {
  try {
    const { status, paid_at, data } = req.body;
    const result = await pool.query(
      `UPDATE invoices SET status=$1, paid_at=$2, data=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [status, paid_at, JSON.stringify(data || {}), req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating invoice:', err);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// ============================================
// PROPOSALS
// ============================================
app.get('/api/proposals', async (req, res) => {
  try {
    const { client_id } = req.query;
    let query = 'SELECT * FROM proposals';
    let params = [];

    if (client_id) {
      query += ' WHERE client_id = $1';
      params.push(client_id);
    }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching proposals:', err);
    res.status(500).json({ error: 'Failed to fetch proposals' });
  }
});

app.post('/api/proposals', async (req, res) => {
  try {
    const { client_id, proposal_number, status, data, signed_at, signature } = req.body;
    const result = await pool.query(
      `INSERT INTO proposals (client_id, proposal_number, status, data, signed_at, signature)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [client_id, proposal_number, status || 'draft', JSON.stringify(data || {}), signed_at, signature]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating proposal:', err);
    res.status(500).json({ error: 'Failed to create proposal' });
  }
});

app.put('/api/proposals/:id', async (req, res) => {
  try {
    const { status, data, signed_at, signature } = req.body;
    const result = await pool.query(
      `UPDATE proposals SET status=$1, data=$2, signed_at=$3, signature=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [status, JSON.stringify(data || {}), signed_at, signature, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating proposal:', err);
    res.status(500).json({ error: 'Failed to update proposal' });
  }
});

// ============================================
// CALENDAR EVENTS
// ============================================
app.get('/api/events', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM calendar_events ORDER BY event_date ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

app.post('/api/events', async (req, res) => {
  try {
    const { client_id, title, event_date, event_time, event_type, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO calendar_events (client_id, title, event_date, event_time, event_type, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [client_id, title, event_date, event_time, event_type, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

app.delete('/api/events/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM calendar_events WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting event:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// ============================================
// EXPENSES & REVENUE (Finance)
// ============================================
app.get('/api/expenses', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses ORDER BY expense_date DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching expenses:', err);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

app.post('/api/expenses', async (req, res) => {
  try {
    const { vendor, amount, category, expense_date, notes, receipt_url, allocations } = req.body;
    const result = await pool.query(
      `INSERT INTO expenses (vendor, amount, category, expense_date, notes, receipt_url, allocations)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [vendor, amount, category, expense_date, notes, receipt_url, JSON.stringify(allocations || [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating expense:', err);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

app.get('/api/revenue', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM revenue ORDER BY revenue_date DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching revenue:', err);
    res.status(500).json({ error: 'Failed to fetch revenue' });
  }
});

app.post('/api/revenue', async (req, res) => {
  try {
    const { client_id, invoice_id, amount, type, revenue_date, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO revenue (client_id, invoice_id, amount, type, revenue_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [client_id, invoice_id, amount, type, revenue_date, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating revenue:', err);
    res.status(500).json({ error: 'Failed to create revenue' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`KGC Portal API running on port ${PORT}`);
});
