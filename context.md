# Kenna Giuzio Cake - Website Project

## Quick Start for New Sessions
> At the start of each session, say: "Read CONTEXT.md in KennaGiuzioCake and let's work on Kenna's website"

---

## The Business

**Name:** Kenna's Cakes / Kenna Giuzio Cake
**Owner:** Kenna Giuzio
**What she does:** Custom cake artist - bespoke celebration cakes that tell personal stories

**Tagline (current):** "Live. Love. Cake" / "Unique stories detailed in cake"

**Domains:**
- kennascakes.com (redirects to main)
- kennagiuziocake.com (primary)

---

## Current Site

**Platform:** Squarespace
**URL:** https://kennagiuziocake.com
**Current pages:** Gallery, My Story, What People Are Saying, How it Works, Get in Touch

**Current costs:**
| Item | Cost/Year |
|------|-----------|
| Squarespace website plan | $304 |
| kennagiuziocake.com domain | $22 |
| kennascakes.com domain | $20 |
| **Total** | **$346/year** |

**After migration:**
| Item | Cost/Year |
|------|-----------|
| Hosting (Cloudflare Pages) | $0 |
| Both domains (on Cloudflare) | ~$22 |
| **Total** | **~$22/year** |

---

## New Site Vision

**Aesthetic:**
- Simple and elegant
- White background
- Refined and editorial
- Fashion/editorial vibe (NOT wedding-y)
- Very little text - let photos speak
- Photography-forward

**Reference site:** www.samanthamillerpastry.com
- Grid-based layout
- Minimal text
- Luxurious, minimal palette (whites, creams, blacks)
- Clean sans-serif typography
- Full-width hero images
- Instagram feed integration
- "Couture" / high-end design studio positioning

**Vibe:** High-end, artistic, editorial - like a fashion brand that happens to make cakes

---

## Site Structure (Planned)

1. **Home** - Full-width hero image, minimal text, grid of work
2. **Gallery/Portfolio** - Editorial photo grid
3. **About/My Story** - Brief, elegant
4. **How it Works** - Simple process
5. **Contact** - Inquiry form
6. **Instagram feed** - Living gallery

---

## Domain Migration Plan

**Step 1: Transfer domains (when ready)**
1. Unlock domains in Squarespace
2. Get authorization codes
3. Transfer to Cloudflare (~$11 each)
4. Wait 5-7 days

**Step 2: Point to new hosting**
- Update DNS to Netlify/Cloudflare Pages

**Step 3: Cancel Squarespace**
- After everything is working

**Domain expiration dates:**
- kennagiuziocake.com: March 27, 2026
- kennascakes.com: January 4, 2027

---

## Local Development Server

**Main Site (site-v4):**
- Live: https://kennagiuziocake.com
- Local: `cd site-v4-deployed-feb04 && python -m http.server 8000 --bind 0.0.0.0`

**Client Portal / Sugar:**
- Live: https://portal.kennagiuziocake.com
- Local: `cd client-portal && python -m http.server 8000`
- **Use Python** (not npx serve) - npx serve strips URL query parameters
- Both local and live connect to same Railway backend (data syncs)

**Python path (if needed):** `/c/Users/GIUZI/AppData/Local/Programs/Python/Python312/python.exe`

---

## Files in This Project

```
C:\Users\jeffgiuzio\claude-code-projects\KennaGiuzioCake\
├── CONTEXT.md                    ← This file
├── site-v1-deployed-jan22/       ← Original version (deployed Jan 22)
├── site-v2-deployed-jan26/       ← V2 with onboarding features (deployed Jan 26) ← CURRENT LIVE
│   ├── index.html                ← Homepage with gallery wall + videos
│   ├── gallery.html              ← Portfolio page (static grid)
│   ├── about.html                ← About page with looping video
│   ├── contact.html              ← Inquiry form
│   ├── images/                   ← Cake photos
│   └── videos/                   ← Video clips
├── images-archive/               ← Archived images
└── videos-archive/               ← Archived videos
```

---

## Session Log

**Session 1 (Jan 20, 2026):**
- Discussed domain transfer logistics
- Researched domain expiration dates (both paid through 2026-2027)
- Calculated cost savings ($346/yr → ~$22/yr)
- Reviewed current Squarespace site
- Reviewed reference site (samanthamillerpastry.com)
- Established design direction: editorial, minimal, white, fashion-forward
- Created project folder structure

**Session 2 (Jan 20, 2026):**
- Built homepage gallery wall with organic layout (absolute positioning)
- Added 4 videos to homepage gallery (thumbnail at 5 sec, play on hover)
  - Fabric in motion (centered focal point)
  - Dutch master still-life rotation
  - Gold floral landscape
  - Floral butterfly rotation
- Fixed hover scaling artifacts (backface-visibility, translateZ fixes)
- Updated About page:
  - Replaced static image with studio_process video (autoplay loop)
  - New copy: "I approach cake as sculpture..."
  - Removed "The Approach" section and CTA
- Rebuilt Portfolio page:
  - CSS grid with varied image shapes (no hover effects, static)
  - 30 photos total
- Logo font: Using Mr De Haviland as placeholder (exact font TBD)

**Next steps:**
- Test mobile responsiveness (can use browser DevTools or deploy to Netlify)
- Consider adding hamburger menu for mobile nav
- Track down exact logo font from designer
- Domain transfer when ready (will also set up email forwarding at that time)

**Session 3 (Jan 21, 2026):**
- Connected contact form to Formspree (ID: xreedgdk)
- Removed "Type of Event" dropdown from inquiry form
- Added pricing note: "I accept a limited number of commissions each season. Projects typically begin at $2,500."
- Added to About page: "Work is available for private commission, editorial projects and select collaborations."
- Discussed email setup - will use Cloudflare email forwarding (hello@kennagiuziocake.com → Gmail) when domain transfers

**Session 4 (Jan 21, 2026):**
- **Homepage gallery refinements:**
  - Smoother transitions: 1.2s expand, 0.6s collapse (fast shrink, slow expand)
  - Fixed video auto-close by disabling loop during expansion
  - Fixed rendering line artifacts on slots 1, 2, 11 with dimension adjustments and tiny rotation hack (0.02deg)
  - Swapped images with "A" versions: Gallery 01A, 04A, 07A, 09A, 11A

- **Mobile Portfolio (gallery.html) - Major rework:**
  - Changed from scroll-based expansion to **tap-to-expand** with 2 second auto-collapse
  - Created **Tetris-style layout** with CSS Grid:
    - Two columns with varied spans (some full-width, some side-by-side)
    - Different heights (2-3 row spans) for visual rhythm
    - `grid-auto-flow: dense` to eliminate white gaps
  - Smooth transitions: 1.2s expand, 0.6s collapse
  - Fixed 5 missing images by swapping with available files:
    - Slot 4: IMG_1387 → IMG_0670
    - Slot 6: IMG_1632 → IMG_0716
    - Slot 14: IMG_1906 → IMG_0839
    - Slot 21: IMG_1135 → IMG_1131
    - Slot 23: IMG_1835 → IMG_0651

- **Mobile layout structure:**
  - Full-width features: slots 1, 6, 11, 16, 21, 26, 30
  - Tall portraits: slots 3, 7, 10, 14, 18, 23, 27
  - Standard side-by-side: remaining slots
  - 6px gaps, 60px base row height

- **Portfolio map tool updated:**
  - `site/portfolio-map.html` - reference tool for planning photo swaps
  - Shows numbered slots with desktop/mobile sizes
  - Color coded: blue = full-width mobile, yellow = tall mobile
  - Table with current image assignments

**Session 5 (Jan 22, 2026):**
- **About page - Mobile portrait video improvements:**
  - Video now stays fixed at top while text scrolls behind it
  - Video container 47vh height with cropped view showing hand work (object-position: center top)
  - Video fades in (1.5s with 0.3s delay) to avoid black flash on load
  - In landscape: video hides completely, just shows text content
  - Added safe-area padding for iPhone notch in landscape
  - Disabled address bar hiding script to prevent scroll jitter

- **Homepage improvements:**
  - Page fades in over 1.6s on load
  - Hero logo fades in with 1s delay (lags behind the cake image)
  - Footer logo now links to homepage (all pages)
  - **Landscape mode fixes:**
    - Floating logo hidden in landscape (was overlapping thumbnails)
    - Fixed collapsed thumbnails not returning to proper size
    - Added explicit collapsed state CSS rules

