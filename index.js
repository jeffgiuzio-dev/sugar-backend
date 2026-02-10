require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const { google } = require('googleapis');
const twilio = require('twilio');
const Stripe = require('stripe');
const OpenAI = require('openai');
const cron = require('node-cron');
const PDFDocument = require('pdfkit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Helper to convert empty strings to null
const nullIfEmpty = (val) => (val === '' || val === undefined) ? null : val;

// Extract first name(s) — handles couples: "Sophia & Emma Williams" → "Sophia & Emma"
function getFirstName(fullName) {
  if (!fullName) return 'there';
  const name = fullName.trim();
  if (name.includes(' & ')) {
    const parts = name.split(' ');
    parts.pop(); // remove last name
    return parts.join(' ');
  }
  return name.split(' ')[0];
}

// Google OAuth2 setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'https://sugar-backend-production.up.railway.app/auth/google/callback'
);

// Gmail API
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// Twilio setup
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// Stripe setup
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// OpenAI setup
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

// Use raw body for Stripe webhook, JSON for everything else
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payments/webhook') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json({ limit: '10mb' })(req, res, next);
  }
});

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

    // Build query - always cap at 7 days max, use lastSync if more recent
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let sinceDate = sevenDaysAgo;
    if (lastSync) {
      const syncDate = new Date(lastSync);
      if (syncDate > sevenDaysAgo) sinceDate = syncDate;
    }
    const query = `after:${Math.floor(sinceDate.getTime() / 1000)}`;

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
          const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';
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
    const { to, subject, message, html, client_id } = req.body;

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
    const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';

    // Build the email (multipart/alternative if HTML provided, plain text otherwise)
    let email;
    if (html) {
      const boundary = 'boundary_' + Date.now().toString(36);
      const emailLines = [
        `To: ${to}`,
        `From: ${kennaEmail}`,
        `Subject: ${subject || ''}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 7bit',
        '',
        message,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: 7bit',
        '',
        html,
        '',
        `--${boundary}--`
      ];
      email = emailLines.join('\r\n');
    } else {
      const emailLines = [
        `To: ${to}`,
        `From: ${kennaEmail}`,
        `Subject: ${subject || ''}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        message
      ];
      email = emailLines.join('\r\n');
    }

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
// TWILIO SMS & VOICE
// ============================================

// Send SMS
app.post('/api/sms/send', async (req, res) => {
  try {
    const { to, message, client_id } = req.body;

    if (!twilioClient) {
      return res.status(503).json({ error: 'Twilio not configured' });
    }

    if (!to || !message) {
      return res.status(400).json({ error: 'Missing required fields: to, message' });
    }

    // Clean phone number (remove formatting, ensure +1 prefix)
    let phone = to.replace(/\D/g, '');
    if (phone.length === 10) phone = '1' + phone;
    if (!phone.startsWith('+')) phone = '+' + phone;

    const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

    const smsResult = await twilioClient.messages.create({
      body: message,
      from: twilioNumber,
      to: phone
    });

    // Log to communications
    if (client_id) {
      await pool.query(`
        INSERT INTO communications (client_id, type, direction, subject, message, channel, external_id, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [client_id, 'text', 'outbound', null, message, 'twilio', smsResult.sid]);
    }

    res.json({
      success: true,
      sid: smsResult.sid,
      message: 'SMS sent successfully'
    });

  } catch (err) {
    console.error('SMS send error:', err);
    res.status(500).json({ error: 'Failed to send SMS', details: err.message });
  }
});

// Webhook for incoming SMS (Twilio calls this)
app.post('/api/sms/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { From, Body, MessageSid } = req.body;

    console.log(`Incoming SMS from ${From}: ${Body}`);

    // Clean phone number for matching
    let phone = From.replace(/\D/g, '');
    if (phone.startsWith('1') && phone.length === 11) phone = phone.substring(1);

    // Try to match to a client by phone
    const clientResult = await pool.query(`
      SELECT id, name FROM clients
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE $1
      LIMIT 1
    `, ['%' + phone]);

    let clientId = null;
    let clientName = 'Unknown';

    if (clientResult.rows.length > 0) {
      clientId = clientResult.rows[0].id;
      clientName = clientResult.rows[0].name;
    }

    // Log the incoming message
    await pool.query(`
      INSERT INTO communications (client_id, type, direction, subject, message, channel, external_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [clientId, 'text', 'inbound', null, Body, 'twilio', MessageSid]);

    // Send notification email to Kenna
    try {
      const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
      if (tokenResult.rows.length > 0) {
        oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });
        const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';

        const emailBody = `New text message received!

From: ${clientName} (${From})
Message: ${Body}

${clientId ? `View in Sugar: https://portal.kennagiuziocake.com/clients/view.html?id=${clientId}` : 'Client not found in system - may be a new inquiry.'}`;

        const emailLines = [
          `To: ${kennaEmail}`,
          `From: ${kennaEmail}`,
          `Subject: Text from ${clientName}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          emailBody
        ];

        const encodedEmail = Buffer.from(emailLines.join('\r\n'))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodedEmail }
        });
      }
    } catch (emailErr) {
      console.error('Failed to send SMS notification email:', emailErr.message);
    }

    // Respond to Twilio (empty TwiML = no auto-reply)
    res.type('text/xml').send('<Response></Response>');

  } catch (err) {
    console.error('SMS webhook error:', err);
    res.type('text/xml').send('<Response></Response>');
  }
});

// Webhook for incoming voice calls (plays voicemail greeting)
app.post('/api/voice/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  // Play greeting and record voicemail
  twiml.say(
    { voice: 'alice' },
    "Hi, you've reached Kenna Giuzio Cake. I'm unable to take your call right now. Please leave a message with your name and number, and I'll get back to you soon. You can also text this number or email kenna at kenna giuzio cake dot com."
  );

  twiml.record({
    maxLength: 120,
    action: '/api/voice/voicemail',
    transcribe: true,
    transcribeCallback: '/api/voice/transcription'
  });

  twiml.say({ voice: 'alice' }, "I didn't receive a message. Goodbye.");

  res.type('text/xml').send(twiml.toString());
});

// Handle voicemail recording completion
app.post('/api/voice/voicemail', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { From, RecordingUrl, RecordingDuration } = req.body;

    console.log(`Voicemail from ${From}: ${RecordingUrl} (${RecordingDuration}s)`);

    // Clean phone for matching
    let phone = From.replace(/\D/g, '');
    if (phone.startsWith('1') && phone.length === 11) phone = phone.substring(1);

    // Try to match client
    const clientResult = await pool.query(`
      SELECT id, name FROM clients
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE $1
      LIMIT 1
    `, ['%' + phone]);

    let clientId = null;
    let clientName = 'Unknown';

    if (clientResult.rows.length > 0) {
      clientId = clientResult.rows[0].id;
      clientName = clientResult.rows[0].name;
    }

    // Log voicemail
    await pool.query(`
      INSERT INTO communications (client_id, type, direction, subject, message, channel, external_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [clientId, 'call', 'inbound', 'Voicemail', `Voicemail (${RecordingDuration}s): ${RecordingUrl}`, 'twilio', RecordingUrl]);

    // Email notification to Kenna
    try {
      const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
      if (tokenResult.rows.length > 0) {
        oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });
        const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';

        const emailBody = `New voicemail received!

From: ${clientName} (${From})
Duration: ${RecordingDuration} seconds
Recording: ${RecordingUrl}

${clientId ? `View in Sugar: https://portal.kennagiuziocake.com/clients/view.html?id=${clientId}` : 'Caller not found in system.'}`;

        const emailLines = [
          `To: ${kennaEmail}`,
          `From: ${kennaEmail}`,
          `Subject: Voicemail from ${clientName}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          emailBody
        ];

        const encodedEmail = Buffer.from(emailLines.join('\r\n'))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodedEmail }
        });
      }
    } catch (emailErr) {
      console.error('Failed to send voicemail notification:', emailErr.message);
    }

  } catch (err) {
    console.error('Voicemail handler error:', err);
  }

  // End call
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.say({ voice: 'alice' }, "Thank you. Goodbye.");
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// Handle voicemail transcription (optional, Twilio sends this async)
app.post('/api/voice/transcription', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { TranscriptionText, RecordingUrl } = req.body;

    if (TranscriptionText) {
      // Update the communication record with transcription
      await pool.query(`
        UPDATE communications
        SET message = message || E'\n\nTranscription: ' || $1
        WHERE external_id = $2
      `, [TranscriptionText, RecordingUrl]);

      console.log(`Transcription for ${RecordingUrl}: ${TranscriptionText}`);
    }
  } catch (err) {
    console.error('Transcription handler error:', err);
  }

  res.sendStatus(200);
});

// Get Twilio status
app.get('/api/twilio/status', (req, res) => {
  res.json({
    configured: !!twilioClient,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || null
  });
});

// ============================================
// STRIPE PAYMENTS
// ============================================

// Get Stripe status
app.get('/api/stripe/status', (req, res) => {
  res.json({
    configured: !!stripe,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    version: 'combined-tasting-email-v4'
  });
});

// Create Checkout Session
app.post('/api/payments/create-checkout', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }

    const { invoice_id, invoice_type, client_id, client_name, client_email, amount, description } = req.body;

    if (!amount || !description) {
      return res.status(400).json({ error: 'Missing required fields: amount, description' });
    }

    // Amount should be in dollars, Stripe needs cents
    const amountCents = Math.round(parseFloat(amount) * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: description,
            description: `Kenna Giuzio Cake - ${client_name || 'Client'}`
          },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      mode: 'payment',
      customer_email: client_email || undefined,
      metadata: {
        invoice_id: invoice_id || '',
        invoice_type: invoice_type || '',
        client_id: client_id || '',
        client_name: client_name || ''
      },
      success_url: `${process.env.FRONTEND_URL || 'https://portal.kennagiuziocake.com'}/invoices/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://portal.kennagiuziocake.com'}/invoices/payment-cancelled.html`
    });

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url
    });

  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session', details: err.message });
  }
});

// Create PaymentIntent (for embedded payment form)
app.post('/api/payments/create-payment-intent', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }

    const { invoice_id, invoice_type, client_id, client_name, client_email, amount, description } = req.body;

    if (!amount || !description) {
      return res.status(400).json({ error: 'Missing required fields: amount, description' });
    }

    const amountCents = Math.round(parseFloat(amount) * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      payment_method_types: ['card'],
      metadata: {
        invoice_id: invoice_id || '',
        invoice_type: invoice_type || '',
        client_id: client_id || '',
        client_name: client_name || '',
        client_email: client_email || ''
      },
      receipt_email: client_email || undefined,
      description: description
    });

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret
    });

  } catch (err) {
    console.error('Stripe PaymentIntent error:', err);
    res.status(500).json({ error: 'Failed to create payment intent', details: err.message });
  }
});

// Test-confirm a PaymentIntent with Stripe test card (sandbox only)
app.post('/api/payments/test-confirm', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

    // Only allow in test mode
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!pk.startsWith('pk_test_')) {
      return res.status(403).json({ error: 'Test confirm only available in sandbox mode' });
    }

    const { paymentIntentId } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: 'Missing paymentIntentId' });

    // Confirm the PaymentIntent with a test payment method
    const confirmed = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: 'pm_card_visa'
    });

    res.json({ success: true, status: confirmed.status });
  } catch (err) {
    console.error('Test confirm error:', err);
    res.status(500).json({ error: 'Test confirm failed', details: err.message });
  }
});

// Debug: manually test confirmation email for a PaymentIntent (sandbox only)
app.post('/api/payments/test-send-confirmation', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!pk.startsWith('pk_test_')) {
      return res.status(403).json({ error: 'Only available in sandbox mode' });
    }

    const { paymentIntentId } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: 'Missing paymentIntentId' });

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const meta = pi.metadata || {};

    // Check Gmail token
    const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
    const hasToken = tokenResult.rows.length > 0;

    const diagnostics = {
      paymentIntentId: pi.id,
      status: pi.status,
      amount: pi.amount,
      receipt_email: pi.receipt_email,
      metadata: meta,
      client_email_from_metadata: meta.client_email,
      effective_email: pi.receipt_email || meta.client_email,
      gmail_token_exists: hasToken,
      would_send_email: !!(pi.receipt_email || meta.client_email) && hasToken
    };

    // If requested, actually try sending the email
    if (req.body.send === true && diagnostics.would_send_email) {
      try {
        const clientEmail = pi.receipt_email || meta.client_email;
        const clientName = meta.client_name || 'Test';
        const amountCents = pi.amount;
        const firstName = getFirstName(clientName);
        const amountFormatted = '$' + (amountCents / 100).toFixed(2);
        const paymentDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });

        oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });
        const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';

        const plainText = `Payment Confirmed\n\nDear ${firstName},\n\nThank you for your payment of ${amountFormatted}.\n\nWarmly,\nKenna`;
        const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#f5f2ed; font-family:Arial, sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ed; padding:30px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background:#ffffff;">
  <tr><td style="height:160px; background:url('https://portal.kennagiuziocake.com/images/header-flowers.jpg') 30% center / cover no-repeat;"></td></tr>
  <tr><td align="center" style="padding:30px 0 10px;">
    <img src="https://portal.kennagiuziocake.com/images/logo.png" alt="Kenna Giuzio Cake" style="height:60px; width:auto;">
  </td></tr>
  <tr><td style="padding:20px 40px 10px; text-align:center;">
    <h1 style="font-family:Georgia, serif; font-size:24px; font-weight:normal; color:#1a1a1a; margin:0 0 16px;">Payment Confirmed</h1>
    <div style="font-size:32px; font-weight:600; color:#b5956a; margin-bottom:20px;">${amountFormatted}</div>
    <p style="font-size:14px; color:#666; line-height:1.7; margin:0;">${paymentDate}</p>
  </td></tr>
  <tr><td style="padding:0 40px;"><div style="border-top:1px solid #e8e0d5;"></div></td></tr>
  <tr><td style="padding:24px 40px 30px;">
    <p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 16px;">Dear ${firstName},</p>
    <p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 16px;">Thank you for your payment. Your tasting is confirmed!</p>
    <p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 16px;">I'm so looking forward to meeting you and creating something beautiful together.</p>
    <p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;">Warmly,</p>
    <p style="font-size:14px; color:#444; line-height:1.8; margin:0;">Kenna</p>
  </td></tr>
  <tr><td style="background:#faf8f5; padding:20px 40px; text-align:center; border-top:1px solid #e8e0d5;">
    <p style="font-size:12px; color:#999; margin:0 0 4px;">Kenna Giuzio Cake &middot; An Artisan Studio</p>
    <p style="font-size:12px; color:#999; margin:0;">(206) 472-5401 &middot; <a href="mailto:kenna@kennagiuziocake.com" style="color:#b5956a;">kenna@kennagiuziocake.com</a></p>
  </td></tr>
