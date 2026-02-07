# SUGAR - Project Architecture
*Kenna Giuzio Cake Client Portal*

**Internal code name:** Sugar
**Purpose:** Replace Honeybook with branded client management system

---

## Folder Structure

```
client-portal/
├── admin/                      # Kenna's dashboard & tools
│   ├── in-studio.html          # Main dashboard (client pipeline)
│   ├── calendar.html           # Calendar with events
│   ├── contacts.html           # All contacts & in-studio clients
│   ├── communications.html     # Email/text/call log & compose
│   ├── invoices.html           # Invoice management
│   ├── finances.html           # Revenue & expenses with OCR
│   ├── media.html              # Media library
│   ├── settings.html           # App settings & sample data
│   ├── brand-colors.html       # Brand color palette manager
│   └── archive.html            # Archived clients
│
├── clients/
│   └── view.html               # Event Portal (client detail view)
│
├── invoices/
│   ├── tasting-scheduler.html  # Create tasting appointments
│   ├── tasting-invoice.html    # Client-facing tasting invoice
│   └── deposit-invoice.html    # Client-facing deposit invoice
│
├── proposals/
│   └── proposal-builder.html   # Create & sign proposals
│
├── promo/
│   └── instagram-intro.html    # Instagram story promo video
│
├── backend/                    # Railway API (ready to deploy)
│   ├── index.js                # Express API endpoints
│   ├── schema.sql              # PostgreSQL tables
│   ├── package.json            # Dependencies
│   ├── railway.json            # Deploy config
│   ├── .env.example            # Environment template
│   └── README.md               # Deployment instructions
│
├── videos/                     # Video assets
│   ├── intro-fabric.mp4        # Tasting intro video
│   ├── intro-vintage.mp4       # Proposal intro video
│   └── intro-butterfly.mp4     # Backup video
│
├── images/
│   ├── logo.png                # Kenna logo
│   └── return-intro.jpg        # Return visit background
│
├── welcome.html                # Tasting intro experience
├── welcome-proposal.html       # Proposal intro experience
└── ARCHITECTURE.md             # This file
```

---

## Data Storage (localStorage)

| Key | Purpose |
|-----|---------|
| `kgc_clients` | All clients/contacts |
| `kgc_communications` | Email, text, call logs |
| `kgc_invoices` | Sent invoices |
| `kgc_tasting_drafts` | Unsent tasting drafts |
| `kgc_proposal_drafts` | Proposal data per client |
| `kgc_signatures` | Signed proposal records |
| `kgc_calendar_events` | Custom calendar events |
| `kgc_imported_calendars` | Personal calendar imports |
| `kgc_expenses` | Expense records with receipts |
| `kgc_revenue` | Revenue records |
| `kgc_portal_[clientId]` | Per-client portal data (team, notes, files) |
| `kgc_brand_colors` | Working color palette |
| `kgc_active_palette` | Live color palette |
| `kgc_inspirations` | Brand color inspiration photos |
| `kgc_collapsed_clients` | UI state for collapsed teams |

---

## Client Flow (Pipeline Stages)

```
Inquiry → Tasting Scheduled → Tasting Paid → Proposal Sent →
Signed → Deposit Paid (Booked) → Final Paid → Delivered → Archived
```

**Status values:** `inquiry`, `tasting`, `proposal`, `signed`, `booked`, `delivered`, `archived`, `contact`

---

## Page Relationships

```
Dashboard (in-studio.html)
    ├── → Client Portal (clients/view.html)
    ├── → Tasting Scheduler → Tasting Invoice
    ├── → Proposal Builder → Deposit Invoice
    ├── → Calendar
    ├── → Communications
    ├── → Invoices
    └── → Finances

Welcome Pages (client-facing intros)
    ├── welcome.html?type=tasting → Tasting Invoice
    ├── welcome-proposal.html → Proposal Builder
    └── welcome.html?type=return → Event Portal (client mode)

Promo
    └── promo/instagram-intro.html → kennagiuziocake.com
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla HTML/CSS/JavaScript |
| Fonts | Cormorant Garamond, Montserrat, Mr De Haviland |
| Data (current) | localStorage |
| Data (future) | PostgreSQL via Railway |
| Backend (pending) | Express.js on Railway |
| Payments (future) | Stripe |
| OCR | Tesseract.js (receipt scanning) |

---

## Backend API Endpoints (ready in backend/index.js)

### Clients
- `GET /api/clients` - List all clients
- `GET /api/clients/:id` - Get single client
- `POST /api/clients` - Create client
- `PUT /api/clients/:id` - Update client
- `DELETE /api/clients/:id` - Delete client

### Communications
- `GET /api/communications` - List (filter by ?client_id=)
- `POST /api/communications` - Log a communication

### Invoices
- `GET /api/invoices` - List (filter by ?client_id= or ?status=)
- `POST /api/invoices` - Create invoice
- `PUT /api/invoices/:id` - Update status

### Proposals
- `GET /api/proposals` - List (filter by ?client_id=)
- `POST /api/proposals` - Create proposal
- `PUT /api/proposals/:id` - Update proposal

### Calendar Events
- `GET /api/events` - List all events
- `POST /api/events` - Create event
- `DELETE /api/events/:id` - Delete event

### Finance
- `GET /api/expenses` - List expenses
- `POST /api/expenses` - Create expense
- `GET /api/revenue` - List revenue
- `POST /api/revenue` - Create revenue entry

---

## Brand Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Brand Gold | `#b5956a` | Buttons, accents |
| Deep Charcoal | `#1a1a1a` | Headlines, text |
| Warm Cream | `#f8f7f5` | Backgrounds |
| Sage Green | `#a8b5a0` | Calendar events, accents |
| Dark Sage | `#6b7d64` | Button fills |
| Elegant Rose | `#c2185b` | Special highlights |

---

## Key Features

- **Client Pipeline** - Visual status tracking from inquiry to delivery
- **Proposal Builder** - Multi-option proposals with sketches, pricing, e-signatures
- **Tasting Scheduler** - Book and invoice tasting appointments
- **Deposit Invoices** - Auto-generated from signed proposals
- **Calendar** - Events auto-populated from client data + custom events
- **Communications** - Log all client interactions, compose emails
- **Finance Tracking** - Revenue from invoices + expenses with receipt OCR
- **Team Management** - Add vendors/family to client events
- **Welcome Intros** - Cinematic video intros for client portal links
- **Brand Colors** - Customizable color palette manager

---

## Deployment (Pending)

**Target:** Railway (backend) + current setup continues for frontend

**Steps:**
1. Deploy backend to Railway
2. Add PostgreSQL database
3. Run schema.sql
4. Update frontend to call API instead of localStorage
5. Add Twilio for SMS
6. Add Gmail API for email sync

---

## Local Development

```bash
# Start local server
cd client-portal
npx http-server -p 8080

# Preview URLs
http://localhost:8080/admin/           # Dashboard
http://localhost:8080/welcome.html     # Tasting intro
http://localhost:8080/promo/instagram-intro.html  # Instagram promo
```

---

*Last updated: Feb 4, 2026*
