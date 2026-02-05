-- Kenna Giuzio Cake Portal Database Schema
-- Run this on your PostgreSQL database to create the tables

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    status VARCHAR(50) DEFAULT 'inquiry',
    event_date DATE,
    event_type VARCHAR(100),
    guest_count VARCHAR(50),
    venue VARCHAR(255),
    source VARCHAR(100),
    notes TEXT,
    instagram VARCHAR(255),
    linkedin VARCHAR(255),
    website VARCHAR(255),
    company VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Communications table (emails, texts, calls, notes)
CREATE TABLE IF NOT EXISTS communications (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- email, text, call, note
    direction VARCHAR(20) DEFAULT 'outbound', -- inbound, outbound
    subject VARCHAR(500),
    message TEXT,
    channel VARCHAR(50), -- gmail, twilio, manual
    external_id VARCHAR(255), -- gmail message id, twilio sid, etc.
    created_at TIMESTAMP DEFAULT NOW()
);

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) UNIQUE,
    type VARCHAR(50), -- tasting, deposit, final
    amount DECIMAL(10,2),
    status VARCHAR(50) DEFAULT 'draft', -- draft, sent, paid, cancelled
    due_date DATE,
    paid_at TIMESTAMP,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Proposals table
CREATE TABLE IF NOT EXISTS proposals (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    proposal_number VARCHAR(50) UNIQUE,
    status VARCHAR(50) DEFAULT 'draft', -- draft, sent, signed
    data JSONB DEFAULT '{}', -- all proposal data (options, prices, etc.)
    signed_at TIMESTAMP,
    signature VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Calendar events table
CREATE TABLE IF NOT EXISTS calendar_events (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    event_date DATE NOT NULL,
    event_time TIME,
    event_type VARCHAR(50), -- wedding, tasting, consultation, custom
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    vendor VARCHAR(255),
    amount DECIMAL(10,2) NOT NULL,
    category VARCHAR(100),
    expense_date DATE,
    notes TEXT,
    receipt_url TEXT,
    allocations JSONB DEFAULT '[]', -- [{client_id, percentage}]
    created_at TIMESTAMP DEFAULT NOW()
);

-- Revenue table
CREATE TABLE IF NOT EXISTS revenue (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    type VARCHAR(50), -- tasting, deposit, final, other
    revenue_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Team members table (for client teams)
CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    role VARCHAR(100),
    role_type VARCHAR(50), -- vendor, family, other
    sort_order INTEGER DEFAULT 0,
    contact_id INTEGER REFERENCES clients(id) ON DELETE SET NULL, -- if linked to contacts
    created_at TIMESTAMP DEFAULT NOW()
);

-- Portal data table (misc client portal data)
CREATE TABLE IF NOT EXISTS portal_data (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
    tasting_paid BOOLEAN DEFAULT FALSE,
    tasting_paid_date TIMESTAMP,
    deposit_paid BOOLEAN DEFAULT FALSE,
    deposit_paid_date TIMESTAMP,
    final_paid BOOLEAN DEFAULT FALSE,
    final_paid_date TIMESTAMP,
    files JSONB DEFAULT '[]',
    notes JSONB DEFAULT '[]',
    internal_notes JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Settings table (for Gmail tokens, preferences, etc.)
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Add missing columns to clients if they don't exist
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tasting_date DATE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tasting_time TIME;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tasting_guests INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS event_time TIME;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_event_date ON clients(event_date);
CREATE INDEX IF NOT EXISTS idx_communications_client_id ON communications(client_id);
CREATE INDEX IF NOT EXISTS idx_communications_created_at ON communications(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_revenue_date ON revenue(revenue_date);

-- Generate invoice numbers automatically
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.invoice_number IS NULL THEN
        NEW.invoice_number := CONCAT(
            CASE NEW.type
                WHEN 'tasting' THEN 'TI-'
                WHEN 'deposit' THEN 'DI-'
                WHEN 'final' THEN 'FI-'
                ELSE 'INV-'
            END,
            TO_CHAR(NOW(), 'YYYY'),
            '-',
            LPAD(nextval('invoice_seq')::TEXT, 4, '0')
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create sequence for invoice numbers
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1000;

-- Create trigger for auto invoice numbers
DROP TRIGGER IF EXISTS set_invoice_number ON invoices;
CREATE TRIGGER set_invoice_number
    BEFORE INSERT ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION generate_invoice_number();

-- Generate proposal numbers automatically
CREATE OR REPLACE FUNCTION generate_proposal_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.proposal_number IS NULL THEN
        NEW.proposal_number := CONCAT('P-', LPAD(nextval('proposal_seq')::TEXT, 4, '0'));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create sequence for proposal numbers (start at 750 to look established)
CREATE SEQUENCE IF NOT EXISTS proposal_seq START 750;

-- Create trigger for auto proposal numbers
DROP TRIGGER IF EXISTS set_proposal_number ON proposals;
CREATE TRIGGER set_proposal_number
    BEFORE INSERT ON proposals
    FOR EACH ROW
    EXECUTE FUNCTION generate_proposal_number();