</table>
</td></tr></table></body></html>`;

        const subject = 'Kenna Giuzio Cake - Tasting Paid & Confirmed';
        let pdfBuffer = null;
        try {
          pdfBuffer = await generateReceiptPDF({
            type: 'tasting', clientName: clientName,
            amountFormatted, paymentDate, paymentMethod: 'Test Payment',
            amountRaw: amountCents / 100, isCardPayment: true,
            receiptNumber: `KGC-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString().slice(-4)}`
          });
        } catch (pdfErr) { console.error('PDF generation failed (test):', pdfErr.message); }

        let encoded;
        if (pdfBuffer) {
          encoded = buildRawEmailWithAttachment({
            to: clientEmail, from: kennaEmail, subject, plainText, htmlBody,
            attachment: { filename: 'KGC-Payment-Receipt.pdf', contentType: 'application/pdf', data: pdfBuffer }
          });
        } else {
          const boundary = 'boundary_' + Date.now().toString(36);
          const emailLines = [
            `To: ${clientEmail}`, `From: ${kennaEmail}`, `Subject: ${subject}`,
            'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`,
            '', `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', '', plainText, '',
            `--${boundary}`, 'Content-Type: text/html; charset=utf-8', '', htmlBody, '', `--${boundary}--`
          ];
          encoded = Buffer.from(emailLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }

        await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
        diagnostics.email_sent = true;
        diagnostics.sent_to = clientEmail;
      } catch (emailErr) {
        diagnostics.email_sent = false;
        diagnostics.email_error = emailErr.message;
      }
    }

    res.json(diagnostics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test PDF receipt generation (sandbox only)
app.get('/api/test/pdf-receipt', async (req, res) => {
  try {
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!pk.startsWith('pk_test_')) {
      return res.status(403).json({ error: 'Only available in sandbox mode' });
    }
    const pdfBuffer = await generateReceiptPDF({
      type: 'tasting',
      clientName: 'Test Client',
      amountFormatted: '$150.00',
      amountRaw: 150.00, isCardPayment: true,
      paymentDate: 'February 9, 2026',
      paymentMethod: 'Visa •••• 4242',
      receiptNumber: 'KGC-20260209-TEST',
      tastingDate: 'Wednesday, February 26, 2026',
      tastingTime: '2 PM'
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="test-receipt.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF test error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Test proposal PDF generation (sandbox only)
app.get('/api/test/proposal-pdf/:clientId', async (req, res) => {
  try {
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!pk.startsWith('pk_test_')) {
      return res.status(403).json({ error: 'Only available in sandbox mode' });
    }
    const propResult = await pool.query("SELECT * FROM proposals WHERE client_id = $1 ORDER BY updated_at DESC LIMIT 1", [req.params.clientId]);
    if (propResult.rows.length === 0) return res.status(404).json({ error: 'No proposal found' });
    const pdfBuffer = await generateProposalPDF(propResult.rows[0]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="proposal.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Proposal PDF test error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ============================================
// DEV TOOLS — Sandbox only
// ============================================

// Trigger reminder check on demand (same as 9 AM cron)
app.post('/api/test/check-reminders', async (req, res) => {
  try {
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!pk.startsWith('pk_test_')) {
      return res.status(403).json({ error: 'Only available in sandbox mode' });
    }
    await checkUpcomingEvents();
    res.json({ success: true, message: 'Reminder check completed' });
  } catch (err) {
    console.error('Test check-reminders error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reset reminders for a client (so you can re-test)
app.post('/api/test/reset-reminders', async (req, res) => {
  try {
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!pk.startsWith('pk_test_')) {
      return res.status(403).json({ error: 'Only available in sandbox mode' });
    }
    const { clientId } = req.body;
    if (clientId) {
      await pool.query('DELETE FROM reminders_sent WHERE client_id = $1', [clientId]);
      res.json({ success: true, message: `Reminders reset for client ${clientId}` });
    } else {
      await pool.query('DELETE FROM reminders_sent');
      res.json({ success: true, message: 'All reminders reset' });
    }
  } catch (err) {
    console.error('Test reset-reminders error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get reminder status for all booked clients
app.get('/api/test/reminder-status', async (req, res) => {
  try {
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!pk.startsWith('pk_test_')) {
      return res.status(403).json({ error: 'Only available in sandbox mode' });
    }
    const clients = await pool.query(`
      SELECT c.id, c.name, c.email, c.status, c.event_date,
             EXTRACT(DAY FROM (c.event_date - NOW())) as days_until
      FROM clients c
      WHERE c.status = 'booked' AND c.event_date IS NOT NULL AND c.event_date > NOW()
      ORDER BY c.event_date ASC
    `);
    const reminders = await pool.query('SELECT * FROM reminders_sent ORDER BY sent_at DESC');
    res.json({
      booked_clients: clients.rows,
      reminders_sent: reminders.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test: fire deposit reminder for a specific client (sandbox only)
app.post('/api/test/deposit-reminder', async (req, res) => {
  try {
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!pk.startsWith('pk_test_')) {
      return res.status(403).json({ error: 'Only available in sandbox mode' });
    }
    const { clientId } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    // Get the proposal and client
    const proposalResult = await pool.query('SELECT * FROM proposals WHERE client_id = $1 AND status = $2 LIMIT 1', [clientId, 'signed']);
    if (proposalResult.rows.length === 0) {
      return res.status(404).json({ error: 'No signed proposal found for this client' });
    }
    const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const proposal = proposalResult.rows[0];
    const client = clientResult.rows[0];

    // Clear any previous reminder for this client so we can re-test
    await pool.query("DELETE FROM reminders_sent WHERE client_id = $1 AND type = 'deposit-reminder'", [clientId]);

    const sent = await sendDepositReminder(proposal, client);
    res.json({ success: sent, message: sent ? `Deposit reminder sent to ${client.email}` : 'Failed to send' });
  } catch (err) {
    console.error('Test deposit-reminder error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Test: run the deposit reminder check (same as hourly cron, sandbox only)
app.post('/api/test/check-deposit-reminders', async (req, res) => {
  try {
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!pk.startsWith('pk_test_')) {
      return res.status(403).json({ error: 'Only available in sandbox mode' });
    }
    await checkDepositReminders();
    res.json({ success: true, message: 'Deposit reminder check completed' });
  } catch (err) {
    console.error('Test check-deposit-reminders error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Test: Fire inquiry response for a specific client
app.post('/api/test/inquiry-response', async (req, res) => {
  try {
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
    if (!pk.startsWith('pk_test_')) {
      return res.status(403).json({ error: 'Only available in sandbox mode' });
    }
    const { clientId } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = clientResult.rows[0];
    if (!client.email) {
      return res.status(400).json({ error: 'Client has no email address' });
    }

    // Clear any previous inquiry-response record so we can re-test
    await pool.query("DELETE FROM reminders_sent WHERE client_id = $1 AND type = 'inquiry-response'", [clientId]);

    const sent = await sendInquiryResponse(client);
    res.json({ success: sent, message: sent ? `Inquiry response sent to ${client.email}` : 'Failed to send' });
  } catch (err) {
    console.error('Test inquiry-response error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Client claims they sent an offline payment (Zelle, cash, check)
// Does NOT mark as paid — sets to pending_verification for Kenna to confirm
app.post('/api/payments/offline-claimed', async (req, res) => {
  try {
    const { invoice_id, invoice_type, client_id, client_name, client_email, amount, payment_method } = req.body;
    const method = payment_method || 'zelle';

    if (!amount) {
      return res.status(400).json({ error: 'Missing required field: amount' });
    }

    const amountFormatted = '$' + parseFloat(amount).toFixed(2);
    const methodLabel = method.charAt(0).toUpperCase() + method.slice(1);

    // Set invoice status to pending_verification (NOT paid) and store payment method
    try {
      if (invoice_id) {
        const updateResult = await pool.query(`
          UPDATE invoices SET status = 'pending_verification',
          data = COALESCE(data, '{}'::jsonb) || $2::jsonb,
          updated_at = NOW()
          WHERE invoice_number = $1
          RETURNING id
        `, [invoice_id, JSON.stringify({ payment_method: method })]);

        // If invoice didn't exist in DB yet (created on client browser only), insert it
        if (updateResult.rowCount === 0) {
          await pool.query(`
            INSERT INTO invoices (client_id, invoice_number, type, amount, status, data, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'pending_verification', $5, NOW(), NOW())
          `, [
            client_id || null,
            invoice_id,
            invoice_type || 'deposit',
            parseFloat(amount) || 0,
            JSON.stringify({ payment_method: method, client_name: client_name, client_email: client_email })
          ]);
        }
      }
    } catch (dbErr) {
      console.error('Offline claim: Failed to update/create invoice:', dbErr.message);
    }

    // Send notification email to Kenna — she needs to verify
    try {
      const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
      if (tokenResult.rows.length > 0) {
        oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });
        const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';
        const emailBody = `${methodLabel} payment claim received!\n\nClient: ${client_name || 'Unknown'}\nAmount: ${amountFormatted}\nMethod: ${methodLabel}\nType: ${invoice_type || 'Payment'}\n\nThe client says they sent payment via ${methodLabel}. Please verify in your bank/records and confirm in the admin portal.\n\n${client_id ? `View client: https://portal.kennagiuziocake.com/clients/view.html?id=${client_id}` : ''}\nVerify payments: https://portal.kennagiuziocake.com/admin/finances.html`;

        const emailLines = [
          `To: ${kennaEmail}`,
          `From: ${kennaEmail}`,
          `Subject: Action Required: Verify ${methodLabel} Payment of ${amountFormatted} from ${client_name || 'Client'}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          emailBody
        ];

        const encodedEmail = Buffer.from(emailLines.join('\r\n'))
          .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedEmail } });
      }
    } catch (emailErr) {
      console.error('Failed to send offline payment notification to Kenna:', emailErr.message);
    }

    // Log the claim
    try {
      if (client_id) {
        await pool.query(`
          INSERT INTO communications (client_id, type, direction, subject, message, channel, created_at)
          VALUES ($1, 'payment', 'inbound', $2, $3, $4, NOW())
        `, [client_id, `${methodLabel} payment claimed: ${amountFormatted}`, `Client claims ${methodLabel} payment of ${amountFormatted} for ${invoice_type || 'invoice'}. Pending verification.`, method]);
      }
    } catch (dbErr) {
      console.error('Failed to log offline claim:', dbErr.message);
    }

    res.json({ success: true, status: 'pending_verification', message: `${methodLabel} payment claim recorded. Awaiting verification.` });

  } catch (err) {
    console.error('Offline claim error:', err);
    res.status(500).json({ error: 'Failed to record payment claim', details: err.message });
  }
});

// Format PostgreSQL time (e.g. "14:00:00") to "2:00 PM"
function formatTime(timeStr) {
  if (!timeStr) return null;
  // If already formatted (contains AM/PM), return as-is
  if (/[ap]m/i.test(timeStr)) return timeStr;
  const parts = timeStr.split(':');
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1] || '00';
  const ampm = hours >= 12 ? 'PM' : 'AM';
  if (hours > 12) hours -= 12;
  if (hours === 0) hours = 12;
  return minutes === '00' ? `${hours} ${ampm}` : `${hours}:${minutes} ${ampm}`;
}

// ===== Image fetcher for PDFs (works on Railway where local files don't exist) =====

// Cache fetched images in memory so we don't re-download every PDF
const _imageCache = {};

async function fetchImageBuffer(url) {
  if (_imageCache[url]) return _imageCache[url];
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    _imageCache[url] = buf;
    return buf;
  } catch (e) {
    console.error('Failed to fetch image:', url, e.message);
    return null;
  }
}

async function loadImage(localPaths, remoteUrl) {
  const fs = require('fs');
  // Try local paths first (for dev)
  const localPath = localPaths.find(p => { try { fs.accessSync(p); return true; } catch { return false; } });
  if (localPath) return localPath;
  // Fall back to fetching from public URL
  if (remoteUrl) {
    return await fetchImageBuffer(remoteUrl);
  }
  return null;
}

// ===== PDF Receipt Generator =====

async function generateReceiptPDF(receiptData) {
  // Pre-fetch images before entering the sync PDF generation
  const bannerImg = await loadImage([
    path.join(__dirname, 'client-portal', 'images', 'header-flowers.jpg'),
    path.join(__dirname, '..', 'images', 'header-flowers.jpg'),
    path.join(__dirname, 'images', 'header-flowers.jpg')
  ], 'https://portal.kennagiuziocake.com/images/header-flowers.jpg');

  const logoImg = await loadImage([
    path.join(__dirname, 'client-portal', 'images', 'logo.png'),
    path.join(__dirname, '..', 'images', 'logo.png'),
    path.join(__dirname, 'images', 'logo.png')
  ], 'https://portal.kennagiuziocake.com/images/logo.png');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'letter', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#b5956a';
    const darkText = '#1a1a1a';
    const lightText = '#666666';
    const pageWidth = 612 - 100; // letter width minus margins

    // Round down to nearest dollar, no cents
    const fmt = (n) => '$' + Math.floor(parseFloat(n)).toLocaleString();

    // Banner image (full width, top of page)
    const bannerHeight = 120;
    if (bannerImg) {
      try {
        doc.image(bannerImg, 0, 0, { width: 612, height: bannerHeight });
        doc.save();
        doc.rect(0, 0, 612, bannerHeight).fill('rgba(255,255,255,0.15)');
        doc.restore();
      } catch (e) { /* skip banner */ }
    }

    // Logo (centered on banner)
    if (logoImg) {
      try { doc.image(logoImg, (612 - 120) / 2, (bannerHeight - 50) / 2, { width: 120 }); } catch (e) { /* skip */ }
    }

    // Title (below banner)
    doc.font('Times-Roman').fontSize(18).fillColor(gold)
      .text('PAYMENT RECEIPT', 50, bannerHeight + 15, { align: 'center', width: pageWidth });

    // Gold divider
    const dividerY = bannerHeight + 42;
    doc.moveTo(50, dividerY).lineTo(562, dividerY).strokeColor(gold).lineWidth(1).stroke();

    // Receipt # and Date (same line, compact)
    const contentStart = dividerY + 8;
    doc.font('Helvetica').fontSize(8).fillColor(lightText);
    doc.text(`Receipt #: ${receiptData.receiptNumber}`, 50, contentStart, { align: 'right', width: pageWidth });
    doc.text(`Date: ${receiptData.paymentDate}`, 50, contentStart + 12, { align: 'right', width: pageWidth });

    // BILL TO
    doc.font('Helvetica-Bold').fontSize(8).fillColor(gold).text('BILL TO', 50, contentStart);
    doc.font('Helvetica').fontSize(10).fillColor(darkText)
      .text(receiptData.clientName || 'Client', 50, contentStart + 12);

    // PAYMENT DETAILS
    let y = contentStart + 35;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(gold).text('PAYMENT DETAILS', 50, y);
    y += 14;

    const descriptionByType = {
      tasting: 'Tasting Fee',
      deposit: 'Event Deposit',
      final: 'Final Balance Payment'
    };

    const detailRows = [
      ['Description', descriptionByType[receiptData.type] || 'Payment']
    ];

    // Deposit receipts: full proposal accounting (all floor'd)
    if (receiptData.type === 'deposit' && receiptData.proposalTotal) {
      const proposalTotal = Math.floor(parseFloat(receiptData.proposalTotal));
      const tastingCredit = Math.floor(parseFloat(receiptData.tastingCredit) || 0);
      const revisedTotal = proposalTotal - tastingCredit;
      const deposit = Math.floor(revisedTotal / 2);
      detailRows.push(['Proposal Total', fmt(proposalTotal)]);
      if (tastingCredit > 0) {
        detailRows.push(['Tasting Credit', '-' + fmt(tastingCredit)]);
      }
      detailRows.push(['Revised Total', fmt(revisedTotal)]);
      detailRows.push(['Deposit (50%)', fmt(deposit)]);
      if (receiptData.isCardPayment) {
        const ccFee = Math.floor(deposit * 0.03);
        detailRows.push(['CC Processing Fee (3%)', fmt(ccFee)]);
        detailRows.push(['Total Charged', fmt(deposit + ccFee)]);
      } else {
        detailRows.push(['Amount Due', fmt(deposit)]);
      }
    } else if (receiptData.isCardPayment && receiptData.amountRaw) {
      // Tasting / final: simple CC fee breakdown (floor'd)
      const totalCharged = Math.floor(parseFloat(receiptData.amountRaw));
      const subtotal = Math.floor(totalCharged / 1.03);
      const ccFee = totalCharged - subtotal;
      detailRows.push(['Subtotal', fmt(subtotal)]);
      detailRows.push(['CC Processing Fee (3%)', fmt(ccFee)]);
      detailRows.push(['Total Charged', fmt(totalCharged)]);
    } else {
      detailRows.push(['Amount', receiptData.amountFormatted]);
    }

    detailRows.push(['Method', receiptData.paymentMethod]);
    detailRows.push(['Status', 'Paid']);

    const labelX = 50;
    const valueX = 210;
    const rowH = 20;

    detailRows.forEach((row, i) => {
      const rowY = y + (i * rowH);
      if (i % 2 === 0) {
        doc.rect(45, rowY - 2, pageWidth + 10, rowH - 1).fill('#faf8f5');
      }
      doc.font('Helvetica-Bold').fontSize(9).fillColor(darkText)
        .text(row[0], labelX, rowY + 3);
      doc.font('Helvetica').fontSize(9).fillColor(darkText)
        .text(row[1], valueX, rowY + 3);
    });

    y += detailRows.length * rowH + 12;

    // Type-specific details (compact)
    if (receiptData.type === 'tasting' && receiptData.tastingDate) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(gold).text('TASTING DETAILS', 50, y);
      y += 14;
      const tastingRows = [['Tasting Date', receiptData.tastingDate]];
      if (receiptData.tastingTime) tastingRows.push(['Time', receiptData.tastingTime]);
      tastingRows.forEach((row, i) => {
        const rowY = y + (i * rowH);
        if (i % 2 === 0) doc.rect(45, rowY - 2, pageWidth + 10, rowH - 1).fill('#faf8f5');
        doc.font('Helvetica-Bold').fontSize(9).fillColor(darkText).text(row[0], labelX, rowY + 3);
        doc.font('Helvetica').fontSize(9).fillColor(darkText).text(row[1], valueX, rowY + 3);
      });
      y += tastingRows.length * rowH;
    }

    if ((receiptData.type === 'deposit' || receiptData.type === 'final') && receiptData.eventDate) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(gold).text('EVENT DETAILS', 50, y);
      y += 14;
      const eventRows = [];
      if (receiptData.eventType) eventRows.push(['Event', receiptData.eventType]);
      if (receiptData.eventDate) eventRows.push(['Event Date', receiptData.eventDate]);
      if (receiptData.venue) eventRows.push(['Venue', receiptData.venue]);
      if (receiptData.balanceDueDate) eventRows.push(['Balance Due', receiptData.balanceDueDate]);
      eventRows.forEach((row, i) => {
        const rowY = y + (i * rowH);
        if (i % 2 === 0) doc.rect(45, rowY - 2, pageWidth + 10, rowH - 1).fill('#faf8f5');
        doc.font('Helvetica-Bold').fontSize(9).fillColor(darkText).text(row[0], labelX, rowY + 3);
        doc.font('Helvetica').fontSize(9).fillColor(darkText).text(row[1], valueX, rowY + 3);
      });
      y += eventRows.length * rowH;
    }

    // Footer
    y += 20;
    doc.moveTo(50, y).lineTo(562, y).strokeColor(gold).lineWidth(1).stroke();
    doc.font('Times-Roman').fontSize(11).fillColor(darkText)
      .text('Thank you for choosing', 50, y + 12, { align: 'center', width: pageWidth });
    doc.font('Times-Bold').fontSize(12).fillColor(darkText)
      .text('Kenna Giuzio Cake', 50, y + 28, { align: 'center', width: pageWidth });
    doc.font('Helvetica').fontSize(8).fillColor(lightText)
      .text('(206) 472-5401  |  kenna@kennagiuziocake.com', 50, y + 46, { align: 'center', width: pageWidth });

    doc.end();
  });
}

