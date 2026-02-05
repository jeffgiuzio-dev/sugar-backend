# KGC Portal API

Backend API for Kenna Giuzio Cake Client Portal.

## Deploy to Railway

### Option 1: Railway Dashboard (Easiest)

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click "New Project" → "Deploy from GitHub repo"
3. Select this repo and the `/client-portal/backend` folder
4. Railway auto-detects Node.js and deploys

### Option 2: Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project (from backend folder)
cd client-portal/backend
railway init

# Add PostgreSQL database
railway add --plugin postgresql

# Deploy
railway up
```

## After Deployment

1. Railway provides `DATABASE_URL` automatically
2. Go to Railway dashboard → Variables
3. Add `FRONTEND_URL` = your Netlify URL (e.g., https://kennagiuziocake.com)
4. The schema.sql runs automatically on first connection

## API Endpoints

### Clients
- `GET /api/clients` - List all clients
- `GET /api/clients/:id` - Get single client
- `POST /api/clients` - Create client
- `PUT /api/clients/:id` - Update client
- `DELETE /api/clients/:id` - Delete client

### Communications
- `GET /api/communications` - List all (or filter by ?client_id=)
- `POST /api/communications` - Log a communication

### Invoices
- `GET /api/invoices` - List all (or filter by ?client_id= or ?status=)
- `POST /api/invoices` - Create invoice
- `PUT /api/invoices/:id` - Update invoice status

### Proposals
- `GET /api/proposals` - List all (or filter by ?client_id=)
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

## Local Development

```bash
# Copy env file
cp .env.example .env

# Edit .env with your local PostgreSQL credentials

# Install dependencies
npm install

# Run with hot reload
npm run dev
```
