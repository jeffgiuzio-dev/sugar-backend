require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const { google } = require('googleapis');
const twilio = require('twilio');
const Stripe = require('stripe');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Helper to convert empty strings to null
const nullIfEmpty = (val) => (val === '' || val === undefined) ? null : val;

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
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null
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
      metadata: {
        invoice_id: invoice_id || '',
        invoice_type: invoice_type || '',
        client_id: client_id || '',
        client_name: client_name || ''
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

// Stripe Webhook (handles payment completion)
app.post('/api/payments/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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
  async function handlePaymentCompleted({ invoiceId, invoiceType, clientId, clientName, amountCents, stripeId }) {
    // Update invoice status to paid
    if (invoiceId) {
      await pool.query(`
        UPDATE invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW()
        WHERE invoice_number = $1
      `, [invoiceId]);
    }

    // Update client status based on payment type
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
      } else if (invoiceType === 'final') {
        await pool.query(`
          INSERT INTO portal_data (client_id, final_paid, final_paid_date)
          VALUES ($1, TRUE, NOW())
          ON CONFLICT (client_id) DO UPDATE SET final_paid = TRUE, final_paid_date = NOW(), updated_at = NOW()
        `, [clientId]);
      }
    }

    // Record revenue
    if (clientId) {
      await pool.query(`
        INSERT INTO revenue (client_id, invoice_id, amount, type, revenue_date, notes)
        VALUES ($1, $2, $3, $4, NOW(), $5)
      `, [clientId, invoiceId || null, amountCents / 100, invoiceType || 'other', `Stripe payment: ${stripeId}`]);
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
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Checkout payment successful:', session.id);
    const { invoice_id, invoice_type, client_id, client_name } = session.metadata || {};
    await handlePaymentCompleted({
      invoiceId: invoice_id, invoiceType: invoice_type, clientId: client_id,
      clientName: client_name, amountCents: session.amount_total, stripeId: session.id
    });
  } else if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    console.log('PaymentIntent succeeded:', paymentIntent.id);
    const { invoice_id, invoice_type, client_id, client_name } = paymentIntent.metadata || {};
    await handlePaymentCompleted({
      invoiceId: invoice_id, invoiceType: invoice_type, clientId: client_id,
      clientName: client_name, amountCents: paymentIntent.amount, stripeId: paymentIntent.id
    });
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
            tasting_date, tasting_time, tasting_end_time, tasting_guests, event_time, event_end_time, archived, instagram, linkedin, website, company } = req.body;
    const result = await pool.query(
      `INSERT INTO clients (name, email, phone, status, event_date, event_type, guest_count, venue, source, notes, address,
       tasting_date, tasting_time, tasting_end_time, tasting_guests, event_time, event_end_time, archived, instagram, linkedin, website, company)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING *`,
      [name, nullIfEmpty(email), nullIfEmpty(phone), status || 'inquiry', nullIfEmpty(event_date), nullIfEmpty(event_type), nullIfEmpty(guest_count), nullIfEmpty(venue), nullIfEmpty(source), nullIfEmpty(notes), nullIfEmpty(address),
       nullIfEmpty(tasting_date), nullIfEmpty(tasting_time), nullIfEmpty(tasting_end_time), nullIfEmpty(tasting_guests), nullIfEmpty(event_time), nullIfEmpty(event_end_time), archived || false, nullIfEmpty(instagram), nullIfEmpty(linkedin), nullIfEmpty(website), nullIfEmpty(company)]
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
            tasting_date, tasting_time, tasting_end_time, tasting_guests, event_time, event_end_time, archived, instagram, linkedin, website, company } = req.body;
    const result = await pool.query(
      `UPDATE clients SET name=$1, email=$2, phone=$3, status=$4, event_date=$5, event_type=$6,
       guest_count=$7, venue=$8, source=$9, notes=$10, address=$11,
       tasting_date=$12, tasting_time=$13, tasting_end_time=$14, tasting_guests=$15, event_time=$16, event_end_time=$17, archived=$18,
       instagram=$19, linkedin=$20, website=$21, company=$22, updated_at=NOW()
       WHERE id=$23 RETURNING *`,
      [name, nullIfEmpty(email), nullIfEmpty(phone), status, nullIfEmpty(event_date), nullIfEmpty(event_type), nullIfEmpty(guest_count), nullIfEmpty(venue), nullIfEmpty(source), nullIfEmpty(notes), nullIfEmpty(address),
       nullIfEmpty(tasting_date), nullIfEmpty(tasting_time), nullIfEmpty(tasting_end_time), nullIfEmpty(tasting_guests), nullIfEmpty(event_time), nullIfEmpty(event_end_time), archived, nullIfEmpty(instagram), nullIfEmpty(linkedin), nullIfEmpty(website), nullIfEmpty(company), req.params.id]
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
    const { client_id, title, event_date, event_time, event_end_time, event_type, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO calendar_events (client_id, title, event_date, event_time, event_end_time, event_type, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [client_id, title, event_date, event_time, event_end_time || null, event_type, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

app.put('/api/events/:id', async (req, res) => {
  try {
    const { title, event_date, event_time, event_end_time, event_type, notes } = req.body;
    const result = await pool.query(
      `UPDATE calendar_events
       SET title = COALESCE($1, title),
           event_date = COALESCE($2, event_date),
           event_time = $3,
           event_end_time = $4,
           event_type = COALESCE($5, event_type),
           notes = $6
       WHERE id = $7
       RETURNING *`,
      [title, event_date, event_time, event_end_time, event_type, notes, req.params.id]
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

    // Add missing column to calendar_events
    console.log('Adding columns to calendar_events table...');
    await pool.query(`
      ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS event_end_time TIME;
    `);
    console.log('✓ Calendar events table updated');

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

// Start server
runMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`KGC Portal API running on port ${PORT}`);
  });
});