// ===== Signed Proposal PDF Generator =====

async function generateProposalPDF(proposal) {
  // Pre-fetch images before entering sync PDF generation
  const bannerImg = await loadImage([
    path.join(__dirname, 'client-portal', 'images', 'header-flowers.jpg'),
    path.join(__dirname, '..', 'images', 'header-flowers.jpg'),
    path.join(__dirname, 'images', 'header-flowers.jpg')
  ], 'https://portal.kennagiuziocake.com/images/header-flowers.jpg');

  const logoImg = await loadImage([
    path.join(__dirname, 'client-portal', 'images', 'logo.png'),
    path.join(__dirname, '..', 'images', 'logo.png'),
    path.join(__dirname, 'images', 'logo.png')
  ], 'https://portal.kennagiuziocake.com/images/logo.png');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'letter', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#b5956a';
    const darkText = '#1a1a1a';
    const lightText = '#666666';
    const pageWidth = 612 - 100; // letter width minus margins
    const data = typeof proposal.data === 'string' ? JSON.parse(proposal.data) : proposal.data;

    // Banner image (full width, top of page)
    const bannerHeight = 120;
    if (bannerImg) {
      try {
        doc.image(bannerImg, 0, 0, { width: 612, height: bannerHeight });
        doc.save();
        doc.rect(0, 0, 612, bannerHeight).fill('rgba(255,255,255,0.15)');
        doc.restore();
      } catch (e) { /* skip banner */ }
    }

    // Logo (centered on banner)
    if (logoImg) {
      try { doc.image(logoImg, (612 - 120) / 2, (bannerHeight - 50) / 2, { width: 120 }); } catch (e) { /* skip */ }
    }

    // Title (below banner)
    const titleY = bannerHeight + 15;
    doc.font('Times-Roman').fontSize(20).fillColor(gold)
      .text('SIGNED PROPOSAL', 50, titleY, { align: 'center', width: pageWidth });
    doc.font('Helvetica').fontSize(10).fillColor(lightText)
      .text(`Proposal #${data.proposalNumber || proposal.proposal_number || ''}`, 50, titleY + 28, { align: 'center', width: pageWidth });

    // Gold divider
    const divY = titleY + 48;
    doc.moveTo(50, divY).lineTo(562, divY).strokeColor(gold).lineWidth(1.5).stroke();

    // Client & Event info
    let y = divY + 14;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(gold).text('CLIENT', 50, y);
    y += 14;
    doc.font('Helvetica').fontSize(11).fillColor(darkText).text(data.clientName || '', 50, y);
    y += 16;
    if (data.clientEmail) { doc.fontSize(10).fillColor(lightText).text(data.clientEmail, 50, y); y += 14; }
    if (data.clientPhone) { doc.fontSize(10).fillColor(lightText).text(data.clientPhone, 50, y); y += 14; }
    if (data.clientAddress) { doc.fontSize(9).fillColor(lightText).text(data.clientAddress, 50, y, { width: 250 }); y = doc.y + 4; }

    // Event details (right column)
    let ey = divY + 14;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(gold).text('EVENT', 340, ey);
    ey += 14;
    doc.font('Helvetica').fontSize(10).fillColor(darkText);
    if (data.eventType) { doc.text(`${data.eventType}`, 340, ey); ey += 14; }
    if (data.eventDate) {
      const evtDate = new Date(data.eventDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      doc.text(evtDate, 340, ey); ey += 14;
    }
    if (data.eventTime) {
      // Format time (e.g. "14:00:00" → "2:00 PM")
      const timeParts = data.eventTime.split(':');
      let hrs = parseInt(timeParts[0], 10);
      const mins = timeParts[1] || '00';
      const ampm = hrs >= 12 ? 'PM' : 'AM';
      if (hrs > 12) hrs -= 12;
      if (hrs === 0) hrs = 12;
      const timeStr = mins === '00' ? `${hrs} ${ampm}` : `${hrs}:${mins} ${ampm}`;
      doc.text(timeStr, 340, ey); ey += 14;
    }
    if (data.venue) { doc.text(data.venue, 340, ey); ey += 14; }
    if (data.venueAddress) { doc.fontSize(9).fillColor(lightText).text(data.venueAddress, 340, ey, { width: 210 }); ey = doc.y + 4; }

    y = Math.max(y, ey) + 12;

    // Selected Design
    const selectedDesign = data.selectedDesign || 'base';
    const designPrice = data[selectedDesign + 'Price'] || data.basePrice || '0';
    const designNarrative = data[selectedDesign + 'Narrative'] || data.baseNarrative || '';
    const designLabel = selectedDesign === 'base' ? 'Base Design' : selectedDesign === 'option1' ? 'Design Option A' : 'Design Option B';

    doc.moveTo(50, y).lineTo(562, y).strokeColor('#e8e0d5').lineWidth(0.5).stroke();
    y += 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(gold).text('SELECTED DESIGN', 50, y);
    y += 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(darkText).text(designLabel, 50, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(gold).text('$' + parseFloat(designPrice).toLocaleString(), 462, y, { width: 100, align: 'right' });
    y += 16;
    if (designNarrative) {
      doc.font('Helvetica').fontSize(9).fillColor(lightText).text(designNarrative, 50, y, { width: pageWidth - 10 });
      y = doc.y + 10;
    }

    // Selected design image
    const designImages = (data.designs && data.designs[selectedDesign]) || [];
    if (designImages.length > 0) {
      try {
        const imgSrc = designImages[0];
        let imgInput = null;
        if (imgSrc.startsWith('data:image')) {
          // Data URL (base64 compressed upload) — extract and convert to Buffer
          const base64Data = imgSrc.split(',')[1];
          if (base64Data) imgInput = Buffer.from(base64Data, 'base64');
        } else {
          // File path — resolve relative to project
          const imgPaths = [
            path.join(__dirname, 'client-portal', imgSrc.replace(/^\.\.\//, '')),
            path.join(__dirname, '..', imgSrc.replace(/^\.\.\//, '')),
            path.join(__dirname, imgSrc.replace(/^\.\.\//, ''))
          ];
          const imgPath = imgPaths.find(p => { try { fs.accessSync(p); return true; } catch { return false; } });
          if (imgPath) imgInput = imgPath;
        }
        if (imgInput) {
          // Center the image, max 220px wide, max 200px tall
          const imgX = (612 - 220) / 2;
          doc.image(imgInput, imgX, y, { fit: [220, 200] });
          y += 210;
        }
      } catch (imgErr) { /* skip image if it fails */ }
    }

    // Line Items
    const items = data.items || [];
    if (items.length > 0) {
      doc.moveTo(50, y).lineTo(562, y).strokeColor('#e8e0d5').lineWidth(0.5).stroke();
      y += 10;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(gold).text('ADDITIONAL ITEMS', 50, y);
      y += 16;

      // Table header
      doc.font('Helvetica-Bold').fontSize(9).fillColor(lightText);
      doc.text('Item', 50, y); doc.text('Description', 180, y); doc.text('Qty', 390, y); doc.text('Amount', 462, y, { width: 100, align: 'right' });
      y += 14;
      doc.moveTo(50, y).lineTo(562, y).strokeColor('#e8e0d5').lineWidth(0.5).stroke();
      y += 6;

      items.forEach(item => {
        let itemPrice = 0;
        if (item.type === 'fixed') {
          itemPrice = parseFloat(item.price) || 0;
        } else {
          itemPrice = (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);
        }
        doc.font('Helvetica-Bold').fontSize(9).fillColor(darkText).text(item.name || '', 50, y, { width: 125 });
        doc.font('Helvetica').fontSize(8).fillColor(lightText).text(item.desc || '', 180, y, { width: 200 });
        const descHeight = doc.heightOfString(item.desc || '', { width: 200 });
        doc.font('Helvetica').fontSize(9).fillColor(darkText).text(item.qty || '', 390, y);
        doc.text('$' + itemPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }), 462, y, { width: 100, align: 'right' });
        y = Math.max(y + 14, doc.y) + 6;
      });
    }

    // Tasting credit
    const tastingCredit = parseFloat(data.tastingCredit) || 0;

    // Total
    y += 4;
    doc.moveTo(50, y).lineTo(562, y).strokeColor(gold).lineWidth(1).stroke();
    y += 10;

    let itemsTotal = 0;
    items.forEach(item => {
      if (item.type === 'fixed') itemsTotal += parseFloat(item.price) || 0;
      else itemsTotal += (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);
    });
    const designTotal = parseFloat(designPrice) || 0;
    const grandTotal = designTotal + itemsTotal - tastingCredit;

    doc.font('Helvetica').fontSize(10).fillColor(darkText);
    doc.text('Design', 50, y); doc.text('$' + designTotal.toLocaleString(undefined, { minimumFractionDigits: 2 }), 462, y, { width: 100, align: 'right' });
    y += 16;
    if (itemsTotal > 0) {
      doc.text('Additional Items', 50, y); doc.text('$' + itemsTotal.toLocaleString(undefined, { minimumFractionDigits: 2 }), 462, y, { width: 100, align: 'right' });
      y += 16;
    }
    if (tastingCredit > 0) {
      doc.text('Tasting Credit', 50, y); doc.fillColor('#4a9'); doc.text('-$' + tastingCredit.toLocaleString(undefined, { minimumFractionDigits: 2 }), 462, y, { width: 100, align: 'right' });
      y += 16;
    }
    doc.font('Helvetica-Bold').fontSize(13).fillColor(gold);
    doc.text('Total', 50, y); doc.text('$' + grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 }), 462, y, { width: 100, align: 'right' });
    y += 24;

    // Terms (if fits on page, otherwise new page)
    const terms = data.terms || '';
    if (terms) {
      if (y > 550) doc.addPage();
      else { doc.moveTo(50, y).lineTo(562, y).strokeColor('#e8e0d5').lineWidth(0.5).stroke(); y += 10; }
      doc.font('Helvetica-Bold').fontSize(9).fillColor(gold).text('TERMS & CONDITIONS', 50, doc.y || y);
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(7.5).fillColor(lightText).text(terms, 50, doc.y, { width: pageWidth, lineGap: 2 });
      doc.moveDown(1);
    }

    // Signature
    const sigY = doc.y + 10;
    if (sigY > 680) doc.addPage();
    doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor(gold).lineWidth(1).stroke();
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(gold).text('ACCEPTED & SIGNED', 50, doc.y);
    doc.moveDown(0.5);
    doc.font('Times-Italic').fontSize(18).fillColor(darkText).text(proposal.signature || data._signature || '', 50, doc.y);
    doc.moveDown(0.3);
    const signedDate = proposal.signed_at || data._signedAt;
    if (signedDate) {
      doc.font('Helvetica').fontSize(9).fillColor(lightText)
        .text('Signed: ' + new Date(signedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), 50, doc.y);
    }

    // Footer
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(8).fillColor(lightText)
      .text('Kenna Giuzio Cake  |  (206) 472-5401  |  kenna@kennagiuziocake.com', 50, doc.y, { align: 'center', width: pageWidth });

    doc.end();
  });
}

// ===== Raw Email Builder with Attachment(s) =====

function buildRawEmailWithAttachment({ to, from, subject, plainText, htmlBody, attachment, attachments }) {
  // Support single attachment or array of attachments
  const allAttachments = attachments || (attachment ? [attachment] : []);
  const mixedBoundary = 'mixed_' + Date.now().toString(36);
  const altBoundary = 'alt_' + Date.now().toString(36) + '_a';

  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    plainText,
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    htmlBody,
    '',
    `--${altBoundary}--`
  ];

  allAttachments.forEach(att => {
    lines.push(
      '',
      `--${mixedBoundary}`,
      `Content-Type: ${att.contentType}; name="${att.filename}"`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      att.data.toString('base64').replace(/(.{76})/g, '$1\r\n')
    );
  });

  lines.push('', `--${mixedBoundary}--`);

  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ===== Template-Aware Email Builders =====
// These read custom templates from the DB (settings table, key 'email_templates')
// and fall back to hardcoded defaults if no custom version exists.

// --- Default templates (fallback if nothing in DB) ---

const defaultTastingConfirmationTemplate = {
  subject: 'Kenna Giuzio Cake - Tasting Paid & Confirmed - {tastingDate}',
  body: `Dear {firstName},

Thank you for your payment of {amount}. Your tasting is confirmed!

Feel free to bring any inspiration photos, color swatches, or your event team members.

If you have any questions before your tasting, don't hesitate to reach out.

See you soon,
Kenna`
};

const defaultBookingConfirmationTemplate = {
  subject: "Kenna Giuzio Cake - You're Booked! - {eventDate}",
  body: `Hi {firstName},

I'm delighted to share that your date is officially booked! Thank you for trusting me with your {eventType}.

In the near future, you will receive an invitation to your event portal, which will allow you to provide wedding cake information such as delivery logistics and setup times, key team members, and a day-of contact phone number. Additionally, we will need to coordinate the return of the floral arrangements to have these preserved. I typically pick up the display cake, when possible and arranged in advance.

WHAT'S NEXT:
- If anything changes with your event, please don't hesitate to let me know.
- Your remaining balance will be due two weeks before your event ({balanceDueDate}).

I'm truly excited to create something beautiful for your celebration!

Warmly,
Kenna`
};

const defaultOneMonthReminderTemplate = {
  subject: 'Kenna Giuzio Cake - Countdown for Your Upcoming Event',
  body: `Hi {firstName},

I can hardly believe your {eventType} is just one month away! I'm truly excited to create your cake for this special occasion.

This is a friendly reminder that your remaining balance of {balanceAmount} will be due on {balanceDueDate}, which is two weeks before your event.

If you have any questions, please don't hesitate to reach out.

Looking forward to celebrating with you!

Warmly,
Kenna`
};

const defaultTwoWeekReminderTemplate = {
  subject: 'Kenna Giuzio Cake - Reminder for Your Upcoming Event',
  body: `Hi {firstName},

Your {eventType} is just two weeks away!

This is a friendly reminder that your final balance of {balanceAmount} is now due.

Payment can be made by credit card, Zelle, or check.

I'll reach out a few days before to confirm everything.

So excited for your big day!

Warmly,
Kenna`
};

// --- Template loaders (same pattern as getDepositReminderTemplate) ---

async function getTastingConfirmationTemplate() {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'email_templates'");
    if (result.rows.length > 0) {
      let custom = result.rows[0].value;
      if (typeof custom === 'string') custom = JSON.parse(custom);
      if (custom && custom['tasting-confirmation']) {
        return { ...defaultTastingConfirmationTemplate, ...custom['tasting-confirmation'] };
      }
    }
  } catch (e) {
    console.log('Could not load custom tasting confirmation template:', e.message);
  }
  return defaultTastingConfirmationTemplate;
}

async function getBookingConfirmationTemplate() {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'email_templates'");
    if (result.rows.length > 0) {
      let custom = result.rows[0].value;
      if (typeof custom === 'string') custom = JSON.parse(custom);
      if (custom && custom['booking-confirmation']) {
        return { ...defaultBookingConfirmationTemplate, ...custom['booking-confirmation'] };
      }
    }
  } catch (e) {
    console.log('Could not load custom booking confirmation template:', e.message);
  }
  return defaultBookingConfirmationTemplate;
}

async function getOneMonthReminderTemplate() {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'email_templates'");
    if (result.rows.length > 0) {
      let custom = result.rows[0].value;
      if (typeof custom === 'string') custom = JSON.parse(custom);
      if (custom && custom['one-month-reminder']) {
        return { ...defaultOneMonthReminderTemplate, ...custom['one-month-reminder'] };
      }
    }
  } catch (e) {
    console.log('Could not load custom one-month reminder template:', e.message);
  }
  return defaultOneMonthReminderTemplate;
}

async function getTwoWeekReminderTemplate() {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'email_templates'");
    if (result.rows.length > 0) {
      let custom = result.rows[0].value;
      if (typeof custom === 'string') custom = JSON.parse(custom);
      if (custom && custom['two-week-reminder']) {
        return { ...defaultTwoWeekReminderTemplate, ...custom['two-week-reminder'] };
      }
    }
  } catch (e) {
    console.log('Could not load custom two-week reminder template:', e.message);
  }
  return defaultTwoWeekReminderTemplate;
}

// --- Generic branded payment email HTML builder ---

