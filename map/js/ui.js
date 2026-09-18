// Sidebar, search, detail panel, non-claims modal and the time scrubber.

window.MAP = window.MAP || {};
(function (MAP) {
'use strict';

const { swatchSVG, tierLineSVG, readPalette, FAMILY_VAR, TIER } = MAP.shapes;

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** The bare host of a live url, for a link that has nothing better to say. */
function hostOf(url) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ''));
  return m ? m[1].replace(/^www\./, '') : String(url || '');
}

/** Renders only as much of a date as the record actually supports. */
function formatDate(d) {
  if (!d) return null;
  const dt = new Date(d.t);
  if (d.precision === 'year') return String(dt.getUTCFullYear());
  if (d.precision === 'month') return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

class UI {
  constructor(data, handlers) {
    this.data = data;
    this.h = handlers;
    this.nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    this.catById = new Map(data.taxonomy.categories.map((c) => [c.key, c]));
    this.typeById = new Map(data.taxonomy.connectionTypes.map((t) => [t.key, t]));

    this.activeCategories = new Set(data.taxonomy.categories.map((c) => c.key));
    this.activeTypes = new Set(data.taxonomy.connectionTypes.map((t) => t.key));
    this.activeTiers = new Set([1, 2, 3]);

    this._buildMasthead();
    this._buildLegend();
    this._buildTypes();
    this._buildTiers();
    this._buildAgeKey();
    this._buildSearch();
    this._buildPanel();
    this._buildModal();
    this._buildTiplineModal();
  }

  palette() { return readPalette(); }
  /** The custom-property name for a family, so swatches follow the theme. */
  hue(family) { return FAMILY_VAR[family]; }

  // -------------------------------------------------------------- chrome ---

  _buildMasthead() {
    const m = this.data.meta;
    el('counts').textContent =
      `${m.nodeCount} entities · ${m.edgeCount} connections · ${m.documentCount} documents`;
  }

  _countNodes(catKey) {
    return this.data.nodes.filter((n) => n.category === catKey).length;
  }

  _buildLegend() {
    const host = el('legend');
    host.innerHTML = this.data.taxonomy.hueFamilies.map((fam) => {
      const cats = this.data.taxonomy.categories.filter((c) => c.family === fam.key);
      const rows = cats.map((c) => `
        <label class="check" data-cat="${c.key}" title="${esc(c.note || c.label)}">
          <input type="checkbox" checked data-category="${c.key}">
          ${swatchSVG(c.shape, c.fill, this.hue(fam.key))}
          <span class="label">${esc(c.label)}</span>
          <span class="n">${this._countNodes(c.key)}</span>
        </label>`).join('');
      return `<div class="family">
        <span class="family-label">${esc(fam.label)}</span>${rows}</div>`;
    }).join('');

    host.addEventListener('change', (ev) => {
      const key = ev.target.dataset.category;
      if (!key) return;
      ev.target.checked ? this.activeCategories.add(key) : this.activeCategories.delete(key);
      ev.target.closest('.check').classList.toggle('off', !ev.target.checked);
      this.h.onFilter();
    });

    el('legend-toggle').addEventListener('click', () => {
      const all = this.activeCategories.size === this.data.taxonomy.categories.length;
      host.querySelectorAll('input[data-category]').forEach((i) => {
        i.checked = !all;
        i.closest('.check').classList.toggle('off', all);
      });
      this.activeCategories = all ? new Set()
        : new Set(this.data.taxonomy.categories.map((c) => c.key));
      this.h.onFilter();
    });
  }

  _buildTypes() {
    const host = el('types');
    const counts = new Map();
    for (const e of this.data.edges) counts.set(e.type, (counts.get(e.type) || 0) + 1);
    host.innerHTML = this.data.taxonomy.connectionTypes.map((t) => `
      <label class="check" title="${esc(t.note || '')}">
        <input type="checkbox" checked data-type="${t.key}">
        <span class="label">${esc(t.label)}</span>
        <span class="n">${counts.get(t.key) || 0}</span>
      </label>`).join('');

    host.addEventListener('change', (ev) => {
      const key = ev.target.dataset.type;
      if (!key) return;
      ev.target.checked ? this.activeTypes.add(key) : this.activeTypes.delete(key);
      ev.target.closest('.check').classList.toggle('off', !ev.target.checked);
      this.h.onFilter();
    });
  }

  _buildTiers() {
    const host = el('tiers');
    const counts = new Map();
    for (const e of this.data.edges) counts.set(e.tier, (counts.get(e.tier) || 0) + 1);
    host.innerHTML = [1, 2, 3].map((t) => `
      <label class="check tier-row">
        <input type="checkbox" checked data-tier="${t}">
        ${tierLineSVG(t, t === 3 ? '--ink-muted' : '--edge-strong')}
        <span class="label">${esc(TIER[t].label)}</span>
        <span class="n">${counts.get(t) || 0}</span>
      </label>`).join('');

    host.addEventListener('change', (ev) => {
      const t = Number(ev.target.dataset.tier);
      if (!t) return;
      ev.target.checked ? this.activeTiers.add(t) : this.activeTiers.delete(t);
      ev.target.closest('.check').classList.toggle('off', !ev.target.checked);
      this.h.onFilter();
    });
  }

  _buildAgeKey() {
    const [t0, t1] = this.data.meta.timeExtent;
    el('age-key').innerHTML = `
      <div class="age-ramp">
        <span>${new Date(t0).getUTCFullYear()}</span>
        <span class="bar"></span>
        <span>${new Date(t1).getUTCFullYear()}</span>
      </div>
      <p class="note">Every node carries a ring shaded by its earliest documented date —
      an achromatic channel, so it never competes with category colour.</p>`;
  }

  // -------------------------------------------------------------- search ---

  _buildSearch() {
    const input = el('search');
    const list = el('suggest');
    let cursor = -1;

    const close = () => { list.innerHTML = ''; cursor = -1; };

    const results = (q) => {
      const s = q.trim().toLowerCase();
      if (!s) return [];
      return this.data.nodes
        .map((n) => {
          const hay = [n.name, n.short, ...(n.aliases || [])].join(' ').toLowerCase();
          const i = hay.indexOf(s);
          return i < 0 ? null : { n, rank: i + (n.name.toLowerCase().startsWith(s) ? -50 : 0) };
        })
        .filter(Boolean)
        .sort((a, b) => a.rank - b.rank || b.n.degree - a.n.degree)
        .slice(0, 9)
        .map((r) => r.n);
    };

    const render = (items) => {
      list.innerHTML = items.map((n, i) => {
        const cat = this.catById.get(n.category);
        return `<button data-id="${esc(n.id)}" data-i="${i}">
          ${swatchSVG(cat.shape, cat.fill, this.hue(n.family), 14)}
          <span class="s-name">${esc(n.name)}</span>
          <span class="s-cat">${esc(cat.label)}</span>
        </button>`;
      }).join('');
    };

    input.addEventListener('input', () => {
      const items = results(input.value);
      items.length ? render(items) : close();
    });

    input.addEventListener('keydown', (ev) => {
      const btns = [...list.querySelectorAll('button')];
      if (ev.key === 'Escape') { close(); input.blur(); return; }
      if (!btns.length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        cursor = (cursor + (ev.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
        btns.forEach((b, i) => b.setAttribute('aria-selected', String(i === cursor)));
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        (btns[Math.max(0, cursor)]).click();
      }
    });

    list.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-id]');
      if (!b) return;
      close();
      input.value = '';
      this.h.onPick(b.dataset.id);
    });

    el('search-clear').addEventListener('click', () => { input.value = ''; close(); input.focus(); });
    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('.search-wrap')) close();
    });
  }

  // --------------------------------------------------------------- panel ---

  _buildPanel() {
    el('panel-close').addEventListener('click', () => this.closePanel());
    el('panel').addEventListener('click', (ev) => {
      const edge = ev.target.closest('[data-edge]');
      if (edge) { this.h.onPickEdge(edge.dataset.edge); return; }
      const b = ev.target.closest('[data-goto]');
      if (b) this.h.onPick(b.dataset.goto);
    });
  }

  closePanel() {
    el('panel').classList.remove('open');
    el('stage').classList.remove('panel-open');
    this.h.onClosePanel();
  }

  _citationHTML(c) {
    const date = c.date ? formatDate({ t: Date.parse(c.date), precision:
      String(c.date).length === 4 ? 'year' : String(c.date).length === 7 ? 'month' : 'day' }) : null;
    const quote = c.excerpt
      ? `<blockquote>${esc(String(c.excerpt).trim())}</blockquote>` : '';
    const link = c.doc
      ? `<a class="doc" href="../${esc(c.doc)}" target="_blank" rel="noopener">${esc(c.doc)}</a>`
      : `<span class="ext">External source — not in evidence/</span>`;
    // The archived copy is the source of the claim and never moves. The live url,
    // where one exists, is where the same source can be read today — a reader's own
    // check on it, and the thing that can rot. Both are shown; the archived one first.
    const live = c.url
      ? `<a class="live" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">
           <span class="live-tag">Live</span>${esc(c.urlLabel || hostOf(c.url))}</a>`
      : '';
    return `<div class="cite">
      <div class="cite-head">
        <span class="cite-label">${esc(c.label || c.doc || c.external)}</span>
        ${date ? `<span class="cite-date">${esc(date)}</span>` : ''}
      </div>
      ${quote}<div class="cite-links">${link}${live}</div>
    </div>`;
  }

  showNode(node) {
    const cat = this.catById.get(node.category);
    const date = formatDate(node.date);
    const related = this.data.edges
      .filter((e) => e.sourceId === node.id || e.targetId === node.id)
      .map((e) => {
        const otherId = e.sourceId === node.id ? e.targetId : e.sourceId;
        const other = this.nodeById.get(otherId);
        const dir = e.sourceId === node.id ? '' : '← ';
        const oc = this.catById.get(other.category);
        // The row opens the CONNECTION, so its citation is one click away —
        // an edge's sources must be reachable, not only a node's.
        return `<button class="rel" data-edge="${esc(e.id)}"
                  title="Show the document behind this connection">
          <span class="rel-name">${swatchSVG(oc.shape, oc.fill, this.hue(other.family), 13)}
            ${esc(other.name)}</span>
          <span class="rel-desc">${esc(dir)}${esc(e.label)}${
            e.date ? ` · ${esc(formatDate(e.date))}` : ''}${
            e.tier === 3 ? ' · unresolved' : e.tier === 2 ? ' · attributed' : ''} ·
            ${e.citations.length} source${e.citations.length === 1 ? '' : 's'}</span>
        </button>`;
      }).join('');

    el('panel-body').innerHTML = `
      <div class="p-kicker">${swatchSVG(cat.shape, cat.fill, this.hue(node.family), 15)}
        <span>${esc(cat.label)}</span>
        ${node.tier !== 1 ? `<span>· ${esc(TIER[node.tier].label)}</span>` : ''}</div>
      <h2 class="p-title">${esc(node.name)}</h2>
      ${date ? `<p class="p-date">${esc(date)}${
        node.dateNote ? ` — ${esc(node.dateNote)}` : ''}</p>` : ''}
      <p class="p-body">${esc(node.summary)}</p>
      ${node.caveat ? `<p class="p-caveat"><b>What this does not establish.</b>
        ${esc(node.caveat)}</p>` : ''}
      <div class="p-section">Sources — ${node.citations.length}</div>
      ${node.citations.map((c) => this._citationHTML(c)).join('')}
      <div class="p-section">Connections — ${
        this.data.edges.filter((e) => e.sourceId === node.id || e.targetId === node.id).length}</div>
      ${related}`;
    this._openPanel();
  }

  _openPanel() {
    el('panel').classList.add('open');
    el('stage').classList.add('panel-open');
    el('panel').scrollTop = 0;
  }

  showEdge(edge) {
    const s = this.nodeById.get(edge.sourceId);
    const t = this.nodeById.get(edge.targetId);
    const type = this.typeById.get(edge.type);
    el('panel-body').innerHTML = `
      <div class="p-kicker"><span>${esc(type.label)}</span>
        <span>· ${esc(TIER[edge.tier].label)}</span></div>
      <h2 class="p-title">${esc(s.short)} <span class="p-verb">${esc(edge.label)}</span> ${esc(t.short)}</h2>
      ${edge.date ? `<p class="p-date">${esc(formatDate(edge.date))}</p>` : ''}
      ${edge.because ? `<p class="p-because"><span class="p-because-arrow">↳</span> ${esc(edge.because)}</p>` : ''}
      ${edge.summary ? `<p class="p-body">${esc(edge.summary)}</p>` : ''}
      ${edge.resolves ? `<p class="p-caveat"><b>What would resolve this.</b>
        ${esc(edge.resolves)}</p>` : ''}
      <div class="p-section">Sources — ${edge.citations.length}</div>
      ${edge.citations.map((c) => this._citationHTML(c)).join('')}
      <div class="p-section">Endpoints</div>
      <button class="rel" data-goto="${esc(s.id)}"><span class="rel-name">${esc(s.name)}</span>
        <span class="rel-desc">from — open this entity</span></button>
      <button class="rel" data-goto="${esc(t.id)}"><span class="rel-name">${esc(t.name)}</span>
        <span class="rel-desc">to — open this entity</span></button>`;
    this._openPanel();
  }

  // --------------------------------------------------------------- modal ---

  _buildModal() {
    const nc = this.data.nonClaims;
    const section = (title, items) => !items || !items.length ? '' : `<h3>${esc(title)}</h3>` + items.map((i) =>
      `<div class="nc"><b>${esc(i.title)}</b><span>${esc(i.body.trim())}</span></div>`).join('');

    el('modal-body').innerHTML = `
      <h2>What this map does not claim</h2>
      <p class="lede">These are the readings the record does not support.</p>
      ${section('Expressly not claimed', nc.notClaimed)}
      ${section('Open questions — why some expected lines are absent', nc.openQuestions)}
      ${section('Threads closed by review', nc.closedThreads)}`;

    el('open-modal').addEventListener('click', () => el('modal').classList.add('open'));
    el('modal').addEventListener('click', (ev) => {
      if (ev.target.id === 'modal' || ev.target.closest('[data-close]')) {
        el('modal').classList.remove('open');
      }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') el('modal').classList.remove('open');
    });
  }

  // ------------------------------------------------------------- tipline ---

  _buildTiplineModal() {
    el('tipline-modal-body').innerHTML = `
      <h2>Send a tip</h2>
      <p class="lede">This project runs on documents. If you have one — a lease, a permit
      filing, an email, a recording, a name we've gotten wrong — it's useful whether or not
      you can say how you got it.</p>
      <h3>What's valuable</h3>
      <div class="nc"><b>Documents</b><span>Filings, contracts, permits, correspondence,
      minutes, financial records — anything with a date and a source, even a partial
      one.</span></div>
      <div class="nc"><b>Corrections</b><span>A name, date, or relationship on this map
      that's wrong, outdated, or missing context.</span></div>
      <div class="nc"><b>Leads</b><span>A person, entity, or public record worth looking
      into, even without documents in hand yet.</span></div>
      <h3>Anonymity</h3>
      <div class="nc"><b>Your identity stays out of it</b><span>Tips are handled
      anonymously. Nothing you send is published or attributed without your explicit
      permission.</span></div>
      <p class="lede" style="margin-top:22px">
        <a href="mailto:trentoverpoo@proton.me">trentoverpoo@proton.me</a>
      </p>`;

    el('open-tipline').addEventListener('click', () => el('tipline-modal').classList.add('open'));
    el('tipline-modal').addEventListener('click', (ev) => {
      if (ev.target.id === 'tipline-modal' || ev.target.closest('[data-close]')) {
        el('tipline-modal').classList.remove('open');
      }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') el('tipline-modal').classList.remove('open');
    });
  }

  // ------------------------------------------------------------- tooltip ---

  showTooltip(node, pt) {
    const tip = el('tooltip');
    if (!node) { tip.classList.remove('show'); return; }
    const cat = this.catById.get(node.category);
    const date = formatDate(node.date);
    tip.innerHTML = `
      <div class="t-name">${esc(node.name)}</div>
      <div class="t-meta">${swatchSVG(cat.shape, cat.fill, this.hue(node.family), 12)}
        <span>${esc(cat.label)}</span>${date ? `<span>· ${esc(date)}</span>` : ''}</div>
      <div class="t-cites">${node.citations.length} source${
        node.citations.length === 1 ? '' : 's'} · ${node.degree} connection${
        node.degree === 1 ? '' : 's'}${node.tier === 3 ? ' · unresolved' : ''}</div>`;
    tip.classList.add('show');
    const stage = el('stage').getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.style.left = `${Math.min(pt.x + 16, stage.width - w - 10)}px`;
    tip.style.top = `${Math.max(8, Math.min(pt.y + 16, stage.height - h - 10))}px`;
  }
}

MAP.UI = UI;
MAP.formatDate = formatDate;
MAP.esc = esc;
}(window.MAP));
