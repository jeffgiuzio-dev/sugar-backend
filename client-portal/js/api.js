/**
 * Sugar API Client
 * Handles all API calls to the backend
 */

const API_BASE_URL = 'https://sugar-backend-production.up.railway.app';

// ============ CASE CONVERSION HELPERS ============

// Convert snake_case to camelCase
function snakeToCamel(str) {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Convert camelCase to snake_case
function camelToSnake(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

// Convert object keys from snake_case to camelCase
function toCamelCase(obj) {
    if (Array.isArray(obj)) {
        return obj.map(toCamelCase);
    }
    if (obj !== null && typeof obj === 'object') {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [
                snakeToCamel(key),
                toCamelCase(value)
            ])
        );
    }
    return obj;
}

// Convert object keys from camelCase to snake_case
function toSnakeCase(obj) {
    if (Array.isArray(obj)) {
        return obj.map(toSnakeCase);
    }
    if (obj !== null && typeof obj === 'object') {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [
                camelToSnake(key),
                toSnakeCase(value)
            ])
        );
    }
    return obj;
}

// Simple fetch wrapper with error handling
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;

    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const fetchOptions = { ...defaultOptions, ...options };

    try {
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

// ============ CLIENTS ============

async function apiGetClients() {
    return apiRequest('/api/clients');
}

async function apiGetClient(id) {
    return apiRequest(`/api/clients/${id}`);
}

async function apiCreateClient(client) {
    return apiRequest('/api/clients', {
        method: 'POST',
        body: JSON.stringify(client),
    });
}

async function apiUpdateClient(id, updates) {
    return apiRequest(`/api/clients/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
    });
}

async function apiDeleteClient(id) {
    return apiRequest(`/api/clients/${id}`, {
        method: 'DELETE',
    });
}

// ============ COMMUNICATIONS ============

async function apiGetCommunications(clientId = null) {
    const endpoint = clientId
        ? `/api/communications?client_id=${clientId}`
        : '/api/communications';
    return apiRequest(endpoint);
}

async function apiCreateCommunication(comm) {
    return apiRequest('/api/communications', {
        method: 'POST',
        body: JSON.stringify(comm),
    });
}

// ============ INVOICES ============

async function apiGetInvoices(clientId = null, status = null) {
    let endpoint = '/api/invoices';
    const params = [];
    if (clientId) params.push(`client_id=${clientId}`);
    if (status) params.push(`status=${status}`);
    if (params.length) endpoint += '?' + params.join('&');
    return apiRequest(endpoint);
}

async function apiCreateInvoice(invoice) {
    return apiRequest('/api/invoices', {
        method: 'POST',
        body: JSON.stringify(invoice),
    });
}

async function apiUpdateInvoice(id, updates) {
    return apiRequest(`/api/invoices/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
    });
}

// ============ PROPOSALS ============

async function apiGetProposals(clientId = null) {
    const endpoint = clientId
        ? `/api/proposals?client_id=${clientId}`
        : '/api/proposals';
    return apiRequest(endpoint);
}

async function apiCreateProposal(proposal) {
    return apiRequest('/api/proposals', {
        method: 'POST',
        body: JSON.stringify(proposal),
    });
}