function buildBrandedPaymentEmailHTML(bodyText, options = {}) {
  // options: { title, amountFormatted, paymentDate, methodNote, detailsHTML, ctaUrl, ctaText }
  // Convert plain text body to styled HTML paragraphs
  const paragraphs = bodyText.split(/\n\n+/).map(p => {
    const lines = p.split('\n');
    const htmlLines = lines.map(line => {
      // Style section headers like "YOUR TASTING:", "WHAT'S NEXT:", "DELIVERY DETAILS:"
      if (/^[A-Z][A-Z\s']+:?\s*$/.test(line.trim())) {
        return `<p style="font-size:13px; font-weight:500; color:#1a1a1a; text-transform:uppercase; letter-spacing:1px; margin:8px 0 4px;">${line.trim()}</p>`;
      }
      // Style bullet points
      if (/^[-•]/.test(line.trim())) {
        return `<p style="font-size:14px; color:#666; line-height:1.8; margin:0 0 4px;">&#8226; ${line.trim().replace(/^[-•]\s*/, '')}</p>`;
      }
      return line;
    });
    const joined = htmlLines.join('<br>');
    if (joined.startsWith('<p style="font-size:13px')) return joined;
    return `<p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 16px;">${joined}</p>`;
  }).join('\n    ');

  // Payment receipt header (with amount) OR simple title header (no amount)
  let headerSection = '';
  const titleFontSize = options.titleSmall ? '16px' : '24px';
  if (options.amountFormatted) {
    headerSection = `
  <tr><td style="padding:20px 40px 10px; text-align:center;">
    <h1 style="font-family:Georgia, 'Times New Roman', serif; font-size:${titleFontSize}; font-weight:normal; color:#1a1a1a; margin:0 0 ${options.subtitle ? '6px' : '16px'};">${options.title || ''}</h1>
    ${options.subtitle ? `<p style="font-family:Georgia, 'Times New Roman', serif; font-size:14px; font-weight:normal; color:#666; margin:0 0 16px;">${options.subtitle}</p>` : ''}
    <div style="font-size:32px; font-weight:600; color:#b5956a; margin-bottom:12px;">${options.amountFormatted}</div>
    <p style="font-size:14px; color:#666; line-height:1.7; margin:0 0 4px;">${options.paymentDate || ''}</p>
    ${options.methodNote || ''}
  </td></tr>
  <tr><td style="padding:8px 40px;"><div style="border-top:1px solid #e8e0d5;"></div></td></tr>`;
  } else if (options.title) {
    headerSection = `
  <tr><td style="padding:20px 40px 10px; text-align:center;">
    <h1 style="font-family:Georgia, 'Times New Roman', serif; font-size:22px; font-weight:normal; color:#1a1a1a; margin:0;">${options.title}</h1>
  </td></tr>
  <tr><td style="padding:8px 40px;"><div style="border-top:1px solid #e8e0d5;"></div></td></tr>`;
  }

  // Optional CTA button
  const ctaSection = options.ctaUrl ? `
  <tr><td align="center" style="padding:10px 40px 30px;">
    <a href="${options.ctaUrl}" style="display:inline-block; padding:14px 40px; background:#b5956a; color:#ffffff; text-decoration:none; font-size:14px; font-weight:500; letter-spacing:1px; border-radius:4px;">${options.ctaText || 'View Details'}</a>
  </td></tr>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f5f2ed; font-family:Arial, Helvetica, sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ed; padding:30px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background:#ffffff;">
  <tr><td style="height:160px; background:url('https://portal.kennagiuziocake.com/images/header-flowers.jpg') 30% center / cover no-repeat;"></td></tr>
  <tr><td align="center" style="padding:30px 0 10px;">
    <img src="https://portal.kennagiuziocake.com/images/logo.png" alt="Kenna Giuzio Cake" style="height:60px; width:auto;">
  </td></tr>${headerSection}${options.detailsHTML || ''}
  <tr><td style="padding:20px 40px 30px;">
    ${paragraphs}
  </td></tr>${ctaSection}
  <tr><td style="background:#faf8f5; padding:20px 40px; text-align:center; border-top:1px solid #e8e0d5;">
    <p style="font-size:12px; color:#999; margin:0 0 4px;">Kenna Giuzio Cake &middot; An Artisan Studio</p>
    <p style="font-size:12px; color:#999; margin:0;">(206) 472-5401 &middot; <a href="mailto:kenna@kennagiuziocake.com" style="color:#b5956a; text-decoration:none;">kenna@kennagiuziocake.com</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// --- Tasting Confirmation builders (template-aware) ---

function buildTastingConfirmationHTML(emailData, template) {
  const { firstName, amountFormatted, paymentDate, paymentMethod, tastingDate, tastingTime } = emailData;
  const methodNote = paymentMethod && paymentMethod !== 'card' ? `<p style="font-size:13px; color:#999; margin:0;">Paid via ${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}</p>` : '';
  const dateLine = tastingDate
    ? `<strong>Date:</strong> ${tastingDate}${tastingTime ? ` at ${tastingTime}` : ''}`
    : `<strong>Date:</strong> To be confirmed`;

  const tastingDetailsHTML = `
  <tr><td style="padding:24px 40px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5; border-radius:8px; padding:20px 24px;">
      <tr><td>
        <p style="font-family:Georgia, 'Times New Roman', serif; font-size:18px; font-weight:normal; color:#1a1a1a; margin:0 0 12px;">Your Tasting</p>
        <p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;">${dateLine}</p>
        <p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;"><strong>Location:</strong> Queen Anne, Seattle</p>
        <p style="font-size:14px; color:#444; line-height:1.8; margin:0;"><strong>Duration:</strong> Approximately 1-2 hours</p>
      </td></tr>
    </table>
  </td></tr>`;

  const bodyText = (template?.body || defaultTastingConfirmationTemplate.body)
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{amount\}/g, amountFormatted)
    .replace(/\{tastingDate\}/g, tastingDate || 'To be confirmed')
    .replace(/\{tastingTime\}/g, tastingTime || '');

  return buildBrandedPaymentEmailHTML(bodyText, {
    title: 'Tasting Paid & Confirmed',
    titleSmall: true,
    amountFormatted,
    paymentDate,
    methodNote,
    detailsHTML: tastingDetailsHTML
  });
}

function buildTastingConfirmationPlain(emailData, template) {
  const { firstName, amountFormatted, paymentDate, paymentMethod, tastingDate, tastingTime } = emailData;
  const methodNote = paymentMethod && paymentMethod !== 'card' ? `Paid via ${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}\n` : '';
  const dateStr = tastingDate ? `${tastingDate}${tastingTime ? ` at ${tastingTime}` : ''}` : 'To be confirmed';
  const tastingInfo = `\nYOUR TASTING:\nDate: ${dateStr}\nLocation: Queen Anne, Seattle\nDuration: Approximately 1-2 hours\n`;

  const bodyText = (template?.body || defaultTastingConfirmationTemplate.body)
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{amount\}/g, amountFormatted)
    .replace(/\{tastingDate\}/g, tastingDate || 'To be confirmed')
    .replace(/\{tastingTime\}/g, tastingTime || '');

  return `Tasting Paid & Confirmed\n\n${amountFormatted}\n${paymentDate}\n${methodNote}${tastingInfo}\n${bodyText}\n\nKenna Giuzio Cake\n(206) 472-5401\nkenna@kennagiuziocake.com`;
}

// --- Booking Confirmation builders (template-aware) ---

function buildBookingConfirmationHTML(emailData, template) {
  const { firstName, amountFormatted, paymentDate, paymentMethod, eventType, eventDate, venue, balanceDueDate } = emailData;
  const methodNote = paymentMethod && paymentMethod !== 'card' ? `<p style="font-size:13px; color:#999; margin:0;">Paid via ${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}</p>` : '';

  const eventDetailsHTML = `
  <tr><td style="padding:24px 40px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5; border-radius:8px; padding:20px 24px;">
      <tr><td>
        <p style="font-family:Georgia, 'Times New Roman', serif; font-size:18px; font-weight:normal; color:#1a1a1a; margin:0 0 12px;">Your Event</p>
        <p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;"><strong>Event:</strong> ${eventType || 'Wedding'}</p>
        <p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;"><strong>Date:</strong> ${eventDate || 'To be confirmed'}</p>
        ${venue ? `<p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;"><strong>Venue:</strong> ${venue}</p>` : ''}
        ${balanceDueDate ? `<p style="font-size:14px; color:#444; line-height:1.8; margin:0;"><strong>Final Balance Due:</strong> ${balanceDueDate}</p>` : ''}
      </td></tr>
    </table>
  </td></tr>`;

  const bodyText = (template?.body || defaultBookingConfirmationTemplate.body)
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{amount\}/g, amountFormatted)
    .replace(/\{eventType\}/g, (eventType || 'celebration').toLowerCase())
    .replace(/\{eventDate\}/g, eventDate || 'your event')
    .replace(/\{venue\}/g, venue || '')
    .replace(/\{balanceDueDate\}/g, balanceDueDate || 'two weeks before your event');

  return buildBrandedPaymentEmailHTML(bodyText, {
    title: "You're Booked!",
    subtitle: "Deposit Payment Received",
    amountFormatted,
    paymentDate,
    methodNote,
    detailsHTML: eventDetailsHTML
  });
}

function buildBookingConfirmationPlain(emailData, template) {
  const { firstName, amountFormatted, paymentDate, paymentMethod, eventType, eventDate, venue, balanceDueDate } = emailData;
  const methodNote = paymentMethod && paymentMethod !== 'card' ? `Paid via ${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}\n` : '';
  const eventInfo = `\nYOUR EVENT\nEvent: ${eventType || 'Wedding'}\nDate: ${eventDate || 'To be confirmed'}${venue ? `\nVenue: ${venue}` : ''}${balanceDueDate ? `\nFinal Balance Due: ${balanceDueDate}` : ''}\n`;

  const bodyText = (template?.body || defaultBookingConfirmationTemplate.body)
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{amount\}/g, amountFormatted)
    .replace(/\{eventType\}/g, (eventType || 'celebration').toLowerCase())
    .replace(/\{eventDate\}/g, eventDate || 'your event')
    .replace(/\{venue\}/g, venue || '')
    .replace(/\{balanceDueDate\}/g, balanceDueDate || 'two weeks before your event');

  return `You're Booked!\nDeposit Payment Received\n\n${amountFormatted}\n${paymentDate}\n${methodNote}${eventInfo}\n${bodyText}\n\nKenna Giuzio Cake\n(206) 472-5401\nkenna@kennagiuziocake.com`;
}

// ===== Deposit Reminder (Auto-Send 24h After Signing) =====

const defaultDepositReminderTemplate = {
  subject: 'Kenna Giuzio Cake - A Gentle Reminder About Your {eventType}',
  body: `Hi {firstName},

Thank you so much for signing your proposal! It was such a pleasure discussing your vision, and I'm truly looking forward to bringing it to life for your {eventType}.

I wanted to reach out because I noticed your deposit hasn't been submitted yet, and I want to make sure your date of {eventDate} stays available for you. As a reminder, your date is officially reserved once the deposit is received.

You can complete your deposit here:
[DEPOSIT LINK]

If you have any questions or would like to discuss anything before moving forward, please don't hesitate to reach out. I'm always happy to help.

Warmly,
Kenna`
};

async function getDepositReminderTemplate() {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'email_templates'");
    if (result.rows.length > 0) {
      let custom = result.rows[0].value;
      if (typeof custom === 'string') custom = JSON.parse(custom);
      if (custom && custom['deposit-reminder']) {
        return { ...defaultDepositReminderTemplate, ...custom['deposit-reminder'] };
      }
    }
  } catch (e) {
    console.log('Could not load custom template:', e.message);
  }
  return defaultDepositReminderTemplate;
}

function buildDepositReminderHTML({ firstName, eventType, eventDate, depositUrl }, template) {
  const bodyText = (template?.body || defaultDepositReminderTemplate.body)
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{eventType\}/g, eventType || 'celebration')
    .replace(/\{eventDate\}/g, eventDate || 'your upcoming event')
    .replace(/\[DEPOSIT LINK\]/g, depositUrl);

  return buildBrandedPaymentEmailHTML(bodyText, {
    title: 'A Gentle Reminder',
    ctaUrl: depositUrl,
    ctaText: 'Complete Your Deposit'
  });
}

function buildDepositReminderPlain({ firstName, eventType, eventDate, depositUrl }, template) {
  const bodyText = (template?.body || defaultDepositReminderTemplate.body)
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{eventType\}/g, eventType || 'celebration')
    .replace(/\{eventDate\}/g, eventDate || 'your upcoming event')
    .replace(/\[DEPOSIT LINK\]/g, depositUrl);

  return bodyText + '\n\nKenna Giuzio Cake\n(206) 472-5401\nkenna@kennagiuziocake.com';
}

async function sendDepositReminder(proposal, client) {
  try {
    const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
    if (tokenResult.rows.length === 0) {
      console.log('Deposit reminder: No Gmail token configured');
      return false;
    }
    oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });
    const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';

    const firstName = getFirstName(client.name);
    const eventType = client.event_type || 'celebration';
    const eventDate = client.event_date
      ? new Date(client.event_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : 'your upcoming event';
    const depositUrl = `https://portal.kennagiuziocake.com/invoices/deposit-invoice.html?clientId=${client.id}`;

    const emailData = { firstName, eventType, eventDate, depositUrl };

    // Load custom template subject if available
    const template = await getDepositReminderTemplate();
    const subject = template.subject
      .replace(/\{firstName\}/g, firstName)
      .replace(/\{eventType\}/g, eventType)
      .replace(/\{eventDate\}/g, eventDate);

    const htmlBody = buildDepositReminderHTML(emailData, template);
    const plainText = buildDepositReminderPlain(emailData, template);

    // Send to client
    const clientEmailLines = [
      `To: ${client.email}`,
      `From: Kenna Giuzio Cake <${kennaEmail}>`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="boundary123"',
      '',
      '--boundary123',
      'Content-Type: text/plain; charset=utf-8',
      '',
      plainText,
      '--boundary123',
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody,
      '--boundary123--'
    ];

    const encodedClient = Buffer.from(clientEmailLines.join('\r\n'))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedClient } });
    console.log(`Deposit reminder sent to ${client.email} for client ${client.name}`);

    // Notify Kenna
    const kennaNotifyLines = [
      `To: ${kennaEmail}`,
      `From: ${kennaEmail}`,
      `Subject: Auto-Reminder Sent: Deposit reminder to ${client.name}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      `An automatic deposit reminder was just sent to ${client.name} (${client.email}).\n\nThey signed their proposal ${Math.round((Date.now() - new Date(proposal.signed_at).getTime()) / 3600000)} hours ago but haven't paid their deposit yet.\n\nDeposit link: ${depositUrl}\nView client: https://portal.kennagiuziocake.com/clients/view.html?id=${client.id}`
    ];

    const encodedKenna = Buffer.from(kennaNotifyLines.join('\r\n'))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedKenna } });

    // Record in reminders_sent
    await pool.query('INSERT INTO reminders_sent (client_id, type) VALUES ($1, $2)', [client.id, 'deposit-reminder']);

    return true;
  } catch (err) {
    console.error('Failed to send deposit reminder:', err.message);
    return false;
  }
}

async function checkDepositReminders() {
  try {
    // Find proposals signed 24+ hours ago where no deposit payment exists and reminder not yet sent
    const result = await pool.query(`
      SELECT p.*, c.name, c.email, c.event_type, c.event_date, c.venue
      FROM proposals p
      JOIN clients c ON p.client_id = c.id
      WHERE p.status = 'signed'
        AND p.signed_at < NOW() - INTERVAL '24 hours'
        AND c.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM revenue r WHERE r.client_id = p.client_id AND r.type = 'deposit'
        )
        AND NOT EXISTS (
          SELECT 1 FROM reminders_sent rs WHERE rs.client_id = p.client_id AND rs.type = 'deposit-reminder'
        )
    `);

    if (result.rows.length === 0) return;

    console.log(`Deposit reminder check: ${result.rows.length} client(s) need reminder`);

    for (const row of result.rows) {
      const client = { id: row.client_id, name: row.name, email: row.email, event_type: row.event_type, event_date: row.event_date, venue: row.venue };
      await sendDepositReminder(row, client);
    }
  } catch (err) {
    console.error('Deposit reminder check failed:', err.message);
  }
}

// Run deposit reminder check every hour
setInterval(checkDepositReminders, 60 * 60 * 1000);
// Also run once on startup (after 30 seconds to let DB initialize)
setTimeout(checkDepositReminders, 30000);

// ===== Inquiry Response (Auto-Send on New Inquiry) =====

