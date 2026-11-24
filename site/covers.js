/* Film box covers for the stock tiles.

   Ported from GRKit (https://github.com/ahonn/grkit, web/src/coverPalette.ts and
   web/src/components/EffectIcon.tsx at c0ddbfbf), MIT License, Copyright (c) 2026 ahonn.
   The full licence text is in vendor/grkit-LICENSE.txt.

   A cover is { template, brand, name, number, band }. `box` has a top brand band,
   `cine` a top band and three bottom stripes, `stack` a bottom brand band. Colours are
   curated inks combined into named looks; a stock gets the look its name or brand matches,
   or the gray look. */
(() => {
  'use strict';

  const INKS = {
    white: [255, 255, 255], portraCream: [232, 212, 176], goldText: [255, 220, 120],
    silver: [236, 236, 236], gray: [214, 214, 214], steel: [168, 168, 176], mist: [200, 200, 200],
    ash: [64, 64, 64], charcoal: [48, 48, 48], classicBrand: [40, 40, 40], classicBody: [51, 51, 51],
    graphite: [36, 36, 36], black: [20, 20, 20], ink: [16, 16, 16],
    kodakYellow: [242, 196, 24], kodakRed: [196, 24, 24], ektarRed: [220, 48, 32],
    orange: [240, 112, 48], agfaOrange: [224, 96, 32], vistaOrange: [232, 120, 40], amber: [242, 168, 64],
    portraBrown: [96, 56, 40], portraAccent: [212, 168, 120], brown: [40, 24, 16],
    purple: [96, 40, 128], violet: [120, 72, 168],
    chromeBlue: [32, 140, 196], teal: [24, 96, 120], blueAccent: [64, 144, 200],
    velviaGreen: [8, 88, 64], fujiGreen: [28, 120, 64], superiaGreen: [36, 160, 64],
    chartreuse: [180, 200, 48], forest: [20, 96, 56], pine: [16, 88, 72], eternaGreen: [16, 56, 40],
    sage: [120, 168, 136], sageDark: [40, 48, 40], mint: [160, 200, 184], moss: [200, 240, 208],
    greenDark: [28, 64, 28], eternaAccent: [120, 140, 120], pink: [255, 120, 160], rose: [216, 152, 160],
  };

  const LOOKS = {
    gray: { band: 'gray', brand: 'classicBrand', body: 'classicBody', text: 'white', accent: 'gray' },
    kodak: { band: 'kodakYellow', brand: 'kodakRed', body: 'black', text: 'white', accent: 'kodakYellow' },
    gold: { band: 'kodakYellow', brand: 'kodakRed', body: 'black', text: 'white', accent: 'kodakRed' },
    ultramax: { band: 'purple', brand: 'white', body: 'black', text: 'white', accent: 'kodakYellow' },
    ektar: { band: 'orange', brand: 'white', body: 'black', text: 'white', accent: 'ektarRed' },
    ektachrome: { band: 'chromeBlue', brand: 'white', body: 'black', text: 'white', accent: 'kodakYellow' },
    kodachrome: { band: 'kodakRed', brand: 'white', body: 'black', text: 'white', accent: 'kodakYellow' },
    aerocolor: { band: 'charcoal', brand: 'kodakYellow', body: 'black', text: 'white', accent: 'kodakRed' },
    portra: { band: 'portraCream', brand: 'portraBrown', body: 'black', text: 'white', accent: 'portraAccent' },
    trix: { band: 'kodakYellow', brand: 'black', body: 'black', text: 'white', accent: 'kodakRed' },
    tmax: { band: 'steel', brand: 'ink', body: 'black', text: 'white', accent: 'kodakYellow' },
    doublex: { band: 'charcoal', brand: 'kodakYellow', body: 'black', text: 'white', accent: 'mist' },
    vision: { band: 'charcoal', brand: 'kodakYellow', body: 'black', text: 'white', accent: 'kodakYellow' },
    velvia: { band: 'velviaGreen', brand: 'white', body: 'black', text: 'white', accent: 'ektarRed' },
    provia: { band: 'teal', brand: 'white', body: 'black', text: 'white', accent: 'blueAccent' },
    astia: { band: 'sage', brand: 'sageDark', body: 'black', text: 'white', accent: 'rose' },
    superia: { band: 'superiaGreen', brand: 'white', body: 'black', text: 'white', accent: 'kodakYellow' },
    c200: { band: 'chartreuse', brand: 'greenDark', body: 'black', text: 'white', accent: 'fujiGreen' },
    pro: { band: 'forest', brand: 'white', body: 'black', text: 'white', accent: 'mint' },
    nps: { band: 'pine', brand: 'white', body: 'black', text: 'white', accent: 'mint' },
    acros: { band: 'ash', brand: 'white', body: 'black', text: 'white', accent: 'fujiGreen' },
    eterna: { band: 'eternaGreen', brand: 'moss', body: 'black', text: 'white', accent: 'eternaAccent' },
    hp5: { band: 'ash', brand: 'white', body: 'black', text: 'white', accent: 'kodakYellow' },
    delta: { band: 'silver', brand: 'ink', body: 'black', text: 'white', accent: 'kodakYellow' },
    xp2: { band: 'violet', brand: 'white', body: 'black', text: 'white', accent: 'kodakYellow' },
    precisa: { band: 'agfaOrange', brand: 'white', body: 'black', text: 'white', accent: 'ektarRed' },
    vista: { band: 'vistaOrange', brand: 'brown', body: 'black', text: 'white', accent: 'amber' },
    cinema: { band: 'ash', brand: 'mist', body: 'ink', text: 'white', accent: 'steel' },
    fuji: { band: 'fujiGreen', brand: 'white', body: 'black', text: 'white', accent: 'fujiGreen' },
    ilford: { band: 'ink', brand: 'white', body: 'black', text: 'white', accent: 'kodakYellow' },
    agfa: { band: 'agfaOrange', brand: 'white', body: 'black', text: 'white', accent: 'ektarRed' },
  };

  const STOCK_LOOKS = [
    [/PORTRA/, 'portra'], [/GOLD/, 'gold'], [/ULTRAMAX/, 'ultramax'], [/EKTAR/, 'ektar'],
    [/EKTACHROME/, 'ektachrome'], [/KODACHROME/, 'kodachrome'], [/AEROCOLOR/, 'aerocolor'],
    [/TRI-?X/, 'trix'], [/T-?MAX/, 'tmax'], [/DOUBLE-?X|5222/, 'doublex'], [/VISION|5207|5219/, 'vision'],
    [/VELVIA/, 'velvia'], [/PROVIA/, 'provia'], [/ASTIA/, 'astia'], [/SUPERIA/, 'superia'],
    [/FUJICOLOR|C200/, 'c200'], [/160C/, 'nps'], [/\bPRO\b|400H/, 'pro'], [/ACROS|NEOPAN/, 'acros'],
    [/ETERNA|8573/, 'eterna'], [/HP5/, 'hp5'], [/DELTA/, 'delta'], [/XP2/, 'xp2'],
    [/PRECISA/, 'precisa'], [/VISTA/, 'vista'],
  ];
  const BRAND_LOOKS = [[/kodak|eastman/i, 'kodak'], [/fuji/i, 'fuji'], [/ilford|harman/i, 'ilford'], [/agfa/i, 'agfa']];

  function lookOf(cover) {
    const label = `${cover.name} ${cover.number} ${cover.brand}`.toUpperCase();
    for (const [re, look] of STOCK_LOOKS) if (re.test(label)) return look;
    if (cover.template === 'cine') return 'cinema';
    for (const [re, look] of BRAND_LOOKS) if (re.test(cover.brand)) return look;
    return 'gray';
  }

  function colours(cover) {
    const slots = LOOKS[lookOf(cover)];
    const c = {};
    for (const k of Object.keys(slots)) c[k] = `rgb(${INKS[slots[k]].join(' ')})`;
    return c;
  }

  const FILLER = [/\bProfessional\b/gi, /\bNegative Film\b/gi, /\bReversal Film\b/gi];

  /* brand, name and number of a catalogue stock as they read on its box */
  function coverOf(s) {
    let model = s.model;
    const push = model.match(/\(Push (\d+)\)/i);
    model = model.replace(/\([^)]*\)/g, ' ');
    FILLER.forEach(re => { model = model.replace(re, ' '); });
    const words = model.trim().split(/\s+/).filter(Boolean);
    let at = -1;
    for (let i = words.length - 1; i >= 0; i--) if (/^\d{2,}[A-Z]{0,2}$/i.test(words[i])) { at = i; break; }
    const number = at >= 0 ? words[at].toUpperCase() : '';
    const rest = words.filter((_, i) => i !== at);
    let name = (rest.length ? rest : words).join(' ').toUpperCase();
    if (!rest.length && number) name = '';
    if (push) name = `${name} +${push[1]}`.trim();
    const cine = s.use === 'cine' && s.kind !== 'bw';
    return {
      template: s.kind === 'paper' ? 'stack' : cine ? 'cine' : 'box',
      brand: /^kodak$/i.test(s.brand) ? 'Kodak' : s.brand.toUpperCase(),
      name: name || number,
      number: name ? number : '',
      band: !cine && s.kind !== 'paper' && s.channel_model !== 'bw',
    };
  }

  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const text = (cls, x, y, width, fill, value, extra = '') =>
    `<text class="${cls}" x="${x}" y="${y}" data-width="${width}"${extra} fill="${fill}">${esc(value)}</text>`;

  function svg(cover) {
    const c = colours(cover);
    let body;
    if (cover.template === 'stack') {
      const footer = 28, center = (3 + footer) / 2;
      body = `<rect x="0" y="3" width="40" height="34" fill="${c.body}"/>
        <rect x="0" y="${footer}" width="40" height="${37 - footer}" fill="${c.band}"/>
        ${text('cover-brand', 20, 34.8, 34, c.brand, cover.brand)}
        ${cover.number ? text('cover-name', 20, 13, 38, c.text, cover.name) + text('cover-number', 20, 24.5, 36, c.text, cover.number)
    : text('cover-name-large', 20, center + 4, 38, c.text, cover.name, ` data-center="${center}"`)}`;
    } else {
      const stripes = cover.template === 'cine', band = cover.template === 'box' && cover.band;
      const baseline = stripes ? 30.2 : band ? 32 : 33;
      const center = (12 + (stripes ? 32 : band ? 34 : 37)) / 2;
      body = `<rect x="0" y="3" width="40" height="34" fill="${c.body}"/>
        <rect x="0" y="3" width="40" height="9" fill="${c.band}"/>
        ${band ? `<rect x="0" y="34" width="40" height="3" fill="${c.accent}"/>` : ''}
        ${stripes ? [32, 34, 36].map(y => `<rect x="0" y="${y}" width="40" height="1" fill="${c.accent}"/>`).join('') : ''}
        ${text('cover-brand', 20, 10.4, 34, c.brand, cover.brand)}
        ${cover.number ? text('cover-name', 20, 19, 38, c.text, cover.name) + text('cover-number', 20, baseline, 36, c.text, cover.number)
    : text('cover-name-large', 20, center + 4, 38, c.text, cover.name, ` data-center="${center}"`)}`;
    }
    return `<svg class="cover" viewBox="0 0 40 40" aria-hidden="true">${body}</svg>`;
  }

  /* Text wider than its data-width is compressed; a large name first shrinks down to 5.5
     units and stays centred on its data-center row (capital height 0.7 of the size). */
  function fitOne(t) {
    t.removeAttribute('textLength');
    const width = Number(t.dataset.width);
    if (t.dataset.center) {
      t.style.removeProperty('font-size');
      const base = parseFloat(getComputedStyle(t).fontSize);
      const length = t.getComputedTextLength();
      const size = length > width ? Math.max(5.5, base * width / length) : base;
      t.style.fontSize = `${size}px`;
      t.setAttribute('y', String(Number(t.dataset.center) + size * 0.7 / 2));
    }
    if (t.getComputedTextLength() > width) {
      t.setAttribute('textLength', String(width));
      t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
  }

  function fit(root) {
    const run = () => root.querySelectorAll('svg.cover text').forEach(fitOne);
    run();
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(run);
  }

  window.Covers = { coverOf, svg, fit };
})();
