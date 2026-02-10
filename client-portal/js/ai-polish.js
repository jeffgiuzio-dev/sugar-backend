/**
 * AI Polish — Shared utility for "Suggest & Accept" AI text polishing
 * Used across: proposal-builder, templates, communications, tasting-scheduler
 * 3-column layout: Original | AI Suggestion | Instructions
 * Draggable, expandable, instruction available from the start
 */

// Inject CSS on first use
function _injectAIPolishStyles() {
  if (document.getElementById('ai-polish-styles')) return;
  const style = document.createElement('style');
  style.id = 'ai-polish-styles';
  style.textContent = `
    .ai-polish-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: aiOverlayIn 0.2s ease-out;
    }
    @keyframes aiOverlayIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .ai-polish-modal {
      position: fixed;
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.05);
      display: flex;
      flex-direction: column;
      z-index: 10001;
      animation: aiModalIn 0.25s ease-out;
      min-width: 700px;
      min-height: 350px;
      resize: both;
      overflow: hidden;
    }
    .ai-polish-header-btn.close-btn {
      font-size: 18px;
      color: #bbb;
    }
    .ai-polish-header-btn.close-btn:hover {
      color: #999;
      background: #f0ebe4;
    }
    @keyframes aiModalIn {
      from { opacity: 0; transform: scale(0.95) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    .ai-polish-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      border-bottom: 1px solid #eee;
      cursor: grab;
      user-select: none;
      flex-shrink: 0;
      border-radius: 10px 10px 0 0;
      background: #faf8f5;
    }
    .ai-polish-header:active { cursor: grabbing; }

    .ai-polish-title {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 18px;
      font-weight: 400;
      color: #1a1a1a;
    }

    .ai-polish-header-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .ai-polish-header-btn {
      width: 28px; height: 28px;
      border: none;
      background: transparent;
      color: #999;
      cursor: pointer;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      font-size: 16px;
    }
    .ai-polish-header-btn:hover { background: #f0ebe4; color: #666; }

    .ai-polish-body {
      display: flex;
      gap: 0;
      flex: 1;
      overflow: hidden;
    }

    .ai-polish-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .ai-polish-pane + .ai-polish-pane {
      border-left: 1px solid #eee;
    }

    .ai-polish-pane-header {
      font-family: 'Montserrat', sans-serif;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      padding: 10px 16px;
      color: #999;
      border-bottom: 1px solid #f5f5f5;
      flex-shrink: 0;
      background: #fafafa;
    }
    .ai-polish-pane-header.suggestion-header {
      color: #b5956a;
      background: #fdf9f5;
    }
    .ai-polish-pane-header.instruction-header {
      color: #7a8b6a;
      background: #f8faf5;
    }

    .ai-polish-pane-text {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      font-family: 'Montserrat', sans-serif;
      font-size: 13px;
      font-weight: 300;
      line-height: 1.8;
      color: #1a1a1a;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .ai-polish-pane-text.original {
      background: #fafafa;
      color: #555;
    }
    .ai-polish-pane-text.suggestion {
      background: #fff;
    }
    textarea.ai-polish-pane-text.suggestion {
      border: none;
      outline: none;
      resize: none;
      cursor: text;
    }
    textarea.ai-polish-pane-text.suggestion:focus {
      background: #fffdf8;
    }

    /* Right instruction pane */
    .ai-polish-instruction-pane {
      width: 240px;
      min-width: 200px;
      display: flex;
      flex-direction: column;
      border-left: 1px solid #eee;
      flex-shrink: 0;
    }
    .ai-polish-instruction-pane textarea {
      flex: 1;
      padding: 14px;
      border: none;
      outline: none;
      resize: none;
      font-family: 'Montserrat', sans-serif;
      font-size: 12px;
      font-weight: 300;
      line-height: 1.7;
      color: #1a1a1a;
      background: #fcfcfa;
    }
    .ai-polish-instruction-pane textarea:focus {
      background: #fff;
    }
    .ai-polish-instruction-pane textarea::placeholder {
      color: #c5c0b8;
      font-style: italic;
    }
    .ai-polish-instruction-actions {
      padding: 10px 14px;
      border-top: 1px solid #f0ede8;
      background: #faf8f5;
      display: flex;
      gap: 6px;
    }

    .ai-polish-footer {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      align-items: center;
      padding: 14px 20px;
      border-top: 1px solid #eee;
      flex-shrink: 0;
      background: #faf8f5;
      border-radius: 0 0 10px 10px;
    }

    .ai-polish-btn {
      padding: 8px 20px;
      font-family: 'Montserrat', sans-serif;
      font-size: 11px;
      font-weight: 400;
      letter-spacing: 0.5px;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .ai-polish-btn.accept {
      background: linear-gradient(135deg, #b5956a, #d4b896);
      color: #fff;
      padding: 8px 28px;
    }
    .ai-polish-btn.accept:hover {
      background: linear-gradient(135deg, #a0825c, #c4a880);
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(181,149,106,0.3);
    }
    .ai-polish-btn.revise {
      background: #fff;
      color: #666;
      border: 1px solid #ddd;
    }
    .ai-polish-instruction-actions .ai-polish-btn {
      width: 100%;
    }
    .ai-polish-btn.revise:hover {
      border-color: #b5956a;
      color: #b5956a;
    }
    .ai-polish-btn.dismiss {
      background: transparent;
      color: #999;
      padding: 8px 14px;
    }
    .ai-polish-btn.dismiss:hover { color: #666; }
    .ai-polish-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .ai-polish-loading {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      color: #b5956a;
      font-family: 'Montserrat', sans-serif;
      font-size: 13px;
      font-weight: 300;
    }

    /* Subject suggestion bar */
    .ai-subject-bar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 10px 16px;
      background: #fdf9f5;
      border: 1px solid #e0d5c7;
      border-radius: 6px;
      margin-top: 8px;
      animation: aiSlideIn 0.2s ease-out;
    }
    @keyframes aiSlideIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .ai-subject-bar label {
      font-family: 'Montserrat', sans-serif;
      font-size: 9px;
      font-weight: 500;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #b5956a;
      white-space: nowrap;
    }
    .ai-subject-bar input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid #e0d5c7;
      border-radius: 4px;
      font-family: 'Montserrat', sans-serif;
      font-size: 12px;
      font-weight: 300;
      color: #1a1a1a;
      background: #fff;
      outline: none;
    }
    .ai-subject-bar input:focus { border-color: #b5956a; }
    .ai-subject-bar button {
      padding: 6px 14px;
      font-family: 'Montserrat', sans-serif;
      font-size: 10px;
      font-weight: 400;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .ai-subject-bar .subject-accept {
      background: linear-gradient(135deg, #b5956a, #d4b896);
      color: #fff;
    }
    .ai-subject-bar .subject-accept:hover {
      background: linear-gradient(135deg, #a0825c, #c4a880);
    }
    .ai-subject-bar .subject-dismiss {
      background: transparent;
      color: #999;
    }
    .ai-subject-bar .subject-dismiss:hover { color: #666; }

    @media (max-width: 768px) {
      .ai-polish-modal {
        min-width: unset;
        width: calc(100vw - 20px) !important;
        height: calc(100vh - 40px) !important;
        top: 20px !important;
        left: 10px !important;
      }
      .ai-polish-body { flex-direction: column; }
      .ai-polish-pane + .ai-polish-pane {
        border-left: none;
        border-top: 1px solid #eee;
      }
      .ai-polish-instruction-pane {
        width: 100%;
        min-width: unset;
        max-height: 120px;
        border-left: none;
        border-top: 1px solid #eee;
      }
    }
  `;
  document.head.appendChild(style);
}

