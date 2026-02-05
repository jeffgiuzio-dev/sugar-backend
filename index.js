require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Google OAuth2 setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'https://sugar-backend-production.up.railway.app/auth/google/callback'
);

// Gmail API
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

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
// GMAIL OAUTH & EMAIL SYNC
// ============================================

// Start OAuth flow - redirects to Google
app.get('/auth/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  res.redirect(authUrl);
});

// OAuth callback - exchanges code for tokens
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Store refresh token in database for persistence
    await pool.query(`
      INSERT INTO settings (key, value)
      VALUES ('gmail_refresh_token', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [tokens.refresh_token || tokens.access_token]);

    // Redirect to frontend with success
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8000';
    res.redirect(`${frontendUrl}/admin/settings.html?gmail=connected`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Failed to authenticate with Google');
  }
});

// Check Gmail connection status
app.get('/api/gmail/status', async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");

    if (result.rows.length === 0) {
      return res.json({ connected: false });
    }

    // Try to refresh token and verify connection
    oauth2Client.setCredentials({ refresh_token: result.rows[0].value });

    try {
      await gmail.users.getProfile({ userId: 'me' });
      res.json({ connected: true });
    } catch (err) {
      res.json({ connected: false, error: 'Token expired' });
    }
  } catch (err) {
    console.error('Gmail status check error:', err);
    res.status(500).json({ error: 'Failed to check Gmail status' });
  }
});

// Sync emails - fetch recent emails and match to clients
app.post('/api/gmail/sync', async (req, res) => {
  try {
    // Get stored refresh token
    const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");

    if (tokenResult.rows.length === 0) {
      return res.status(401).json({ error: 'Gmail not connected. Please authenticate first.' });
    }

    oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });

    // Get last sync timestamp
    const lastSyncResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_last_sync'");
    const lastSync = lastSyncResult.rows.length > 0 ? lastSyncResult.rows[0].value : null;

    // Build query - get emails from last 7 days or since last sync
    let query = 'newer_than:7d';
    if (lastSync) {
      const syncDate = new Date(lastSync);
      query = `after:${Math.floor(syncDate.getTime() / 1000)}`;
    }

    // Fetch messages
    const messagesResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100
    });

    const messages = messagesResponse.data.messages || [];
    let synced = 0;
    let matched = 0;

    // Get all client emails for matching
    const clientsResult = await pool.query('SELECT id, name, email FROM clients WHERE email IS NOT NULL');
    const clientEmails = {};
    clientsResult.rows.forEach(c => {
      if (c.email) clientEmails[c.email.toLowerCase()] = c;
    });

    // Process each message
    for (const msg of messages) {
      try {
        // Get full message details
        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full'
        });

        const headers = fullMsg.data.payload.headers;
        const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        const from = getHeader('From');
        const to = getHeader('To');
        const subject = getHeader('Subject');
        const date = getHeader('Date');
        const messageId = getHeader('Message-ID');

        // Extract email addresses
        const fromEmail = from.match(/<(.+?)>/) ? from.match(/<(.+?)>/)[1].toLowerCase() : from.toLowerCase();
        const toEmail = to.match(/<(.+?)>/) ? to.match(/<(.+?)>/)[1].toLowerCase() : to.toLowerCase();

        // Check if already synced (by gmail message ID)
        const existingCheck = await pool.query(
          'SELECT id FROM communications WHERE external_id = $1',
          [msg.id]
        );

        if (existingCheck.rows.length > 0) {
          continue; // Already synced
        }

        // Try to match to a client
        let client = clientEmails[fromEmail] || clientEmails[toEmail];

        if (!client) {
          // Also check team members
          const teamResult = await pool.query(
            'SELECT client_id FROM team_members WHERE LOWER(email) = $1 OR LOWER(email) = $2',
            [fromEmail, toEmail]
          );
          if (teamResult.rows.length > 0) {
            const clientResult = await pool.query('SELECT id, name, email FROM clients WHERE id = $1', [teamResult.rows[0].client_id]);
            if (clientResult.rows.length > 0) {
              client = clientResult.rows[0];
            }
          }
        }

        if (client) {
          // Get message body
          let body = '';
          if (fullMsg.data.payload.body && fullMsg.data.payload.body.data) {
            body = Buffer.from(fullMsg.data.payload.body.data, 'base64').toString('utf-8');
          } else if (fullMsg.data.payload.parts) {
            const textPart = fullMsg.data.payload.parts.find(p => p.mimeType === 'text/plain');
            if (textPart && textPart.body && textPart.body.data) {
              body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
            }
          }

          // Determine direction
          const kennaEmail = process.env.KENNA_EMAIL || 'hello@kennagiuziocake.com';
          const direction = fromEmail.includes(kennaEmail.split('@')[0]) ? 'outbound' : 'inbound';

          // Insert communication
          await pool.query(`
            INSERT INTO communications (client_id, type, direction, subject, message, channel, external_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [client.id, 'email', direction, subject, body.substring(0, 10000), 'gmail', msg.id, new Date(date)]);

          matched++;
        }

        synced++;
      } catch (msgErr) {
        console.error('Error processing message:', msg.id, msgErr.message);
      }
    }

    // Update last sync timestamp
    await pool.query(`
      INSERT INTO settings (key, value)
      VALUES ('gmail_last_sync', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [new Date().toISOString()]);

    res.json({
      success: true,
      total: messages.length,
      synced,
      matched,
      message: `Synced ${synced} emails, ${matched} matched to clients`
    });

  } catch (err) {
    console.error('Gmail sync error:', err);
    res.status(500).json({ error: 'Failed to sync emails', details: err.message });
  }
});

// Disconnect Gmail
app.post('/api/gmail/disconnect', async (req, res) => {
  try {
    await pool.query("DELETE FROM settings WHERE key IN ('gmail_refresh_token', 'gmail_last_sync')");
    res.json({ success: true });
  } catch (err) {
    console.error('Gmail disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect Gmail' });
  }
});

// Send email via Gmail
app.post('/api/gmail/send', async (req, res) => {
  try {
    const { to, subject, message, client_id } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'Missing required fields: to, message' });
    }

    // Get stored refresh token
    const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
    if (tokenResult.rows.length === 0) {
      return res.status(401).json({ error: 'Gmail not connected. Please authenticate first.' });
    }

    oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });

    // Get Kenna's email for the From header
    const kennaEmail = process.env.KENNA_EMAIL || 'hello@kennagiuziocake.com';

    // Build the email
    const emailLines = [
      `To: ${to}`,
      `From: ${kennaEmail}`,
      `Subject: ${subject || ''}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      message
    ];
    const email = emailLines.join('\r\n');

    // Encode to base64url
    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send via Gmail API
    const sendResult = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail
      }
    });

    // Log the communication if client_id provided
    if (client_id) {
      await pool.query(`
        INSERT INTO communications (client_id, type, direction, subject, message, channel, external_id, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [client_id, 'email', 'outbound', subject || '', message, 'gmail', sendResult.data.id]);
    }

    res.json({
      success: true,
      messageId: sendResult.data.id,
      message: 'Email sent successfully'
    });

  } catch (err) {
    console.error('Gmail send error:', err);
    res.status(500).json({ error: 'Failed to send email', details: err.message });
  }
});

// ============================================
// PUBLIC INQUIRY ENDPOINT (Website Form)
// ============================================
app.post('/api/inquiries', async (req, res) => {
  try {
    const { name, email, event_date, guest_count, venue, message } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    // Create client in database
    const clientResult = await pool.query(
      `INSERT INTO clients (name, email, status, event_date, guest_count, venue, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, email, 'inquiry', event_date || null, guest_count || null, venue || null, message || null, 'website']
    );

    const newClient = clientResult.rows[0];

    // Send notification email to Kenna
    try {
      const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");

      if (tokenResult.rows.length > 0) {
        oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });

        const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';

        // Build notification email
        const eventInfo = event_date ? `\nEvent Date: ${event_date}` : '';
        const guestInfo = guest_count ? `\nGuest Count: ${guest_count}` : '';
        const venueInfo = venue ? `\nVenue/Location: ${venue}` : '';
        const visionInfo = message ? `\n\nTheir Vision:\n${message}` : '';

        const notificationBody = `New inquiry from your website!

Name: ${name}
Email: ${email}${eventInfo}${guestInfo}${venueInfo}${visionInfo}

---
View in Sugar: https://portal.kennagiuziocake.com/clients/view.html?id=${newClient.id}`;

        const emailLines = [
          `To: ${kennaEmail}`,
          `From: ${kennaEmail}`,
          `Subject: New Inquiry: ${name}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          notificationBody
        ];
        const emailRaw = emailLines.join('\r\n');

        const encodedEmail = Buffer.from(emailRaw)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodedEmail }
        });

        console.log(`Inquiry notification sent to ${kennaEmail} for client ${newClient.id}`);
      }
    } catch (emailErr) {
      // Log but don't fail the request if email fails
      console.error('Failed to send inquiry notification email:', emailErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Inquiry received',
      clientId: newClient.id
    });

  } catch (err) {
    console.error('Error creating inquiry:', err);
    res.status(500).json({ error: 'Failed to submit inquiry' });
  }
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
    const { name, email, phone, status, event_date, event_type, guest_count, venue, source, notes, address,
            tasting_date, tasting_time, tasting_guests, event_time, archived, instagram, linkedin, website, company } = req.body;
    const result = await pool.query(
      `INSERT INTO clients (name, email, phone, status, event_date, event_type, guest_count, venue, source, notes, address,
       tasting_date, tasting_time, tasting_guests, event_time, archived, instagram, linkedin, website, company)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING *`,
      [name, email, phone, status || 'inquiry', event_date, event_type, guest_count, venue, source, notes, address,
       tasting_date, tasting_time, tasting_guests, event_time, archived || false, instagram, linkedin, website, company]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating client:', err);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const { name, email, phone, status, event_date, event_type, guest_count, venue, source, notes, address,
            tasting_date, tasting_time, tasting_guests, event_time, archived, instagram, linkedin, website, company } = req.body;
    const result = await pool.query(
      `UPDATE clients SET name=$1, email=$2, phone=$3, status=$4, event_date=$5, event_type=$6,
       guest_count=$7, venue=$8, source=$9, notes=$10, address=$11,
       tasting_date=$12, tasting_time=$13, tasting_guests=$14, event_time=$15, archived=$16,
       instagram=$17, linkedin=$18, website=$19, company=$20, updated_at=NOW()
       WHERE id=$21 RETURNING *`,
      [name, email, phone, status, event_date, event_type, guest_count, venue, source, notes, address,
       tasting_date, tasting_time, tasting_guests, event_time, archived, instagram, linkedin, website, company, req.params.id]
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
// PORTAL DATA
// ============================================
app.get('/api/portal/:clientId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM portal_data WHERE client_id = $1', [req.params.clientId]);
    if (result.rows.length === 0) {
      return res.json({});
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching portal data:', err);
    res.status(500).json({ error: 'Failed to fetch portal data' });
  }
});

app.put('/api/portal/:clientId', async (req, res) => {
  try {
    const { tasting_paid, deposit_paid, final_paid, files, notes, internal_notes } = req.body;

    // Upsert - insert or update
    const result = await pool.query(`
      INSERT INTO portal_data (client_id, tasting_paid, deposit_paid, final_paid, files, notes, internal_notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (client_id) DO UPDATE SET
        tasting_paid = COALESCE($2, portal_data.tasting_paid),
        deposit_paid = COALESCE($3, portal_data.deposit_paid),
        final_paid = COALESCE($4, portal_data.final_paid),
        files = COALESCE($5, portal_data.files),
        notes = COALESCE($6, portal_data.notes),
        internal_notes = COALESCE($7, portal_data.internal_notes),
        updated_at = NOW()
      RETURNING *`,
      [req.params.clientId, tasting_paid, deposit_paid, final_paid,
       JSON.stringify(files || []), JSON.stringify(notes || []), JSON.stringify(internal_notes || [])]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating portal data:', err);
    res.status(500).json({ error: 'Failed to update portal data' });
  }
});

// ============================================
// TEAM MEMBERS
// ============================================
app.get('/api/team/:clientId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM team_members WHERE client_id = $1 ORDER BY sort_order ASC',
      [req.params.clientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching team members:', err);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

app.post('/api/team', async (req, res) => {
  try {
    const { client_id, name, email, phone, role, role_type, sort_order } = req.body;
    const result = await pool.query(
      `INSERT INTO team_members (client_id, name, email, phone, role, role_type, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [client_id, name, email, phone, role, role_type, sort_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating team member:', err);
    res.status(500).json({ error: 'Failed to create team member' });
  }
});

app.put('/api/team/:id', async (req, res) => {
  try {
    const { name, email, phone, role, role_type, sort_order } = req.body;
    const result = await pool.query(
      `UPDATE team_members SET name=$1, email=$2, phone=$3, role=$4, role_type=$5, sort_order=$6
       WHERE id=$7 RETURNING *`,
      [name, email, phone, role, role_type, sort_order, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team member not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating team member:', err);
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

app.delete('/api/team/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM team_members WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team member not found' });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting team member:', err);
    res.status(500).json({ error: 'Failed to delete team member' });
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

// ============================================
// IMPORTED CALENDARS
// ============================================
app.get('/api/imported-calendars', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM imported_calendars ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching imported calendars:', err);
    res.status(500).json({ error: 'Failed to fetch imported calendars' });
  }
});

app.get('/api/imported-calendars/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM imported_calendars WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Imported calendar not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching imported calendar:', err);
    res.status(500).json({ error: 'Failed to fetch imported calendar' });
  }
});

app.post('/api/imported-calendars', async (req, res) => {
  try {
    const { name, source_url, color, events, enabled } = req.body;
    const result = await pool.query(
      `INSERT INTO imported_calendars (name, source_url, color, events, enabled, last_synced)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [name, source_url, color || '#999999', JSON.stringify(events || []), enabled !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating imported calendar:', err);
    res.status(500).json({ error: 'Failed to create imported calendar' });
  }
});

app.put('/api/imported-calendars/:id', async (req, res) => {
  try {
    const { name, source_url, color, events, enabled, last_synced } = req.body;
    const result = await pool.query(
      `UPDATE imported_calendars SET
       name = COALESCE($1, name),
       source_url = COALESCE($2, source_url),
       color = COALESCE($3, color),
       events = COALESCE($4, events),
       enabled = COALESCE($5, enabled),
       last_synced = COALESCE($6, last_synced),
       updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [name, source_url, color, events ? JSON.stringify(events) : null, enabled, last_synced, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Imported calendar not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating imported calendar:', err);
    res.status(500).json({ error: 'Failed to update imported calendar' });
  }
});

app.delete('/api/imported-calendars/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM imported_calendars WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Imported calendar not found' });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting imported calendar:', err);
    res.status(500).json({ error: 'Failed to delete imported calendar' });
  }
});

// ============================================
// SETTINGS (Generic key-value store)
// ============================================
app.get('/api/settings/:key', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings WHERE key = $1', [req.params.key]);
    if (result.rows.length === 0) {
      return res.json({ key: req.params.key, value: null });
    }
    // Parse value if it's JSON
    const row = result.rows[0];
    try {
      row.value = JSON.parse(row.value);
    } catch (e) {
      // Value is not JSON, leave as-is
    }
    res.json(row);
  } catch (err) {
    console.error('Error fetching setting:', err);
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

app.put('/api/settings/:key', async (req, res) => {
  try {
    const { value } = req.body;
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const result = await pool.query(`
      INSERT INTO settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
      RETURNING *`,
      [req.params.key, valueStr]
    );
    // Parse value back for response
    const row = result.rows[0];
    try {
      row.value = JSON.parse(row.value);
    } catch (e) {
      // Value is not JSON, leave as-is
    }
    res.json(row);
  } catch (err) {
    console.error('Error saving setting:', err);
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

app.delete('/api/settings/:key', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM settings WHERE key = $1 RETURNING *', [req.params.key]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Setting not found' });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting setting:', err);
    res.status(500).json({ error: 'Failed to delete setting' });
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