- **Contact/Inquire page:**
  - In landscape: photo hides for smooth transition
  - Added safe-area padding for iPhone notch
  - Disabled scroll-jumping address bar script
  - Changed "Send Inquiry" button to warm golden color (#b5956a) to match vase aesthetic

- **Local dev server:**
  - Updated to use port 8080: `python -m http.server 8080 --bind 192.168.5.243`
  - Preview URL: http://192.168.5.243:8080

**Session 6 (Jan 22, 2026):**
- **Portfolio page (gallery.html) desktop fix:**
  - Fixed header hiding on desktop - was using `@media (orientation: landscape)` which affected desktop monitors
  - Changed to `@media (max-width: 900px) and (orientation: landscape)` for mobile only

- **Page transitions added:**
  - Homepage: White overlay fades in (0.8s) before navigating to Inquire page
  - About page: Body fades out (0.1s) before navigating to Inquire page
  - Contact/Inquire page: Fades in (1.0s with 0.15s delay)

- **Fullscreen fix for desktop:**
  - All pages: Fullscreen only triggers on mobile (≤900px), not desktop monitors

- **Contact/Inquire page updates:**
  - Added "Event Location" field (City, State or Venue)
  - Fixed input focus scroll jump on desktop

- **Homepage photo swaps:**
  - Slot 1: Gallery 01A → Gallery 01
  - Slot 4: Gallery 04A → IMG_0429
  - Slot 12: IMG_1835 → IMG_0462
  - Slot 14: IMG_0700 → IMG_0454

- **Homepage map tool created:**
  - `site/homepage-map.html` - visual reference for all 17 visible slots
  - Shows exact positions matching actual layout
  - Blue = video slots, numbered for easy reference

- **DEPLOYED TO NETLIFY:**
  - **Live URL: https://kenna-giuzio-cake.netlify.app**
  - Free hosting, automatic HTTPS
  - Drag & drop deployment

- **Domain transfer initiated:**
  - Both domains unlocked in Squarespace
  - Authorization codes requested (sent to kgiuzio@gmail.com)
  - Next: Transfer to Cloudflare when codes arrive

- **Local dev server:**
  - Updated to port 8000: `python -m http.server 8000 --bind 0.0.0.0`
  - Preview URL: http://192.168.5.243:8000

**Session 7 (Jan 23, 2026):**
- **Domain transfers submitted to Cloudflare:**
  - Received auth codes from Squarespace
  - Submitted transfers for both domains ($10.46 each, $20.92 total)
  - Transfers pending - Squarespace has until Jan 28 to release
  - Received transfer notification emails from Squarespace (ignore them to proceed)

- **Email forwarding set up:**
  - Configured Cloudflare Email Routing for kennagiuziocake.com
  - hello@kennagiuziocake.com → kgiuzio@gmail.com ✅ Working
  - MX and TXT records (SPF, DKIM) auto-configured

- **DNS pointed to Netlify:**
  - Deleted old Squarespace DNS records (A records, old CNAMEs, Squarespace NS records)
  - Added CNAME records pointing to kenna-giuzio-cake.netlify.app
  - Both domains configured with "DNS only" (gray cloud) proxy status

- **Custom domains added to Netlify:**
  - kennagiuziocake.com (primary domain)
  - www.kennagiuziocake.com (redirects to primary)
  - kennascakes.com (domain alias)
  - SSL certificates provisioned via Let's Encrypt

- **All domains now live:**
  - https://kennagiuziocake.com ✅
  - https://www.kennagiuziocake.com ✅
  - https://kennascakes.com ✅
  - https://kenna-giuzio-cake.netlify.app ✅

- **Email MCP Server created:**
  - Built custom MCP server for sending emails from Claude Code
  - Uses Gmail SMTP with app password
  - Configured in `C:\Users\jeffgiuzio\claude-email-mcp\`
  - Registered in Claude Code settings
  - Restart Claude Code to activate, then can send emails from any session

---

## Live Site

**Production URLs:**
- https://kennagiuziocake.com (primary)
- https://www.kennagiuziocake.com (redirects to primary)
- https://kennascakes.com (alias - TODO: add to Cloudflare Pages)
- https://portal.kennagiuziocake.com (Sugar client portal)

**Backup URLs (Cloudflare Pages subdomains):**
- https://kenna-giuzio-cake.pages.dev
- https://sugar-portal.pages.dev

**Hosting:** Cloudflare Pages (free tier, unlimited bandwidth)
**Status:** Live and working

**Email:** kenna@kennagiuziocake.com (Google Workspace)

---

## Domain Transfer Status

**Status:** ✅ COMPLETE

| Domain | Cloudflare Status | Transfer Complete |
|--------|-------------------|-------------------|
| kennagiuziocake.com | ✅ Active | ✅ Jan 2026 |
| kennascakes.com | ✅ Active | ✅ Jan 2026 |

---

## Cloudflare Setup

**Account:** kgiuzio@gmail.com
**Plan:** Free

**Domains:**
- kennagiuziocake.com ✅ Active
- kennascakes.com ✅ Active

**DNS Records (kennagiuziocake.com):**
- CNAME `@` → kenna-giuzio-cake.netlify.app
- CNAME `www` → kenna-giuzio-cake.netlify.app
- MX records → Cloudflare email routing
- TXT records → SPF & DKIM for email

**DNS Records (kennascakes.com):**
- CNAME `@` → kenna-giuzio-cake.netlify.app
- CNAME `www` → kenna-giuzio-cake.netlify.app
- MX records → Google (existing)

**Email Routing:**
- hello@kennagiuziocake.com → kgiuzio@gmail.com ✅

---

## Email System (Claude Code Integration)

**What it does:** Allows Claude Code to send emails directly during any session, with contact lookup, groups, and draft approval.

**Location:** `C:\Users\jeffgiuzio\claude-email-mcp\`

**Files:**
- `index.js` - MCP server code
- `.env` - Gmail credentials (GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
- `package.json` - Dependencies
- `contacts.json` - Contact directory (1,242 contacts from Gmail + Outlook)
- `settings.json` - Email preferences

**Contacts:**
- 1,242 contacts imported from Gmail and Outlook exports
- Includes name, email, phone, company, title
- Search by name - Claude will look up email automatically

**Groups:**
- Can create email groups for bulk sending
- Example: "Family" group with multiple recipients
- Usage: "Send an email to the Family group"

**Settings (settings.json):**
```json
{
  "requireDraftApproval": true,
  "defaultSignature": "Jeff"
}
```
- Draft approval required by default - Claude shows draft before sending
- Can be overridden per-email if needed

**Features:**
- Contact lookup by name
- Draft approval before sending
- Email attachments supported
- Groups for bulk emails

**Example usage:**
- "Send an email to Robert Giuzio" - looks up contact, drafts email, waits for approval
- "Send an email to the Family group about dinner plans"
- "Send me an email with an attachment"

**To add contacts:**
- Export from Gmail: contacts.google.com → Export → Google CSV
- Export from Outlook: outlook.live.com/people → Manage → Export
- Tell Claude to import the CSV from Downloads folder

**Note:** App password can be revoked anytime at https://myaccount.google.com/apppasswords

---

## Migration Complete ✅

1. ✅ Domain transfers complete (both active in Cloudflare)
2. ✅ Squarespace subscription cancelled (Jan 27, 2026)

**Annual savings: ~$324/year** ($346 Squarespace → $22 Cloudflare domains)

---

**Session 8 (Jan 23, 2026):**
- **Email system fully configured:**
  - Updated Gmail app password
  - Imported 1,242 contacts from Gmail and Outlook CSV exports
  - Added contact groups feature (e.g., "Family" group)
  - Added settings.json with `requireDraftApproval: true`
  - Claude now shows draft and waits for approval before sending
  - Contact lookup by name - no need to provide email addresses
  - Email attachments supported (tested with Apollo 11 moon landing photo)

- **Email workflow:**
  1. "Send an email to [name]" - Claude looks up contact
  2. Claude drafts email and shows preview
  3. User approves or requests changes
  4. Claude sends on approval

- **Files created:**
  - `C:\Users\jeffgiuzio\claude-email-mcp\contacts.json` - 1,242 contacts
  - `C:\Users\jeffgiuzio\claude-email-mcp\settings.json` - email preferences

---

---

**Session 9 (Jan 26, 2026):**
- **Created V2 sandbox** (`site-v2/`) for developing new features without affecting live site

- **Mobile onboarding animation (home & portfolio pages):**
  - Auto-expands gallery items when scrolling to gallery on mobile
  - First 3 expansions from bottom rows to not block content
  - Rotates through ALL items before repeating any
  - "Tap to discover" hint fades in with gallery
  - Stops auto-showcase when user taps (user takes control)
  - Videos loop instead of closing when they end

- **Desktop hover hint (home & portfolio pages):**
  - "Hover to explore the gallery" text above gallery
  - Pulses from gray to gold (#b5956a) with bold weight
  - Fades away when user hovers over a gallery item

- **Hero logo breathing animation (homepage):**
  - Logo fades in slowly, holds, fades out, repeats
  - 14 second cycle with long blank periods to view cake

- **Image protection (all pages):**
  - Disabled right-click/context menu on images
  - Disabled long-press save on mobile (iOS)
  - Disabled image dragging
  - CSS: `-webkit-touch-callout: none`, `user-select: none`

- **Navigation updates:**
  - Added "Home" link to desktop nav on all pages except homepage
  - Mobile menu already had Home on all pages

- **Timing refinements:**
  - Gallery items expand for 3.5 seconds (matching tap feel)
  - 1.5s collapse animation with proper z-index handling
  - 2.2s pause between auto-expansions
  - 2.8s initial delay on homepage before first expansion
  - Portfolio hint appears immediately with gallery fade-in

- **Folder reorganization:**
  - `site/` → `site-v1-deployed-jan22/` (original version)
  - `site-v2/` → `site-v2-deployed-jan26/` (current live version)

- **Deployed V2 to Netlify**

---

---

## Honeybook Replacement Project (PLANNED)

**Status:** Planning phase

**Goal:** Build a custom client management system to replace Honeybook, matching the elegant aesthetic of the website.

### Current Pain Point
Honeybook costs $19-79/month ($228-948/year) and looks generic. Kenna needs a branded experience that feels like part of her business.

### Core Features Needed

**1. Client Portal** (unique link per wedding)
- Wedding details and timeline
- Inspiration photos they've shared
- Cake design mockups/photos
- Communication history
- kennagiuziocake.com/clients/smith-wedding

**2. Beautiful Proposals**
- Branded PDF or web page
- Cake options with photos
- Pricing tiers
- Terms & conditions
- Digital acceptance/signing

**3. Invoicing & Payments**
- Branded invoices matching site aesthetic
- Stripe integration for deposits/final payments
- Payment reminders
- Payment history

**4. Finance Tracking**
- Dashboard: income, pending payments, expenses
- Per-client payment history
- Simple reporting

### Technical Approach (TBD)
- Custom site matching her aesthetic
- Stripe for payments
- Simple admin panel for Kenna
- Client portal pages auto-generated per booking

### Cost Comparison
| Option | Annual Cost |
|--------|-------------|
| Honeybook | $228-948 |
| Custom build | Stripe fees only (2.9% + 30¢) |

### Files
```
KennaGiuzioCake/
├── client-portal/           <- Client management system ("Sugar")
│   ├── admin/
│   │   └── index.html       <- In Studio (default landing page)
│   ├── clients/             <- Individual client portals
│   ├── proposals/
│   │   └── proposal-builder.html  <- Build & preview proposals
│   ├── invoices/            <- Invoice system
│   ├── backend/             <- Railway API (PostgreSQL)
│   └── images/
│       └── header-flowers.jpg
```

### Current Status
- ✅ In Studio page with client management
- ✅ Proposal builder with 3 design options (Display Cake, Option 2, Option 3)
- ✅ Sketch upload per design option (supports HEIC from iPhone)
- ✅ Preview popup for client view
- ✅ Design selection with price recalculation & highlight follows selection
- ✅ Electronic signature
- ✅ Signed proposal/agreement view (with contract terms, print button)
- ✅ Tasting scheduler with live preview
- ✅ Tasting invoice (client-facing, payment options)
- ✅ Client portal with status tracker, documents, files, notes
- ✅ Accounting section (tasting fee, deposit, final payment tracking)
- ✅ Payment tracking (Mark Paid / Undo with confirmation)
- ✅ Stats display (Payments Received, Payments Due - dynamic)
- ✅ Railway backend deployed (PostgreSQL, all API endpoints)
- ✅ Gmail API integration (auto-sync incoming/outgoing emails to client communications)
- ✅ Frontend deployed to Cloudflare Pages (portal.kennagiuziocake.com)
- ✅ Core data migrated to API (clients, portal data, proposals, communications sync across devices)
- ✅ Stripe integration (test mode - ready for live when business verified)
- 🔲 Email notifications (send invoice links directly)

### Next Steps
1. **Beta testing** — Kenna uses with real client
2. **Stripe integration** — Enable actual card payments on invoices
3. **Email integration** — Send invoices directly from platform
4. **Final invoice system** — For remaining 50% balance

---

**Session 10 (Jan 27, 2026):**
- Confirmed domain transfers complete (both Active in Cloudflare)
- Cancelled Squarespace website subscription
- Annual savings: ~$324/year
- Added Honeybook replacement project plan to context

---

**Session 11 (Jan 27, 2026) - Honeybook Replacement Build:**

**Admin Dashboard (`client-portal/admin/index.html`):**
- Client list with status, event date, payment info
- Stats cards (pending proposals, delivered, outstanding)
- Add new client modal
- Tasting invoice and Proposal buttons per client
- "Signed ✓" button for signed proposals (opens clean view)

**Proposal Builder (`client-portal/proposals/proposal-builder.html`):**
- Three design sections: Base, Option 1, Option 2
- Each design has: sketch upload area, price field, narrative textarea
- Sketch upload supports HEIC (iPhone photos) with auto-conversion
- Live preview panel showing proposal as client will see it
- "Select Your Design" section with clickable options
- Price recalculates when design is selected
- Service fee (3.4% for card) and tasting credit support
- Payment method toggle (Zelle vs Card)

**Preview & Signing Flow:**
- Preview button opens client-facing popup
- Client can select their preferred design option
- Totals recalculate based on selection
- Agreement checkbox enables signature input
- Electronic signature (typed, cursive font)
- Sign button saves to localStorage and updates client status
- Locked confirmation shown after signing

**Signed Proposal View (from dashboard):**
- Clean, professional layout (not the builder)
- Shows: client info, selected design sketch, narrative, pricing breakdown
- Green "SIGNED & ACCEPTED" badge
- Signature display with date/time
- Print button

**Bug Fixes:**
- Added `selectDesign()` function to popup (was missing, caused JS errors)
- Fixed client ID comparison (number vs string mismatch)
- Fixed $0 prices by saving all price data to signature record
- `loadSignature()` now restores prices from signature data
- Robust ID matching: tries number, string, and String() comparison

**Data Storage (localStorage):**
- `kgc_clients` - Client records (id, name, email, event, status, etc.)
- `kgc_proposal_drafts` - Saved proposal data per client
- `kgc_signatures` - Signature records with selected design, prices, totals
- `kgc_sketches` - Backup sketch storage

---

---

**Session 12 (Jan 28, 2026) - Tasting System & Client Portal:**

**Project folder moved to OneDrive:**
- Moved `claude-code-projects` to OneDrive for San Diego computer sync
- Updated CLAUDE.md paths accordingly

**Proposal Builder Improvements:**
- Renamed options: Display Cake, Display Cake Option 2, Display Cake Option 3
- Design highlight now follows selection (gold border + cream background)
- Added contract terms to signed agreement view
- Changed "Print Proposal" to "Print Agreement" on signed view
- Phone number auto-formatting (accepts 10 digits, formats to (xxx) xxx-xxxx)

**Additional Services (Quick Add):**
- Cutting Cake now has Flavors field
- Added "Other" option for custom add-ons
- Items auto-sort: Cutting Cake → Flower Cloche → Other → Delivery → Travel
- Items insert in correct hierarchy order when added

**Tasting System:**
- **Tasting Scheduler** (`invoices/tasting-scheduler.html`):
  - Form: date, time, guest count, fee, location, internal notes
  - Live preview panel
  - Save Draft / Send Invoice buttons
  - Updates client status to "Tasting Scheduled"
- **Tasting Invoice** (`invoices/tasting-invoice.html`):
  - Client-facing branded invoice
  - Payment options: Credit Card (+3.4% fee) or Zelle (no fee)
  - Updated footer: white background with Kenna's logo (240px)
- Dashboard shows "Tasting Draft" / "Tasting ✓" buttons
- Payment status: "Awaiting tasting payment"

**Client Portal** (`clients/view.html`):
- **Status Tracker** — Visual progress: Inquiry → Tasting → Proposal → Booked → Delivered
- **Event Details** — Client info, event date, venue, guest count
- **Documents** — Links to tasting invoice and proposal (click to open)
- **Accounting** (Admin only):
  - Tasting Fee, Deposit (50%), Final Payment line items
  - Mark Paid / Undo buttons
  - Elegant confirmation modal for Undo
  - Summary: Total Due / Total Paid
- **Files & Images** — Upload area with drag-and-drop support
- **Communication** — Client-visible notes only (no internal toggle)
- **Internal Notes** (Admin only) — Private notes section
- Dashboard link: Click client name → opens portal
- "Dashboard" button (gold, matches brand)

**Dashboard Accounting:**
- Stats now dynamic: Payments Received / Payments Due
- Payment column shows: "Tasting Paid ✓", "Deposit Paid", "Paid in Full ✓"
- Calculates from actual client payment data

**Data Storage (localStorage):**
- `kgc_tasting_drafts` — Tasting scheduler data per client
- `kgc_portal_[clientId]` — Portal data (notes, files, internal notes, payment status)

---

**Session 13 (Jan 30, 2026) - Calendar Feature:**

**Calendar Page (`admin/calendar.html`):**
- Beautiful month-view calendar matching site aesthetic
- Auto-populates events from client data:
  - Event dates (weddings/celebrations) - green
  - Tasting appointments - orange
  - Inquiry received dates - gray
  - Proposal sent dates - blue
  - Agreement signed dates - purple
  - Custom events - gold
- Click any day to see event details in side panel
- Add custom events with title, date, time, and notes
- Delete custom events (client events are read-only)
- Click client events to open their portal
- Legend showing all event types

**Export Options:**
- Download .ICS file (works with all calendar apps)
- Add to Google Calendar (instructions + direct add for single events)
- Add to Outlook (instructions + auto-download .ics)

**Data Storage:**
- `kgc_calendar_events` — Custom events added by Kenna

**Dashboard Updates:**
- Calendar nav link now works
- "VIEW CALENDAR" link in Upcoming section now works

---

**Session 14 (Jan 30, 2026) - Clients Page & Team Management:**

**Clients Page (`admin/clients.html`):**
- Delete client button (X) on each row
- Renamed "Recent Clients" to "In Studio"
- Toggle tabs: "In Studio" | "All Contacts"
  - In Studio = active pipeline (inquiry, tasting, proposal, booked)
  - All Contacts = everyone
- Search bar for All Contacts (always sorted A-Z alphabetically)
- Contact table columns: Name, Email, Phone, Address, Instagram, LinkedIn
- Instagram and LinkedIn are clickable links
- Clicking a contact opens edit popup (clicking an inquiry goes to full portal)

**Add/Edit Contact Modal:**
- Phone-contact style form (Name, Phone, Email, Address)
- Company, Website, Instagram, LinkedIn fields
- Contacts added here get status='contact' (not 'inquiry')
- "jeff" test data auto-fill for development

**Team Section in Client Portal (`clients/view.html`):**
- Moved to right under Event Details
- Shows Primary Contact at top with highlighted gold styling
- Click primary to edit name/phone/email
- "Switch" button to swap primary with a team member
- Add team members via "+ Add Member" button
- Two-level role selection:
  - Type: Vendor, Family, or Other
  - Vendor roles: Wedding Planner, Venue Contact, Photographer, Videographer, Florist, Caterer, DJ, Band, Rental Company, Lighting, Hair & Makeup
  - Family roles: Mother of the Bride, Mother of the Groom, Father of the Bride, Father of the Groom, Maid of Honor, Best Man, Bridesmaid, Groomsman, Sibling, Grandparent
  - Other: Custom text input
- "From Contacts" tab to add existing contacts as team members
- Click team members to edit
- Drag and drop to reorder team members (order is preserved)
- Option to add team member to All Contacts when creating

**In Studio Team Display (clients.html):**
- Team members appear indented below primary client
- Collapse/expand chevron (▶) for clients with team
- Team count badge shows number of team members
- Team order matches drag/drop order from client portal
- Collapse state remembered in localStorage

**Data Storage:**
- `kgc_portal_[clientId].team` — Team members array (preserves order)
- `kgc_collapsed_clients` — Collapse states for In Studio view
- Team members in contacts have `linkedToClient` and `role` fields

---

**Session 15 (Jan 31, 2026) - Calendar Enhancements & UI Polish:**

**Dynamic Date Headers (all admin pages):**
- Added current date display to Dashboard, Calendar, Contacts, Brand Colors
- Date format: "Friday, January 31, 2026"
- Page headers are sticky (stay visible when scrolling)

**Calendar - Week View Improvements:**
- Selected day column highlighted with gold border and light background
- Events at same time display side by side (not stacked)
- All-day row stays sticky when scrolling (locked at top: 74px)
- Header row with day names/numbers stays locked

**Calendar - Month View Improvements:**
- Day cells increased to 120px height for more event space
- Shows up to 4 events per day
- "+X more" link appears when events overflow
- Clicking "+X more" switches to week view for that date
- Removed scroll container (was clunky)
- Selected day styling: gold border + black bold number
- Today: no special styling (looks like any other day)

**Calendar - Navigation:**
- Upcoming events: clicking stays in current view (week or month)
- View toggle (Month/Week) anchors to selected date
- Add Event modal pre-populates with selected date or today's date

**Dashboard Updates:**
- "Add Inquiry" and "Add Contact" buttons (matching contacts page style)
- "jeff" auto-fill for testing forms
- Removed "CLIENT PORTAL" text from logo area
- Active/Archived client sections with filtering
- Dynamic stats calculation for upcoming events

**Other Updates:**
- Contacts page (renamed from Clients) with sticky header
- Brand Colors page: Data Management section (Clear All Data, Clear Calendar, Load Sample Data)
- Client Portal: Active/Archive toggle at bottom of page

---

**Session 16 (Jan 31, 2026) - Event Portal & Invoicing System:**

**Event Portal Redesign (`clients/view.html`):**
- Renamed from "Client Portal" to "Event Portal"
- Added floral ribbon header (matching Dashboard/Calendar aesthetic)
- Title auto-generates as "Name EventType" (e.g., "Smith Wedding") unless custom edited
- Event date displays in header subtitle
- Added full sidebar navigation (admin only) - consistent with all other admin pages
- All sections collapsed by default except Event Details

**Invoices Page (`admin/invoices.html`):**
- New dedicated invoices management page
- Stats: Total Invoiced, Outstanding, Paid, This Month
- Filters: All, Drafts, Sent, Paid, Tasting, Deposit
- Invoice table with: Invoice #, Client, Type, Amount, Status, Actions
- View button opens actual invoice
- Mark Paid updates invoice status + client accounting
- Draft invoices pulled from `kgc_tasting_drafts` (unsent)
- Edit/Send buttons for drafts → opens scheduler to complete
- Sidebar nav updated on all pages to link to `/admin/invoices`

**Tasting Invoice Flow Fixed:**
- Send Invoice no longer shows "Draft saved" alert interruption
- Saves invoice to `kgc_invoices` localStorage (with full tracking data)
- Opens invoice in new tab
- Invoice number format: TI-YYYY-XXXX
- Accounting in Event Portal auto-updates

**Deposit Invoice (`invoices/deposit-invoice.html`):**
- Triggers when proposal is signed ("Pay Deposit to Reserve Date" button)
- Shows: Proposal total, tasting credit, adjusted total, 50% deposit due
- Payment options: Credit Card (+3.4% fee) or Zelle (no fee)
- Payment schedule: 50% now to reserve, 50% before event
- Terms: Non-refundable, 30-day reschedule notice
- Links to deposit invoice with all data pre-filled from proposal

**Proposal Integration:**
- After signing, "Pay Deposit to Reserve Date" button appears
- Generates deposit invoice link with client/event/total data
- Link works on both fresh sign and returning to signed proposal

**Data Storage:**
- `kgc_invoices` — All sent invoices (tasting, deposit, etc.)
- Invoice records include: id, type, clientId, clientName, amount, status, sentAt, etc.

---

**Session 17 (Feb 1, 2026) - Finance Module & Receipt Scanning:**

**Finance Page (`admin/finances.html`):**
- New dedicated finance/expense tracking page
- Stats: Total Revenue, Total Expenses, Net Profit, This Month
- Tabs: All, Revenue, Expenses
- Revenue auto-populates from paid invoices (tasting, deposits)
- Manual revenue entry with optional client link
- Search bar for filtering expenses

**Expense Entry with OCR:**
- Receipt photo upload (drag & drop supported)
- **Tesseract.js OCR** scans receipts for:
  - Vendor (17+ known stores: Amazon, Costco, Safeway, etc.)
  - Amount (including tax calculation)
  - Date (multiple formats supported)
  - Category (guessed from item keywords)
- Shows scan results: ✓ detected / ✗ not detected
- Smart amount detection:
  - Finds "Total before tax" + "Tax" and adds them
  - Ignores gift card reductions (takes actual expense)
  - Sanity check: tax must be < 15% of subtotal

**Expense Categories (dropdown):**
- Ingredients & Supplies
- Equipment & Tools
- Packaging & Presentation
- Marketing & Advertising
- Office & Admin

**Category Auto-Detection:**
- Scans OCR text for item keywords to guess category:
  - "flour", "sugar", "fondant" → Ingredients & Supplies
  - "mixer", "spatula", "pan" → Equipment & Tools
  - "box", "ribbon", "board" → Packaging & Presentation
  - "printer", "computer" → Office & Admin
  - "business card", "flyer" → Marketing & Advertising
- Falls back to vendor-based guess if no keywords found

**Expense Allocation:**
- Split expenses between projects or General Overhead
- Percentage allocation (must total 100%)
- Links to active clients (booked, signed, proposal, tasting status)

**Receipt Viewer Popup:**
- Floating, draggable window (not fullscreen overlay)
- Resize from corners
- Zoom controls: +/− buttons, mouse wheel zoom
- Zoom level display (100%, 125%, etc.)
- Click and drag to pan when zoomed
- Bounds checking (can't drag off-screen)

**Data Storage:**
- `kgc_revenue` — Revenue records (manual + auto from invoices)
- `kgc_expenses` — Expense records with receipt images, allocations, categories

---

**Deposit Payment Flow (completed from Session 16):**
- Deposit invoice now properly updates client status to "booked"
- Fixed client ID lookup (fallback to name match)
- Fixed deposit link URL (absolute path for popup window)
- Portal accounting shows "Paid" status correctly

**Event Portal Updates:**
- Added "Proposal" button in header
- Added "Dashboard" button in proposal builder
- Fixed date formatting for ISO strings
- Shows "Due by [date]" for unpaid final payment (2 weeks before event)

**Proposal Builder Updates:**
- Moved Terms & Conditions BEFORE signature section
- Fixed client data population in popup/deposit flow

---

## Mobile Receipt Upload - Implementation Plan

**Goal:** Kenna takes receipt photo on phone → expense saved to platform

**Current Limitation:** localStorage is device-specific (phone data ≠ desktop data)

**Phase 1: Mobile UI Testing (No Backend)**
- Make Finance page mobile-responsive
- Deploy client-portal to Netlify
- Kenna tests on phone: camera → OCR → expense entry flow
- Data stays on phone only (localStorage)
- Purpose: Test and refine the mobile UX before building backend

**Phase 2: Backend for Sync (Production)**
- Add Railway backend with PostgreSQL database
- Receipt images stored in cloud (Railway or S3/R2)
- Phone and desktop share same data
- This is when it goes live with real clients

**Infrastructure (from Jan 31 decision):**
| Service | Purpose | Cost |
|---------|---------|------|
| Railway | Backend, database, API | ~$5-15/mo |
| Cloudflare | DNS, domains, email routing | Free |
| Netlify | Static site + client portal | Free |
| Stripe | Payments | Transaction fees |

**Note:** Cloudflare D1 could work for beta testing but Railway/PostgreSQL is better for production with real client data.

**Optional Later: Email-to-Upload**
- receipts@kennagiuziocake.com → auto-creates expense draft
- "Snap and send" workflow
- Requires backend (Phase 2) to process incoming emails

---

**Session 18 (Feb 1, 2026) - Calendar Import/Export & Tasting Scheduler:**

**Calendar Personal Calendar Import:**
- Import external calendars (Google, Outlook) via .ICS file upload
- Multiple calendars supported with individual toggles
- Calendar names extracted from ICS (X-WR-CALNAME) or filename
- Click calendar name to rename it
- Delete individual calendars (X button)
- Personal events display in light grey (distinct from business events)
- Timezone handling: UTC times (Z suffix) properly converted to local time

**Calendar Export:**
- Export button opens modal with options:
  - Download .ICS file
  - Add to Google Calendar
  - Add to Outlook
- Exports only Kenna Cake business events (excludes imported personal calendars)
- ICS includes X-WR-CALNAME: "Kenna Giuzio Cake"

**Tasting Scheduler Calendar Popup:**
- Large resizable calendar popup (700px)
- Shows events inside calendar cells (real calendar view)
- Click event to see details popup
- Click empty cell to select date
- Draggable popup (grab header to move)
- Resizable (drag corner)
- Reads from imported calendars (import done via Calendar module only)

**Calendar UI Improvements:**
- Today's date highlighted with gold border + cream background + gold circle on number
- Navigation: circular arrow buttons + pill-shaped "Today" button
- Import/Export buttons moved to sidebar under Settings
- Removed old export section from main content

**Known Limitation - URL Calendar Sync:**
- Pasting Google/Outlook calendar URLs blocked by CORS
- File import (.ICS) works perfectly
- URL sync requires Railway backend proxy (future)

**Data Storage:**
- `kgc_imported_calendars` — Array of calendar objects with id, name, enabled, events
- Old `kgc_personal_calendar` format deprecated

---

## Upcoming Work

**When Railway Backend is Up:**
- URL-based calendar sync (proxy to avoid CORS)
- Real-time calendar subscription updates

**Next Session Options:**
- Mobile-responsive finance page (PWA)
- Stripe integration for payments
- Final invoice system (remaining 50% balance)
- Payment confirmation emails
- Invoice reminder system

**Workshops Feature (Planned):**
- Workshop event creation
- Workshop-specific invoicing
- Public workshop calendar/sign-up page

---

**Session 19 (Feb 3, 2026) - Proposal Preview & Payment Flow Polish:**

**Sketch Upload Improvements:**
- Single sketch per option (upload box hides after uploading)
- Sketch displays larger and centered when uploaded
- Upload box reappears if sketch is deleted

**Cake Option Selection:**
- Added "Select [Option Name]" buttons below each design
- Radio-style selection (button fills gold when selected)
- Removed redundant radio circles (whole button indicates selection)
- Clicking updates the proposal estimate totals

**Lightbox Watermark Protection:**
- Copyright watermark: "© Kenna Giuzio Cake. All Rights Reserved."
- Small, subtle, legal-style text (Arial, bottom-right corner)
- Option title displayed at top (e.g., "Option 2") in elegant Cormorant Garamond
- Watermark baked into downloaded images

**Preview Proposal Improvements:**
- Opens in separate popup window (750x900) instead of tab
- Fixed signing error (null checks for elements that don't exist in popup)
- Deposit link opens in new tab (target="_blank")

**Payment Flow Polish:**
- "Pay Deposit to Reserve Date" → "View Paid Invoice" after payment
- Message changes to "Your deposit has been received:"
- Green "DEPOSIT PAID - DATE RESERVED" banner when booked
- All proposal form inputs locked after deposit paid
- Payment complete screen hides redundant terms/totals sections

**Proposal Number Assignment:**
- Proposal number (#P-XXXX) assigned when Proposal button clicked from In Studio
- 4-digit sequential numbers starting at 0750 (looks established)
- Saved to proposal draft in localStorage
- Displayed in Client Information panel header + preview panel
- Used in deposit invoice (reads from draft, not generated from client ID)
- Each client gets one permanent proposal number

**Deposit Invoice Updates:**
- Added client address under name in Bill To section
- Fixed "Invalid Date" issue (robust date formatting)
- Combined "Payment Summary" and "From Your Proposal" into one section
- Proposal number reads from draft data (consistent with builder)
- Hides terms and totals sections after payment complete

**Contacts Page:**
- Default view changed to "In Studio" (was "All Contacts")
- In Studio tab active by default on page load

**Test Data Buttons:**
- Individual test buttons for each add-on type (Cutting, Cloche, Other, Delivery, Travel)
- Loads realistic sample data for testing

**Data Storage:**
- Client status 'booked' indicates deposit paid
- `portalData.depositPaid` and `depositPaidDate` track payment

**Settings Page - Data Management:**
- Clear All Data now also removes: `kgc_expenses`, `kgc_revenue`, `kgc_invoices`
- Load Sample Data adds 3 inquiries + 25 sample contacts
- Contacts have realistic Seattle-area data, some with vendor roles, Instagram, LinkedIn
- Removed auto-generating test invoices from Finances page

---

**Beta Target:** Aiming for beta (Kenna uses with real client) soon - checking in after each session to assess progress.

**Remaining for Beta:**
- Full end-to-end flow testing
- Fix any bugs found during testing
- Small UI polish items

**Post-Beta (can wait):**
- Backend (Railway) for multi-device sync
- Stripe integration for real payments
- Email notifications
- Mobile app

---

---

**Session 20 (Feb 4, 2026) - Client Portal Intro Experience & Communications:**

**Welcome/Intro Page (`client-portal/welcome.html`):**
- Magical first-touch experience for clients entering the portal
- **Tasting Intro (type=tasting):**
  - Full-screen "Fabric in Motion" video loops in background
  - Kenna Giuzio Cake logo fades in at 5 seconds
  - "Enter Your Vision" button appears at 8 seconds (Cormorant Garamond, gold, transparent)
  - Button: transparent with gold border, hover fills slightly
  - Video always plays (clients share link with family/friends)
- **Return Visit Intro (type=return):**
  - Beautiful cake photo (IMG_1276) instead of video
  - Faster timing: logo at 2s, button at 3.5s
  - Button text: "Welcome Back"
  - Goes to client portal view (mode=client, hides admin sections)
- **Graceful Transitions:**
  - Video/photo fades out smoothly (2.5s) when button clicked
  - Destination page starts with black screen
  - Black fades away revealing page content (3s)
  - Warm cream background (#faf8f5) on destination pages

**Communications Page (`admin/communications.html`):**
- Central inbox-style view for all logged communications
- Filters: All, Emails, Texts, Calls
- Search by client name
- Click communication to view details or jump to client portal
- "+ New Message" compose modal:
  - Type: Email, Log Text, Log Call, Note
  - Client dropdown with filter search (In Studio clients only)
  - Shows client email when selected
  - Email opens mailto: with pre-filled content
  - All communications auto-logged to localStorage
- Added to sidebar navigation on all admin pages

**Tasting Invoice Email Flow:**
- "Send Invoice" button in Tasting Scheduler now:
  - Creates mailto: link with beautiful pre-written email
  - Email includes magic welcome link (with video intro)
  - Auto-logs to Communications
  - Gmail opens with everything pre-filled, Kenna just hits send
- Email template includes:
  - Warm personalized greeting
  - Tasting date/time confirmation
  - Magic link to `welcome.html?dest=tasting&clientId=xxx`
  - Professional signature

**Client Portal View Updates:**
- Added fade-in transition (matches tasting invoice)
- `mode=client` URL param hides admin-only sections
- Return visits via welcome page go directly to portal view
- Background updated to warm cream (#faf8f5)

**Video Files:**
- Copied `01 KG_fabric-in_motion.mp4` → `client-portal/videos/intro-fabric.mp4`
- Copied `07 KG_floral_butterfly_rotation.mp4` → `client-portal/videos/intro-butterfly.mp4` (backup)
- Copied `IMG_1276.JPEG` → `client-portal/images/return-intro.jpg`

**Data Storage:**
- `kgc_communications` — Logged emails, texts, calls, notes with timestamps

**Client Search Fix (continued):**
- Redesigned client dropdown in Communications compose modal
- Changed from separate dropdown + filter input to unified searchable dropdown
- Type client name → matching results appear in dropdown list below input
- Click result to select → fills input with name, shows email below
- Click outside dropdown → closes dropdown
- Much more intuitive UX (type "sarah" → see Sarah in results → click to select)

---

**Session 21 (Feb 4, 2026) - Sugar Project & Intro Experience Polish:**

**Project Code Name: "Sugar"**
- Internal code name for the client portal project
- Used in conversations ("Let's work on Sugar")
- Not client-facing, keeps Kenna Giuzio Cake branding

**Railway Backend (attempted - Railway outage):**
- Created full backend structure in `client-portal/backend/`:
  - `index.js` - Express.js API with all endpoints (clients, communications, invoices, proposals, events, expenses, revenue)
  - `schema.sql` - PostgreSQL schema with all tables, indexes, auto-generated invoice/proposal numbers
  - `package.json` - Dependencies (express, pg, cors, helmet, dotenv)
  - `railway.json` - Railway deployment config
  - `.env.example` - Environment variable template
  - `README.md` - Deployment instructions
- Railway was experiencing partial outage during setup
- **Next session:** Complete Railway deployment when service restored

**Tasting Intro Experience Enhanced (`welcome.html`):**
- **Waterfall reveal effect:**
  - Logo fades in at 3 seconds
  - Button fades in at 4.5 seconds (1.5s after logo)
  - Both have elegant 1.5s fade animations
- **Video timing & black screen:**
  - Video plays for 10 seconds
  - Logo transitions to white at 9 seconds (1 second before fade)
  - Button transitions to white shortly after logo (0.4s delay)
  - Video fades to black over 1.5 seconds (video keeps playing during fade)
  - 5 second hold on black screen
  - Smooth loop back (no flash) - video restarts behind black, then fades in
- **Button styling:**
  - Semi-transparent sage green fill (`rgba(107, 125, 100, 0.25)`)
  - No border/outline
  - Dark forest green text (`#1a2418`)
  - Transitions to semi-transparent white on black screen
  - Text changed from "Enter Your Vision" to just "Enter"

**Proposal Intro Experience (`welcome-proposal.html`):**
- New separate intro page for proposal viewing
- Uses vintage ornamental video (`intro-vintage.mp4`)
- **Logo and button are white throughout** (better contrast with dark cake video)
- Button text: "View Proposal"
- Same waterfall effect and timing as tasting intro
- Same fade to black / loop behavior
- Goes to `/proposals/proposal-builder.html` when clicked

**Video Files Added:**
- Copied `08 KG_vintage_ornamental-form.mp4` → `client-portal/videos/intro-vintage.mp4`

**Demo URLs:**
- Tasting intro: `http://localhost:8080/welcome.html?type=tasting&clientId=1`
- Proposal intro: `http://localhost:8080/welcome-proposal.html?clientId=1`
- Return visit: `http://localhost:8080/welcome.html?type=return&clientId=1`

---

## Sugar Backend (Railway) ✅ DEPLOYED

**Status:** Live and running

**API URL:** https://sugar-backend-production.up.railway.app/

**Endpoints:**
- `GET /` — Health check
- `GET /health` — Status with timestamp
- `GET /api/clients` — List all clients
- `POST /api/clients` — Create client
- `GET /api/communications` — List communications
- `GET /api/invoices` — List invoices
- `GET /api/proposals` — List proposals
- `GET /api/events` — Calendar events
- `GET /api/expenses` — Expenses
- `GET /api/revenue` — Revenue

**Database:** PostgreSQL (Railway-managed)

**Development Approach:**
- Frontend stays on localStorage during development (faster iteration)
- Claude updates backend database in parallel to keep data in sync
- When ready for production: swap localStorage calls to API calls

**Future Integrations:**
- Twilio integration for texting
- Gmail API for email sync
- Multi-device data sync

---

**Session 22 (Feb 4, 2026) - Website V4 Deployed:**

**Mobile Auto-Scroll:**
- Added auto-scroll to mobile homepage (matches desktop behavior)
- After hero logo fades, page smoothly scrolls to show "Edible Art for Life's Moments" intro
- 3 second delay on mobile (vs 3.5s desktop), 3 second scroll duration
- User can cancel by touching/scrolling the screen

**V4 Deployment:**
- Removed V4 banner from all pages (index, gallery, about, contact)
- Deployed to Netlify as live site
- Live at: https://kennagiuziocake.com

**Folder Structure:**
- `site-v4-deployed-feb04/` — Currently live version
- `site-v5/` — Ready for future changes
- `site-v4/` — Old folder, locked by process (TODO: delete after restart)

---

---

**Session 23 (Feb 4, 2026) - Sugar Backend Deployed & Dashboard Removed:**

**Railway Backend Live:**
- API URL: https://sugar-backend-production.up.railway.app/
- PostgreSQL database connected and working
- All endpoints operational (clients, communications, invoices, proposals, events, expenses, revenue)
- Test data confirmed: 2 clients already in database

**Backend Files (client-portal/backend/):**
- `index.js` — Express.js API with all endpoints
- `schema.sql` — PostgreSQL schema
- `package.json` — Dependencies
- `railway.json` — Deployment config
- `README.md` — API documentation

**Dashboard Removed:**
- Deleted old dashboard page (index.html)
- In Studio is now the default landing page at `/admin/`
- Kept `mobile-dashboard-test.html` for future mobile app reference

**Gmail API Integration:**
- Created Google Cloud project "Sugar Portal"
- Enabled Gmail API
- Set up OAuth consent screen (External, test user: kgiuzio@gmail.com)
- Created OAuth credentials (Web application)
- Added environment variables to Railway:
  - GOOGLE_CLIENT_ID
  - GOOGLE_CLIENT_SECRET
  - KENNA_EMAIL
- Updated backend with Gmail sync endpoints
- Created settings table in database for storing tokens
- Tested OAuth flow - working (blocks non-test users as expected)
- **Send Email Feature Added:**
  - POST /api/gmail/send sends email through Kenna's Gmail
  - Auto-logs to communications with client_id
  - Full loop tested: Kenna sent email to Jeff, Jeff replied, reply auto-synced

**Development Approach:**
- Frontend continues using localStorage during build (faster iteration)
- Claude updates backend in parallel to keep data ready
- Production cutover: swap to API when ready for real clients

**Gmail Integration (Session 23):**
- Gmail API enabled in Google Cloud Console (project: Sugar Portal)
- OAuth credentials stored in Railway environment variables
- Test user: kgiuzio@gmail.com (Kenna)
- Endpoints:
  - `GET /auth/google` — Start OAuth flow
  - `GET /api/gmail/status` — Check connection status
  - `POST /api/gmail/sync` — Sync emails, match to clients
  - `POST /api/gmail/send` — Send email through Kenna's Gmail
  - `POST /api/gmail/disconnect` — Remove connection
- How it works:
  1. Kenna clicks "Connect Gmail" in Settings
  2. Logs in with her Gmail, approves app
  3. Emails sync and match to clients by email address
  4. Inbound replies auto-log to Event Portal communications
  5. Outgoing emails sent through Sugar are auto-logged
- **Tested & Working:** Full email loop verified (send → receive reply → auto-sync)

---

**Session 24 (Feb 4-5, 2026) - Communications & Email Thread View:**

**Server Issue Fixed:**
- `npx serve` was stripping URL query parameters (301 redirects)
- Switched to Python `http.server` for local development
- Event portal links now work correctly with `?id=` parameter

**Communications Page Improvements:**
- Now loads from API instead of localStorage
- Fixed scrambled layout (HTML escaping for email content)
- Updated icons to elegant style: ✉ (email), 🗨 (text), ☏ (call)
- Icon color changed to gold (#b5956a), removed circle backgrounds
- Added **bold** "To:" and "Reply:" direction indicators
- Added client names to entries (e.g., "To: Jeff Giuzio")

**Email Thread Modal (both pages):**
- Click any email to open elegant modal showing conversation thread
- Filters to same subject line only (e.g., "Test" and "Re: Test")
- **From: Kenna** (gold border) for outbound emails
- **From: [Client Name]** (green border) for inbound emails
- Subject line shown in each email bubble
- **Newest on top** - scroll down for older history
- Strips Gmail quoted replies and signatures for clean display
- Scroll contained within modal (doesn't bleed to background)

**Reply Feature:**
- Reply button on both Communications page and Event Portal
- Nice modal with To, Subject, Message fields
- Shows original message for reference
- Sends via Gmail API, auto-logs to communications
- No confirmation popup after send (just closes modal)

**Local Development:**
- Use Python server: `cd client-portal && python -m http.server 8000`
- Preview URL: http://localhost:8000/admin/in-studio.html
- Note: npx serve causes URL issues, avoid for this project

---

**Session 25 (Feb 5, 2026) - Frontend Deployed & API-First Migration:**

**Sugar Frontend Deployed to Netlify:**
- **Live URL:** https://portal.kennagiuziocake.com
- Custom subdomain via Cloudflare CNAME record
- SSL certificate auto-provisioned
- Added `netlify.toml` with `/admin` → `/admin/in-studio.html` redirect

**Favicon Added:**
- Kenna's logo now shows in browser tab
- Added `<link rel="icon" type="image/png" href="/favicon.png">` to all HTML files

**API-First Migration Complete:**
- **Core client data now on API** — syncs across all devices
- In-memory cache for fast synchronous reads
- `loadAllDataFromAPI()` fetches all data on page load
- New inquiries save directly to PostgreSQL (tested & verified)

**What's on API (syncs across devices):**
- ✅ Clients (inquiries, status, dates, contact info)
- ✅ Portal data (notes, files, team members)
- ✅ Proposals and signatures
- ✅ Communications (via Gmail API)
- ✅ Proposal drafts (migrated Feb 5, 2026)
- ✅ Custom calendar events (migrated Feb 5, 2026)
- ✅ Imported personal calendars (migrated Feb 5, 2026)
- ✅ Brand palette settings (migrated Feb 5, 2026)

**localStorage usage:** Frontend still maintains localStorage as a cache for synchronous reads and offline fallback. API is the source of truth.

**Architecture:**
```
Browser (portal.kennagiuziocake.com)
    ↓ API calls
Railway Backend (sugar-backend-production.up.railway.app)
    ↓
PostgreSQL Database
```

---

---

**Session 26 (Feb 5, 2026) - Full localStorage Migration to API:**

**Backend Updates:**
- Added `imported_calendars` table to `schema.sql`
- Added index on `imported_calendars(enabled)`
- New API endpoints in `index.js`:
  - `GET/POST/PUT/DELETE /api/imported-calendars` — Imported calendar CRUD
  - `GET/PUT/DELETE /api/settings/:key` — Generic key-value settings store

**api.js Updates:**
- Added imported calendars functions: `getImportedCalendars()`, `saveImportedCalendar()`, `deleteImportedCalendar()`
- Added generic settings functions: `getSetting()`, `saveSetting()`
- Added brand palette helpers: `getBrandPalette()`, `saveBrandPalette()`
- Added calendar events functions: `getCalendarEvents()`, `saveCalendarEvent()`, `deleteCalendarEvent()`
- Added proposal drafts functions: `getProposalDrafts()`, `getProposalDraft()`, `saveProposalDraft()`
- All functions use API with localStorage fallback for offline support

**Frontend Files Updated:**
- `brand-colors.html` — Brand palette + inspirations now sync to API
- `calendar.html` — Custom events + imported calendars now sync to API
- `settings.html` — Imported calendars management syncs to API
- `in-studio.html` — Proposal drafts + brand palette sync to API
- `index.html` — Proposal drafts + brand palette sync to API
- `contacts.html` — Proposal draft creation syncs to API

**Migration Pattern:**
1. Page loads immediately from localStorage (fast)
2. Background fetch from API updates localStorage
3. Saves go to both localStorage (immediate) and API (async)
4. Graceful fallback to localStorage if API unavailable

**Data now fully synced across devices:**
- Proposal drafts (kgc_proposal_drafts)
- Custom calendar events (kgc_calendar_events)
- Imported calendars (kgc_imported_calendars)
- Brand palette (kgc_brand_palette, kgc_brand_colors, kgc_active_palette)
- Inspirations (kgc_inspirations)

**To deploy:** `cd client-portal/backend && railway up`

---

**Session 27 (Feb 5, 2026) - Analytics Dashboard & SEO:**

**Looker Studio Dashboard Created:**
- Report name: "Kenna Giuzio Cake Analytics"
- Mobile-friendly size (400x800 canvas)
- Elements:
  - Date range picker (controls all charts)
  - Visitors scorecard (Total users)
  - Contact Views scorecard (filtered to /contact page)
  - Top Pages bar chart (using Page title dimension)
  - Traffic Sources pie chart
  - Kenna's logo
  - Traffic source key explaining confusing terms

**Traffic Source Cheat Sheet:**
- **(direct)** = Typed URL, bookmark, or email/text link
- **(not set)** = Unknown source (ignore)
- **l.instagram.com** = Instagram link click (stories, bio)
- **l.facebook.com** = Facebook link click
- **ig** = Instagram app
- **google/bing** = Search engines

**SEO Fix - Homepage Meta Description:**
- Added meta description to index.html:
  `"Kenna Giuzio Cake - Bespoke celebration cakes in Seattle. Custom wedding cakes, birthday cakes, and edible art for life's special moments."`
- Deployed to Netlify
- Should help homepage rank above About page in Google search

**Google Analytics Setup:**
- GA4 property: G-4E23LYKZE7
- Already tracking: kennagiuziocake.com
- Recommended: GA mobile app for quick phone checks
- Looker Studio link for detailed custom view

**Sugar Frontend Deployed:**
- Live at: https://portal.kennagiuziocake.com
- Full localStorage → API migration completed
- Backend deployed via GitHub (not CLI)

**Railway Deployment Note:**
Sugar backend deploys from **GitHub**, not CLI. When making backend changes:
1. Commit changes to git
2. Push to GitHub: `git push origin master`
3. Railway auto-deploys

Do NOT use `railway up` - project is configured for GitHub deployments.

---

**Session 28 (Feb 5, 2026) - Google Workspace Email Setup:**

**Business Email Activated:**
- **kenna@kennagiuziocake.com** - Primary business email
- **hello@kennagiuziocake.com** - Alias (goes to same inbox)
- Platform: Google Workspace Business Starter (~$7/month)
- Can send AND receive as business email

**DNS Changes in Cloudflare:**
- Disabled Cloudflare Email Routing (was forwarding hello@ to Gmail)
- Added Google MX record: `smtp.google.com` (priority 1)
- Added DKIM TXT record: `google._domainkey` → (long key)
- Added CNAME for verification: `fsdwcrwiydhc` → `gv-ejb5hhywocbt5b.dv.googlehosted.com`

**Email Setup Summary:**
| Email | Purpose |
|-------|---------|
| kenna@kennagiuziocake.com | Primary - client conversations |
| hello@kennagiuziocake.com | Public - on website, inquiry form |

**To access email:**
- Go to mail.google.com
- Sign in with kenna@kennagiuziocake.com

**Admin console:** admin.google.com (manage aliases, users, settings)

**Note:** 14-day trial of Business Plus started - need to downgrade to Business Starter before trial ends to avoid $20/month charge.

---

**Session 29 (Feb 5, 2026) - Website Inquiry Form → Sugar Integration:**

**Replaced Formspree with direct Sugar API integration:**
- Website inquiry form now POSTs to `https://sugar-backend-production.up.railway.app/api/inquiries`
- Formspree bypassed (account still exists, just dormant)

**What happens when someone submits inquiry:**
1. Client created in Sugar portal (status: 'inquiry', source: 'website')
2. Notification email sent to kenna@kennagiuziocake.com with:
   - Client name & email
   - Event date, guest count, venue
   - Their vision/message
   - Direct link to view in Sugar portal
3. Client appears instantly in "In Studio" - no manual entry needed

**Files changed:**
- `client-portal/backend/index.js` - Added `POST /api/inquiries` endpoint
- `website/site-v4-deployed-feb04/contact.html` - Form submits to Sugar API

**Direct contact email updated:**
- Changed from hello@kennagiuziocake.com to kenna@kennagiuziocake.com on inquiry page

**Railway environment variable:**
- `KENNA_EMAIL` must be set to `kenna@kennagiuziocake.com` for notifications to go to business email

---

**Session 30 (Feb 5, 2026) - Twilio Integration (Dormant) & Manual Text Logging:**

**Twilio SMS + Voicemail Built (not yet activated):**
- Full integration coded and deployed to backend
- Will activate when environment variables are added to Railway
- Kenna decided to hold off - worried about confusion between personal texts and business texts

**Backend endpoints added (dormant until configured):**
- `POST /api/sms/send` - Send SMS from Sugar
- `POST /api/sms/webhook` - Receive incoming texts (Twilio webhook)
- `POST /api/voice/webhook` - Voicemail greeting
- `POST /api/voice/voicemail` - Handle voicemail recordings
- `GET /api/twilio/status` - Check if Twilio is configured

**Features when activated:**
- Send texts from Sugar portal
- Receive texts → auto-log to client + email notification to Kenna
- Voicemail with custom greeting → recording emailed to Kenna
- Auto-transcription of voicemails
- Auto-match incoming messages to clients by phone number

**To activate later (Railway environment variables):**
```
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NUMBER=+12065551234
```

**Twilio webhook URLs (configure in Twilio Console):**
- SMS: `https://sugar-backend-production.up.railway.app/api/sms/webhook`
- Voice: `https://sugar-backend-production.up.railway.app/api/voice/webhook`

**For now:** Kenna manually logs important texts via Communications page → "+ New Message" → "Log Text"

---

**Session 31 (Feb 5, 2026) - Stripe Payment Integration:**

**Stripe Account Created:**
- Account: Kenna Giuzio Cake (sandbox/test mode)
- Using Jeff's Google account for management

**Backend Endpoints Added:**
- `GET /api/stripe/status` - Check if Stripe is configured
- `POST /api/payments/create-checkout` - Create Stripe Checkout session
- `POST /api/payments/webhook` - Handle payment completion (updates invoice, client status, records revenue, emails Kenna)
- `GET /api/payments/session/:id` - Get session details for success page

**Frontend Pages Created/Updated:**
- `invoices/payment-success.html` - Success page after payment
- `invoices/payment-cancelled.html` - Cancelled payment page
- `invoices/tasting-invoice.html` - Updated with Stripe checkout
- `invoices/deposit-invoice.html` - Updated with Stripe checkout

**Railway Environment Variables:**
```
STRIPE_SECRET_KEY=sk_test_... (API secret key)
STRIPE_PUBLISHABLE_KEY=pk_test_... (API publishable key)
STRIPE_WEBHOOK_SECRET=whsec_... (webhook signing secret)
```

**Stripe Webhook Configured:**
- URL: `https://sugar-backend-production.up.railway.app/api/payments/webhook`
- Event: `checkout.session.completed`

**Status:** ✅ Fully working (test mode). Tested Feb 5, 2026.

**To go live (when ready):**
1. Stripe Dashboard → "Switch to live account"
2. Add business details, bank account, tax info (SSN/EIN)
3. Get live API keys (pk_live, sk_live)
4. Update Railway variables with live keys
5. Update webhook to live mode

---

**Session 32 (Feb 5-6, 2026) - Invoice Workflow Fix for Stripe:**

**Problem Identified:**
- Invoices were only saved to Kenna's localStorage
- When clients clicked invoice links on their phone, the invoice page tried to load from localStorage (empty on their device)
- This caused invoices to show placeholder data and payments couldn't be processed

**Backend Fixes (`client-portal/backend/index.js`):**
- Added `GET /api/invoices/:id` endpoint - fetches invoice by ID or invoice_number (TI-2026-XXXX)
- Updated `POST /api/invoices` to accept `invoice_number` parameter
- Deployed to Railway via GitHub push

**Frontend Fixes:**
- **tasting-invoice.html:**
  - Added `populateFromInvoice()` function to load from API or localStorage
  - Added `initializePage()` async function that tries API first, then localStorage, then URL params
  - Invoices now load correctly on any device
- **tasting-scheduler.html:**
  - Added `API_URL` constant
  - Now saves invoices to BOTH localStorage AND the API
  - Invoice data stored in `data` JSONB field with all tasting details

**Full Payment Flow (Now Working):**
1. Kenna creates tasting invoice in Sugar → saved to API + localStorage
2. Client receives welcome link via email
3. Client clicks link → welcome page → tasting invoice
4. Invoice fetches data from API (works on any device)
5. Client clicks "Pay with Card" → Stripe Checkout
6. After payment → webhook updates invoice status

**Deployed:**
- Backend: Railway (auto-deployed from GitHub)
- Frontend: Cloudflare Pages (migrated from Netlify Feb 6, 2026)

**Test Invoice Created:**
- `TI-2026-TEST` in database (can be used for testing)

---

**Session 32 continued (Feb 6, 2026) - Netlify → Cloudflare Pages Migration:**

**Why we migrated:**
- Netlify free tier hit bandwidth limits (503 errors)
- Both kennagiuziocake.com and portal.kennagiuziocake.com went down
- Cloudflare Pages has **unlimited bandwidth** on free tier

**Migration steps:**
1. Installed Cloudflare Wrangler CLI
2. Logged into Cloudflare via `wrangler login`
3. Created two Cloudflare Pages projects:
   - `kenna-giuzio-cake` → main website
   - `sugar-portal` → client portal
4. Deployed both sites via `wrangler pages deploy`
5. Added custom domains in Cloudflare dashboard
6. Cloudflare auto-updated DNS (since domains already on Cloudflare)

**New hosting setup:**
| Site | Cloudflare Pages Project | Custom Domain |
|------|-------------------------|---------------|
| Main website | kenna-giuzio-cake | kennagiuziocake.com |
| Sugar portal | sugar-portal | portal.kennagiuziocake.com |

**Cloudflare Pages URLs (backup):**
- https://kenna-giuzio-cake.pages.dev
- https://sugar-portal.pages.dev

**Deploy commands:**
```bash
# Main website
cd website/site-v4-deployed-feb04
npx wrangler pages deploy . --project-name kenna-giuzio-cake

# Sugar portal
cd client-portal
npx wrangler pages deploy . --project-name sugar-portal
```

**Other fixes in this session:**
- Added Communications link to tasting-scheduler.html and tasting-invoice.html sidebars
- Updated all email addresses from hello@ to kenna@kennagiuziocake.com
- Added `_redirects` file to Sugar portal for root URL redirect

**TODO:**
- Add kennascakes.com to Cloudflare Pages custom domains

**Stripe Setup Complete (Feb 5, 2026):**
- Completed Stripe onboarding (bank account, 2FA)
- 2FA backup code saved to `credentials/stripe-backup-code.txt`
- Test payment successful with card 4242 4242 4242 4242
- Ready for live payments when Kenna switches to live mode

**Test card for sandbox:**
- Card: 4242 4242 4242 4242
- Expiry: Any future date
- CVC: Any 3 digits

---

---

**Session 33 (Feb 6, 2026) - Dark Mode & UI Polish:**

**Dark Mode Added to Sugar Portal:**
- Toggle button at bottom of sidebar on all admin pages
- Setting saved to `localStorage` under key `kgc_dark_mode`
- Syncs across all pages (In Studio, Calendar, Contacts, Communications, Templates, Finances, Settings, Archive, Media, Event Portal)
- CSS variables for theming:
  - `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-hover`
  - `--text-primary`, `--text-secondary`, `--text-muted`
  - `--border-color`, `--accent-gold`
  - `--modal-bg`, `--input-bg`, `--overlay`
- Logo inverts in dark mode (`filter: invert(0.85)`)

**IMPORTANT - When Making CSS Changes:**
- All color changes must use CSS variables (not hardcoded colors)
- Test in BOTH light mode AND dark mode
- If adding new UI elements, ensure they work with the variable system

**Toast Notifications:**
- Replaced browser `alert()` with elegant toast notifications
- Pages updated: Communications, Calendar
- Use `showToast(message, type, duration)` function
- Types: 'success', 'error', 'warning', 'info'

**Other Fixes:**
- Communications modal: drag to move, resize from corner, won't close when releasing mouse outside window
- "View Client" button fixed (was using wrong URL parameter)
- Smiley face icons (☺) for website inquiries in Communications

---

*Last updated: Feb 6, 2026 (Dark mode fully implemented)*