// Remove any existing modal
function _removeExistingModal() {
  const existing = document.querySelector('.ai-polish-overlay');
  if (existing) existing.remove();
  const existingModal = document.querySelector('.ai-polish-modal');
  if (existingModal) existingModal.remove();
}

// Show subject line suggestion after accept
async function _suggestSubjectLine(apiUrl, bodyText, subjectInput) {
  if (!subjectInput) return;

  // Remove any existing subject bar
  const existing = document.querySelector('.ai-subject-bar');
  if (existing) existing.remove();

  // Create the suggestion bar
  const bar = document.createElement('div');
  bar.className = 'ai-subject-bar';
  bar.innerHTML = `
    <label>AI Subject</label>
    <input type="text" value="Generating..." readonly>
    <button class="subject-accept" disabled>Accept</button>
    <button class="subject-dismiss">Skip</button>
  `;

  // Insert after the subject input
  subjectInput.parentElement.insertBefore(bar, subjectInput.nextSibling);

  const barInput = bar.querySelector('input');
  const acceptBtn = bar.querySelector('.subject-accept');
  const dismissBtn = bar.querySelector('.subject-dismiss');

  // Dismiss
  dismissBtn.addEventListener('click', () => bar.remove());

  try {
    const response = await fetch(`${apiUrl}/api/ai/generate-narrative`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: bodyText, generateSubject: true })
    });
    const data = await response.json();
    if (data.success && data.narrative) {
      barInput.value = data.narrative;
      barInput.readOnly = false;
      acceptBtn.disabled = false;

      acceptBtn.addEventListener('click', () => {
        subjectInput.value = barInput.value;
        bar.remove();
      });
    }
  } catch (err) {
    console.error('Subject suggestion error:', err);
    bar.remove();
  }
}