const defaultInquiryResponseTemplate = {
  subject: 'Kenna Giuzio Cake - Thank You for Your Inquiry - {eventType}',
  body: `Hi {firstName},

Thank you so much for reaching out about your {eventType}! I'm excited to hear about your vision for {eventDate}.

Here's how my process works:

1. TASTING CONSULTATION
Tastings are designed as a salon-style experience. A moment to slow down with cake and champagne with up to 4 additional guests, explore ideas, and determine if my work is the right fit for your celebration. The tasting fee is $250, which will then be fully credited to your final invoice should we decide to move forward together.

2. CUSTOM PROPOSAL
After our tasting, I'll create a detailed proposal with pricing based on your specific design, guest count, and any special requirements we discuss.

3. BOOKING
A 50% deposit locks in your date. The remaining balance is due two weeks before your event.

I work on a limited commission basis, with projects beginning at $2,500. Looking forward to creating something beautiful for your celebration!

Warmly,
Kenna`
};

async function getInquiryResponseTemplate() {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'email_templates'");
    if (result.rows.length > 0) {
      let custom = result.rows[0].value;
      if (typeof custom === 'string') custom = JSON.parse(custom);
      if (custom && custom['inquiry-response']) {
        return { ...defaultInquiryResponseTemplate, ...custom['inquiry-response'] };
      }
    }
  } catch (e) {
    console.log('Could not load custom inquiry response template:', e.message);
  }
  return defaultInquiryResponseTemplate;
}