async function apiUpdateProposal(id, updates) {
    return apiRequest(`/api/proposals/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
    });
}

// ============ CALENDAR EVENTS ============

async function apiGetEvents() {
    return apiRequest('/api/events');
}

async function apiCreateEvent(event) {
    return apiRequest('/api/events', {
        method: 'POST',
        body: JSON.stringify(event),
    });
}

async function apiDeleteEvent(id) {
    return apiRequest(`/api/events/${id}`, {
        method: 'DELETE',
    });
}

async function apiUpdateEvent(id, event) {
    return apiRequest(`/api/events/${id}`, {
        method: 'PUT',
        body: JSON.stringify(event),
    });
}

// ============ EXPENSES ============

async function apiGetExpenses() {
    return apiRequest('/api/expenses');
}

async function apiCreateExpense(expense) {
    return apiRequest('/api/expenses', {
        method: 'POST',
        body: JSON.stringify(expense),
    });
}

// ============ REVENUE ============

async function apiGetRevenue() {
    return apiRequest('/api/revenue');
}

async function apiCreateRevenue(revenue) {
    return apiRequest('/api/revenue', {
        method: 'POST',
        body: JSON.stringify(revenue),
    });
}

// ============ PORTAL DATA ============
// Portal data is stored in the portal_data table

async function apiGetPortalData(clientId) {
    try {
        const result = await apiRequest(`/api/portal/${clientId}`);
        return result;
    } catch (e) {
        // Return empty object if not found
        return {};
    }
}

async function apiUpdatePortalData(clientId, data) {
    return apiRequest(`/api/portal/${clientId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}

// ============ TEAM MEMBERS ============

async function apiGetTeamMembers(clientId) {
    return apiRequest(`/api/team/${clientId}`);
}

async function apiCreateTeamMember(member) {
    return apiRequest('/api/team', {
        method: 'POST',
        body: JSON.stringify(member),
    });
}

async function apiUpdateTeamMember(id, updates) {
    return apiRequest(`/api/team/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
    });
}

async function apiDeleteTeamMember(id) {
    return apiRequest(`/api/team/${id}`, {
        method: 'DELETE',
    });
}

// ============ FRONTEND-FRIENDLY WRAPPERS ============
// These functions match the localStorage interface the frontend expects
// They handle case conversion automatically

let _clientsCache = null;
let _clientsCacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds

// Get all clients (returns camelCase, caches for 5 seconds)
async function getClients() {
    const now = Date.now();
    if (_clientsCache && (now - _clientsCacheTime) < CACHE_TTL) {
        return _clientsCache;
    }
    try {
        const clients = await apiGetClients();
        _clientsCache = toCamelCase(clients);
        _clientsCacheTime = now;
        return _clientsCache;
    } catch (error) {
        console.error('API unavailable, falling back to localStorage');
        return JSON.parse(localStorage.getItem('kgc_clients') || '[]');
    }
}

// Save clients (accepts camelCase)
async function saveClients(clients) {
    // Invalidate cache
    _clientsCache = null;

    // For now, we save individual clients
    // This is called when updating a single client usually
    // The frontend should be updated to call saveClient(client) instead
    localStorage.setItem('kgc_clients', JSON.stringify(clients));
}

// Save a single client
async function saveClient(client) {
    _clientsCache = null;
    try {
        const snakeClient = toSnakeCase(client);
        if (client.id) {
            const result = await apiUpdateClient(client.id, snakeClient);
            return toCamelCase(result);
        } else {
            const result = await apiCreateClient(snakeClient);
            return toCamelCase(result);
        }
    } catch (error) {
        console.error('API unavailable, falling back to localStorage');
        // Fallback: save to localStorage
        const clients = JSON.parse(localStorage.getItem('kgc_clients') || '[]');
        if (client.id) {
            const idx = clients.findIndex(c => c.id === client.id);
            if (idx >= 0) clients[idx] = client;
        } else {
            client.id = Date.now();
            clients.unshift(client);
        }
        localStorage.setItem('kgc_clients', JSON.stringify(clients));
        return client;
    }
}

// Create a new client
async function createClient(clientData) {
    _clientsCache = null;
    try {
        const snakeClient = toSnakeCase(clientData);
        const result = await apiCreateClient(snakeClient);
        return toCamelCase(result);
    } catch (error) {
        console.error('API unavailable, falling back to localStorage');
        const clients = JSON.parse(localStorage.getItem('kgc_clients') || '[]');
        const newClient = {
            id: Date.now(),
            createdAt: new Date().toISOString(),
            ...clientData
        };
        clients.unshift(newClient);
        localStorage.setItem('kgc_clients', JSON.stringify(clients));
        return newClient;
    }
}

// Get portal data for a client
async function getPortalData(clientId) {
    try {
        const data = await apiGetPortalData(clientId);
        return toCamelCase(data);
    } catch (error) {
        return JSON.parse(localStorage.getItem('kgc_portal_' + clientId) || '{}');
    }
}

// Save portal data for a client
async function savePortalData(clientId, data) {
    try {
        const snakeData = toSnakeCase(data);
        return await apiUpdatePortalData(clientId, snakeData);
    } catch (error) {
        localStorage.setItem('kgc_portal_' + clientId, JSON.stringify(data));
        return data;
    }
}

// Get proposals for a client
async function getProposals(clientId = null) {
    try {
        const proposals = await apiGetProposals(clientId);
        return toCamelCase(proposals);
    } catch (error) {
        const drafts = JSON.parse(localStorage.getItem('kgc_proposal_drafts') || '{}');
        if (clientId) {
            return drafts[clientId] ? [drafts[clientId]] : [];
        }
        return Object.values(drafts);
    }
}

// Check if proposal is signed
async function isProposalSigned(clientId) {
    try {
        const proposals = await apiGetProposals(clientId);
        return proposals.some(p => p.signed_at !== null);
    } catch (error) {
        const signatures = JSON.parse(localStorage.getItem('kgc_signatures') || '{}');
        return signatures[clientId] || signatures[String(clientId)];
    }
}

// Check if proposal draft exists
async function hasProposalDraft(clientId) {
    try {
        const proposals = await apiGetProposals(clientId);
        return proposals.length > 0;
    } catch (error) {
        const drafts = JSON.parse(localStorage.getItem('kgc_proposal_drafts') || '{}');
        return drafts[clientId] || drafts[String(clientId)];
    }
}

// Get tasting draft (for backwards compatibility)
function getTastingDraft(clientId) {
    const drafts = JSON.parse(localStorage.getItem('kgc_tasting_drafts') || '{}');
    return drafts[clientId] || drafts[String(clientId)];
}

// ============ IMPORTED CALENDARS ============

let _importedCalendarsCache = null;
let _importedCalendarsCacheTime = 0;

async function apiGetImportedCalendars() {
    return apiRequest('/api/imported-calendars');
}

async function apiCreateImportedCalendar(calendar) {
    return apiRequest('/api/imported-calendars', {
        method: 'POST',
        body: JSON.stringify(calendar),
    });
}

async function apiUpdateImportedCalendar(id, updates) {
    return apiRequest(`/api/imported-calendars/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
    });
}

async function apiDeleteImportedCalendar(id) {
    return apiRequest(`/api/imported-calendars/${id}`, {
        method: 'DELETE',
    });
}

// Get all imported calendars (with caching)
async function getImportedCalendars() {
    const now = Date.now();
    if (_importedCalendarsCache && (now - _importedCalendarsCacheTime) < CACHE_TTL) {
        return _importedCalendarsCache;
    }
    try {
        const calendars = await apiGetImportedCalendars();
        _importedCalendarsCache = toCamelCase(calendars);
        _importedCalendarsCacheTime = now;
        // Also update localStorage for offline/sync access
        localStorage.setItem('kgc_imported_calendars', JSON.stringify(_importedCalendarsCache));
        return _importedCalendarsCache;
    } catch (error) {
        console.error('API unavailable for imported calendars, falling back to localStorage');
        return JSON.parse(localStorage.getItem('kgc_imported_calendars') || '[]');
    }
}

// Save a single imported calendar
async function saveImportedCalendar(calendar) {
    _importedCalendarsCache = null;
    try {
        const snakeCalendar = toSnakeCase(calendar);
        let result;
        if (calendar.id) {
            result = await apiUpdateImportedCalendar(calendar.id, snakeCalendar);
        } else {
            result = await apiCreateImportedCalendar(snakeCalendar);
        }
        return toCamelCase(result);
    } catch (error) {
        console.error('API unavailable, saving imported calendar to localStorage');
        const calendars = JSON.parse(localStorage.getItem('kgc_imported_calendars') || '[]');
        if (calendar.id) {
            const idx = calendars.findIndex(c => c.id === calendar.id);
            if (idx >= 0) calendars[idx] = calendar;
        } else {
            calendar.id = Date.now();
            calendars.push(calendar);
        }
        localStorage.setItem('kgc_imported_calendars', JSON.stringify(calendars));
        return calendar;
    }
}

// Delete an imported calendar
async function deleteImportedCalendar(id) {
    _importedCalendarsCache = null;
    try {
        await apiDeleteImportedCalendar(id);
        return true;
    } catch (error) {
        console.error('API unavailable, deleting imported calendar from localStorage');
        const calendars = JSON.parse(localStorage.getItem('kgc_imported_calendars') || '[]');
        const filtered = calendars.filter(c => c.id !== id);
        localStorage.setItem('kgc_imported_calendars', JSON.stringify(filtered));
        return true;
    }
}

// ============ SETTINGS (Generic key-value) ============

async function apiGetSetting(key) {
    return apiRequest(`/api/settings/${key}`);
}

async function apiSaveSetting(key, value) {
    return apiRequest(`/api/settings/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
    });
}

async function apiDeleteSetting(key) {
    return apiRequest(`/api/settings/${key}`, {
        method: 'DELETE',
    });
}

// Get a setting by key
async function getSetting(key) {
    try {
        const result = await apiGetSetting(key);
        // Also cache in localStorage
        if (result.value !== null) {
            localStorage.setItem(`kgc_${key}`, JSON.stringify(result.value));
        }
        return result.value;
    } catch (error) {
        console.error(`API unavailable for setting ${key}, falling back to localStorage`);
        const stored = localStorage.getItem(`kgc_${key}`);
        return stored ? JSON.parse(stored) : null;
    }
}

// Save a setting by key
async function saveSetting(key, value) {
    try {
        const result = await apiSaveSetting(key, value);
        // Also update localStorage
        localStorage.setItem(`kgc_${key}`, JSON.stringify(value));
        return result.value;
    } catch (error) {
        console.error(`API unavailable, saving setting ${key} to localStorage`);
        localStorage.setItem(`kgc_${key}`, JSON.stringify(value));
        return value;
    }
}

// ============ BRAND PALETTE ============

// Get the active brand palette
async function getBrandPalette() {
    return getSetting('brand_palette');
}

// Save the active brand palette
async function saveBrandPalette(palette) {
    return saveSetting('brand_palette', palette);
}

// Get the working/editing brand colors
async function getBrandColors() {
    return getSetting('brand_colors');
}

// Save the working/editing brand colors
async function saveBrandColors(colors) {
    return saveSetting('brand_colors', colors);
}

// ============ CALENDAR EVENTS (Custom events) ============

let _calendarEventsCache = null;
let _calendarEventsCacheTime = 0;

// Get all custom calendar events
async function getCalendarEvents() {
    const now = Date.now();
    if (_calendarEventsCache && (now - _calendarEventsCacheTime) < CACHE_TTL) {
        return _calendarEventsCache;
    }
    try {
        const events = await apiGetEvents();
        _calendarEventsCache = toCamelCase(events);
        _calendarEventsCacheTime = now;
        // Also update localStorage for offline access
        localStorage.setItem('kgc_calendar_events', JSON.stringify(_calendarEventsCache));
        return _calendarEventsCache;
    } catch (error) {
        console.error('API unavailable for calendar events, falling back to localStorage');
        return JSON.parse(localStorage.getItem('kgc_calendar_events') || '[]');
    }
}

// Save a calendar event
async function saveCalendarEvent(event) {
    _calendarEventsCache = null;
    try {
        const snakeEvent = toSnakeCase(event);
        const result = await apiCreateEvent(snakeEvent);
        return toCamelCase(result);
    } catch (error) {
        console.error('API unavailable, saving calendar event to localStorage');
        const events = JSON.parse(localStorage.getItem('kgc_calendar_events') || '[]');
        if (!event.id) {
            event.id = Date.now();
        }
        events.push(event);
        localStorage.setItem('kgc_calendar_events', JSON.stringify(events));
        return event;
    }
}

// Delete a calendar event
async function deleteCalendarEvent(id) {
    _calendarEventsCache = null;
    try {
        await apiDeleteEvent(id);
        return true;
    } catch (error) {
        console.error('API unavailable, deleting calendar event from localStorage');
        const events = JSON.parse(localStorage.getItem('kgc_calendar_events') || '[]');
        const filtered = events.filter(e => e.id !== id);
        localStorage.setItem('kgc_calendar_events', JSON.stringify(filtered));
        return true;
    }
}

// Update a calendar event
async function updateCalendarEvent(id, event) {
    _calendarEventsCache = null;
    try {
        const snakeEvent = toSnakeCase(event);
        const result = await apiUpdateEvent(id, snakeEvent);
        return toCamelCase(result);
    } catch (error) {
        console.error('API unavailable, updating calendar event in localStorage');
        const events = JSON.parse(localStorage.getItem('kgc_calendar_events') || '[]');
        const index = events.findIndex(e => String(e.id) === String(id));
        if (index !== -1) {
            events[index] = { ...events[index], ...event, id };
            localStorage.setItem('kgc_calendar_events', JSON.stringify(events));
        }
        return event;
    }
}

// ============ PROPOSAL DRAFTS ============

let _proposalDraftsCache = null;
let _proposalDraftsCacheTime = 0;

// Get all proposal drafts (keyed by client ID)
async function getProposalDrafts() {
    const now = Date.now();
    if (_proposalDraftsCache && (now - _proposalDraftsCacheTime) < CACHE_TTL) {
        return _proposalDraftsCache;
    }
    try {
        const proposals = await apiGetProposals();
        // Convert array to object keyed by client_id for backwards compatibility
        const draftsObj = {};
        proposals.forEach(p => {
            const clientId = p.client_id || p.clientId;
            if (clientId) {
                draftsObj[clientId] = {
                    ...toCamelCase(p.data || {}),
                    id: p.id,
                    proposalNumber: p.proposal_number || p.proposalNumber,
                    status: p.status,
                    signedAt: p.signed_at || p.signedAt,
                    signature: p.signature
                };
            }
        });
        _proposalDraftsCache = draftsObj;
        _proposalDraftsCacheTime = now;
        // Also update localStorage for offline access
        localStorage.setItem('kgc_proposal_drafts', JSON.stringify(draftsObj));
        return draftsObj;
    } catch (error) {
        console.error('API unavailable for proposals, falling back to localStorage');
        return JSON.parse(localStorage.getItem('kgc_proposal_drafts') || '{}');
    }
}

// Get proposal draft for a specific client
async function getProposalDraft(clientId) {
    try {
        const proposals = await apiGetProposals(clientId);
        if (proposals.length > 0) {
            const p = proposals[0];
            return {
                ...toCamelCase(p.data || {}),
                id: p.id,
                proposalNumber: p.proposal_number || p.proposalNumber,
                status: p.status,
                signedAt: p.signed_at || p.signedAt,
                signature: p.signature
            };
        }
        return null;
    } catch (error) {
        console.error('API unavailable, getting proposal draft from localStorage');
        const drafts = JSON.parse(localStorage.getItem('kgc_proposal_drafts') || '{}');
        return drafts[clientId] || drafts[String(clientId)] || null;
    }
}

// Save proposal draft for a client
async function saveProposalDraft(clientId, draft) {
    _proposalDraftsCache = null;
    try {
        // Check if proposal already exists for this client
        const existing = await apiGetProposals(clientId);

        const proposalData = {
            client_id: clientId,
            status: draft.status || 'draft',
            data: toSnakeCase(draft)
        };

        if (draft.proposalNumber) {
            proposalData.proposal_number = draft.proposalNumber;
        }
        if (draft.signedAt) {
            proposalData.signed_at = draft.signedAt;
        }
        if (draft.signature) {
            proposalData.signature = draft.signature;
        }

        let result;
        if (existing.length > 0) {
            result = await apiUpdateProposal(existing[0].id, proposalData);
        } else {
            result = await apiCreateProposal(proposalData);
        }
        return toCamelCase(result);
    } catch (error) {
        console.error('API unavailable, saving proposal draft to localStorage');
        const drafts = JSON.parse(localStorage.getItem('kgc_proposal_drafts') || '{}');
        drafts[clientId] = draft;
        localStorage.setItem('kgc_proposal_drafts', JSON.stringify(drafts));
        return draft;
    }
}
