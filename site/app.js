/* Lightbox: pick spektrafilm stocks and zip them into a darktable pack.
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
  const FILTER_KINDS = [
    ['all', 'All'], ['negative', 'Colour negative'], ['cine', 'Cinema'], ['slide', 'Slide'],
    ['bw', 'Black & white'], ['print', 'Print stocks'],
  ];
  const NEW_DAYS = 21;

  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mb = n => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB';
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  let cat = null;
  let byId = new Map();
  const picked = new Set();
  const filt = { kind: 'all', source: 'all', q: '', hideApprox: false };

  /* ---------------------------------------------------------------- storage */
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        pick: [...picked], known: cat.stocks.map(s => s.stock),
      }));
    } catch (_) { /* private mode: the page still works */ }
  }

  function restore() {
    const url = new URLSearchParams(location.search).get('pick');
    if (url) {
      const ids = url === 'all' ? cat.stocks.map(s => s.stock) : url.split(',');
      ids.filter(id => byId.has(id)).forEach(id => picked.add(id));
      return;
    }
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) { saved = null; }
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
      const tile = document.getElementById('s-' + id);
      if (tile) flash(tile);
    }
    save();
    paintStates();
  }

  // the grease-pencil ring: drawn when a stock is picked, then wiped off
  function flash(tile) {
    const svg = tile.querySelector('.ring');
    const path = svg.querySelector('path');
    const w = svg.clientWidth, h = svg.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    path.setAttribute('d', ringPath(w, h));
    clearTimeout(tile._ringTimer);
    tile.classList.remove('flash', 'fade');
    void path.getBoundingClientRect();
    tile.classList.add('flash');
    tile._ringTimer = setTimeout(() => {
      tile.classList.add('fade');
      tile._ringTimer = setTimeout(() => {
        path.style.transition = 'none';
        tile.classList.remove('flash', 'fade');
        requestAnimationFrame(() => { path.style.transition = ''; });
      }, 450);
    }, 900);
  }

  /* ------------------------------------------------------------- rendering */
  const RING = '<svg class="ring" aria-hidden="true"><path pathLength="1"/></svg>';
  // a hand-drawn loop in percent of the tile, scaled to its pixels so the stroke stays even
  const RING_PTS = [[7, 8], [30, 2.5, 70, 1.5, 95, 5.5], [98.6, 30, 98.8, 70, 94.6, 95], [66, 98.6, 32, 99, 5.5, 94.5],
    [1.8, 70, 1.4, 34, 4, 9], [4.5, 6.5, 9, 4.8, 16, 4]];
  function ringPath(w, h) {
    const pt = (x, y) => `${(x / 100 * w).toFixed(1)},${(y / 100 * h).toFixed(1)}`;
    return RING_PTS.map((c, i) => i === 0 ? `M${pt(c[0], c[1])}`
      : `C${pt(c[0], c[1])} ${pt(c[2], c[3])} ${pt(c[4], c[5])}`).join(' ');
  }
  const TICK = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7"/></svg>';

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
    const tags = [];
    if (isNew(s)) tags.push('<span class="tag new">New</span>');
    tags.push(`<span class="tag">${s.in_base ? 'darktable' : esc(s.source)}</span>`);
    if (s.approximate) tags.push('<span class="tag">Approximate</span>');
    if (/experimental/i.test(s.name)) tags.push('<span class="tag">Experimental</span>');
    if (s.channel_model === 'bw' && s.kind !== 'bw') tags.push('<span class="tag">B&amp;W</span>');
    const model = s.model.replace(/\s*\((experimental)\)\s*/i, ' ').trim();
    return `<article class="tile" data-id="${esc(s.stock)}" id="s-${esc(s.stock)}">
      ${RING}
      <button type="button" class="pick" aria-pressed="false" aria-label="${esc(s.name)}">
        ${stripHTML(s)}
        <span class="label"><span class="b">${esc(s.brand)}</span><span class="m">${esc(model)}</span><span class="box">${TICK}</span></span>
        <span class="tags">${tags.join('')}</span>
        <span class="need" hidden></span>
      </button>
      <button type="button" class="more" aria-label="Details for ${esc(s.name)}">Details</button>
    </article>`;
  }

  function matches(s) {
    if (filt.kind !== 'all') {
      if (filt.kind === 'print' ? s.stage !== 'printing' : s.kind !== filt.kind) return false;
    }
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
      return `<section class="group" aria-label="${esc(label)}">
        <div class="group-head"><h3>${esc(label)}</h3><span class="n">${items.length}</span>
          <button type="button" class="link-btn" data-group="${k}">Select all ${esc(label.toLowerCase())}</button></div>
        <div class="grid">${items.map(tileHTML).join('')}</div></section>`;
    }).join('');
    paintStates();
  }

  function paintStates() {
    const { all, need } = included();
    document.querySelectorAll('.tile').forEach(t => {
      const id = t.dataset.id;
      const on = picked.has(id);
      const req = !on && need.has(id);
      t.classList.toggle('on', on);
      t.classList.toggle('required', req);
      t.querySelector('.pick').setAttribute('aria-pressed', String(on || req));
      const n = t.querySelector('.need');
      if (need.has(id)) {
        const films = need.get(id);
        n.hidden = false;
        n.textContent = req
          ? `Added for ${films.length === 1 ? films[0].name : plural(films.length, 'film', 'films')}`
          : `Used by ${films.length === 1 ? films[0].name : plural(films.length, 'selected film', 'selected films')}`;
      } else n.hidden = true;
    });
    paintTray(all, need);
    paintChips();
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
      $('#tray-detail').textContent = `${mb(size)} unzipped` + (autoN ? `, ${plural(autoN, 'paper', 'papers')} added for your films` : '');
      btn.disabled = false;
    }
    const missingBase = cat.stocks.filter(s => s.in_base && !all.has(s.stock));
    const w = $('#tray-warn');
    if (missingBase.length && films.length) {
      w.hidden = false;
      const it = missingBase.length === 1 ? 'it' : 'them';
      w.textContent = `Leaves out ${missingBase.length} of darktable’s own stocks. Edits that use ${it} need ${it} in the pack.`;
    } else w.hidden = true;
  }

  function sizeOf(ids) {
    let n = cat.shared_files['pack.json'].size + cat.shared_files['spectra_lut.f32'].size;
    ids.forEach(id => { n += byId.get(id).size; });
    return n;
  }

  function paintChips() {
    const count = k => cat.stocks.filter(s => k === 'all' || (k === 'print' ? s.stage === 'printing' : s.kind === k)).length;
    $('#kind-chips').innerHTML = FILTER_KINDS.map(([k, label]) =>
      `<button type="button" class="chip" data-kind="${k}" aria-pressed="${filt.kind === k}">${esc(label)}<span>${count(k)}</span></button>`).join('');
    const sources = [['all', 'Every source'], ['darktable', 'In darktable’s pack'],
      ...cat.sources.filter(s => s.role === 'extension').map(s => [s.name, `Added from ${s.name}`])];
    $('#source-chips').innerHTML = sources.map(([k, label]) =>
      `<button type="button" class="chip" data-source="${esc(k)}" aria-pressed="${filt.source === k}">${esc(label)}</button>`).join('');
  }

  function renderContact() {
    // negatives first: the orange mask is the most recognisable sight on a light table
    const order = KINDS.map(k => k[0]);
    const films = cat.stocks.filter(s => s.stage === 'filming')
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    $('#contact-strip').innerHTML = films.map((s, i) => {
      const grad = `linear-gradient(90deg, ${s.wedge.map((c, j) => `${c} ${Math.round(j / (s.wedge.length - 1) * 100)}%`).join(', ')})`;
      return `<a class="cframe" href="#s-${esc(s.stock)}" style="--rb:${s.rebate};--ep:${s.wedge[s.wedge.length - 1]}" title="${esc(s.name)}">
        <span class="sp"></span><span class="img" style="background:${grad}"></span>
        <span class="ep">${esc(s.brand)} ${esc(s.model)} ${i + 1}</span></a>`;
    }).join('');
    const nFilm = films.length;
    const ext = cat.sources.filter(s => s.role === 'extension').map(s => s.name);
    $('#lede').textContent = `${nFilm} films and ${cat.stocks.length - nFilm} print stocks from darktable${ext.length ? ' and ' + ext.join(' and ') : ''}, pulled from git every night. Pick the stocks you want and download a pack darktable’s spektrafilm module reads as it is.`;
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
        <p>Pack format ${esc(cat.pack_format)}, spektrafilm ${esc(cat.spektrafilm_version)}, spectral table <code>${esc(cat.lut_hash)}</code>. Built ${esc(built.toLocaleString())}.</p>
        <p><a href="${DATA}build-log.txt">Build log</a>, <a href="${DATA}catalog.json">catalogue JSON</a></p></div>`;
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

  /* --------------------------------------------------------------- download */
  async function download() {
    const { all } = included();
    const ids = [...all].sort();
    const btn = $('#download');
    const bar = $('#tray-progress');
    const fill = bar.querySelector('span');
    const files = [
      ['pack.json', 'pack.json'], ['spectra_lut.f32', 'spectra_lut.f32'],
      ...ids.map(id => [byId.get(id).file, byId.get(id).file]),
      ...cat.licenses.map(p => [p, p]),
    ];
    btn.disabled = true; bar.hidden = false;
    const out = {};
    let done = 0;
    const setP = (f, label) => { fill.style.width = (f * 100).toFixed(1) + '%'; btn.textContent = label; };
    try {
      const queue = files.slice();
      const worker = async () => {
        while (queue.length) {
          const [src, dst] = queue.shift();
          const r = await fetch(`${DATA}pack/${src}`, { cache: 'no-cache' });
          if (!r.ok) throw new Error(`${src} answered ${r.status}`);
          out[`spektrafilm/${dst}`] = [new Uint8Array(await r.arrayBuffer()), { level: dst.endsWith('.f32') ? 1 : 6 }];
          done++; setP(done / files.length * 0.85, `Fetching ${done} of ${files.length}`);
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      out['spektrafilm/README.txt'] = fflate.strToU8(readme(ids));
      out['spektrafilm/SHA256SUMS'] = fflate.strToU8(sums(ids));
      setP(0.9, 'Zipping');
      const zipped = await new Promise((res, rej) => fflate.zip(out, { level: 6 }, (err, data) => err ? rej(err) : res(data)));
      const blob = new Blob([zipped], { type: 'application/zip' });
      const a = document.createElement('a');
      const stamp = cat.built_at.slice(0, 10).replace(/-/g, '');
      a.href = URL.createObjectURL(blob);
      a.download = `spektrafilm-pack-${stamp}-${ids.length}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      setP(1, 'Downloaded');
      toast(`Downloaded ${a.download} (${mb(blob.size)}). Unzip it into darktable’s data folder, then restart darktable.`);
    } catch (e) {
      toast(`The pack was not built: ${e.message}. Reload the page and try again; if it keeps failing, the site may be mid-update.`);
      btn.textContent = 'Download pack';
    } finally {
      setTimeout(() => { bar.hidden = true; fill.style.width = '0'; btn.textContent = 'Download pack'; btn.disabled = false; paintStates(); }, 1600);
    }
  }

  function readme(ids) {
    const src = cat.sources.map(s => `  ${s.name}: ${s.repo} @ ${s.commit}${s.pack ? ` (pack ${s.pack})` : ''}`).join('\n');
    const rows = ids.map(id => byId.get(id)).map(s =>
      `- ${s.name} (${s.file})\n    ${s.in_base ? "darktable's pack" : 'added from ' + s.source}; ${s.copyright || 'see profile metadata'}${s.approximate ? '\n    approximate: not transcribed from a manufacturer datasheet' : ''}`).join('\n');
    return `spektrafilm data pack for darktable
===================================

Built by Lightbox on ${new Date().toISOString().slice(0, 10)} from the catalogue of ${cat.built_at}.
${ids.length} stocks, pack format ${cat.pack_format}, spektrafilm ${cat.spektrafilm_version}, spectral table ${cat.lut_hash}.

INSTALL
Unzip so this folder lands at
  Linux, macOS:  ~/.local/share/darktable/spektrafilm/
  Windows:       %LOCALAPPDATA%\\darktable\\spektrafilm\\
Move any pack.json, spectra_lut.f32 and profiles/ already there somewhere safe
first. Leave the packs/ folder alone. Restart darktable. darktable prefers this
hand-installed pack over the packs it downloads; delete pack.json,
spectra_lut.f32 and profiles/ to go back.

SOURCES
${src}

CHANGES (CC BY-SA 4.0 asks that modifications are noted)
darktable's pack was extended with negs_to_darktable_pack.py: profiles darktable
lacks were added from the extension repositories, single-channel B&W profiles
were widened to three channels, log-exposure grids were snapped to the pack's
grid, blackbody illuminants, film render defaults and neutral print filters
were added for the new stocks, and darktable films whose automatic paper would
change were pinned to their previous paper. Profiles not listed below were left
out of this pack. pack.json and spectra_lut.f32 are the merged pack's, unchanged.

STOCKS AND CREDITS
${rows}

LICENCE
The profiles are licensed under CC BY-SA 4.0; full texts and notices are in
licenses/. Credit the authors above, keep the licence and note your changes if
you share or adapt this pack. The spektrafilm author asks that the data is not
resold and not used to train commercial AI models.
`;
  }

  function sums(ids) {
    const lines = Object.entries(cat.shared_files).map(([n, f]) => `${f.sha256}  ${n}`);
    ids.forEach(id => { const s = byId.get(id); lines.push(`${s.sha256}  ${s.file}`); });
    return lines.join('\n') + '\n';
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
      const tile = e.target.closest('.tile');
      const g = e.target.closest('[data-group]');
      if (g) {
        cat.stocks.filter(s => s.kind === g.dataset.group && matches(s)).forEach(s => picked.add(s.stock));
        save(); paintStates(); return;
      }
      if (!tile) return;
      if (e.target.closest('.more')) openDetail(tile.dataset.id);
      else if (e.target.closest('.pick')) toggle(tile.dataset.id);
    });
    $('#kind-chips').addEventListener('click', e => {
      const b = e.target.closest('[data-kind]'); if (!b) return;
      filt.kind = b.dataset.kind; renderGroups();
    });
    $('#source-chips').addEventListener('click', e => {
      const b = e.target.closest('[data-source]'); if (!b) return;
      filt.source = b.dataset.source; renderGroups();
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
      const url = `${location.origin}${location.pathname}?pick=${all ? 'all' : ids.sort().join(',')}`;
      try { await navigator.clipboard.writeText(url); toast('Link copied. It opens Lightbox with this selection.'); }
      catch (_) { prompt('Copy this link:', url); }
    });
    $('#download').addEventListener('click', download);
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
    renderContact();
    renderSources();
    renderGroups();
  }

  init();
})();