// Call the AI endpoint
async function _callAIPolish(apiUrl, notes, instruction) {
  const body = { notes };
  if (instruction && instruction.trim()) {
    body.instruction = instruction.trim();
  }
  const response = await fetch(`${apiUrl}/api/ai/generate-narrative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (data.success && data.narrative) {
    return data.narrative;
  }
  throw new Error(data.error || 'Failed to polish text.');
}

// Make an element draggable by a handle
function _makeDraggable(modal, handle) {
  let isDragging = false;
  let startX, startY, startLeft, startTop;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('.ai-polish-header-btn')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = modal.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    modal.style.left = (startLeft + dx) + 'px';
    modal.style.top = (startTop + dy) + 'px';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.style.userSelect = '';
  });
}

/**
 * Main entry point — call this from any page
 * @param {HTMLTextAreaElement} textarea - The textarea to polish
 * @param {Object} options
 * @param {string} options.apiUrl - API base URL
 * @param {Function} [options.onAccept] - Callback after accepting (e.g. updatePreview)
 * @param {HTMLButtonElement} [options.btn] - The button that was clicked
 * @param {HTMLInputElement} [options.subjectInput] - Subject input for auto-suggest
 */
function _showElegantToast(message) {
  const existing = document.getElementById('ai-elegant-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'ai-elegant-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%) translateY(20px)',
    background: '#faf8f5', color: '#8b7355', border: '1px solid #e0d5c7',
    padding: '14px 32px', borderRadius: '8px', fontFamily: "'Montserrat', sans-serif",
    fontSize: '13px', fontWeight: '300', letterSpacing: '0.3px',
    boxShadow: '0 4px 20px rgba(181,149,106,0.15)', zIndex: '10002',
    opacity: '0', transition: 'all 0.3s ease'
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(() => {
    toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

async function aiPolish(textarea, options = {}) {
  if (!textarea || !textarea.value.trim()) {
    _showElegantToast('Add your text first, then let AI refine it.');
    return;
  }

  _injectAIPolishStyles();
  _removeExistingModal();

  const apiUrl = options.apiUrl || (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '');
  const originalText = textarea.value.trim();

  // Find the button that triggered this
  const btn = options.btn || textarea.parentElement.querySelector('.ai-polish-btn');

  function restoreBtn() {
    // nothing to restore since we don't change the button anymore
  }

  // Show modal with instruction pane — user writes instructions, then clicks Polish
  _showPolishModal(textarea, apiUrl, originalText, options, restoreBtn);
}

function _showPolishModal(textarea, apiUrl, originalText, options, restoreBtn) {
  // Overlay (doesn't close on click)
  const overlay = document.createElement('div');
  overlay.className = 'ai-polish-overlay';
  document.body.appendChild(overlay);

  // Modal
  const modal = document.createElement('div');
  modal.className = 'ai-polish-modal';

  // Size and position — wider to fit 3 columns
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(vw * 0.8, 750), 1200);
  const height = Math.min(Math.max(vh * 0.65, 450), 700);
  modal.style.width = width + 'px';
  modal.style.height = height + 'px';
  modal.style.left = ((vw - width) / 2) + 'px';
  modal.style.top = ((vh - height) / 2) + 'px';

  const escapedOriginal = originalText.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  modal.innerHTML = `
    <div class="ai-polish-header">
      <span class="ai-polish-title">AI Assist</span>
      <div class="ai-polish-header-actions">
        <button class="ai-polish-header-btn close-btn" data-action="close" title="Close">&times;</button>
      </div>
    </div>
    <div class="ai-polish-body">
      <div class="ai-polish-pane">
        <div class="ai-polish-pane-header">Current Version</div>
        <div class="ai-polish-pane-text original">${escapedOriginal}</div>
      </div>
      <div class="ai-polish-pane">
        <div class="ai-polish-pane-header suggestion-header">AI Suggestion <span style="font-weight:300; font-size:9px; letter-spacing:0.5px; color:#ccc; margin-left:6px;">CLICK TO EDIT</span></div>
        <div class="ai-polish-waiting" style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center; color:#bbb; font-family:'Montserrat',sans-serif; font-size:12px; font-weight:300; line-height:1.8;">
          <div style="margin-bottom:6px;">Add instructions on the right, then click</div>
          <div style="color:#b5956a; font-weight:500; letter-spacing:1px; font-size:13px;">POLISH</div>
        </div>
      </div>
      <div class="ai-polish-instruction-pane">
        <div class="ai-polish-pane-header instruction-header">Instructions</div>
        <textarea id="aiPolishInstruction" placeholder="Any notes for the AI?"></textarea>
        <div style="padding:8px 14px 4px; font-family:'Cormorant Garamond',Georgia,serif; font-size:11px; color:#c5c0b8; line-height:1.7; font-style:italic;">
          A little direction goes a long way &mdash; or leave blank and let AI do its thing.
        </div>
        <div class="ai-polish-instruction-actions">
          <button class="ai-polish-btn accept" data-action="polish" style="background:linear-gradient(135deg,#b5956a,#d4b896); color:#fff; width:100%;">Polish</button>
        </div>
      </div>
    </div>
    <div class="ai-polish-footer">
      <button class="ai-polish-btn dismiss" data-action="dismiss">Dismiss</button>
      <button class="ai-polish-btn revise" data-action="revise" style="display:none;">Revise</button>
      <button class="ai-polish-btn accept" data-action="accept" disabled>Accept</button>
    </div>
  `;

  document.body.appendChild(modal);

  // Draggable
  _makeDraggable(modal, modal.querySelector('.ai-polish-header'));

  // Close (X) button
  modal.querySelector('[data-action="close"]').addEventListener('click', () => {
    overlay.remove();
    modal.remove();
    restoreBtn();
  });

  // Dismiss
  modal.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
    overlay.remove();
    modal.remove();
    restoreBtn();
  });

  // Polish button — fires the first API call with optional instruction
  modal.querySelector('[data-action="polish"]').addEventListener('click', async function() {
    const polishBtn = this;
    const instructionInput = modal.querySelector('#aiPolishInstruction');
    const instruction = instructionInput ? instructionInput.value.trim() : '';

    polishBtn.textContent = 'Polishing...';
    polishBtn.disabled = true;

    // Replace waiting message with loading spinner
    const waitingEl = modal.querySelector('.ai-polish-waiting');
    if (waitingEl) {
      waitingEl.className = 'ai-polish-loading';
      waitingEl.innerHTML = 'Polishing...';
    }

    try {
      const suggestion = await _callAIPolish(apiUrl, originalText, instruction || null);
      // Change Polish button to Revise
      polishBtn.textContent = 'Revise';
      polishBtn.disabled = false;
      polishBtn.setAttribute('data-action', 'revise-instruction');
      // Show the footer Revise button too
      const footerRevise = modal.querySelector('[data-action="revise"]');
      if (footerRevise) footerRevise.style.display = '';
      _updateModalSuggestion(suggestion, textarea, apiUrl, originalText, options, restoreBtn);
    } catch (err) {
      console.error('AI polish error:', err);
      polishBtn.textContent = 'Retry Polish';
      polishBtn.disabled = false;
      if (waitingEl) {
        waitingEl.innerHTML = 'Could not reach the AI service.<br>Check your connection and try again.';
        waitingEl.style.color = '#c0392b';
      }
    }
  });

  // Enter key in instruction field triggers Polish/Revise (Shift+Enter for newline)
  modal.querySelector('#aiPolishInstruction').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const polishBtn = modal.querySelector('[data-action="polish"]') || modal.querySelector('[data-action="revise-instruction"]');
      if (polishBtn) polishBtn.click();
    }
  });
}

function _updateModalSuggestion(suggestion, textarea, apiUrl, originalText, options, restoreBtn) {
  const modal = document.querySelector('.ai-polish-modal');
  if (!modal) return;
  const overlay = document.querySelector('.ai-polish-overlay');

  // Replace loading with editable suggestion textarea
  const rightPane = modal.querySelectorAll('.ai-polish-pane')[1];
  const loadingEl = rightPane.querySelector('.ai-polish-loading');
  if (loadingEl) {
    const textArea = document.createElement('textarea');
    textArea.className = 'ai-polish-pane-text suggestion';
    textArea.value = suggestion;
    loadingEl.replaceWith(textArea);
  }

  // Enable accept button
  const acceptBtn = modal.querySelector('[data-action="accept"]');
  const reviseBtn = modal.querySelector('[data-action="revise"]');
  const instructionInput = modal.querySelector('#aiPolishInstruction');

  acceptBtn.disabled = false;

  // Accept handler — reads from the editable suggestion textarea
  function bindAccept(btn) {
    btn.addEventListener('click', () => {
      const suggestionEl = modal.querySelector('.ai-polish-pane-text.suggestion');
      const acceptedText = suggestionEl ? suggestionEl.value : suggestion;
      textarea.value = acceptedText;
      overlay.remove();
      modal.remove();
      restoreBtn();
      if (options.onAccept) options.onAccept();
      // Auto-suggest subject line if a subject input was provided
      if (options.subjectInput) {
        _suggestSubjectLine(apiUrl, acceptedText, options.subjectInput);
      }
    });
  }
  bindAccept(acceptBtn);

  // Revise from instruction pane (right side button that was originally "Polish")
  const reviseInstructionBtn = modal.querySelector('[data-action="revise-instruction"]');
  if (reviseInstructionBtn) {
    reviseInstructionBtn.addEventListener('click', async function() {
      const instruction = instructionInput.value.trim();
      const currentText = modal.querySelector('.ai-polish-pane-text.suggestion');
      const textToRevise = currentText ? currentText.value : suggestion;

      this.textContent = instruction ? 'Revising...' : 'Polishing...';
      this.disabled = true;
      acceptBtn.disabled = true;
      if (currentText) currentText.style.opacity = '0.4';

      try {
        const revised = instruction
          ? await _callAIPolish(apiUrl, textToRevise, instruction)
          : await _callAIPolish(apiUrl, originalText);
        if (currentText) {
          currentText.value = revised;
          currentText.style.opacity = '1';
        }
        if (instruction) instructionInput.value = '';
        const newAcceptBtn = acceptBtn.cloneNode(true);
        acceptBtn.replaceWith(newAcceptBtn);
        bindAccept(newAcceptBtn);
      } catch (err) {
        console.error('AI revise error:', err);
        alert('Could not reach the AI service. Try again later.');
        if (currentText) currentText.style.opacity = '1';
      } finally {
        this.textContent = 'Revise';
        this.disabled = false;
        const curAccept = modal.querySelector('[data-action="accept"]');
        if (curAccept) curAccept.disabled = false;
      }
    });
  }

  // Footer Revise handler — sends current suggestion text + instruction to AI
  reviseBtn.addEventListener('click', async function() {
    const instruction = instructionInput.value.trim();
    const currentText = modal.querySelector('.ai-polish-pane-text.suggestion');
    const textToRevise = currentText ? currentText.value : suggestion;

    if (!instruction) {
      // No instruction — do a full re-polish from original
      reviseBtn.textContent = 'Polishing...';
      reviseBtn.disabled = true;
      acceptBtn.disabled = true;

      if (currentText) currentText.style.opacity = '0.4';

      try {
        const newSuggestion = await _callAIPolish(apiUrl, originalText);
        if (currentText) {
          currentText.value = newSuggestion;
          currentText.style.opacity = '1';
        }
        // Rebind accept
        const newAcceptBtn = acceptBtn.cloneNode(true);
        acceptBtn.replaceWith(newAcceptBtn);
        bindAccept(newAcceptBtn);
      } catch (err) {
        console.error('AI retry error:', err);
        alert('Could not reach the AI service. Try again later.');
        if (currentText) currentText.style.opacity = '1';
      } finally {
        reviseBtn.textContent = 'Revise';
        reviseBtn.disabled = false;
        const curAccept = modal.querySelector('[data-action="accept"]');
        if (curAccept) curAccept.disabled = false;
      }
      return;
    }

    // Has instruction — send current text + instruction for targeted revision
    reviseBtn.textContent = 'Revising...';
    reviseBtn.disabled = true;
    acceptBtn.disabled = true;

    if (currentText) currentText.style.opacity = '0.4';

    try {
      const revised = await _callAIPolish(apiUrl, textToRevise, instruction);
      if (currentText) {
        currentText.value = revised;
        currentText.style.opacity = '1';
      }
      // Clear instruction after successful revision
      instructionInput.value = '';

      // Rebind accept with revised text
      const newAcceptBtn = acceptBtn.cloneNode(true);
      acceptBtn.replaceWith(newAcceptBtn);
      bindAccept(newAcceptBtn);
    } catch (err) {
      console.error('AI revise error:', err);
      alert('Could not reach the AI service. Try again later.');
      if (currentText) currentText.style.opacity = '1';
    } finally {
      reviseBtn.textContent = 'Revise';
      reviseBtn.disabled = false;
      const curAccept = modal.querySelector('[data-action="accept"]');
      if (curAccept) curAccept.disabled = false;
    }
  });
}
