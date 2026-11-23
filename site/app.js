/* Spektrafilm Pack Creator: pick spektrafilm stocks and zip them into a darktable pack.
   Reads data/catalog.json (written by tools/build.py) and fetches pack files
   from data/pack/ when the pack is downloaded. No server code. */
(() => {
  'use strict';

  const DATA = 'data/';
  const STORE = 'lightbox.pick.v1';
  const KINDS = [
    ['negative', 'Colour negative'],
    ['cine', 'Cinema negative'],
    ['slide', 'Slide'],
    ['bw', 'Black & white'],
    ['paper', 'Paper'],
    ['print-film', 'Print film'],
  ];
  const KIND_NAME = Object.fromEntries(KINDS);
  const FILTER_KINDS = [['all', 'All'], ['color', 'Color'], ['bw', 'B&W'], ['print', 'Print']];
  const KIND_FILTER = { negative: 'color', cine: 'color', slide: 'color', bw: 'bw', paper: 'print', 'print-film': 'print' };
  const SCHEMES = [['gray', 'Off'], ['color', 'Color'], ['all', 'All']];
  const NEW_DAYS = 21;

  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mb = n => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB';
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  let cat = null;
  let byId = new Map();
  const picked = new Set();
  const filt = { kind: 'all', source: 'all', q: '', hideApprox: false };
  let scheme = 'all';
  // spectral upsampling: the files of the tables put in the pack, and the one new edits start with
  const up = { include: new Set(), def: null };

  /* ---------------------------------------------------------------- storage */
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        pick: [...picked], known: cat.stocks.map(s => s.stock),
        scheme, tables: [...up.include], table_default: up.def,
      }));
    } catch (_) { /* private mode: the page still works */ }
  }

  function restoreTables(saved) {
    const tables = cat.tables || [];
    const byFile = new Map(tables.map(t => [t.file, t]));
    const byIdent = new Map(tables.filter(t => t.identifier).map(t => [t.identifier, t]));
    up.include = new Set(tables.map(t => t.file));
    up.def = tables[0] ? tables[0].file : null;
    const q = new URLSearchParams(location.search);
    if (q.get('table') && byIdent.has(q.get('table'))) {
      up.def = byIdent.get(q.get('table')).file;
      if (q.get('only') === '1') up.include = new Set([up.def]);
      return;
    }
    if (saved && Array.isArray(saved.tables)) {
      const inc = saved.tables.filter(f => byFile.has(f));
      if (inc.length) up.include = new Set(inc);
      if (saved.table_default && up.include.has(saved.table_default)) up.def = saved.table_default;
      else up.def = tables.find(t => up.include.has(t.file)).file;
    }
  }

  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) { saved = null; }
    if (saved && SCHEMES.some(([k]) => k === saved.scheme)) scheme = saved.scheme;
    restoreTables(saved);
    const url = new URLSearchParams(location.search).get('pick');
    if (url) {
      const ids = url === 'all' ? cat.stocks.map(s => s.stock) : url.split(',');
      ids.filter(id => byId.has(id)).forEach(id => picked.add(id));
      return;
    }
    if (!saved || !Array.isArray(saved.pick)) {
      cat.stocks.forEach(s => picked.add(s.stock));
      return;
    }
    saved.pick.filter(id => byId.has(id)).forEach(id => picked.add(id));
    // someone who kept everything gets stocks added since their last visit
    const known = new Set(saved.known || []);
    const hadAll = (saved.known || []).every(id => saved.pick.includes(id));
    if (hadAll) cat.stocks.filter(s => !known.has(s.stock)).forEach(s => picked.add(s.stock));
  }

  /* ------------------------------------------------------------- selection */
  function requiredPapers() {
    const need = new Map();
    for (const id of picked) {
      const s = byId.get(id);
      if (s && s.stage === 'filming' && s.paper && byId.has(s.paper)) {
        if (!need.has(s.paper)) need.set(s.paper, []);
        need.get(s.paper).push(s);
      }
    }
    return need;
  }

  function included() {
    const need = requiredPapers();
    const all = new Set(picked);
    need.forEach((_, p) => all.add(p));
    return { all, need };
  }

  function toggle(id) {
    const s = byId.get(id);
    const { need } = included();
    if (picked.has(id) && need.has(id)) {
      picked.delete(id);
      const films = need.get(id);
      toast(`${s.name} stays in the pack: ${films.length === 1 ? films[0].name + ' prints on it' : films.length + ' selected films print on it'}.`);
    } else if (picked.has(id)) {
      picked.delete(id);
    } else {
      picked.add(id);
    }
    save();
    paintStates();
  }

  /* ------------------------------------------------------------- rendering */
  function stripHTML(s, opts = {}) {
    const paper = s.stage === 'printing' && s.kind === 'paper';
    const frames = s.wedge.map(c => `<i style="background:${c}"></i>`).join('');
    const ep = esc(`${s.brand} ${s.model}`);
    return `<div class="strip${paper ? ' paper' : ''}" style="--rb:${s.rebate};--ep:${s.wedge[s.wedge.length - 1]}" ${opts.label ? `role="img" aria-label="${esc(opts.label)}"` : 'aria-hidden="true"'}>
      <div class="sp"></div><div class="frames">${frames}</div><div class="ep">${paper ? '' : ep}</div></div>`;
  }

  // stocks present since the first build are not new; later arrivals are, for a few weeks
  let baseline = '';
  function isNew(s) {
    return s.first_seen > baseline && (Date.parse(cat.built_at) - Date.parse(s.first_seen)) / 864e5 < NEW_DAYS;
  }

  function tileHTML(s) {
    const meta = [isNew(s) ? 'New' : null, s.in_base ? 'darktable' : s.source,
      s.approximate ? 'approximate' : null, /experimental/i.test(s.name) ? 'experimental' : null].filter(Boolean);
    const wedge = s.wedge.map(c => `<i style="background:${c}"></i>`).join('');
    return `<div class="shelf-tile" data-id="${esc(s.stock)}" id="s-${esc(s.stock)}">
      <input type="checkbox" class="tile-check" aria-label="Add ${esc(s.name)} to the pack">
      <button type="button" class="tile-body pick" aria-hidden="true" tabindex="-1">
        ${Covers.svg(Covers.coverOf(s), scheme)}
        <span class="wedge" style="--rb:${s.rebate}">${wedge}</span>
        <span class="tile-name">${esc(s.model.replace(/\s*\((experimental)\)\s*/i, ' ').trim())}</span>
      </button>
      <span class="tile-meta${isNew(s) ? ' new' : ''}">${esc(meta.join(' · '))}</span>
      <span class="tile-need" hidden></span>
      <button type="button" class="tile-link more" aria-label="Details for ${esc(s.name)}">Details</button>
    </div>`;
  }

  function matches(s) {
    if (filt.kind !== 'all' && KIND_FILTER[s.kind] !== filt.kind) return false;
    if (filt.source !== 'all' && (filt.source === 'darktable' ? !s.in_base : s.in_base || s.source !== filt.source)) return false;
    if (filt.hideApprox && s.approximate) return false;
    if (filt.q) {
      const hay = `${s.name} ${s.brand} ${s.model} ${s.stock} ${KIND_NAME[s.kind]} ${s.origin}`.toLowerCase();
      if (!filt.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }

  function shown() { return cat.stocks.filter(matches); }

  function renderGroups() {
    const list = shown();
    const host = $('#groups');
    if (!list.length) {
      host.innerHTML = `<p class="empty">No stocks match “${esc(filt.q || 'these filters')}”. Clear the search or pick another kind.</p>`;
      return;
    }
    host.innerHTML = KINDS.map(([k, label]) => {
      const items = list.filter(s => s.kind === k);
      if (!items.length) return '';
      return `<div class="shelf-label" role="heading" aria-level="3"><span>${esc(label)} <span class="n">${items.length}</span></span>
          <button type="button" class="link-btn" data-group="${k}">Select all</button></div>
        ${items.map(tileHTML).join('')}`;
    }).join('');
    Covers.fit(host);
    paintStates();
  }

  function paintStates() {
    const { all, need } = included();
    document.querySelectorAll('.shelf-tile').forEach(t => {
      const id = t.dataset.id;
      const on = picked.has(id);
      const req = !on && need.has(id);
      if (on || req) t.dataset.checked = ''; else delete t.dataset.checked;
      t.classList.toggle('required', req);
      const box = t.querySelector('.tile-check');
      box.checked = on || req;
      box.indeterminate = req;
      const n = t.querySelector('.tile-need');
      if (need.has(id)) {
        const films = need.get(id);
        n.hidden = false;
        n.textContent = req
          ? `Added for ${films.length === 1 ? films[0].name : plural(films.length, 'film', 'films')}`
          : `Used by ${films.length === 1 ? films[0].name : plural(films.length, 'selected film', 'selected films')}`;
      } else n.hidden = true;
    });
    $('#sel-count').textContent = all.size;
    $('#all-count').textContent = cat.stocks.length;
    paintTray(all, need);
    paintSegs();
  }

  function paintTray(all, need) {
    const films = [...all].filter(id => byId.get(id).stage === 'filming');
    const prints = all.size - films.length;
    const autoN = [...need.keys()].filter(p => !picked.has(p)).length;
    const btn = $('#download');
    if (!films.length) {
      $('#tray-count').textContent = 'Select at least one film';
      $('#tray-detail').textContent = 'Papers alone make an empty pack.';
      btn.disabled = true;
    } else {
      $('#tray-count').textContent = `${plural(films.length, 'film', 'films')} and ${plural(prints, 'print stock', 'print stocks')}`;
      const size = sizeOf(all);
      const tables = upsamplingKnown() ? `, ${declared().map(tableName).join(' + ')}` : '';
      $('#tray-detail').textContent = `${mb(size)} unzipped${tables}` + (autoN ? `, ${plural(autoN, 'paper', 'papers')} added for your films` : '');
      btn.disabled = false;
    }
    paintRcLine(films.length ? packHash([...all]) : null);
    const missingBase = cat.stocks.filter(s => s.in_base && !all.has(s.stock));
    const w = $('#tray-warn');
    if (missingBase.length && films.length) {
      w.hidden = false;
      const it = missingBase.length === 1 ? 'it' : 'them';
      w.textContent = `Leaves out ${missingBase.length} of darktable’s own stocks. Edits that use ${it} need ${it} in the pack.`;
    } else w.hidden = true;
  }

  function sizeOf(ids) {
    let n = cat.shared_files['pack.json'].size;
    tablesOn().forEach(t => { n += t.size; });
    ids.forEach(id => { n += byId.get(id).size; });
    return n;
  }

  function paintSegs() {
    const count = k => cat.stocks.filter(s => k === 'all' || KIND_FILTER[s.kind] === k).length;
    $('#kind-segs').innerHTML = FILTER_KINDS.map(([k, label]) =>
      `<button type="button" class="seg" data-kind="${k}" aria-pressed="${filt.kind === k}" title="${count(k)} stocks">${esc(label)}</button>`).join('');
    const sources = [['all', 'Every source'], ['darktable', 'darktable’s pack'],
      ...cat.sources.filter(s => s.role === 'extension').map(s => [s.name, `Added from ${s.name}`])];
    $('#source-segs').innerHTML = sources.map(([k, label]) =>
      `<button type="button" class="seg" data-source="${esc(k)}" aria-pressed="${filt.source === k}">${esc(label)}</button>`).join('');
    $('#scheme-segs').innerHTML = SCHEMES.map(([k, label]) =>
      `<button type="button" class="seg" data-scheme="${k}" aria-pressed="${scheme === k}">${esc(label)}</button>`).join('');
  }

  function renderLede() {
    const films = cat.stocks.filter(s => s.stage === 'filming');
    const nFilm = films.length;
    const ext = cat.sources.filter(s => s.role === 'extension').map(s => s.name);
    $('#lede').textContent = `${nFilm} films and ${cat.stocks.length - nFilm} print stocks from darktable${ext.length ? ' and ' + ext.join(' and ') : ''}, pulled from git every night. Pick the stocks and the spectral upsampling tables you want and download a pack darktable’s spektrafilm module reads as it is.`;
  }

  function renderSources() {
    const built = new Date(cat.built_at);
    const days = (Date.now() - built) / 864e5;
    const badge = $('#sync-badge');
    badge.textContent = `Synced ${built.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    badge.classList.toggle('stale', days > 3);
    badge.title = days > 3 ? 'The last nightly sync is more than three days old; see the build log.' : 'Last nightly sync';
    $('#source-list').innerHTML = cat.sources.map(s => {
      const url = s.repo.replace(/\.git$/, '');
      const skipped = (s.skipped || []).length
        ? `<p>${plural(s.skipped.length, 'profile', 'profiles')} skipped: ${s.skipped.map(x => esc(x.stock)).join(', ')}.</p>` : '';
      return `<div class="src"><h3>${esc(s.name)}</h3>
        <p>${s.role === 'base' ? `darktable’s data pack <code>${esc(s.pack)}</code>, ${plural(s.profiles, 'profile', 'profiles')}.` : `${plural(s.profiles, 'stock', 'stocks')} added to darktable’s pack.`}</p>
        <a href="${esc(url)}">${esc(url.replace('https://', ''))}</a>
        <p>Commit <a href="${esc(url)}/commit/${esc(s.commit)}"><code>${esc(s.commit.slice(0, 8))}</code></a>, ${esc(new Date(s.date).toLocaleDateString())}: ${esc(s.subject)}</p>
        ${skipped}</div>`;
    }).join('') + `<div class="src"><h3>This build</h3>
        <p>Pack format ${esc(cat.pack_format)}, spektrafilm ${esc(cat.spektrafilm_version)}${cat.base_pack_hash ? `, base pack <code>${esc(cat.base_pack_hash)}</code>` : ''}, spectral ${(cat.tables || []).length > 1 ? 'tables' : 'table'} ${(cat.tables || []).map(t => `<code>${esc(t.lut_hash || '?')}</code>${t.identifier ? ' ' + esc(t.identifier) : ''}`).join(', ')}. Built ${esc(built.toLocaleString())}.</p>
        <p><a href="${DATA}build-log.txt">Build log</a>, <a href="${DATA}catalog.json">catalogue JSON</a></p></div>
      <div class="src"><h3>Licences</h3>
        <p>${cat.licenses.map(l => `<a href="${DATA}pack/${esc(l)}">${esc(l.replace(/^licenses\//, ''))}</a>`).join('<br>')}</p></div>`;
  }

  /* ----------------------------------------------------------------- detail */
  const CH = { rgb: ['var(--r)', 'var(--g)', 'var(--b)'], dye: ['#21a6b8', '#c4388f', '#d4b012'] };

  function chart(title, xs, series, xLabel, yLabel, colours, labels, highlight) {
    // drop identical series (B&W profiles carry one layer three times)
    const keep = series.map((s, i) => i).filter(i => !series.slice(0, i).some(o => JSON.stringify(o) === JSON.stringify(series[i])));
    const W = 320, H = 190, L = 34, R = 8, T = 8, B = 30;
    const pts = [];
    keep.forEach(i => series[i].forEach((y, j) => { if (y != null && xs[j] != null) pts.push([xs[j], y]); }));
    if (!pts.length) return '';
    const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0]));
    let y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
    if (y1 - y0 < 1e-6) { y1 += 1; y0 -= 1; }
    const sx = x => L + (x - x0) / (x1 - x0) * (W - L - R);
    const sy = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    const ticks = (a, b, n) => { const step = Math.pow(10, Math.floor(Math.log10((b - a) / n))); const m = [1, 2, 5, 10].find(k => (b - a) / (k * step) <= n) * step; const out = []; for (let v = Math.ceil(a / m) * m; v <= b + 1e-9; v += m) out.push(+v.toFixed(6)); return out; };
    const grid = ticks(x0, x1, 5).map(v => `<line class="ax" x1="${sx(v)}" x2="${sx(v)}" y1="${T}" y2="${H - B}" opacity=".5"/><text x="${sx(v)}" y="${H - B + 13}" text-anchor="middle">${v}</text>`).join('')
      + ticks(y0, y1, 4).map(v => `<line class="ax" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" opacity=".5"/><text x="${L - 5}" y="${sy(v) + 3}" text-anchor="end">${v}</text>`).join('');
    const lines = keep.map(i => {
      let d = '', pen = false;
      series[i].forEach((y, j) => {
        if (y == null || xs[j] == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${sx(xs[j]).toFixed(1)},${sy(y).toFixed(1)}`; pen = true;
      });
      const c = keep.length === 1 ? 'var(--ink)' : colours[i % colours.length];
      const dim = highlight != null && i !== highlight;
      return `<path class="ln" d="${d}" stroke="${c}" ${dim ? 'opacity=".35" stroke-width="1.2"' : ''}/>`;
    }).join('');
    const legend = keep.length > 1 ? `<div class="legend">${keep.map(i => `<span><i style="background:${colours[i % colours.length]}${highlight != null && i !== highlight ? ';opacity:.35' : ''}"></i>${esc(labels[i])}${highlight === i ? ' (shown in strip)' : ''}</span>`).join('')}</div>` : '';
    return `<figure class="chart" style="margin:0"><h3>${esc(title)}</h3>${legend}
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${lines}
      <text x="${(L + W - R) / 2}" y="${H - 3}" text-anchor="middle">${esc(xLabel)}</text>
      <text x="10" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 10 ${(T + H - B) / 2})">${esc(yLabel)}</text></svg></figure>`;
  }

  async function openDetail(id) {
    const s = byId.get(id);
    const dlg = $('#detail');
    const body = $('#d-body');
    body.innerHTML = `<div class="d-title"><span class="b">${esc(s.brand)}</span><h2 id="d-title">${esc(s.model)}</h2></div><p class="empty">Loading curves…</p>`;
    if (!dlg.open) dlg.showModal();
    let d;
    try {
      const r = await fetch(`${DATA}stocks/${encodeURIComponent(id)}.json`);
      if (!r.ok) throw new Error(r.status);
      d = await r.json();
    } catch (e) {
      body.querySelector('.empty').textContent = `The curves for ${s.name} did not load (${e.message}). Check your connection and open the details again.`;
      return;
    }
    const paper = s.paper ? byId.get(s.paper) : null;
    const dev = d.curve_labels.length > 1 && /min$/.test(d.curve_labels[0]);
    const facts = [
      ['Kind', KIND_NAME[s.kind] + (s.use === 'cine' && s.stage === 'filming' ? ', motion picture' : '')],
      ['Name in darktable', s.dt_name],
      s.stage === 'filming' ? ['Paper', paper ? `${paper.name}${s.target_print ? '' : ' (darktable’s automatic choice)'}` : '—'] : null,
      ['Balanced for', s.reference_illuminant],
      ['Anti-halation', s.antihalation || '—'],
      ['Source', s.in_base ? 'darktable’s data pack' : `Added from ${s.source}`],
      ['Profile by', { spektrafilm: 'spektrafilm (Andrea Volpato)', Fotufilm: 'Fotufilm (MUAStudio), converted by Negs', Negs: 'Negs (Noah Haasis)' }[s.origin] || s.origin],
      ['Measured from', s.approximate || s.manufacturer_data === false || d.metadata.approximate ? 'Fitted, not transcribed from a manufacturer datasheet' : 'Datasheets and publications'],
      ['File', `<a href="${DATA}pack/${esc(s.file)}" download>${esc(s.file)}</a>, ${(s.size / 1024).toFixed(0)} KB`],
      ['In the catalogue since', new Date(s.first_seen).toLocaleDateString()],
    ].filter(Boolean);
    const curveCols = dev ? d.curve_labels.map((_, i) => `hsl(${210 + i * 30} 25% ${40 + i * 6}%)`) : CH.rgb;
    const on = picked.has(id);
    body.innerHTML = `
      <div class="d-title"><span class="b">${esc(s.brand)}</span><h2 id="d-title">${esc(s.model)}</h2></div>
      <div class="d-strip">${stripHTML(s, { label: `Step wedge of ${s.name}` })}
        <p class="cap">Neutral steps from log exposure ${s.wedge_log_exposure[0]} to ${s.wedge_log_exposure[s.wedge_log_exposure.length - 1]}, as the developed ${s.stage === 'printing' ? 'stock looks under its viewing light' : 'film looks on a light table'}.</p></div>
      <div class="d-actions">
        <button type="button" class="btn ${on ? '' : 'btn-primary'}" id="d-toggle">${on ? 'Remove from pack' : 'Add to pack'}</button>
      </div>
      <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'File' ? v : esc(v)}</dd>`).join('')}</dl>
      <div class="charts">
        ${chart('Characteristic curves', d.log_exposure, d.density_curves, 'log exposure', 'density', curveCols, d.curve_labels, dev ? d.dev_default : null)}
        ${chart('Spectral sensitivity', d.wavelengths, d.log_sensitivity, 'wavelength, nm', 'log sensitivity', CH.rgb, ['Red layer', 'Green layer', 'Blue layer'])}
        ${chart('Dye density', d.wavelengths, d.channel_density, 'wavelength, nm', 'density', CH.dye, ['Cyan dye', 'Magenta dye', 'Yellow dye'])}
      </div>
      <p class="lic">${esc(d.metadata.copyright || '')} ${esc(d.metadata.license || '')}</p>`;
    $('#d-toggle').addEventListener('click', () => { toggle(id); openDetail(id); });
  }

  /* ------------------------------------------------------- spectral tables */
  const tablesOn = () => (cat.tables || []).filter(t => up.include.has(t.file));
  // the tables the pack declares, the one new edits start with first
  const declared = () => tablesOn().sort((a, b) => (b.file === up.def) - (a.file === up.def));
  const upsamplingKnown = () => (cat.tables || []).some(t => t.identifier);
  const tableName = t => t.identifier || 'spectral table';

  function renderTables() {
    const sec = $('#upsampling');
    if (!upsamplingKnown()) { sec.hidden = true; return; }
    sec.hidden = false;
    const first = cat.tables[0];
    $('#tables').innerHTML = cat.tables.map(t => {
      const on = up.include.has(t.file), def = up.def === t.file;
      const what = t.kind === 'reflectance'
        ? `Reflectance table, recovered under ${esc(t.scene_illuminant || 'its scene illuminant')}.${/beta/i.test(t.identifier) ? ' A beta: it renders differently, not better.' : ''}`
        : `Irradiance table.${t === first ? ' The one every edit so far was made with.' : ''}`;
      return `<div class="module" data-file="${esc(t.file)}">
        <label class="module-main"><input type="checkbox" data-include ${on ? 'checked' : ''} ${on && up.include.size === 1 ? 'disabled' : ''}>
          <span class="module-text"><span class="module-name">${esc(tableName(t))}</span>
          <span class="module-description">${what} <code>${esc(t.file)}</code>, ${mb(t.size)}, table hash <code>${esc(t.lut_hash || '?')}</code>.</span></span></label>
        <label class="module-default"><input type="radio" name="table-default" data-default ${def ? 'checked' : ''}> New edits start with it</label>
      </div>`;
    }).join('');
    const w = $('#tables-warn');
    const msgs = [];
    if (up.def !== first.file) msgs.push(`New edits start with ${tableName(cat.tables.find(t => t.file === up.def))}. Edits that never chose a table render with it too, and darktable warns that they were developed with a different one.`);
    const out = cat.tables.filter(t => !up.include.has(t.file));
    if (out.length) msgs.push(`Leaves out ${out.map(tableName).join(' and ')}. Edits that use it ask darktable to fetch a pack that carries it.`);
    w.hidden = !msgs.length;
    w.textContent = msgs.join(' ');
  }

  function setTable(file, include, makeDefault) {
    if (include) up.include.add(file);
    else if (up.include.size > 1) up.include.delete(file);
    if (makeDefault) { up.include.add(file); up.def = file; }
    if (!up.include.has(up.def)) up.def = declared()[0].file;
    save(); renderTables(); paintStates();
  }

  /* pack_hash of the pack a download builds, by the recipe of darktable-spektrafilm's
     tools/spektrafilm_export_data.py: FNV-1a over the pack format, spektrafilm
     version and model constants (cat.pack_hash_seed, precomputed by build.py), one
     line per declared table, and one line per profile with the FNV-1a of its file */
  function fnv(str, h) {
    const bytes = new TextEncoder().encode(str);
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619) >>> 0;
    return h >>> 0;
  }
  const hex8 = n => n.toString(16).padStart(8, '0');

  function packHash(ids) {
    if (!cat.pack_hash_seed) return null;
    let h = parseInt(cat.pack_hash_seed, 16) >>> 0;
    declared().forEach(t => { h = fnv(`\ntable=${t.decl.identifier}:${t.decl.kind}:${t.decl.file}`, h); });
    ids.map(id => byId.get(id)).map(s => [s.file.replace(/^profiles\//, ''), s.fnv]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .forEach(([name, f]) => { h = fnv(`\nprofile=${name}:${f}`, h); });
    return hex8(h);
  }

  const RC_KEY = 'plugins/darkroom/spektrafilm/default_pack';
  function paintRcLine(hash) {
    const box = $('#rc');
    box.hidden = !hash;
    $('#rc-none').hidden = !!hash || !cat.pack_hash_seed;
    if (!cat.pack_hash_seed) $('#rc').closest('li').hidden = true;
    if (hash) $('#rc-line').textContent = `${RC_KEY}=${hash}`;
  }

  /* pack.json as the download carries it: the tables chosen, the default first and
     flagged, and the pack's own pack_hash. Everything else stays byte for byte */
  function packJson(raw, hash) {
    if (!upsamplingKnown()) return raw;
    const kv = /^\{"[^"]*": /.test(raw) ? [', ', ': '] : [',', ':'];
    const obj = o => '{' + Object.entries(o).map(([k, v]) => JSON.stringify(k) + kv[1] + JSON.stringify(v)).join(kv[0]) + '}';
    const decl = declared().map(t => {
      const d = { ...t.decl };
      delete d.default;
      if (t.file === up.def) d.default = true;
      return d;
    });
    let out = raw;
    const key = '"spectral_upsampling"' + kv[1] + '[';
    const a = out.indexOf(key);
    if (a < 0) throw new Error('pack.json declares no spectral_upsampling tables');
    const b = out.indexOf(']', a + key.length);
    out = out.slice(0, a + key.length - 1) + '[' + decl.map(obj).join(kv[0]) + out.slice(b);
    if (hash) {
      const m = out.match(/"pack_hash"\s*:\s*"[0-9a-f]{8}"/);
      if (!m) throw new Error('pack.json carries no pack_hash');
      out = out.replace(m[0], `"pack_hash"${kv[1]}"${hash}"`);
    }
    return out;
  }

  /* --------------------------------------------------------------- download */
  async function download() {
    const { all } = included();
    const ids = [...all].sort();
    const hash = packHash(ids);
    const btn = $('#download');
    const bar = $('#tray-progress');
    const fill = bar.querySelector('span');
    // the folder darktable keeps a downloaded pack in: its pack_hash, or its default table's hash
    const dir = hash || declared()[0].lut_hash;
    const files = [
      'pack.json',
      ...tablesOn().map(t => t.file),
      ...ids.map(id => byId.get(id).file),
    ];
    btn.disabled = true; bar.hidden = false;
    const out = { 'pack.json': null, profiles: {} };
    let done = 0;
    const setP = (f, label) => { fill.style.width = (f * 100).toFixed(1) + '%'; btn.textContent = label; };
    try {
      const queue = files.slice();
      const worker = async () => {
        while (queue.length) {
          const src = queue.shift();
          const r = await fetch(`${DATA}pack/${src}`, { cache: 'no-cache' });
          if (!r.ok) throw new Error(`${src} answered ${r.status}`);
          const entry = [new Uint8Array(await r.arrayBuffer()), { level: src.endsWith('.f32') ? 1 : 6 }];
          if (src.startsWith('profiles/')) out.profiles[src.slice(9)] = entry;
          else out[src] = entry;
          done++; setP(done / files.length * 0.85, `Fetching ${done} of ${files.length}`);
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      out['pack.json'][0] = fflate.strToU8(packJson(fflate.strFromU8(out['pack.json'][0]), hash));
      setP(0.9, 'Zipping');
      const zipped = await new Promise((res, rej) => fflate.zip({ [dir]: out }, { level: 6 }, (err, data) => err ? rej(err) : res(data)));
      const blob = new Blob([zipped], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${dir}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      setP(1, 'Downloaded');
      toast(`Downloaded ${a.download} (${mb(blob.size)}). Unzip it into darktable’s spektrafilm/packs folder${hash ? `, set default_pack=${hash}` : ''} and restart darktable.`);
    } catch (e) {
      toast(`The pack was not built: ${e.message}. Reload the page and try again; if it keeps failing, the site may be mid-update.`);
      btn.textContent = 'Download pack';
    } finally {
      setTimeout(() => { bar.hidden = true; fill.style.width = '0'; btn.textContent = 'Download pack'; btn.disabled = false; paintStates(); }, 1600);
    }
  }

  /* ------------------------------------------------------------------ misc */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5200);
  }

  function wire() {
    $('#groups').addEventListener('click', e => {
      const tile = e.target.closest('.shelf-tile');
      const g = e.target.closest('[data-group]');
      if (g) {
        cat.stocks.filter(s => s.kind === g.dataset.group && matches(s)).forEach(s => picked.add(s.stock));
        save(); paintStates(); return;
      }
      if (!tile) return;
      // the checkbox toggles through its change event; Details opens the dialog;
      // a click anywhere else on the card toggles the stock
      if (e.target.closest('.more')) openDetail(tile.dataset.id);
      else if (!e.target.closest('.tile-check')) toggle(tile.dataset.id);
    });
    $('#groups').addEventListener('change', e => {
      const tile = e.target.closest('.shelf-tile');
      if (tile && e.target.matches('.tile-check')) toggle(tile.dataset.id);
    });
    $('#kind-segs').addEventListener('click', e => {
      const b = e.target.closest('[data-kind]'); if (!b) return;
      filt.kind = b.dataset.kind; renderGroups();
    });
    $('#source-segs').addEventListener('click', e => {
      const b = e.target.closest('[data-source]'); if (!b) return;
      filt.source = b.dataset.source; renderGroups();
    });
    $('#scheme-segs').addEventListener('click', e => {
      const b = e.target.closest('[data-scheme]'); if (!b) return;
      scheme = b.dataset.scheme; save(); renderGroups();
    });
    let qt;
    $('#q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { filt.q = e.target.value.trim(); renderGroups(); }, 120); });
    $('#hide-approx').addEventListener('change', e => { filt.hideApprox = e.target.checked; renderGroups(); });
    $('#sel-shown').addEventListener('click', () => { shown().forEach(s => picked.add(s.stock)); save(); paintStates(); });
    $('#clear-shown').addEventListener('click', () => { shown().forEach(s => picked.delete(s.stock)); save(); paintStates(); });
    $('#sel-dt').addEventListener('click', () => {
      picked.clear(); cat.stocks.filter(s => s.in_base).forEach(s => picked.add(s.stock)); save(); paintStates();
      toast('Selected the stocks in darktable’s own pack.');
    });
    $('#copy-link').addEventListener('click', async () => {
      const ids = [...picked];
      const all = ids.length === cat.stocks.length;
      let url = `${location.origin}${location.pathname}?pick=${all ? 'all' : ids.sort().join(',')}`;
      const def = (cat.tables || []).find(t => t.file === up.def);
      if (upsamplingKnown() && def) url += `&table=${encodeURIComponent(def.identifier)}${up.include.size === 1 ? '&only=1' : ''}`;
      try { await navigator.clipboard.writeText(url); toast('Link copied. It opens the Spektrafilm Pack Creator with this selection.'); }
      catch (_) { prompt('Copy this link:', url); }
    });
    $('#download').addEventListener('click', download);
    $('#tables').addEventListener('change', e => {
      const row = e.target.closest('.module'); if (!row) return;
      if (e.target.matches('[data-include]')) setTable(row.dataset.file, e.target.checked, false);
      else if (e.target.matches('[data-default]')) setTable(row.dataset.file, true, true);
    });
    $('#rc-copy').addEventListener('click', async () => {
      const line = $('#rc-line').textContent;
      try { await navigator.clipboard.writeText(line); toast('Copied. Paste it into darktablerc while darktable is closed.'); }
      catch (_) { prompt('Copy this line:', line); }
    });
    $('#detail').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
    document.querySelectorAll('.os-tabs [role=tab]').forEach(tab => tab.addEventListener('click', () => {
      document.querySelectorAll('.os-tabs [role=tab]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
      document.querySelectorAll('.os-path').forEach(c => { c.textContent = c.dataset[tab.dataset.os]; });
    }));
    // keep the tray out of the way while the hero's own buttons are on screen
    const tray = $('#tray');
    tray.classList.add('away');
    new IntersectionObserver(([e]) => tray.classList.toggle('away', e.isIntersecting))
      .observe($('.hero-actions'));
    if (/Win/.test(navigator.platform)) $('#tab-win').click();
    else if (/Mac/.test(navigator.platform)) $('#tab-mac').click();
  }

  async function init() {
    wire();
    try {
      const r = await fetch(`${DATA}catalog.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`catalog.json answered ${r.status}`);
      cat = await r.json();
    } catch (e) {
      $('#groups').innerHTML = `<p class="empty">The catalogue did not load (${esc(e.message)}). If you are running this from a checkout, run <code>python3 tools/build.py</code> first, then serve the <code>site</code> folder.</p>`;
      $('#sync-badge').textContent = 'Not synced';
      return;
    }
    byId = new Map(cat.stocks.map(s => [s.stock, s]));
    baseline = cat.stocks.map(s => s.first_seen).sort()[0];
    restore();
    renderLede();
    renderSources();
    renderTables();
    renderGroups();
  }

  init();
})();