// Convert template body text to branded HTML email
function buildInquiryResponseHTML(bodyText) {
  // Convert plain text paragraphs to HTML paragraphs
  const paragraphs = bodyText.split(/\n\n+/).map(p => {
    // Check if line looks like a numbered header (e.g. "1. TASTING CONSULTATION")
    const lines = p.split('\n');
    const htmlLines = lines.map(line => {
      if (/^\d+\.\s+[A-Z]/.test(line.trim())) {
        return `<p style="font-size:13px; color:#b5956a; font-weight:bold; letter-spacing:0.5px; margin:8px 0 4px;">${line.trim()}</p>`;
      }
      return line;
    });
    const joined = htmlLines.join('<br>');
    // If it's just a styled header, return as-is
    if (joined.startsWith('<p style="font-size:13px')) return joined;
    return `<p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 16px;">${joined}</p>`;
  }).join('\n    ');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f5f2ed; font-family:Arial, Helvetica, sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ed; padding:30px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background:#ffffff;">
  <!-- Banner -->
  <tr><td style="height:160px; background:url('https://portal.kennagiuziocake.com/images/header-flowers.jpg') 30% center / cover no-repeat;"></td></tr>
  <!-- Logo -->
  <tr><td align="center" style="padding:30px 0 10px;">
    <img src="https://portal.kennagiuziocake.com/images/logo.png" alt="Kenna Giuzio Cake" style="height:60px; width:auto;">
  </td></tr>
  <!-- Title -->
  <tr><td style="padding:20px 40px 10px; text-align:center;">
    <h1 style="font-family:Georgia, 'Times New Roman', serif; font-size:22px; font-weight:normal; color:#1a1a1a; margin:0;">Thank You for Reaching Out</h1>
  </td></tr>
  <!-- Divider -->
  <tr><td style="padding:8px 40px;"><div style="border-top:1px solid #e8e0d5;"></div></td></tr>
  <!-- Message -->
  <tr><td style="padding:20px 40px 30px;">
    ${paragraphs}
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#faf8f5; padding:20px 40px; text-align:center; border-top:1px solid #e8e0d5;">
    <p style="font-size:12px; color:#999; margin:0 0 4px;">Kenna Giuzio Cake &middot; An Artisan Studio</p>
    <p style="font-size:12px; color:#999; margin:0;">(206) 472-5401 &middot; <a href="mailto:kenna@kennagiuziocake.com" style="color:#b5956a; text-decoration:none;">kenna@kennagiuziocake.com</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildInquiryResponsePlain(bodyText) {
  return bodyText + '\n\nKenna Giuzio Cake\n(206) 472-5401\nkenna@kennagiuziocake.com';
}

async function sendInquiryResponse(client) {
  try {
    const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
    if (tokenResult.rows.length === 0) {
      console.log('Inquiry response: No Gmail token configured');
      return false;
    }
    oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });
    const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';

    const firstName = getFirstName(client.name);
    const eventType = client.event_type || 'celebration';
    const eventDate = client.event_date
      ? new Date(client.event_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : 'your upcoming event';

    // Load custom template (subject + body) and replace placeholders
    const template = await getInquiryResponseTemplate();
    const subject = template.subject
      .replace(/\{firstName\}/g, firstName)
      .replace(/\{eventType\}/g, eventType)
      .replace(/\{eventDate\}/g, eventDate);

    const bodyText = template.body
      .replace(/\{firstName\}/g, firstName)
      .replace(/\{eventType\}/g, eventType)
      .replace(/\{eventDate\}/g, eventDate);

    const htmlBody = buildInquiryResponseHTML(bodyText);
    const plainText = buildInquiryResponsePlain(bodyText);

    // Send to client
    const clientEmailLines = [
      `To: ${client.email}`,
      `From: Kenna Giuzio Cake <${kennaEmail}>`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="boundary123"',
      '',
      '--boundary123',
      'Content-Type: text/plain; charset=utf-8',
      '',
      plainText,
      '--boundary123',
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody,
      '--boundary123--'
    ];

    const encodedClient = Buffer.from(clientEmailLines.join('\r\n'))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedClient } });
    console.log(`Inquiry response sent to ${client.email} for client ${client.name}`);

    // Notify Kenna
    const kennaNotifyLines = [
      `To: ${kennaEmail}`,
      `From: ${kennaEmail}`,
      `Subject: Auto-Response Sent: Inquiry response to ${client.name}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      `An automatic inquiry response was just sent to ${client.name} (${client.email}).\n\nThis is the standard inquiry response with your process overview and pricing.\n\nView client: https://portal.kennagiuziocake.com/clients/view.html?id=${client.id}`
    ];

    const encodedKenna = Buffer.from(kennaNotifyLines.join('\r\n'))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedKenna } });

    // Record in reminders_sent to prevent duplicates
    await pool.query('INSERT INTO reminders_sent (client_id, type) VALUES ($1, $2)', [client.id, 'inquiry-response']);

    // Log to communications
    await pool.query(
      `INSERT INTO communications (client_id, type, direction, subject, message, channel)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [client.id, 'email', 'outbound', subject, 'Auto-sent inquiry response with process overview', 'email']
    );

    return true;
  } catch (err) {
    console.error('Failed to send inquiry response:', err.message);
    return false;
  }
}

// Create "Event Prep" multi-day calendar event starting 1 week before event
async function createEventPrepCalendarEvent(clientId) {
  try {
    const clientResult = await pool.query('SELECT name, event_date FROM clients WHERE id = $1', [clientId]);
    if (clientResult.rows.length === 0 || !clientResult.rows[0].event_date) return;

    const client = clientResult.rows[0];
    const lastName = (client.name || '').split(' ').pop();
    const prepTitle = `${lastName} Event Prep`;
    const eventTitle = `${lastName} ${client.name.includes('Wedding') ? 'Wedding' : 'Event'}`;

    // Extract clean YYYY-MM-DD string (handles both Date objects and strings from Postgres)
    let eventDateStr;
    if (typeof client.event_date === 'string') {
      eventDateStr = client.event_date.split('T')[0];
    } else if (client.event_date instanceof Date) {
      eventDateStr = client.event_date.toISOString().split('T')[0];
    } else {
      console.error('Invalid event_date format:', client.event_date);
      return;
    }

    console.log(`Creating calendar events for ${client.name}, event date: ${eventDateStr}`);

    // Parse date components
    const [year, month, day] = eventDateStr.split('-').map(Number);

    // Create 7 prep events (7 days before the event) using Date in UTC
    for (let i = 7; i >= 1; i--) {
      const prepDate = new Date(Date.UTC(year, month - 1, day - i));
      const dateStr = prepDate.toISOString().split('T')[0];

      await pool.query(
        `INSERT INTO calendar_events (client_id, title, event_date, event_type, notes)
         VALUES ($1, $2, $3, 'prep', $4)`,
        [clientId, prepTitle, dateStr, `Day ${8 - i} of 7 — event prep for ${client.name}`]
      );
    }

    // Create the actual event date (use the original string, don't manipulate it)
    await pool.query(
      `INSERT INTO calendar_events (client_id, title, event_date, event_type, notes)
       VALUES ($1, $2, $3, 'event', $4)`,
      [clientId, eventTitle, eventDateStr, `Event day for ${client.name}`]
    );

    console.log(`Created 7-day prep (ending ${day - 1}) + event (${eventDateStr}) for ${client.name}`);
  } catch (err) {
    console.error('Failed to create event prep calendar events:', err.message);
  }
}

// Admin verifies an offline payment (Zelle, cash, check) — marks as paid, sends client email
app.post('/api/payments/offline-verify', async (req, res) => {
  try {
    const { invoice_id, invoice_type, client_id, client_name, client_email, amount, payment_method } = req.body;
    const method = payment_method || 'zelle';

    if (!amount) {
      return res.status(400).json({ error: 'Missing required field: amount' });
    }

    const amountCents = Math.round(parseFloat(amount) * 100);
    const amountFormatted = '$' + parseFloat(amount).toFixed(2);
    const firstName = getFirstName(client_name);
    const paymentDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
    const methodLabel = method.charAt(0).toUpperCase() + method.slice(1);

    // Now mark invoice as paid
    try {
      if (invoice_id) {
        await pool.query(`
          UPDATE invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW()
          WHERE invoice_number = $1
        `, [invoice_id]);
      }
    } catch (dbErr) {
      console.error('Offline verify: Failed to update invoice:', dbErr.message);
    }

    // Update client status
    try {
      if (client_id && invoice_type) {
        if (invoice_type === 'tasting') {
          await pool.query(`
            INSERT INTO portal_data (client_id, tasting_paid, tasting_paid_date)
            VALUES ($1, TRUE, NOW())
            ON CONFLICT (client_id) DO UPDATE SET tasting_paid = TRUE, tasting_paid_date = NOW(), updated_at = NOW()
          `, [client_id]);
        } else if (invoice_type === 'deposit') {
          await pool.query(`UPDATE clients SET status = 'booked', updated_at = NOW() WHERE id = $1`, [client_id]);
          await pool.query(`
            INSERT INTO portal_data (client_id, deposit_paid, deposit_paid_date)
            VALUES ($1, TRUE, NOW())
            ON CONFLICT (client_id) DO UPDATE SET deposit_paid = TRUE, deposit_paid_date = NOW(), updated_at = NOW()
          `, [client_id]);
          // Create multi-day "Event Prep" calendar event
          await createEventPrepCalendarEvent(client_id);
        } else if (invoice_type === 'final') {
          await pool.query(`
            INSERT INTO portal_data (client_id, final_paid, final_paid_date)
            VALUES ($1, TRUE, NOW())
            ON CONFLICT (client_id) DO UPDATE SET final_paid = TRUE, final_paid_date = NOW(), updated_at = NOW()
          `, [client_id]);
        }
      }
    } catch (dbErr) {
      console.error('Offline verify: Failed to update client status:', dbErr.message);
    }

    // Record revenue
    try {
      if (client_id) {
        await pool.query(`
          INSERT INTO revenue (client_id, invoice_id, amount, type, revenue_date, notes)
          VALUES ($1, $2, $3, $4, NOW(), $5)
        `, [client_id, invoice_id || null, amountCents / 100, invoice_type || 'other', `${methodLabel} payment verified by admin`]);
      }
    } catch (dbErr) {
      console.error('Offline verify: Failed to record revenue:', dbErr.message);
    }

    // Send branded confirmation email to client
    if (client_email) {
      try {
        const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
        if (tokenResult.rows.length > 0) {
          oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });
          const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';

          let subject, plainText, htmlBody;
          let tastingDate = null, tastingTime = null;
          let eventType = null, eventDate = null, venueStr = null, balanceDueDate = null;

          if (invoice_type === 'tasting') {
            // Fetch tasting date/time for combined email
            try {
              if (client_id) {
                const clientResult = await pool.query('SELECT tasting_date, tasting_time FROM clients WHERE id = $1', [client_id]);
                if (clientResult.rows.length > 0) {
                  const row = clientResult.rows[0];
                  if (row.tasting_date) {
                    tastingDate = new Date(row.tasting_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                  }
                  tastingTime = formatTime(row.tasting_time);
                }
              }
            } catch (dbErr) {
              console.error('Offline verify: Failed to fetch tasting details for email:', dbErr.message);
            }

            const tastingTemplate = await getTastingConfirmationTemplate();
            const emailData = { firstName, amountFormatted, paymentDate, paymentMethod: method, tastingDate, tastingTime };
            subject = tastingTemplate.subject.replace(/\{tastingDate\}/g, tastingDate || 'Your Tasting').replace(/\{firstName\}/g, firstName);
            plainText = buildTastingConfirmationPlain(emailData, tastingTemplate);
            htmlBody = buildTastingConfirmationHTML(emailData, tastingTemplate);
          } else if (invoice_type === 'deposit') {
            // Booking confirmation for deposit payments
            try {
              if (client_id) {
                const clientResult = await pool.query('SELECT event_type, event_date, venue FROM clients WHERE id = $1', [client_id]);
                if (clientResult.rows.length > 0) {
                  const row = clientResult.rows[0];
                  eventType = row.event_type;
                  if (row.event_date) {
                    eventDate = new Date(row.event_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                    // Balance due = 2 weeks before event
                    const balDate = new Date(row.event_date);
                    balDate.setDate(balDate.getDate() - 14);
                    balanceDueDate = balDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                  }
                  venueStr = row.venue;
                }
              }
            } catch (dbErr) {
              console.error('Offline verify: Failed to fetch event details for booking email:', dbErr.message);
            }

            const bookingTemplate = await getBookingConfirmationTemplate();
            const bookingData = { firstName, amountFormatted, paymentDate, paymentMethod: method, eventType, eventDate, venue: venueStr, balanceDueDate };
            subject = bookingTemplate.subject.replace(/\{eventDate\}/g, eventDate || 'Your Event').replace(/\{firstName\}/g, firstName).replace(/\{eventType\}/g, eventType || 'celebration');
            plainText = buildBookingConfirmationPlain(bookingData, bookingTemplate);
            htmlBody = buildBookingConfirmationHTML(bookingData, bookingTemplate);
          } else if (invoice_type === 'final') {
            // Paid in Full confirmation for final balance payments
            try {
              if (client_id) {
                const clientResult = await pool.query('SELECT event_type, event_date, venue FROM clients WHERE id = $1', [client_id]);
                if (clientResult.rows.length > 0) {
                  const row = clientResult.rows[0];
                  eventType = row.event_type;
                  if (row.event_date) {
                    eventDate = new Date(row.event_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                  }
                  venueStr = row.venue;
                }
              }
            } catch (dbErr) {
              console.error('Offline verify: Failed to fetch event details for final payment email:', dbErr.message);
            }

            const eventDetailsHTML = `
  <tr><td style="padding:0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5; border-radius:8px; padding:20px 24px; margin:16px 0;">
      <tr><td>
        ${eventType ? `<p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;"><strong>Event:</strong> ${eventType}</p>` : ''}
        ${eventDate ? `<p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;"><strong>Event Date:</strong> ${eventDate}</p>` : ''}
        ${venueStr ? `<p style="font-size:14px; color:#444; line-height:1.8; margin:0;"><strong>Venue:</strong> ${venueStr}</p>` : ''}
      </td></tr>
    </table>
  </td></tr>`;

            const bodyTextFinal = `Hi ${firstName},\n\nYour final balance has been received — you are officially paid in full!\n\nWe are so excited for your ${eventType || 'event'}${eventDate ? ' on ' + eventDate : ''}. Everything is set, and we can't wait to bring your cake vision to life.\n\nIf you have any last-minute details or questions, don't hesitate to reach out.\n\nWarmly,\nKenna`;

            subject = `Paid in Full - Kenna Giuzio Cake`;
            plainText = bodyTextFinal + '\n\nKenna Giuzio Cake\n(206) 472-5401\nkenna@kennagiuziocake.com';
            htmlBody = buildBrandedPaymentEmailHTML(bodyTextFinal, {
              title: 'Paid in Full',
              amountFormatted,
              paymentDate,
              detailsHTML: eventDetailsHTML
            });
          } else {
            // Generic payment confirmation for other payments
            subject = 'Payment Confirmed - Kenna Giuzio Cake';
            const bodyTextGeneric = `Hi ${firstName},\n\nThank you for your ${methodLabel} payment of ${amountFormatted}.\n\nWarmly,\nKenna`;
            plainText = bodyTextGeneric + '\n\nKenna Giuzio Cake\n(206) 472-5401\nkenna@kennagiuziocake.com';
            htmlBody = buildBrandedPaymentEmailHTML(bodyTextGeneric, {
              title: 'Payment Confirmed',
              amountFormatted,
              paymentDate
            });
          }

          // Generate PDF attachments
          const pdfAttachments = [];

          // For deposit payments, fetch proposal first (needed for receipt breakdown AND proposal PDF)
          let proposalRow = null;
          if (invoice_type === 'deposit' && client_id) {
            try {
              const propResult = await pool.query("SELECT * FROM proposals WHERE client_id = $1 AND status = 'signed' ORDER BY updated_at DESC LIMIT 1", [client_id]);
              if (propResult.rows.length > 0) proposalRow = propResult.rows[0];
            } catch (propErr) { console.error('Failed to fetch proposal for deposit receipt:', propErr.message); }
          }

          // Receipt PDF
          try {
            const isCard = method === 'card';
            const receiptData = {
              type: invoice_type || 'other',
              clientName: client_name || firstName,
              amountFormatted, paymentDate, paymentMethod: methodLabel,
              amountRaw: parseFloat(amount), isCardPayment: isCard,
              receiptNumber: `KGC-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString().slice(-4)}`
            };
            if (invoice_type === 'tasting') { receiptData.tastingDate = tastingDate; receiptData.tastingTime = tastingTime; }
            if (invoice_type === 'final') { receiptData.eventType = eventType; receiptData.eventDate = eventDate; receiptData.venue = venueStr; }
            if (invoice_type === 'deposit') {
              receiptData.eventType = eventType; receiptData.eventDate = eventDate; receiptData.venue = venueStr; receiptData.balanceDueDate = balanceDueDate;
              // Extract proposal totals for receipt breakdown
              if (proposalRow) {
                try {
                  const pData = typeof proposalRow.data === 'string' ? JSON.parse(proposalRow.data) : proposalRow.data;
                  const selectedDesign = pData.selectedDesign || 'base';
                  const designPrice = parseFloat(pData[selectedDesign + 'Price'] || pData.basePrice || 0);
                  let itemsTotal = 0;
                  (pData.items || []).forEach(item => {
                    if (item.type === 'fixed') itemsTotal += parseFloat(item.price) || 0;
                    else itemsTotal += (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);
                  });
                  receiptData.proposalTotal = designPrice + itemsTotal;
                  receiptData.tastingCredit = parseFloat(pData.tastingCredit) || 0;
                } catch (e) { console.error('Failed to parse proposal data for receipt:', e.message); }
              }
            }
            const receiptBuf = await generateReceiptPDF(receiptData);
            pdfAttachments.push({ filename: 'KGC-Payment-Receipt.pdf', contentType: 'application/pdf', data: receiptBuf });
          } catch (pdfErr) { console.error('PDF receipt generation failed (offline):', pdfErr.message); }

          // Signed proposal PDF for deposit payments
          if (proposalRow) {
            try {
              const proposalBuf = await generateProposalPDF(proposalRow);
              pdfAttachments.push({ filename: 'KGC-Signed-Proposal.pdf', contentType: 'application/pdf', data: proposalBuf });
            } catch (propErr) { console.error('Proposal PDF generation failed (offline):', propErr.message); }
          }

          let encodedClientEmail;
          if (pdfAttachments.length > 0) {
            encodedClientEmail = buildRawEmailWithAttachment({
              to: client_email, from: kennaEmail, subject, plainText, htmlBody,
              attachments: pdfAttachments
            });
          } else {
            const boundary = 'boundary_' + Date.now().toString(36);
            const emailLines = [
              `To: ${client_email}`, `From: ${kennaEmail}`, `Subject: ${subject}`,
              'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`,
              '', `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 7bit',
              '', plainText, '', `--${boundary}`, 'Content-Type: text/html; charset=utf-8',
              'Content-Transfer-Encoding: 7bit', '', htmlBody, '', `--${boundary}--`
            ];
            encodedClientEmail = Buffer.from(emailLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          }

          await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedClientEmail } });

          if (client_id) {
            await pool.query(`
              INSERT INTO communications (client_id, type, direction, subject, message, channel, created_at)
              VALUES ($1, 'email', 'outbound', $2, $3, 'gmail', NOW())
            `, [client_id, subject, plainText]);
          }
        }
      } catch (clientEmailErr) {
        console.error('Failed to send offline verification email to client:', clientEmailErr.message);
      }
    }

    res.json({ success: true, message: `${methodLabel} payment verified and confirmed` });

  } catch (err) {
    console.error('Offline verify error:', err);
    res.status(500).json({ error: 'Failed to verify payment', details: err.message });
  }
});

// Legacy endpoint — redirect to new one
app.post('/api/payments/zelle-confirmed', (req, res) => {
  res.status(301).json({ error: 'Use /api/payments/offline-claimed instead', redirect: '/api/payments/offline-claimed' });
});

// Stripe Webhook (handles payment completion)
app.post('/api/payments/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

  let event;

  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // For testing without webhook signature verification
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Shared payment completion logic
  async function handlePaymentCompleted({ invoiceId, invoiceType, clientId, clientName, clientEmail, amountCents, stripeId }) {
    console.log('handlePaymentCompleted called:', { invoiceId, invoiceType, clientId, clientName, clientEmail: clientEmail ? '***' : '(empty)', amountCents, stripeId });

    // Update or create invoice record as paid
    try {
      if (invoiceId) {
        const updateResult = await pool.query(`
          UPDATE invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
            amount = COALESCE(NULLIF(amount, 0), $2)
          WHERE invoice_number = $1 RETURNING id
        `, [invoiceId, amountCents / 100]);

        if (updateResult.rowCount === 0) {
          // Invoice doesn't exist in DB yet — create it (common for final balance + deposit via client browser)
          await pool.query(`
            INSERT INTO invoices (client_id, invoice_number, type, amount, status, paid_at, data, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'paid', NOW(), $5, NOW(), NOW())
          `, [clientId || null, invoiceId, invoiceType || 'other', amountCents / 100,
              JSON.stringify({ payment_method: 'card', client_name: clientName, client_email: clientEmail, stripe_id: stripeId })]);
          console.log('Invoice created (upsert):', invoiceId, 'amount:', amountCents / 100);
        } else {
          console.log('Invoice updated:', invoiceId);
        }
      }
    } catch (dbErr) {
      console.error('Failed to update/create invoice:', dbErr.message);
    }

    // Update client status based on payment type
    try {
      if (clientId && invoiceType) {
        if (invoiceType === 'tasting') {
          await pool.query(`
            INSERT INTO portal_data (client_id, tasting_paid, tasting_paid_date)
            VALUES ($1, TRUE, NOW())
            ON CONFLICT (client_id) DO UPDATE SET tasting_paid = TRUE, tasting_paid_date = NOW(), updated_at = NOW()
          `, [clientId]);
        } else if (invoiceType === 'deposit') {
          await pool.query(`UPDATE clients SET status = 'booked', updated_at = NOW() WHERE id = $1`, [clientId]);
          await pool.query(`
            INSERT INTO portal_data (client_id, deposit_paid, deposit_paid_date)
            VALUES ($1, TRUE, NOW())
            ON CONFLICT (client_id) DO UPDATE SET deposit_paid = TRUE, deposit_paid_date = NOW(), updated_at = NOW()
          `, [clientId]);
          // Create multi-day "Event Prep" calendar event
          await createEventPrepCalendarEvent(clientId);
        } else if (invoiceType === 'final') {
          await pool.query(`
            INSERT INTO portal_data (client_id, final_paid, final_paid_date)
            VALUES ($1, TRUE, NOW())
            ON CONFLICT (client_id) DO UPDATE SET final_paid = TRUE, final_paid_date = NOW(), updated_at = NOW()
          `, [clientId]);
        }
        console.log('Client status updated:', clientId, invoiceType);
      }
    } catch (dbErr) {
      console.error('Failed to update client status:', dbErr.message);
    }

    // Record revenue
    try {
      if (clientId) {
        await pool.query(`
          INSERT INTO revenue (client_id, invoice_id, amount, type, revenue_date, notes)
          VALUES ($1, $2, $3, $4, NOW(), $5)
        `, [clientId, invoiceId || null, amountCents / 100, invoiceType || 'other', `Stripe payment: ${stripeId}`]);
        console.log('Revenue recorded');
      }
    } catch (dbErr) {
      console.error('Failed to record revenue:', dbErr.message);
    }

    // Send confirmation email to Kenna
    try {
      const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
      if (tokenResult.rows.length > 0) {
        oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });
        const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';
        const amountFormatted = (amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        const emailBody = `Payment received!\n\nClient: ${clientName || 'Unknown'}\nAmount: ${amountFormatted}\nType: ${invoiceType || 'Payment'}\nStripe ID: ${stripeId}\n\n${clientId ? `View in Sugar: https://portal.kennagiuziocake.com/clients/view.html?id=${clientId}` : ''}`;

        const emailLines = [
          `To: ${kennaEmail}`,
          `From: ${kennaEmail}`,
          `Subject: Payment Received: ${amountFormatted} from ${clientName || 'Client'}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          emailBody
        ];

        const encodedEmail = Buffer.from(emailLines.join('\r\n'))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodedEmail }
        });
      }
    } catch (emailErr) {
      console.error('Failed to send payment notification:', emailErr.message);
    }

    // Send branded confirmation email to the client
    if (clientEmail) {
      try {
        const tokenResult2 = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
        if (tokenResult2.rows.length > 0) {
          oauth2Client.setCredentials({ refresh_token: tokenResult2.rows[0].value });
          const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';
          const amountFormatted = '$' + (amountCents / 100).toFixed(2);
          const firstName = getFirstName(clientName);
          const paymentDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });

          let subject, plainText, htmlBody;
          let tastingDate = null, tastingTime = null;
          let eventType = null, eventDate = null, venueStr = null, balanceDueDate = null;

          if (invoiceType === 'tasting') {
            // Fetch tasting date/time for combined email
            try {
              if (clientId) {
                const clientResult = await pool.query('SELECT tasting_date, tasting_time FROM clients WHERE id = $1', [clientId]);
                if (clientResult.rows.length > 0) {
                  const row = clientResult.rows[0];
                  if (row.tasting_date) {
                    tastingDate = new Date(row.tasting_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                  }
                  tastingTime = formatTime(row.tasting_time);
                }
              }
            } catch (dbErr) {
              console.error('Failed to fetch tasting details for email:', dbErr.message);
            }

            const tastingTemplate = await getTastingConfirmationTemplate();
            const emailData = { firstName, amountFormatted, paymentDate, paymentMethod: 'card', tastingDate, tastingTime };
            subject = tastingTemplate.subject.replace(/\{tastingDate\}/g, tastingDate || 'Your Tasting').replace(/\{firstName\}/g, firstName);
            plainText = buildTastingConfirmationPlain(emailData, tastingTemplate);
            htmlBody = buildTastingConfirmationHTML(emailData, tastingTemplate);
          } else if (invoiceType === 'deposit') {
            // Booking confirmation for deposit payments
            try {
              if (clientId) {
                const clientResult = await pool.query('SELECT event_type, event_date, venue FROM clients WHERE id = $1', [clientId]);
                if (clientResult.rows.length > 0) {
                  const row = clientResult.rows[0];
                  eventType = row.event_type;
                  if (row.event_date) {
                    eventDate = new Date(row.event_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                    const balDate = new Date(row.event_date);
                    balDate.setDate(balDate.getDate() - 14);
                    balanceDueDate = balDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                  }
                  venueStr = row.venue;
                }
              }
            } catch (dbErr) {
              console.error('Failed to fetch event details for booking email:', dbErr.message);
            }

            const bookingTemplate = await getBookingConfirmationTemplate();
            const bookingData = { firstName, amountFormatted, paymentDate, paymentMethod: 'card', eventType, eventDate, venue: venueStr, balanceDueDate };
            subject = bookingTemplate.subject.replace(/\{eventDate\}/g, eventDate || 'Your Event').replace(/\{firstName\}/g, firstName).replace(/\{eventType\}/g, eventType || 'celebration');
            plainText = buildBookingConfirmationPlain(bookingData, bookingTemplate);
            htmlBody = buildBookingConfirmationHTML(bookingData, bookingTemplate);
          } else if (invoiceType === 'final') {
            // Paid in Full confirmation for final balance payments
            try {
              if (clientId) {
                const clientResult = await pool.query('SELECT event_type, event_date, venue FROM clients WHERE id = $1', [clientId]);
                if (clientResult.rows.length > 0) {
                  const row = clientResult.rows[0];
                  eventType = row.event_type;
                  if (row.event_date) {
                    eventDate = new Date(row.event_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                  }
                  venueStr = row.venue;
                }
              }
            } catch (dbErr) {
              console.error('Failed to fetch event details for final payment email:', dbErr.message);
            }

            const eventDetailsHTML = `
  <tr><td style="padding:0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5; border-radius:8px; padding:20px 24px; margin:16px 0;">
      <tr><td>
        ${eventType ? `<p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;"><strong>Event:</strong> ${eventType}</p>` : ''}
        ${eventDate ? `<p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;"><strong>Event Date:</strong> ${eventDate}</p>` : ''}
        ${venueStr ? `<p style="font-size:14px; color:#444; line-height:1.8; margin:0;"><strong>Venue:</strong> ${venueStr}</p>` : ''}
      </td></tr>
    </table>
  </td></tr>`;

            const bodyTextFinal = `Hi ${firstName},\n\nYour final balance has been received — you are officially paid in full!\n\nWe are so excited for your ${eventType || 'event'}${eventDate ? ' on ' + eventDate : ''}. Everything is set, and we can't wait to bring your cake vision to life.\n\nIf you have any last-minute details or questions, don't hesitate to reach out.\n\nWarmly,\nKenna`;

            subject = `Paid in Full - Kenna Giuzio Cake`;
            plainText = bodyTextFinal + '\n\nKenna Giuzio Cake\n(206) 472-5401\nkenna@kennagiuziocake.com';
            htmlBody = buildBrandedPaymentEmailHTML(bodyTextFinal, {
              title: 'Paid in Full',
              amountFormatted,
              paymentDate,
              detailsHTML: eventDetailsHTML
            });
          } else {
            // Generic payment confirmation for other payments
            subject = 'Payment Confirmed - Kenna Giuzio Cake';
            const bodyTextGeneric = `Hi ${firstName},\n\nThank you for your payment of ${amountFormatted}.\n\nWarmly,\nKenna`;
            plainText = bodyTextGeneric + '\n\nKenna Giuzio Cake\n(206) 472-5401\nkenna@kennagiuziocake.com';
            htmlBody = buildBrandedPaymentEmailHTML(bodyTextGeneric, {
              title: 'Payment Confirmed',
              amountFormatted,
              paymentDate
            });
          }

          // Generate PDF attachments
          const pdfAttachments = [];

          // For deposit payments, fetch proposal first (needed for receipt breakdown AND proposal PDF)
          let proposalRow = null;
          if (invoiceType === 'deposit' && clientId) {
            try {
              const propResult = await pool.query("SELECT * FROM proposals WHERE client_id = $1 AND status = 'signed' ORDER BY updated_at DESC LIMIT 1", [clientId]);
              if (propResult.rows.length > 0) proposalRow = propResult.rows[0];
            } catch (propErr) { console.error('Failed to fetch proposal for deposit receipt:', propErr.message); }
          }

          // Receipt PDF
          try {
            const receiptData = {
              type: invoiceType || 'other',
              clientName: clientName || firstName,
              amountFormatted, paymentDate, paymentMethod: 'Card',
              amountRaw: amountCents / 100, isCardPayment: true,
              receiptNumber: `KGC-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${(stripeId || '').slice(-4) || Date.now().toString().slice(-4)}`
            };
            if (invoiceType === 'tasting') { receiptData.tastingDate = tastingDate; receiptData.tastingTime = tastingTime; }
            if (invoiceType === 'final') { receiptData.eventType = eventType; receiptData.eventDate = eventDate; receiptData.venue = venueStr; }
            if (invoiceType === 'deposit') {
              receiptData.eventType = eventType; receiptData.eventDate = eventDate; receiptData.venue = venueStr; receiptData.balanceDueDate = balanceDueDate;
              // Extract proposal totals for receipt breakdown
              if (proposalRow) {
                try {
                  const pData = typeof proposalRow.data === 'string' ? JSON.parse(proposalRow.data) : proposalRow.data;
                  const selectedDesign = pData.selectedDesign || 'base';
                  const designPrice = parseFloat(pData[selectedDesign + 'Price'] || pData.basePrice || 0);
                  let itemsTotal = 0;
                  (pData.items || []).forEach(item => {
                    if (item.type === 'fixed') itemsTotal += parseFloat(item.price) || 0;
                    else itemsTotal += (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);
                  });
                  receiptData.proposalTotal = designPrice + itemsTotal;
                  receiptData.tastingCredit = parseFloat(pData.tastingCredit) || 0;
                } catch (e) { console.error('Failed to parse proposal data for receipt:', e.message); }
              }
            }
            const receiptBuf = await generateReceiptPDF(receiptData);
            pdfAttachments.push({ filename: 'KGC-Payment-Receipt.pdf', contentType: 'application/pdf', data: receiptBuf });
          } catch (pdfErr) { console.error('PDF receipt generation failed (webhook):', pdfErr.message); }

          // Signed proposal PDF for deposit payments
          if (proposalRow) {
            try {
              const proposalBuf = await generateProposalPDF(proposalRow);
              pdfAttachments.push({ filename: 'KGC-Signed-Proposal.pdf', contentType: 'application/pdf', data: proposalBuf });
            } catch (propErr) { console.error('Proposal PDF generation failed (webhook):', propErr.message); }
          }

          let encodedClientEmail;
          if (pdfAttachments.length > 0) {
            encodedClientEmail = buildRawEmailWithAttachment({
              to: clientEmail, from: kennaEmail, subject, plainText, htmlBody,
              attachments: pdfAttachments
            });
          } else {
            const boundary = 'boundary_' + Date.now().toString(36);
            const emailLines = [
              `To: ${clientEmail}`, `From: ${kennaEmail}`, `Subject: ${subject}`,
              'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`,
              '', `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 7bit',
              '', plainText, '', `--${boundary}`, 'Content-Type: text/html; charset=utf-8',
              'Content-Transfer-Encoding: 7bit', '', htmlBody, '', `--${boundary}--`
            ];
            encodedClientEmail = Buffer.from(emailLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          }

          await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encodedClientEmail }
          });

          // Log the communication
          if (clientId) {
            await pool.query(`
              INSERT INTO communications (client_id, type, direction, subject, message, channel, created_at)
              VALUES ($1, 'email', 'outbound', $2, $3, 'gmail', NOW())
            `, [clientId, subject, plainText]);
          }

          console.log('Confirmation email sent to:', clientEmail, 'type:', invoiceType);
        }
      } catch (clientEmailErr) {
        console.error('Failed to send client confirmation email:', clientEmailErr.message);
      }
    }
  }

  // Handle the event
  console.log('Webhook received event:', event.type);

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('Checkout payment successful:', session.id);
      const { invoice_id, invoice_type, client_id, client_name, client_email: meta_email } = session.metadata || {};
      await handlePaymentCompleted({
        invoiceId: invoice_id, invoiceType: invoice_type, clientId: client_id,
        clientName: client_name, clientEmail: session.customer_email || meta_email,
        amountCents: session.amount_total, stripeId: session.id
      });
    } else if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      console.log('PaymentIntent succeeded:', paymentIntent.id, 'metadata:', JSON.stringify(paymentIntent.metadata));
      const { invoice_id, invoice_type, client_id, client_name, client_email } = paymentIntent.metadata || {};
      console.log('Calling handlePaymentCompleted with email:', paymentIntent.receipt_email || client_email);
      await handlePaymentCompleted({
        invoiceId: invoice_id, invoiceType: invoice_type, clientId: client_id,
        clientName: client_name, clientEmail: paymentIntent.receipt_email || client_email,
        amountCents: paymentIntent.amount, stripeId: paymentIntent.id
      });
      console.log('handlePaymentCompleted finished for:', paymentIntent.id);
    } else {
      console.log('Unhandled webhook event type:', event.type);
    }
  } catch (eventErr) {
    console.error('Webhook event handling error:', eventErr.message, eventErr.stack);
  }

  res.json({ received: true });
});

// Get checkout session details (for success page)
app.get('/api/payments/session/:sessionId', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }

    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);

    res.json({
      success: true,
      paid: session.payment_status === 'paid',
      amount: session.amount_total / 100,
      customerEmail: session.customer_email,
      metadata: session.metadata
    });

  } catch (err) {
    console.error('Get session error:', err);
    res.status(500).json({ error: 'Failed to get session details' });
  }
});

// Get PaymentIntent details (for success page - embedded flow)
app.get('/api/payments/intent/:intentId', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(req.params.intentId);

    res.json({
      success: true,
      paid: paymentIntent.status === 'succeeded',
      amount: paymentIntent.amount / 100,
      customerEmail: paymentIntent.receipt_email,
      metadata: paymentIntent.metadata
    });

  } catch (err) {
    console.error('Get PaymentIntent error:', err);
    res.status(500).json({ error: 'Failed to get payment intent details' });
  }
});

// ============================================
// PUBLIC INQUIRY ENDPOINT (Website Form)
// ============================================
app.post('/api/inquiries', async (req, res) => {
  try {
    const { name, email, event_type, event_date, guest_count, venue, message } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    // Create client in database
    const clientResult = await pool.query(
      `INSERT INTO clients (name, email, status, event_type, event_date, guest_count, venue, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [name, email, 'inquiry', event_type || null, event_date || null, guest_count || null, venue || null, message || null, 'website']
    );

    const newClient = clientResult.rows[0];

    // Log initial inquiry to communications
    if (message) {
      await pool.query(
        `INSERT INTO communications (client_id, type, direction, subject, message, channel)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newClient.id, 'note', 'inbound', 'Website Inquiry', message, 'website']
      );
    }

    // Send notification email to Kenna
    try {
      const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");

      if (tokenResult.rows.length > 0) {
        oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });

        const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';

        // Build notification email
        const eventTypeInfo = event_type ? `\nEvent Type: ${event_type}` : '';
        const eventInfo = event_date ? `\nEvent Date: ${event_date}` : '';
        const guestInfo = guest_count ? `\nGuest Count: ${guest_count}` : '';
        const venueInfo = venue ? `\nVenue/Location: ${venue}` : '';
        const visionInfo = message ? `\n\nTheir Vision:\n${message}` : '';

        const notificationBody = `New inquiry from your website!

Name: ${name}
Email: ${email}${eventTypeInfo}${eventInfo}${guestInfo}${venueInfo}${visionInfo}

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
      console.error('Failed to send inquiry notification email:', emailErr.message);
    }

    // Send SMS alert to Kenna
    try {
      if (twilioClient && process.env.KENNA_PHONE) {
        const smsBody = `New inquiry from ${name}!` +
          (event_type ? ` ${event_type}.` : '') +
          (event_date ? ` Date: ${event_date}.` : '') +
          ` Check Sugar for details.`;

        await twilioClient.messages.create({
          body: smsBody,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: process.env.KENNA_PHONE
        });
        console.log('Inquiry SMS sent to Kenna');
      }
    } catch (smsErr) {
      console.error('Failed to send inquiry SMS:', smsErr.message);
    }

    // Auto-send inquiry response to client
    try {
      await sendInquiryResponse(newClient);
    } catch (autoErr) {
      console.error('Failed to auto-send inquiry response:', autoErr.message);
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
            tasting_date, tasting_time, tasting_end_time, tasting_guests, event_time, event_end_time, archived, instagram, linkedin, website, company } = req.body;
    const result = await pool.query(
      `INSERT INTO clients (name, email, phone, status, event_date, event_type, guest_count, venue, source, notes, address,
       tasting_date, tasting_time, tasting_end_time, tasting_guests, event_time, event_end_time, archived, instagram, linkedin, website, company)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING *`,
      [name, nullIfEmpty(email), nullIfEmpty(phone), status || 'inquiry', nullIfEmpty(event_date), nullIfEmpty(event_type), nullIfEmpty(guest_count), nullIfEmpty(venue), nullIfEmpty(source), nullIfEmpty(notes), nullIfEmpty(address),
       nullIfEmpty(tasting_date), nullIfEmpty(tasting_time), nullIfEmpty(tasting_end_time), nullIfEmpty(tasting_guests), nullIfEmpty(event_time), nullIfEmpty(event_end_time), archived || false, nullIfEmpty(instagram), nullIfEmpty(linkedin), nullIfEmpty(website), nullIfEmpty(company)]
    );

    const newClient = result.rows[0];

    // Auto-send inquiry response if status is inquiry and email exists
    if ((newClient.status === 'inquiry') && newClient.email) {
      try {
        await sendInquiryResponse(newClient);
      } catch (autoErr) {
        console.error('Failed to auto-send inquiry response:', autoErr.message);
      }
    }

    res.status(201).json(newClient);
  } catch (err) {
    console.error('Error creating client:', err);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const { name, email, phone, status, event_date, event_type, guest_count, venue, source, notes, address,
            tasting_date, tasting_time, tasting_end_time, tasting_guests, event_time, event_end_time, archived, instagram, linkedin, website, company } = req.body;

    // Check if event_date is changing and client has deposit paid
    const oldClient = await pool.query('SELECT event_date, status FROM clients WHERE id = $1', [req.params.id]);
    const isBooked = oldClient.rows[0]?.status === 'booked';
    const eventDateChanged = event_date && oldClient.rows[0]?.event_date &&
                             new Date(event_date).getTime() !== new Date(oldClient.rows[0].event_date).getTime();

    const result = await pool.query(
      `UPDATE clients SET
       name=COALESCE($1, name), email=COALESCE($2, email), phone=COALESCE($3, phone), status=COALESCE($4, status),
       event_date=COALESCE($5, event_date), event_type=COALESCE($6, event_type), guest_count=COALESCE($7, guest_count),
       venue=COALESCE($8, venue), source=COALESCE($9, source), notes=COALESCE($10, notes), address=COALESCE($11, address),
       tasting_date=COALESCE($12, tasting_date), tasting_time=COALESCE($13, tasting_time), tasting_end_time=COALESCE($14, tasting_end_time),
       tasting_guests=COALESCE($15, tasting_guests), event_time=COALESCE($16, event_time), event_end_time=COALESCE($17, event_end_time),
       archived=COALESCE($18, archived), instagram=COALESCE($19, instagram), linkedin=COALESCE($20, linkedin),
       website=COALESCE($21, website), company=COALESCE($22, company), updated_at=NOW()
       WHERE id=$23 RETURNING *`,
      [name, nullIfEmpty(email), nullIfEmpty(phone), status, nullIfEmpty(event_date), nullIfEmpty(event_type), nullIfEmpty(guest_count), nullIfEmpty(venue), nullIfEmpty(source), nullIfEmpty(notes), nullIfEmpty(address),
       nullIfEmpty(tasting_date), nullIfEmpty(tasting_time), nullIfEmpty(tasting_end_time), nullIfEmpty(tasting_guests), nullIfEmpty(event_time), nullIfEmpty(event_end_time), archived, nullIfEmpty(instagram), nullIfEmpty(linkedin), nullIfEmpty(website), nullIfEmpty(company), req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // If event date changed and client is booked, recreate calendar events
    if (eventDateChanged && isBooked) {
      console.log(`Event date changed for booked client ${req.params.id}, recreating calendar events`);
      // Delete old prep and event entries
      await pool.query(`DELETE FROM calendar_events WHERE client_id = $1 AND event_type IN ('prep', 'event')`, [req.params.id]);
      // Create new prep and event entries
      await createEventPrepCalendarEvent(req.params.id);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating client:', err);
    res.status(500).json({ error: 'Failed to update client' });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    // Delete calendar events first (uses SET NULL, not CASCADE)
    await pool.query('DELETE FROM calendar_events WHERE client_id = $1', [req.params.id]);

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
    const { client_id, invoice_number, type, amount, status, due_date, data } = req.body;
    const result = await pool.query(
      `INSERT INTO invoices (client_id, invoice_number, type, amount, status, due_date, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [client_id, invoice_number || null, type, amount, status || 'draft', due_date, JSON.stringify(data || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating invoice:', err);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// Get single invoice by ID or invoice_number
app.get('/api/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Try to find by invoice_number first (TI-2026-1234), then by id
    let result;
    if (id.startsWith('TI-') || id.startsWith('DI-') || id.startsWith('FI-') || id.startsWith('INV-')) {
      result = await pool.query(
        'SELECT * FROM invoices WHERE invoice_number = $1',
        [id]
      );
    } else {
      result = await pool.query(
        'SELECT * FROM invoices WHERE id = $1',
        [parseInt(id)]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching invoice:', err);
    res.status(500).json({ error: 'Failed to fetch invoice' });
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

app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM invoices WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json({ message: 'Invoice deleted', invoice: result.rows[0] });
  } catch (err) {
    console.error('Error deleting invoice:', err);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// Delete ALL invoices (for data wipe)
app.delete('/api/invoices', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM invoices RETURNING *');
    res.json({ message: `Deleted ${result.rows.length} invoices`, count: result.rows.length });
  } catch (err) {
    console.error('Error deleting all invoices:', err);
    res.status(500).json({ error: 'Failed to delete invoices' });
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
// AI NARRATIVE GENERATION
// ============================================
app.post('/api/ai/generate-narrative', async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({ error: 'OpenAI not configured. Add OPENAI_API_KEY to environment.' });
    }

    const { notes, eventType, instruction, generateSubject } = req.body;

    if (!notes || !notes.trim()) {
      return res.status(400).json({ error: 'Please enter some notes to polish.' });
    }

    // Subject line generation mode
    if (generateSubject) {
      const subjectCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Generate a short, professional email subject line for Kenna Giuzio Cake. The subject must start with "Kenna Giuzio Cake - " followed by a brief, warm descriptor. Keep it under 60 characters total. No emojis. Just return the subject line, nothing else.`
          },
          {
            role: 'user',
            content: `Generate a subject line for this email body:\n\n${notes.trim().substring(0, 500)}`
          }
        ],
        max_tokens: 50,
        temperature: 0.7
      });
      const subject = subjectCompletion.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
      return res.json({ success: true, narrative: subject });
    }

    // Dynamic max_tokens based on input length — generous to allow creative expansion
    const inputLength = notes.trim().length;
    const maxTokens = inputLength > 600 ? 1000 : inputLength > 300 ? 800 : inputLength > 100 ? 600 : 400;

    // Build messages based on whether this is a full polish or a targeted revision
    const isRevision = instruction && instruction.trim();
    const systemPrompt = isRevision
      ? `You are helping Kenna, a cake artist, revise her writing for clients. Guidelines:
- ONLY change the specific parts mentioned in the instruction
- Keep everything else EXACTLY as-is — do not rephrase, reorder, or touch unchanged sections
- Warm, professional, and elegant — never over-the-top or pretentious
- Detail-oriented but modest — Kenna's natural voice
- No emojis
- Do NOT include a subject line — return ONLY the body text, no "Subject:" prefix
- Return the COMPLETE text with only the requested changes applied`
      : `You are helping Kenna, a luxury cake artist in Seattle, polish her writing for clients. Don't just clean up grammar — elevate the tone and add thoughtful touches. Guidelines:
- Elegant and warm — like a handwritten note on beautiful stationery. Approachable luxury, never stuffy
- Add sensory details where natural — flavors, textures, the feeling of a celebration — but don't overdo it
- Kenna's voice: confident, passionate about her craft, genuinely warm toward clients
- Weave in specific details from the notes and expand on them where it feels right
- No emojis, no cliché filler phrases ("don't hesitate to reach out", "we can't wait"), no exclamation mark overload
- Keep the length similar to the original — polish, don't pad
- Match the appropriate voice: third person for product descriptions, first person for emails and messages
- Do NOT include a subject line — return ONLY the body text, no "Subject:" prefix
- The result should feel noticeably more refined than the input, but still sound like Kenna wrote it`;

    const userMessage = isRevision
      ? `Here is the current text:\n\n${notes}\n\nInstruction: ${instruction.trim()}`
      : `Polish this:\n${notes}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_tokens: maxTokens,
      temperature: isRevision ? 0.6 : 0.75
    });

    const narrative = completion.choices[0].message.content.trim();
    res.json({ success: true, narrative });
  } catch (err) {
    console.error('AI narrative generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate narrative. Please try again.' });
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
    const { client_id, title, event_date, event_end_date, event_time, event_end_time, event_type, is_multi_day, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO calendar_events (client_id, title, event_date, event_end_date, event_time, event_end_time, event_type, is_multi_day, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [client_id, title, event_date, event_end_date || null, event_time, event_end_time || null, event_type, is_multi_day || false, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

app.put('/api/events/:id', async (req, res) => {
  try {
    const { title, event_date, event_end_date, event_time, event_end_time, event_type, is_multi_day, notes } = req.body;
    const result = await pool.query(
      `UPDATE calendar_events
       SET title = COALESCE($1, title),
           event_date = COALESCE($2, event_date),
           event_end_date = $3,
           event_time = $4,
           event_end_time = $5,
           event_type = COALESCE($6, event_type),
           is_multi_day = COALESCE($7, is_multi_day),
           notes = $8
       WHERE id = $9
       RETURNING *`,
      [title, event_date, event_end_date || null, event_time, event_end_time, event_type, is_multi_day, notes, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating event:', err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Bulk delete all calendar events (used by data wipe)
app.delete('/api/events', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM calendar_events RETURNING *');
    res.json({ message: `Deleted ${result.rows.length} calendar events`, count: result.rows.length });
  } catch (err) {
    console.error('Error deleting all events:', err);
    res.status(500).json({ error: 'Failed to delete events' });
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

// Clean up orphaned prep events (prep events for clients that don't exist or aren't booked)
app.post('/api/events/cleanup-prep', async (req, res) => {
  try {
    // Delete prep and event entries where client doesn't exist or isn't booked
    const result = await pool.query(`
      DELETE FROM calendar_events
      WHERE event_type IN ('prep', 'event')
      AND (client_id IS NULL
           OR client_id NOT IN (SELECT id FROM clients WHERE status = 'booked'))
      RETURNING *
    `);
    console.log(`Cleaned up ${result.rows.length} orphaned calendar events`);
    res.json({ success: true, deleted: result.rows.length, events: result.rows });
  } catch (err) {
    console.error('Error cleaning up calendar events:', err);
    res.status(500).json({ error: 'Failed to cleanup calendar events' });
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

// Run migrations on startup
async function runMigrations() {
  console.log('==========================================');
  console.log('STARTING DATABASE MIGRATIONS');
  console.log('==========================================');

  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('✓ Database connected');

    // Add all missing columns to clients table
    console.log('Adding columns to clients table...');
    await pool.query(`
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS event_end_time TIME;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS tasting_end_time TIME;
    `);
    console.log('✓ Clients table updated');

    // Add missing columns to calendar_events
    console.log('Adding columns to calendar_events table...');
    await pool.query(`
      ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS event_end_time TIME;
      ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS event_end_date DATE;
      ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS is_multi_day BOOLEAN DEFAULT FALSE;
    `);
    console.log('✓ Calendar events table updated');

    // Create reminders_sent table (for automatic reminder emails)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reminders_sent (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL,
        type VARCHAR(30) NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Fix: migrate client_id from UUID to INTEGER if needed
    try {
      const colCheck = await pool.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'reminders_sent' AND column_name = 'client_id'
      `);
      if (colCheck.rows.length > 0 && colCheck.rows[0].data_type === 'uuid') {
        console.log('Migrating reminders_sent.client_id from UUID to INTEGER...');
        await pool.query('DELETE FROM reminders_sent');
        await pool.query('ALTER TABLE reminders_sent ALTER COLUMN client_id TYPE INTEGER USING 0');
        console.log('✓ reminders_sent.client_id migrated to INTEGER');
      }
    } catch (migErr) {
      console.error('reminders_sent migration error:', migErr.message);
    }
    console.log('✓ Reminders sent table ready');

    // Verify schema
    console.log('Verifying schema...');
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'clients'
      AND column_name IN ('tasting_time', 'tasting_end_time', 'event_time', 'event_end_time', 'tasting_guests')
      ORDER BY column_name;
    `);

    console.log('Clients table columns:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

    console.log('==========================================');
    console.log('MIGRATIONS COMPLETE');
    console.log('==========================================');
  } catch (error) {
    console.error('==========================================');
    console.error('MIGRATION ERROR:', error);
    console.error('==========================================');
    throw error; // Re-throw to prevent server from starting if migration fails
  }
}

// Background Gmail sync — every 5 minutes
async function backgroundGmailSync() {
  try {
    const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
    if (tokenResult.rows.length === 0) return;

    oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });

    const lastSyncResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_last_sync'");
    const lastSync = lastSyncResult.rows.length > 0 ? lastSyncResult.rows[0].value : null;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let sinceDate = sevenDaysAgo;
    if (lastSync) {
      const syncDate = new Date(lastSync);
      if (syncDate > sevenDaysAgo) sinceDate = syncDate;
    }

    const messagesResponse = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${Math.floor(sinceDate.getTime() / 1000)}`,
      maxResults: 50
    });

    const messages = messagesResponse.data.messages || [];
    if (messages.length === 0) return;

    const clientsResult = await pool.query('SELECT id, name, email FROM clients WHERE email IS NOT NULL');
    const clientEmails = {};
    clientsResult.rows.forEach(c => {
      if (c.email) clientEmails[c.email.toLowerCase()] = c;
    });

    let synced = 0;
    for (const msg of messages) {
      try {
        const existingCheck = await pool.query('SELECT id FROM communications WHERE external_id = $1', [msg.id]);
        if (existingCheck.rows.length > 0) continue;

        const fullMsg = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
        const headers = fullMsg.data.payload.headers;
        const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        const from = getHeader('From');
        const to = getHeader('To');
        const subject = getHeader('Subject');
        const date = getHeader('Date');

        const fromEmail = from.match(/<(.+?)>/) ? from.match(/<(.+?)>/)[1].toLowerCase() : from.toLowerCase();
        const toEmail = to.match(/<(.+?)>/) ? to.match(/<(.+?)>/)[1].toLowerCase() : to.toLowerCase();

        let client = clientEmails[fromEmail] || clientEmails[toEmail];
        if (!client) {
          const teamResult = await pool.query(
            'SELECT client_id FROM team_members WHERE LOWER(email) = $1 OR LOWER(email) = $2',
            [fromEmail, toEmail]
          );
          if (teamResult.rows.length > 0) {
            const clientResult = await pool.query('SELECT id, name, email FROM clients WHERE id = $1', [teamResult.rows[0].client_id]);
            if (clientResult.rows.length > 0) client = clientResult.rows[0];
          }
        }

        if (client) {
          let body = '';
          if (fullMsg.data.payload.body && fullMsg.data.payload.body.data) {
            body = Buffer.from(fullMsg.data.payload.body.data, 'base64').toString('utf-8');
          } else if (fullMsg.data.payload.parts) {
            const textPart = fullMsg.data.payload.parts.find(p => p.mimeType === 'text/plain');
            if (textPart && textPart.body && textPart.body.data) {
              body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
            }
          }

          const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';
          const direction = fromEmail.includes(kennaEmail.split('@')[0]) ? 'outbound' : 'inbound';

          await pool.query(`
            INSERT INTO communications (client_id, type, direction, subject, message, channel, external_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [client.id, 'email', direction, subject, body.substring(0, 10000), 'gmail', msg.id, new Date(date)]);
          synced++;
        }
      } catch (msgErr) {
        // Skip individual message errors
      }
    }

    await pool.query(`
      INSERT INTO settings (key, value) VALUES ('gmail_last_sync', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [new Date().toISOString()]);

    if (synced > 0) console.log(`Background sync: ${synced} new emails matched`);
  } catch (err) {
    // Silent fail — don't crash the server
    if (!err.message?.includes('No refresh token')) {
      console.error('Background Gmail sync error:', err.message);
    }
  }
}

// Automatic reminder emails — check daily for upcoming events
async function checkUpcomingEvents() {
  console.log('Checking upcoming events for reminders...');
  try {
    const tokenResult = await pool.query("SELECT value FROM settings WHERE key = 'gmail_refresh_token'");
    if (tokenResult.rows.length === 0) {
      console.log('Reminders: No Gmail token configured, skipping');
      return;
    }
    oauth2Client.setCredentials({ refresh_token: tokenResult.rows[0].value });
    const kennaEmail = process.env.KENNA_EMAIL || 'kenna@kennagiuziocake.com';

    // Get all booked clients with future event dates who haven't paid final balance
    const result = await pool.query(`
      SELECT c.id, c.name, c.email, c.event_type, c.event_date, c.venue,
             pd.deposit_paid_date
      FROM clients c
      LEFT JOIN portal_data pd ON pd.client_id = c.id
      WHERE c.status = 'booked'
        AND c.event_date IS NOT NULL
        AND c.event_date > NOW()
        AND (pd.final_paid IS NULL OR pd.final_paid = FALSE)
      ORDER BY c.event_date ASC
    `);

    for (const client of result.rows) {
      const eventDate = new Date(client.event_date);
      const now = new Date();
      const daysUntil = Math.floor((eventDate - now) / (1000 * 60 * 60 * 24));
      const firstName = getFirstName(client.name);
      const eventDateFormatted = eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

      // Check if reminder already sent
      const alreadySent = async (type) => {
        const check = await pool.query(
          'SELECT id FROM reminders_sent WHERE client_id = $1 AND type = $2',
          [client.id, type]
        );
        return check.rows.length > 0;
      };

      // 30 days out — One month reminder
      if (daysUntil <= 30 && daysUntil > 14) {
        if (await alreadySent('one_month')) continue;

        // Calculate balance info and build final balance link
        let balanceAmount = 'your remaining balance';
        let proposalTotal = 0, tastingCredit = 0, depositPaid = 0;
        try {
          const invResult = await pool.query(
            "SELECT amount, data FROM invoices WHERE client_id = $1 AND type = 'deposit' AND status = 'paid' ORDER BY created_at DESC LIMIT 1",
            [client.id]
          );
          if (invResult.rows.length > 0) {
            const invData = invResult.rows[0].data || {};
            proposalTotal = parseFloat(invData.proposalTotal) || 0;
            tastingCredit = parseFloat(invData.tastingCredit) || 0;
            depositPaid = parseFloat(invResult.rows[0].amount) || parseFloat(invData.amount) || 0;
            const remaining = Math.floor((proposalTotal - tastingCredit) - depositPaid);
            if (remaining > 0) balanceAmount = '$' + remaining.toLocaleString();
          }
        } catch (e) { console.log('Could not calculate balance for reminder'); }

        const finalBalanceLinkOneMonth = `https://portal.kennagiuziocake.com/welcome-proposal.html?dest=final-balance&clientId=${client.id}&mode=final-balance&total=${proposalTotal}&tastingCredit=${tastingCredit}&depositPaid=${depositPaid}`;

        const balanceDueDate = new Date(eventDate);
        balanceDueDate.setDate(balanceDueDate.getDate() - 14);
        const balanceDueDateStr = balanceDueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        const eventType = (client.event_type || 'event').toLowerCase();
        const oneMonthTemplate = await getOneMonthReminderTemplate();

        const subject = oneMonthTemplate.subject
          .replace(/\{firstName\}/g, firstName)
          .replace(/\{eventType\}/g, eventType)
          .replace(/\{balanceAmount\}/g, balanceAmount)
          .replace(/\{balanceDueDate\}/g, balanceDueDateStr)
          .replace(/\{eventDate\}/g, eventDateFormatted);

        const bodyText = oneMonthTemplate.body
          .replace(/\{firstName\}/g, firstName)
          .replace(/\{eventType\}/g, eventType)
          .replace(/\{balanceAmount\}/g, balanceAmount)
          .replace(/\{balanceDueDate\}/g, balanceDueDateStr)
          .replace(/\{eventDate\}/g, eventDateFormatted);

        const eventDetailsHTML = `
  <tr><td style="padding:0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5; border-radius:8px; padding:20px 24px; margin:16px 0;">
      <tr><td>
        <p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;"><strong>Event Date:</strong> ${eventDateFormatted}</p>
        ${client.venue ? `<p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;"><strong>Venue:</strong> ${client.venue}</p>` : ''}
        <p style="font-size:14px; color:#444; line-height:1.8; margin:0;"><strong>Final Balance:</strong> ${balanceAmount} due by ${balanceDueDateStr}</p>
      </td></tr>
    </table>
  </td></tr>`;

        const plainText = bodyText + `\n\nView and pay your final balance here:\n${finalBalanceLinkOneMonth}\n\nKenna Giuzio Cake\n(206) 472-5401\nkenna@kennagiuziocake.com`;

        const htmlBody = buildBrandedPaymentEmailHTML(bodyText, {
          title: 'One Month to Go!',
          detailsHTML: eventDetailsHTML,
          ctaUrl: finalBalanceLinkOneMonth,
          ctaText: 'VIEW YOUR FINAL BALANCE'
        });

        try {
          const boundary = 'boundary_' + Date.now().toString(36);
          const emailLines = [
            `To: ${client.email}`, `From: ${kennaEmail}`, `Subject: ${subject}`,
            'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
            `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 7bit', '', plainText, '',
            `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 7bit', '', htmlBody, '',
            `--${boundary}--`
          ];
          const encoded = Buffer.from(emailLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });

          await pool.query('INSERT INTO reminders_sent (client_id, type) VALUES ($1, $2)', [client.id, 'one_month']);
          await pool.query(
            `INSERT INTO communications (client_id, type, direction, subject, message, channel, created_at) VALUES ($1, 'email', 'outbound', $2, $3, 'gmail', NOW())`,
            [client.id, subject, plainText]
          );
          console.log(`Sent 1-month reminder to ${client.name} (${client.email})`);
        } catch (emailErr) {
          console.error(`Failed to send 1-month reminder to ${client.name}:`, emailErr.message);
        }
      }

      // 14 days out — Two week reminder + final balance invoice link
      if (daysUntil <= 14 && daysUntil > 0) {
        if (await alreadySent('two_week')) continue;

        // Calculate balance and build final balance link
        let balanceAmount = 0;
        let proposalTotal = 0, tastingCredit = 0, depositPaid = 0;
        try {
          const invResult = await pool.query(
            "SELECT amount, data FROM invoices WHERE client_id = $1 AND type = 'deposit' AND status = 'paid' ORDER BY created_at DESC LIMIT 1",
            [client.id]
          );
          if (invResult.rows.length > 0) {
            const invData = invResult.rows[0].data || {};
            proposalTotal = parseFloat(invData.proposalTotal) || 0;
            tastingCredit = parseFloat(invData.tastingCredit) || 0;
            depositPaid = parseFloat(invResult.rows[0].amount) || parseFloat(invData.amount) || 0;
            balanceAmount = (proposalTotal - tastingCredit) - depositPaid;
          }
        } catch (e) { console.log('Could not calculate balance for 2-week reminder'); }

        const balanceFormatted = balanceAmount > 0 ? '$' + Math.floor(balanceAmount).toLocaleString() : 'your remaining balance';
        const finalBalanceLink = `https://portal.kennagiuziocake.com/welcome-proposal.html?dest=final-balance&clientId=${client.id}&mode=final-balance&total=${proposalTotal}&tastingCredit=${tastingCredit}&depositPaid=${depositPaid}`;

        const eventType = (client.event_type || 'event').toLowerCase();
        const twoWeekTemplate = await getTwoWeekReminderTemplate();

        const subject = twoWeekTemplate.subject
          .replace(/\{firstName\}/g, firstName)
          .replace(/\{eventType\}/g, eventType)
          .replace(/\{balanceAmount\}/g, balanceFormatted)
          .replace(/\{eventDate\}/g, eventDateFormatted)
          .replace(/\{venue\}/g, client.venue || '');

        const bodyText = twoWeekTemplate.body
          .replace(/\{firstName\}/g, firstName)
          .replace(/\{eventType\}/g, eventType)
          .replace(/\{balanceAmount\}/g, balanceFormatted)
          .replace(/\{eventDate\}/g, eventDateFormatted)
          .replace(/\{venue\}/g, client.venue || 'TBD');

        const eventDetailsHTML = `
  <tr><td style="padding:0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5; border-radius:8px; padding:20px 24px; margin:16px 0;">
      <tr><td>
        <p style="font-size:14px; color:#444; line-height:1.8; margin:0 0 4px;"><strong>Event Date:</strong> ${eventDateFormatted}</p>
        ${client.venue ? `<p style="font-size:14px; color:#444; line-height:1.8; margin:0;"><strong>Venue:</strong> ${client.venue}</p>` : ''}
      </td></tr>
    </table>
  </td></tr>`;

        const plainText = bodyText + `\n\nView and pay your final balance here:\n${finalBalanceLink}\n\nKenna Giuzio Cake\n(206) 472-5401\nkenna@kennagiuziocake.com`;

        const htmlBody = buildBrandedPaymentEmailHTML(bodyText, {
          title: 'Final Balance Due',
          amountFormatted: balanceFormatted,
          paymentDate: `Due before ${eventDateFormatted}`,
          detailsHTML: eventDetailsHTML,
          ctaUrl: finalBalanceLink,
          ctaText: 'VIEW YOUR FINAL BALANCE'
        });

        try {
          // Create final balance invoice record
          const fbInvoiceId = 'FB-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-4);
          await pool.query(`
            INSERT INTO invoices (invoice_number, client_id, type, status, amount, data, created_at)
            VALUES ($1, $2, 'final', 'sent', $3, $4, NOW())
            ON CONFLICT DO NOTHING
          `, [fbInvoiceId, client.id, balanceAmount, JSON.stringify({
            proposalTotal, tastingCredit, depositPaid,
            clientName: client.name, clientEmail: client.email,
            eventType: client.event_type, eventDate: client.event_date, venue: client.venue
          })]);

          const boundary = 'boundary_' + Date.now().toString(36);
          const emailLines = [
            `To: ${client.email}`, `From: ${kennaEmail}`, `Subject: ${subject}`,
            'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
            `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 7bit', '', plainText, '',
            `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 7bit', '', htmlBody, '',
            `--${boundary}--`
          ];
          const encoded = Buffer.from(emailLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });

          await pool.query('INSERT INTO reminders_sent (client_id, type) VALUES ($1, $2)', [client.id, 'two_week']);
          await pool.query(
            `INSERT INTO communications (client_id, type, direction, subject, message, channel, created_at) VALUES ($1, 'email', 'outbound', $2, $3, 'gmail', NOW())`,
            [client.id, subject, plainText]
          );
          console.log(`Sent 2-week reminder + final balance to ${client.name} (${client.email})`);
        } catch (emailErr) {
          console.error(`Failed to send 2-week reminder to ${client.name}:`, emailErr.message);
        }
      }
    }

    console.log('Reminder check complete');
  } catch (err) {
    console.error('checkUpcomingEvents error:', err.message);
  }
}

// Schedule daily reminder check at 9:00 AM Pacific
cron.schedule('0 9 * * *', checkUpcomingEvents, { timezone: 'America/Los_Angeles' });

// Start server
runMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`KGC Portal API running on port ${PORT}`);

    // Start background email sync (every 5 minutes)
    setInterval(backgroundGmailSync, 5 * 60 * 1000);
    // Run once on startup after a short delay
    setTimeout(backgroundGmailSync, 30000);
  });
});
