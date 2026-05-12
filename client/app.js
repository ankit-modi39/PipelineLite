// Browser dashboard. Vanilla JS, no build step.
//
// Two data sources, two cadences:
//   - REST GET /api/builds         → poll every 5s for the list + queue stats
//   - Socket.io subscribe/log/status → live stream for the selected build
//
// XSS hygiene: every string from the server is HTML-escaped before going
// into innerHTML. Log chunks go through textContent (no escape needed).

const socket = io();   // /socket.io served by the same origin

let selectedId  = null;     // currently subscribed buildId
let currentBuild = null;    // last-known build object for the detail header
let stickToBottom = true;   // tail-style autoscroll

const $ = (sel) => document.querySelector(sel);
const els = {
  list:    $('#builds-list'),
  refresh: $('#refresh-btn'),
  qDepth:  $('#queue-depth'),
  qActive: $('#queue-active'),
  header:  $('#detail-header'),
  output:  $('#log-output'),
};

// ── Tiny escape helper ──────────────────────────────────────────────
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

// ── Build list (REST polling) ───────────────────────────────────────
async function refreshBuilds() {
  try {
    const res = await fetch('/api/builds');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderList(data.builds);
    els.qDepth.textContent  = data.queue.depth;
    els.qActive.textContent = data.queue.active;
  } catch (err) {
    console.error('refreshBuilds failed', err);
  }
}

function renderList(builds) {
  if (!builds.length) {
    els.list.innerHTML = '<li class="empty">no builds yet</li>';
    return;
  }
  els.list.innerHTML = builds.map((b) => `
    <li data-id="${esc(b.id)}" class="${b.id === selectedId ? 'selected' : ''}">
      <div class="build-id">${esc(b.id)}</div>
      <div class="build-row">
        <span class="status ${esc(b.status)}">${esc(b.status)}</span>
        <span class="build-ref">${esc(b.branch ?? b.ref ?? '-')}</span>
      </div>
    </li>
  `).join('');

  els.list.querySelectorAll('li[data-id]').forEach((li) => {
    li.addEventListener('click', () => selectBuild(li.dataset.id));
  });
}

// ── Detail view ────────────────────────────────────────────────────
function selectBuild(id) {
  if (selectedId === id) return;

  if (selectedId) socket.emit('unsubscribe', { buildId: selectedId });

  selectedId   = id;
  currentBuild = null;
  stickToBottom = true;
  els.output.textContent = '';
  els.header.classList.remove('empty');
  els.header.innerHTML = '<em>loading…</em>';

  // Update selection styling without a full re-render.
  els.list.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('selected', li.dataset.id === id);
  });

  socket.emit('subscribe', { buildId: id }, (resp) => {
    if (resp?.error) {
      els.header.innerHTML = `<em>error: ${esc(resp.error)}</em>`;
    }
  });
}

function renderHeader(build) {
  currentBuild = build;
  const exit = build.exitCode != null ? ` (exit ${esc(build.exitCode)})` : '';
  els.header.innerHTML = `
    <dl>
      <dt>Build:</dt>   <dd>${esc(build.id)}</dd>
      <dt>Repo:</dt>    <dd>${esc(build.repo ?? '-')}</dd>
      <dt>Branch:</dt>  <dd>${esc(build.branch ?? build.ref ?? '-')}</dd>
      <dt>Commit:</dt>  <dd>${esc(build.commit ?? '-')}</dd>
      <dt>Status:</dt>  <dd><span class="status ${esc(build.status)}">${esc(build.status)}</span>${exit}</dd>
      <dt>Started:</dt> <dd>${esc(build.startedAt ?? '-')}</dd>
      <dt>Ended:</dt>   <dd>${esc(build.endedAt ?? '-')}</dd>
    </dl>
  `;
}

function appendLog(chunk) {
  els.output.appendChild(document.createTextNode(chunk));
  if (stickToBottom) els.output.scrollTop = els.output.scrollHeight;
}

// ── Socket.io event handlers ───────────────────────────────────────
socket.on('snapshot', ({ build, log }) => {
  renderHeader(build);
  els.output.textContent = log || '';
  els.output.scrollTop = els.output.scrollHeight;
});

socket.on('log', ({ buildId, chunk }) => {
  // Defensive: ignore events for builds we no longer care about
  // (room cleanup should prevent these, but the check is cheap).
  if (buildId !== selectedId) return;
  appendLog(chunk);
});

socket.on('status', (evt) => {
  // Always refresh the list so the row's status pill updates.
  refreshBuilds();
  // Update the detail header in-place if it's the current build.
  if (evt.buildId === selectedId && currentBuild) {
    renderHeader({ ...currentBuild, ...evt });
  }
});

// ── Autoscroll: only follow if user is already at the bottom ───────
els.output.addEventListener('scroll', () => {
  const atBottom = els.output.scrollTop + els.output.clientHeight
                 >= els.output.scrollHeight - 4;
  stickToBottom = atBottom;
});

// ── Bootstrap ──────────────────────────────────────────────────────
els.refresh.addEventListener('click', refreshBuilds);
refreshBuilds();
setInterval(refreshBuilds, 5000);
