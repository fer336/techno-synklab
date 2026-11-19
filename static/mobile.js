/* SYNK//LAB mobile shell. Builds five screens and keeps them in sync with the mixer (mixer.js) by reading its
   state and by driving the existing desktop controls, so the audio engine is never duplicated. Active at <= 770px. */
(function () {
  'use strict';
  if (typeof djDecks === 'undefined' || typeof tracks === 'undefined' || typeof djAuto === 'undefined') return;

  const Q = (s, r) => (r || document).querySelector(s);
  const QA = (s, r) => [...(r || document).querySelectorAll(s)];
  const mq = window.matchMedia('(max-width:770px)');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const store = {
    get: (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  };

  const svg = (d, extra) => '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>';
  const IC = {
    mix: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.6"/>'),
    list: svg('<path d="M4 6.5h16M4 12h16M4 17.5h9"/>'),
    bot: svg('<rect x="5" y="8" width="14" height="10" rx="3"/><path d="M12 4v4M9.5 13h.01M14.5 13h.01"/>'),
    sliders: svg('<path d="M4 7h4M14 7h6M4 12h9M17 12h3M4 17h2M12 17h8"/><circle cx="11" cy="7" r="2.2"/><circle cx="15" cy="12" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>').replace('stroke-width="1.8"', 'stroke-width="2.4"'),
    play: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    stop: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    swap: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>').replace('stroke-width="1.8"', 'stroke-width="2.2"'),
    chev: svg('<path d="M9 6l6 6-6 6"/>').replace('width="22" height="22"', 'width="20" height="20"'),
    up: svg('<path d="M6 14l6-6 6 6"/>').replace('width="22" height="22"', 'width="20" height="20"'),
    down: svg('<path d="M6 10l6 6 6-6"/>').replace('width="22" height="22"', 'width="20" height="20"'),
    check: svg('<path d="M5 12l5 5 9-10"/>').replace('width="22" height="22"', 'width="16" height="16"').replace('stroke="currentColor"', 'stroke="#caff1a"'),
    up2: svg('<path d="M12 16V5M7 10l5-5 5 5M5 19h14"/>'),
    spark: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>').replace('width="22" height="22"', 'width="18" height="18"')
  };

  const sw = (id, title, sub) => '<button type="button" class="m-sw" role="switch" aria-checked="false" data-sw="' + id + '"><span class="tx"><b>' + title + '</b><small>' + sub + '</small></span><span class="trk"><i></i></span></button>';
  const chips = (sel, list, cls) => '<div class="m-seg ' + (cls || '') + '">' + list.map(([v, l]) => '<button type="button" data-sel="' + sel + '" data-val="' + v + '" aria-pressed="false">' + l + '</button>').join('') + '</div>';
  const tab = (id, label, icon) => '<button type="button" class="m-tab" data-go="' + id + '" aria-current="false">' + icon + '<span>' + label + '</span></button>';
  const head = (eyebrow, title, p) => '<header class="m-head"><div class="m-eyebrow">' + eyebrow + '</div><h1>' + title + '</h1>' + (p ? '<p>' + p + '</p>' : '') + '</header>';

  const ROOT = document.createElement('div');
  ROOT.id = 'm-app';
  ROOT.innerHTML =
    // ---- Mezcla
    '<section class="m-screen on" data-s="mix" aria-label="Mezcla">' +
    '<header class="m-top"><div class="m-brand">SYNK<span>//</span>LAB</div><div class="m-pill" id="m-pill"><i></i><span id="m-status">EN ESPERA</span></div></header>' +
    '<main class="m-main">' +
    '<section id="m-empty" class="m-card m-empty" hidden><h2>Tu set está vacío</h2><p>Importa tus temas para empezar a mezclar.</p><button type="button" class="m-btn lime" data-go="importar">Importar audio</button></section>' +
    '<section id="m-single" class="m-card" aria-label="Ahora suena"><div class="m-eyebrow" id="m-s-eye">AHORA SUENA</div><h1 class="m-title" id="m-s-title">—</h1><div class="m-sub" id="m-s-sub"></div>' +
    '<div class="m-wave"><div class="m-exit" id="m-exit" hidden><b>SALIDA</b></div><div class="m-bars" id="m-bars"></div></div>' +
    '<div class="m-times"><span id="m-s-cur">0:00</span><span id="m-s-dur">0:00</span></div><div class="m-chips" id="m-s-chips"></div></section>' +
    '<section id="m-dual" class="m-card" aria-label="Los dos decks sonando" hidden>' +
    '<div class="m-deck"><div class="m-deckhead"><span class="m-eyebrow" id="m-da-tag">DECK A · SALE</span><span class="m-pct" id="m-da-pct">100%</span></div><div class="m-dtitle" id="m-da-title"></div><div class="m-sub" id="m-da-sub"></div><canvas class="m-wf" id="m-da-wf" aria-label="Onda del deck que suena"></canvas><div class="m-jump" id="m-da-jump"><span>SALTAR</span><button type="button" data-jump="-16">−16</button><button type="button" data-jump="-4">−4</button><button type="button" data-jump="4">+4</button><button type="button" data-jump="16">+16</button></div></div>' +
    '<div class="m-tempo" id="m-tempo">TEMPO</div><button type="button" class="m-syncbtn" id="m-sync">SYNC · copiar el BPM del que suena</button><div class="m-nudge" id="m-nudge"><span>FASE DEL QUE ENTRA</span><button type="button" data-nudge="-10">−10</button><button type="button" data-nudge="-2">−2</button><button type="button" data-nudge="2">+2</button><button type="button" data-nudge="10">+10</button></div>' +
    '<div class="m-deck"><div class="m-deckhead"><span class="m-eyebrow" style="color:#9fc43a" id="m-db-tag">DECK B · ENTRA</span><span class="m-pct" style="color:#caff1a" id="m-db-pct">0%</span></div><div class="m-dtitle" id="m-db-title"></div><div class="m-sub" id="m-db-sub"></div><canvas class="m-wf" id="m-db-wf" aria-label="Onda del deck que entra"></canvas><div class="m-jump" id="m-db-jump"><span>SALTAR</span><button type="button" data-jump="-16">−16</button><button type="button" data-jump="-4">−4</button><button type="button" data-jump="4">+4</button><button type="button" data-jump="16">+16</button></div><div class="m-skiptag" id="m-db-skip" hidden></div></div></section>' +
    '<section id="m-next" class="m-card lime" aria-label="Próxima mezcla" hidden><div class="m-mixhead"><div><div class="m-eyebrow" id="m-n-eye">PRÓXIMA MEZCLA EN</div><div class="m-count" id="m-n-count">0:00</div></div><div class="m-plan" id="m-n-plan"></div></div>' +
    '<div class="m-prog"><i id="m-n-prog"></i></div>' +
    '<div class="m-nexttrack" id="m-n-row"><div class="m-bdg">B</div><div class="m-nt"><b id="m-n-title"></b><span id="m-n-sub"></span></div></div>' +
    '<div id="m-n-bul"></div></section>' +
    '<div class="m-ctl"><button type="button" class="m-sq" id="m-play" aria-label="Pausar">' + IC.pause + '</button><button type="button" class="m-go" id="m-go">' + IC.swap + '<span id="m-go-l">Iniciar Auto DJ</span></button><button type="button" class="m-sq stop" id="m-stop" aria-label="Desactivar Auto DJ">' + IC.stop + '</button></div>' +
    '<section class="m-card m-xf" aria-label="Crossfader"><div class="m-xfhead"><span>CROSSFADER</span><b id="m-xf-l">A 100% · B 0%</b></div><div class="m-xftrack" id="m-xf" role="slider" aria-valuemin="0" aria-valuemax="100" aria-label="Crossfader"><div class="rail"></div><div class="fill" id="m-xf-fill"></div><div class="knob" id="m-xf-knob"></div></div></section>' +
    '<details class="m-card m-fx" id="m-fx" open><summary><span class="m-eyebrow">EFECTOS Y EQ</span><span class="m-fxhint">↺ restaura de a poco</span></summary>' +
    '<div class="m-fxdeck"><button type="button" data-fxdeck="A" aria-pressed="true">DECK A</button><button type="button" data-fxdeck="B" aria-pressed="false">DECK B</button></div>' +
    '<div id="m-fx-list"></div>' +
    '<div class="m-fxpads"><button type="button" data-pad="Throw">REVERB THROW</button><button type="button" data-pad="Sweep">SWEEP</button><button type="button" data-pad="Brake">FRENO</button><button type="button" data-pad="EchoOut">ECO OUT</button></div>' +
    '<button type="button" class="m-fxall" data-fxresetall>↺ RESTAURAR TODOS LOS EFECTOS</button></details>' +
    '<button type="button" class="m-peek" id="m-peek" data-go="cola" hidden><div class="t"><div class="m-eyebrow">DESPUÉS · EN LA COLA</div><b id="m-peek-t"></b></div>' + IC.chev + '</button>' +
    '</main></section>' +
    // ---- Cola
    '<section class="m-screen" data-s="cola" aria-label="Cola del set">' + head('<span id="m-q-stats">SET</span>', 'Cola del set') +
    '<main class="m-main"><button type="button" class="m-btn" id="m-sort">' + IC.spark + '<span id="m-sort-l">Ordenar automáticamente</span></button><div id="m-list"></div>' +
    '<div class="m-note">Usa las flechas de la derecha para cambiar el orden. El Auto DJ mezcla de arriba hacia abajo.</div></main></section>' +
    // ---- Importar
    '<section class="m-screen" data-s="importar" aria-label="Importar audio">' + head('AÑADIR AL SET', 'Importar audio') +
    '<main class="m-main"><section class="m-card"><div class="m-drop"><div class="ic">' + IC.up2 + '</div><button type="button" class="m-btn lime" id="m-pick">Elegir archivos</button><p>MP3, WAV, FLAC o M4A, según tu navegador.<br>Puedes elegir varios a la vez.</p></div>' +
    sw('djEstimateBPM', 'Estimar BPM al importar', 'Experimental: verifícalo de oído') +
    '<div class="m-help">Los archivos se procesan en este dispositivo y no se suben a ningún servidor.</div></section>' +
    '<section class="m-card"><label class="m-lab" for="m-link">O pega un enlace</label><input class="m-in" id="m-link" type="url" inputmode="url" placeholder="YouTube, SoundCloud o un MP3 directo" autocomplete="off">' +
    '<div class="m-grid2"><button type="button" class="m-btn lime" id="m-prev" style="font-size:16px;font-family:inherit;letter-spacing:0;text-transform:none">Previsualizar</button><button type="button" class="m-btn" id="m-dl">Descargar MP3</button></div>' +
    '<p class="m-help">Los enlaces de YouTube y SoundCloud se mezclan solo por volumen, sin EQ ni efectos. Descarga únicamente contenido que tengas derecho a usar.</p></section>' +
    '<section class="m-card m-files"><h2 class="m-h2" id="m-imp-h">IMPORTADOS</h2><div id="m-files"></div></section></main></section>' +
    // ---- Agente
    '<section class="m-screen" data-s="agente" aria-label="Agente DJ">' + head('IA OPCIONAL', 'Agente DJ', 'Una IA decide cómo se mezcla cada transición. Corre en tu equipo y no usa claves de API.') +
    '<main class="m-main"><section class="m-card" id="m-ag-card" style="padding-top:6px">' + sw('djAgentOn', 'Permitir control por agente', 'API local de esta app') + '<div class="m-state" id="m-ag-state"><i></i><span id="m-ag-text"></span></div></section>' +
    '<section class="m-card"><h2 class="m-h2">¿Quién decide?</h2>' + chips('prov', [['claude', 'Claude'], ['codex', 'Codex'], ['rules', 'Reglas']], 'c3') + '<p class="m-help" id="m-prov-help"></p>' +
    '<label class="m-lab" for="m-style" style="margin-top:16px">Estilo (opcional)</label><input class="m-in" id="m-style" type="text" placeholder="hipnótico, mezclas largas" autocomplete="off"></section>' +
    '<section class="m-card lime" id="m-last" hidden><h2 class="m-eyebrow">ÚLTIMA MEZCLA</h2><div style="margin-top:8px;font-weight:700;font-size:16px" id="m-last-t"></div><div class="m-chips" id="m-last-c"></div></section>' +
    '<section class="m-card"><h2 class="m-h2">Cómo conectarlo</h2><p class="m-help" style="margin-top:10px;color:#a9b4ac">Activa el permiso y ejecuta esto en una terminal de tu equipo, donde ya tienes sesión iniciada:</p>' +
    '<div class="m-row"><code class="m-code" id="m-cmd"></code><button type="button" class="m-btn" id="m-copy">Copiar</button></div></section></main></section>' +
    // ---- Ajustes
    '<section class="m-screen" data-s="ajustes" aria-label="Ajustes de mezcla">' + head('AUTO DJ', 'Ajustes de mezcla', 'Se aplican a cada transición automática.') +
    '<main class="m-main"><section class="m-card"><h2 class="m-h2">Duración de transición</h2>' + chips('djFadeSeconds', [['8', '8 s'], ['16', '16 s'], ['24', '24 s'], ['32', '32 s'], ['48', '48 s']], 'c5') +
    '<p class="m-help">Con el agente de IA activo, la IA elige la duración en cada mezcla y pasa por encima de este valor.</p></section>' +
    '<section class="m-card"><h2 class="m-h2">EQ automático</h2>' + chips('djAutoEQ', [['off', 'Apagado'], ['bass', 'Graves'], ['blend', 'Mezcla']], 'c3') + '<p class="m-help" id="m-eq-help" style="color:#a9b4ac"></p></section>' +
    '<section class="m-card"><h2 class="m-h2">Efecto en la cola del tema que sale</h2>' + chips('djAutoFX', [['off', 'Ninguno'], ['echo', 'Eco'], ['reverb', 'Reverb'], ['flanger', 'Flanger'], ['random', 'Aleatorio']], 'wrap') + '</section>' +
    '<section class="m-card" style="padding-top:4px;padding-bottom:4px">' +
    sw('djAutoSync', 'Sincronizar tempo y golpes', 'Iguala el tempo y alinea los golpes del tema que entra.') +
    sw('djCrispRate', 'Audio nítido', 'Sin estiramiento en ajustes de tempo pequeños (≤1.5 %). El tono varía hasta 26 cents.') +
    sw('djFollowMaster', 'Seguir al tema que suena', 'Sin promedio: el que entra copia el BPM del que está sonando (ej. 127).') +
    sw('djAutoPhrase', 'Mezclar por frases', 'Entra sin intro y sale donde cae la energía.') +
    sw('djAutoFilter', 'Barrido de filtro', 'Cierra los agudos del que sale y abre los del que entra.') +
    sw('djAutoGain', 'Nivelar volúmenes', 'Compensa la diferencia de volumen entre temas.') + '</section>' +
    '<section class="m-card" style="padding-top:6px;padding-bottom:6px"><h2 class="m-h2" style="padding:10px 0 4px">Más herramientas</h2>' +
    ['discover|Descubrir música', 'analyze|Analizador de mezcla', 'sets|Constructor de sets', 'labels|Explorador de sellos'].map((x) => { const [v, l] = x.split('|'); return '<button type="button" class="m-more" data-more="' + v + '"><span>' + l + '</span>' + IC.chev + '</button>'; }).join('') + '</section></main></section>' +
    // ---- Tabs
    '<nav class="m-tabs" aria-label="Secciones">' + tab('mix', 'Mezcla', IC.mix) + tab('cola', 'Cola', IC.list) +
    '<button type="button" class="m-tab plus" data-go="importar" aria-label="Importar audio" aria-current="false"><span>' + IC.plus + '</span></button>' +
    tab('agente', 'Agente', IC.bot) + tab('ajustes', 'Ajustes', IC.sliders) + '</nav>';
  document.body.appendChild(ROOT);

  const $ = (id) => document.getElementById(id);
  let screen = 'mix';
  let lastTr = null, lastMix = null, qSig = '', fSig = '';
  const prov = { v: store.get('synklab.m.prov', 'claude') };
  $('m-style').value = store.get('synklab.m.style', '');

  // ---------------------------------------------------------------- helpers
  function go(name) {
    screen = name;
    QA('.m-screen', ROOT).forEach((s) => s.classList.toggle('on', s.dataset.s === name));
    QA('.m-tab', ROOT).forEach((t) => t.setAttribute('aria-current', t.dataset.go === name ? 'page' : 'false'));
    qSig = ''; fSig = '';
    update();
  }
  function setNative(id, value) {
    const el = $(id) || document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value; else el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function nativeEl(id) { return document.getElementById(id); }
  function camelot(k) { const m = /^(\d{1,2})([AB])$/.exec(k || ''); return m ? [+m[1], m[2]] : null; }
  function keyOk(a, b) {
    const x = camelot(a), y = camelot(b);
    if (!x || !y) return null;
    if (x[0] === y[0]) return true;
    const d = Math.min((x[0] - y[0] + 12) % 12, (y[0] - x[0] + 12) % 12);
    return d === 1 && x[1] === y[1];
  }
  // Many titles arrive as "Artist - Title"; the artist is already shown on its own line.
  function st(t) {
    if (!t) return '';
    const m = /^(.+?)\s[-\u2013\u2014]\s(.+)$/.exec(t.title || '');
    if (m && t.artist) {
      const a = t.artist.toLowerCase().replace(/\s*\((official|oficial)\)/, ''), p = m[1].toLowerCase();
      if (a.includes(p) || p.includes(a)) return m[2];
    }
    return t.title || '';
  }
  function durOf(t) { return t && t.duration ? t.duration / 1000 : 0; }
  function activeInfo() { const L = djAuto.active, d = djDecks[L]; return { L, d, t: d.id ? djTrack(d.id) : null }; }

  function barData(t, n, dur) {
    if (!t) return Array(n).fill(0.12);
    const s = t.sect;
    if (s && s.db && s.db.length && dur > 0) {
      return Array.from({ length: n }, (_, j) => {
        const k = Math.max(0, Math.min(s.db.length - 1, Math.floor(((j + 0.5) / n * dur - s.p0) / (16 * s.per))));
        return Math.max(0.12, Math.min(1, (s.db[k] + 22) / 16));
      });
    }
    const pk = typeof djPeaks !== 'undefined' && djPeaks.get ? djPeaks.get(t.id) : null;
    if (pk && pk.length) {
      const per = pk.length / n;
      const raw = Array.from({ length: n }, (_, j) => { let m = 0; for (let i = Math.floor(j * per); i < Math.floor((j + 1) * per); i++) m = Math.max(m, pk[i] || 0); return m; });
      const top = Math.max(0.05, ...raw);
      return raw.map((v) => Math.max(0.12, Math.min(1, v / top)));
    }
    return Array(n).fill(0.25);
  }
  function ensureBars(el, n) {
    if (el.children.length !== n) { el.innerHTML = '<i></i>'.repeat(n); }
    return el.children;
  }
  function paint(el, t, cur, dur, opts) {
    const n = 31, kids = ensureBars(el, n), h = barData(t, n, dur);
    const pj = dur > 0 ? Math.min(n - 1, Math.floor(cur / dur * n)) : -1;
    const skipJ = opts && opts.skipUntil > 0 && dur > 0 ? Math.floor(opts.skipUntil / dur * n) : -1;
    for (let j = 0; j < n; j++) {
      let c = '#3e4a43';
      if (j === pj) c = (opts && opts.head) || '#edf1e9';
      else if (j < pj) c = (opts && opts.past) || '#8f9a93';
      if (j < skipJ) c = '#222b26';
      kids[j].style.height = Math.round(h[j] * 100) + '%';
      kids[j].style.background = c;
    }
  }
  function chipsHtml(t) {
    if (!t) return '';
    const out = [];
    const bpm = typeof djBpmFor === 'function' ? djBpmFor(t) : t.bpm;
    if (bpm) out.push('<span class="m-chip">' + Number(bpm).toFixed(1) + ' BPM</span>');
    if (t.key) out.push('<span class="m-chip">' + esc(t.key) + '</span>');
    if (t.tonal && t.tonal.bass >= 0.8) out.push('<span class="m-chip">BAJO ALTO</span>');
    return out.join('');
  }
  function setText(id, v) { const el = $(id); if (el && el.textContent !== v) el.textContent = v; }
  function setHtml(id, v) { const el = $(id); if (el && el.innerHTML !== v) el.innerHTML = v; }
  const FX = { off: 'sin efecto', echo: 'eco', reverb: 'reverb', flanger: 'flanger', random: 'efecto aleatorio' };
  const EQ = { off: 'apagado', bass: 'graves', blend: 'mezcla' };

  // ---------------------------------------------------------------- Mezcla
  function updateMix() {
    const avail = djAvailable();
    const { L, d, t } = activeInfo();
    const tr = djAuto.transition, run = djAuto.enabled, paused = d.el.paused;
    const status = tr ? 'MEZCLANDO' : run ? (paused ? 'EN PAUSA' : 'EN VIVO') : (d.id && !paused ? 'SONANDO' : 'EN ESPERA');
    setText('m-status', status);
    $('m-pill').classList.toggle('live', !!tr || (run && !paused) || (!run && !!d.id && !paused));

    $('m-empty').hidden = avail.length > 0 || run;
    const t0 = t || avail[0] || null;
    // Both decks are always visible (compact) while the set has tracks; with nothing loaded they preview the first two tracks.
    $('m-single').hidden = true;
    $('m-dual').hidden = !tr && avail.length === 0;
    if (!$('m-dual').hidden) updateDual(tr);

    updateNext(L, d, t, tr, run);

    const go = $('m-go');
    $('m-go-l').textContent = tr ? 'Mezclando…' : run ? 'Mezclar siguiente' : 'Activar Auto DJ';
    go.disabled = !!tr || (!run && avail.length === 0);
    $('m-play').disabled = !run && !d.id && avail.length === 0;
    const pa = paused ? 'Reproducir' : 'Pausar';
    if ($('m-play').getAttribute('aria-label') !== pa) { $('m-play').setAttribute('aria-label', pa); $('m-play').innerHTML = paused ? IC.play : IC.pause; }
    $('m-stop').disabled = !run;
    { const nb = QA('[data-nudge]', ROOT); nb.forEach((b) => { b.disabled = !tr; }); }
    syncFx();
    { const sy = $('m-sync'); if (sy) sy.disabled = !d.id || !!tr; }

    const v = +(nativeEl('djCrossfade') || { value: 0 }).value || 0;
    const a = Math.round(Math.cos(v / 100 * Math.PI / 2) * 100), b = Math.round(Math.sin(v / 100 * Math.PI / 2) * 100);
    setText('m-xf-l', 'A ' + a + '% · B ' + b + '%');
    const w = $('m-xf').clientWidth || 326;
    $('m-xf-fill').style.width = Math.round(v / 100 * w) + 'px';
    $('m-xf-knob').style.left = Math.round(v / 100 * (w - 28)) + 'px';

    const nt = t && djNextTrack(t.id);
    const peek = !tr && (nt || (!t && avail[1]));
    $('m-peek').hidden = !peek;
    if (peek) { const p = nt || avail[1]; setText('m-peek-t', st(p) + (p.bpm ? ' · ' + Number(p.bpm).toFixed(1) + ' BPM' : '')); }
  }

  // ---- Scrolling waveform lanes: both decks share one time scale (real seconds), playhead fixed at the left third, beat/bar
  // lines from each track's grid. When the two tracks are in sync their beat lines sit at the same x in both lanes.
  let lanes = null;
  const WF_SPAN = 14, WF_HEAD = 0.3, smooth = { A: { t: 0, at: 0 }, B: { t: 0, at: 0 } }, hiMax = new Map();
  function deckTime(L) {
    if (scrub && scrub.L === L && scrub.pending != null) return scrub.pending; // while dragging, show the finger position, not the lagging media clock
    const el = djDecks[L].el, now = performance.now(), s = smooth[L], real = el.currentTime || 0;
    if (el.paused || Math.abs(real - s.t) > 0.4) { s.t = real; s.at = now; return real; }
    const est = s.t + (now - s.at) / 1000 * (el.playbackRate || 1);
    s.t = est + (real - est) * 0.08; s.at = now; return s.t; // glide to the media clock instead of stepping with its coarse updates
  }
  function nearestAnchor(t, time) { let a = t.grid.anchors[0]; for (const x of t.grid.anchors) if (Math.abs(x.t - time) < Math.abs(a.t - time)) a = x; return a; }
  function drawLane(cv, L, t, color, active, note) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const d = djDecks[L], loaded = !!(t && d.id === t.id), rate = loaded ? (d.el.playbackRate || 1) : 1;
    const hi = t && typeof djPeaksHi !== 'undefined' ? djPeaksHi.get(t.id) : null, headX = w * WF_HEAD, pps = w / WF_SPAN, mid = h / 2;
    if (!hi) { g.fillStyle = '#6f7a72'; g.font = "10px 'DM Mono',monospace"; g.fillText(t ? 'La onda se carga al acercarse la mezcla' : '', 8, mid + 3); return; }
    let mx = hiMax.get(t.id); if (!mx) { mx = 0.05; for (let i = 0; i < hi.length; i += 3) if (hi[i] > mx) mx = hi[i]; hiMax.set(t.id, mx); }
    const cur = loaded ? deckTime(L) : (lanes && lanes.entry) || 0, tStart = cur - headX / pps * rate, tEnd = cur + (w - headX) / pps * rate;
    for (let x = 0; x < w; x += 2) { // waveform: each 2px column covers a slice of track time at the current playback rate
      const t0 = cur + (x - headX) / pps * rate, t1 = t0 + 2 / pps * rate;
      if (t1 < 0 || t0 > hi.length / 100) continue;
      let p = 0; for (let i = Math.max(0, Math.floor(t0 * 100)), e = Math.min(hi.length - 1, Math.ceil(t1 * 100)); i <= e; i++) if (hi[i] > p) p = hi[i];
      const a = Math.max(1, Math.min(1, p / mx) * (h * 0.46));
      g.fillStyle = x < headX ? (active ? '#5d6b62' : '#3a443e') : color;
      g.fillRect(x, mid - a, 1.6, a * 2);
    }
    if (t.grid && djGridOK(t)) { // beat lines (every 4th, the bar, is brighter)
      const per = 60 / t.grid.bpm, a0 = t.grid.anchors[0].ph; let time = tStart;
      for (let n = 0; n < 80; n++) {
        const a = nearestAnchor(t, time), idx = Math.ceil((time - a.ph) / per - 1e-6), bt = a.ph + idx * per;
        if (bt > tEnd) break;
        const x = headX + (bt - cur) / rate * pps, bar = ((Math.round((bt - a0) / per) % 4) + 4) % 4 === 0;
        g.fillStyle = bar ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.2)'; g.fillRect(x - 0.5, bar ? 0 : h * 0.25, bar ? 1.5 : 1, bar ? h : h * 0.5);
        time = bt + per * 0.5;
      }
    }
    g.fillStyle = '#ffffff'; g.fillRect(headX - 1, 0, 2, h); // playhead
    if (note) { g.fillStyle = 'rgba(8,12,10,.7)'; g.fillRect(w - 78, 3, 74, 14); g.fillStyle = '#caff1a'; g.font = "9px 'DM Mono',monospace"; g.fillText(note, w - 74, 13); }
  }
  // ---- Drag a waveform to move the track (drag left = forward, like grabbing the wave); jump buttons move by beats.
  let scrub = null;
  function beatJump(L, n) {
    const d = djDecks[L], t = d.id ? djTrack(d.id) : null; if (!t) return;
    const bpm = (typeof djBpmFor === 'function' ? djBpmFor(t) : t.bpm) || t.bpm;
    if (!bpm || !(d.el.duration > 0)) return;
    if (djAuto.transition && djAuto.transition.to === L) djAuto.transition.lock = false; // manual move wins over the phase lock
    d.el.currentTime = Math.max(0, Math.min(d.el.duration - 0.05, (d.el.currentTime || 0) + n * 60 / bpm));
  }
  ['m-da-wf', 'm-db-wf'].forEach((id) => {
    const cv = $(id);
    cv.addEventListener('pointerdown', (e) => {
      if (!lanes) return;
      const L = id === 'm-da-wf' ? lanes.fromL : lanes.toL, d = djDecks[L];
      if (!d.id || !(d.el.duration > 0)) return;
      cv.setPointerCapture(e.pointerId);
      scrub = { cv, L, x: e.clientX, t0: d.el.currentTime || 0, rate: d.el.playbackRate || 1, last: 0, pending: null };
      if (djAuto.transition && djAuto.transition.to === L) djAuto.transition.lock = false;
    });
    cv.addEventListener('pointermove', (e) => {
      if (!scrub || scrub.cv !== cv) return;
      const d = djDecks[scrub.L], pps = cv.clientWidth / WF_SPAN, now = performance.now();
      const nt = Math.max(0, Math.min((d.el.duration || 0) - 0.05, scrub.t0 - (e.clientX - scrub.x) / pps * scrub.rate));
      scrub.pending = nt;
      if (now - scrub.last > 40) { d.el.currentTime = nt; scrub.last = now; }
    });
    const end = () => { if (scrub && scrub.cv === cv) { if (scrub.pending != null) djDecks[scrub.L].el.currentTime = scrub.pending; scrub = null; } };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  });

  // ---- Crossfader: drag anywhere on the track (touching it hands control to you, like on desktop: Auto DJ switches off).
  const xfEl = $('m-xf');
  function xfMove(e) {
    const r = xfEl.getBoundingClientRect(), v = Math.max(0, Math.min(100, (e.clientX - r.left - 14) / Math.max(1, r.width - 28) * 100));
    const el = nativeEl('djCrossfade'); if (!el) return;
    el.value = String(Math.round(v)); el.dispatchEvent(new Event('input', { bubbles: true })); updateMix();
  }
  xfEl.addEventListener('pointerdown', (e) => { xfEl.setPointerCapture(e.pointerId); xfEl._drag = true; xfMove(e); });
  xfEl.addEventListener('pointermove', (e) => { if (xfEl._drag) xfMove(e); });
  xfEl.addEventListener('pointerup', () => { xfEl._drag = false; }); xfEl.addEventListener('pointercancel', () => { xfEl._drag = false; });

  // ---- Effects & EQ: mirrors the desktop controls of one deck (the native inputs stay the source of truth).
  const FXS = [['Rate', 'Tempo'], ['Hp', 'Pasa-altos'], ['Lp', 'Pasa-bajos'], ['Low', 'Graves'], ['Mid', 'Medios'], ['High', 'Agudos'], ['Echo', 'Eco'], ['Reverb', 'Reverb'], ['Flanger', 'Flanger']];
  let fxDeck = 'A', fxAuto = true, fxDrag = false, fxBuilt = false;
  function buildFx() {
    const ref = nativeEl('djEchoA'); if (!ref) return;
    $('m-fx-list').innerHTML = FXS.map(([n, label]) => {
      const el = nativeEl('dj' + n + 'A');
      return '<div class="m-fxrow" data-fx="' + n + '"><span class="n">' + label + '</span><input type="range" class="m-range" data-fxin="' + n + '" min="' + el.min + '" max="' + el.max + '" step="' + (el.step || '1') + '" value="' + el.value + '"><b class="v">0</b><button type="button" class="m-reset" data-fxreset="' + n + '" aria-label="Restaurar ' + label + ' de a poco">↺</button></div>';
    }).join('');
    fxBuilt = true;
  }
  function syncFx(force) {
    if (!fxBuilt) buildFx();
    if (!fxBuilt) return;
    if (fxAuto && djAuto.active) fxDeck = djAuto.active;
    QA('[data-fxdeck]', ROOT).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fxdeck === fxDeck)));
    FXS.forEach(([n]) => {
      const nat = nativeEl('dj' + n + fxDeck), r = ROOT.querySelector('[data-fxin="' + n + '"]'), v = ROOT.querySelector('[data-fx="' + n + '"] .v'), lab = nativeEl('dj' + n + 'Val' + fxDeck);
      if (!nat || !r) return;
      if (!fxDrag || force) r.value = nat.value;
      if (v && lab && v.textContent !== lab.textContent) v.textContent = lab.textContent;
    });
  }
  ROOT.addEventListener('input', (e) => {
    const r = e.target.closest && e.target.closest('[data-fxin]'); if (!r) return;
    const nat = nativeEl('dj' + r.dataset.fxin + fxDeck); if (!nat) return;
    clearInterval(nat._anim); nat._anim = null; // a finger on the control cancels any glide in progress
    nat.value = r.value; nat.dispatchEvent(new Event('input', { bubbles: true })); syncFx();
  });
  ROOT.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('[data-fxin]')) fxDrag = true; });
  document.addEventListener('pointerup', () => { fxDrag = false; }); document.addEventListener('pointercancel', () => { fxDrag = false; });
  ROOT.addEventListener('contextmenu', (e) => { const row = e.target.closest && e.target.closest('[data-fx]'); if (row) { e.preventDefault(); djResetFX(fxDeck, row.dataset.fx); } }); // long-press

  function wfLoop() {
    const dual = $('m-dual');
    if (lanes && dual && !dual.hidden && !document.hidden && dual.offsetParent !== null) {
      const { fromL, toL, tf, tt, tr } = lanes;
      drawLane($('m-da-wf'), fromL, tf, '#e4ebe0', true, null);
      drawLane($('m-db-wf'), toL, tt, '#caff1a', !!tr, !tr || !djDecks[toL].id ? 'ENTRA AQUÍ' : null);
    }
    requestAnimationFrame(wfLoop);
  }
  requestAnimationFrame(wfLoop);

  function updateDual(tr) {
    const act = activeInfo();
    const fromL = tr ? tr.from : act.L, toL = tr ? tr.to : (act.L === 'A' ? 'B' : 'A');
    const from = djDecks[fromL], to = djDecks[toL];
    let tf = from.id ? djTrack(from.id) : null;
    const loaded = !!tf;
    if (!tf && !tr) tf = djAvailable()[0] || null; // nothing loaded yet: preview the first track
    let tt = to.id ? djTrack(to.id) : null;
    // Outside a transition the idle deck shows what comes next (preloaded, or just queued: not loaded yet).
    if (!tr && !tt && tf) tt = djNextTrack(tf.id) || (!loaded ? djAvailable()[1] : null) || null;
    const fe = from.el, te = to.el;
    const fdur = (from.id && fe.duration) || durOf(tf), tdur = (to.id && te.duration) || durOf(tt);
    if (tr) {
      const v = +(nativeEl('djCrossfade') || { value: 0 }).value || 0;
      const cosV = Math.cos(v / 100 * Math.PI / 2), sinV = Math.sin(v / 100 * Math.PI / 2);
      const pa = Math.round((tr.from === 'A' ? cosV : sinV) * 100), pb = Math.round((tr.to === 'B' ? sinV : cosV) * 100);
      setText('m-da-tag', 'DECK ' + fromL + ' · SALE'); setText('m-da-pct', pa + '%');
      setText('m-db-tag', 'DECK ' + toL + ' · ENTRA'); setText('m-db-pct', pb + '%');
    } else {
      setText('m-da-tag', 'DECK ' + fromL + (!loaded ? ' · LISTO' : fe.paused ? ' · EN PAUSA' : ' · SUENA')); setText('m-da-pct', fmt(loaded ? fe.currentTime || 0 : 0) + ' / ' + fmt(fdur));
      setText('m-db-tag', 'DECK ' + toL + (to.id ? ' · LISTO' : ' · SIGUE')); setText('m-db-pct', tt ? fmt(tdur) : '—');
    }
    setText('m-da-title', st(tf)); setText('m-db-title', st(tt));
    const sub = (t) => t ? [t.artist, t.bpm ? Number(t.bpm).toFixed(1) + ' BPM' : '', t.key].filter(Boolean).join(' · ') : '';
    setText('m-da-sub', sub(tf)); setText('m-db-sub', sub(tt));
    if (tr && tr.entry == null) tr.entry = Math.max(0, (te.currentTime || 0) - (performance.now() - tr.start) / 1000 * (te.playbackRate || 1));
    const entry = tr ? tr.entry : 0;
    lanes = { fromL, toL, tf, tt, tr, loadedFrom: loaded, entry };
    QA('#m-da-jump button', ROOT).forEach((b) => { b.disabled = !from.id; }); QA('#m-db-jump button', ROOT).forEach((b) => { b.disabled = !to.id; });
    const sk = $('m-db-skip');
    sk.hidden = !(entry > 1);
    if (!sk.hidden) sk.textContent = 'INTRO SALTEADO · ENTRA EN ' + fmt(entry);
    let tempo = 'TEMPO';
    if (tf && tt && tf.bpm && tt.bpm) {
      const bf = typeof djBpmFor === 'function' ? djBpmFor(tf) : tf.bpm, bt = typeof djBpmFor === 'function' ? djBpmFor(tt) : tt.bpm;
      const ph = tr && tr.lock && tr.err != null && tf && tf.grid ? Math.round(tr.err * 60 / tf.grid.bpm * 1000) : null; // beat phase error of the incoming deck, ms
      tempo = 'TEMPO · ' + (tr && Math.abs(fe.playbackRate * bf - te.playbackRate * bt) < 0.6 ? 'AMBOS A ' + (te.playbackRate * bt).toFixed(1) + ' BPM' : bf.toFixed(1) + ' → ' + bt.toFixed(1) + ' BPM') + (ph != null ? ' · FASE ' + (ph > 0 ? '+' : '') + ph + ' ms' : '');
    }
    setText('m-tempo', tempo);
  }

  function updateNext(L, d, t, tr, run) {
    const card = $('m-next');
    card.hidden = !(run && (t || tr));
    if (card.hidden) return;
    const fadeSel = +(nativeEl('djFadeSeconds') || { value: 16 }).value || 16;
    let nt = null, bul = '';
    if (tr) {
      const el = (performance.now() - tr.start) / 1000, left = Math.max(0, tr.duration / 1000 - el);
      setText('m-n-eye', 'MEZCLA EN CURSO'); setText('m-n-count', Math.ceil(left) + ' s');
      $('m-n-prog').style.width = Math.min(100, el / (tr.duration / 1000) * 100) + '%';
      const to = djDecks[tr.to]; nt = to.id ? djTrack(to.id) : null;
      setHtml('m-n-plan', Math.round(tr.duration / 1000) + ' s · EQ ' + (EQ[tr.eq] || tr.eq) + '<br>' + (FX[tr.fx] || tr.fx));
    } else {
      const fade = (djAuto.plan && djAuto.plan.fade) || fadeSel;
      const dur = d.el.duration || durOf(t), cur = d.el.currentTime || 0;
      const exitAt = djAuto.exit && djAuto.exit.id === d.id && djAuto.exit.at != null ? djAuto.exit.at : null;
      const startAt = Math.max(1, (exitAt != null ? exitAt : dur) - fade - 4.6);
      const until = (startAt - cur) / (d.el.playbackRate || 1);
      setText('m-n-eye', 'PRÓXIMA MEZCLA EN'); setText('m-n-count', until <= 0 ? 'AHORA' : fmt(until));
      $('m-n-prog').style.width = Math.max(0, Math.min(100, cur / startAt * 100)) + '%';
      setHtml('m-n-plan', fade + ' s · EQ ' + (EQ[(nativeEl('djAutoEQ') || {}).value] || 'graves') + '<br>' + (FX[(nativeEl('djAutoFX') || {}).value] || ''));
      nt = t ? djNextTrack(t.id) : null;
      if (nt && t) {
        try {
          if (nativeEl('djAutoPhrase') && nativeEl('djAutoPhrase').checked && djSectOK(t) && djSectOK(nt)) {
            const en = djEntryTime(t, nt, exitAt != null ? exitAt : dur);
            bul += '<div class="m-bul">' + IC.check + (en > 1 ? 'Entra en ' + fmt(en) + ' y salta el intro' : 'Entra desde el principio') + '</div>';
          }
          if (nativeEl('djAutoSync') && nativeEl('djAutoSync').checked && t.bpm && nt.bpm) {
            const a = djBpmFor(t), b = djBpmFor(nt), gap = Math.abs(b - a) / a;
            bul += '<div class="m-bul">' + IC.check + (gap <= 0.06 ? 'Tempo: ambos se encuentran en ' + ((a + b) / 2).toFixed(1) + ' BPM' : 'Tempo: el entrante sigue al saliente') + '</div>';
          }
        } catch (e) { /* data not ready yet */ }
      }
    }
    $('m-n-row').hidden = !nt;
    if (nt) { setText('m-n-title', st(nt)); setText('m-n-sub', [nt.artist, nt.bpm ? Number(nt.bpm).toFixed(1) + ' BPM' : '', nt.key].filter(Boolean).join(' · ')); }
    else if (!tr) bul = '<div class="m-bul">Último tema del set</div>';
    setHtml('m-n-bul', bul);
  }

  // ---------------------------------------------------------------- Cola
  function renderQueue() {
    const { d } = activeInfo(), run = djAuto.enabled;
    const curId = run && d.id ? d.id : null, nxt = curId ? djNextTrack(curId) : null;
    const sig = tracks.map((t) => t.id).join(',') + '|' + curId + '|' + (nxt && nxt.id);
    if (sig === qSig) return;
    qSig = sig;
    const total = tracks.reduce((s, t) => s + durOf(t), 0);
    setText('m-q-stats', 'SET · ' + tracks.length + (tracks.length === 1 ? ' TEMA' : ' TEMAS') + (total ? ' · ' + fmt(total) : ''));
    if (!tracks.length) { $('m-list').innerHTML = '<div class="m-card m-empty"><h2>Tu set está vacío</h2><p>Importa archivos con el botón + de la barra inferior.</p></div>'; return; }
    $('m-list').innerHTML = tracks.map((t, i) => {
      const now = t.id === curId, next = nxt && t.id === nxt.id;
      const tag = now ? 'SUENA' : next ? 'SIGUE' : '';
      const nextT = tracks[i + 1];
      let link = '';
      if (nextT) {
        const parts = []; let color = '#8f9a93';
        if (t.bpm && nextT.bpm) {
          const gap = Math.abs(nextT.bpm - t.bpm) / t.bpm * 100;
          parts.push(Number(t.bpm).toFixed(1) + ' → ' + Number(nextT.bpm).toFixed(1) + ' BPM');
          if (gap <= 6) { parts.push('tempo compatible (' + Math.round(gap) + ' %)'); color = '#b9df70'; } else { parts.push('diferencia de tempo (' + Math.round(gap) + ' %)'); color = '#f3bf7c'; }
        }
        if (keyOk(t.key, nextT.key) === false) { parts.push('tonalidades distintas (' + esc(t.key) + ' → ' + esc(nextT.key) + ')'); color = '#f3bf7c'; }
        if (parts.length) link = '<div class="m-link" style="color:' + color + '">' + parts.join(' · ') + '</div>';
      }
      return '<div><div class="m-item' + (now ? ' now' : '') + '"><div class="m-n">' + (i + 1) + '</div><div class="m-it"><div class="r1"><b>' + esc(st(t)) + '</b><span class="m-tag">' + tag + '</span></div>' +
        '<div class="r2">' + esc(t.artist || '—') + (durOf(t) ? ' · ' + fmt(durOf(t)) : '') + '</div><div class="r3">' + (t.bpm ? '<span>' + Number(t.bpm).toFixed(1) + ' BPM</span>' : '') + '<span>' + esc(t.key || '—') + '</span></div></div>' +
        '<div class="m-mv"><button type="button" data-mv="' + esc(t.id) + '" data-dir="-1" aria-label="Subir ' + esc(st(t)) + '"' + (i === 0 ? ' disabled' : '') + '>' + IC.up + '</button><button type="button" data-mv="' + esc(t.id) + '" data-dir="1" aria-label="Bajar ' + esc(st(t)) + '"' + (i === tracks.length - 1 ? ' disabled' : '') + '>' + IC.down + '</button></div></div>' + link + '</div>';
    }).join('');
  }
  function move(id, dir) {
    const i = tracks.findIndex((t) => t.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= tracks.length) return;
    [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    persist(); renderSet(); renderDJ();
    if (djAuto.enabled && !djAuto.transition) {
      const a = djDecks[djAuto.active], nxt = a.id && djNextTrack(a.id), idle = djAuto.active === 'A' ? 'B' : 'A';
      if (nxt && djDecks[idle].id !== nxt.id && !djDecks[idle].loading) djLoadDeck(idle, nxt.id);
    }
    qSig = ''; renderQueue();
  }
  function sortSet() {
    const apply = nativeEl('djApplyOrder'), analyze = nativeEl('djAnalyzeSet');
    if (apply && !apply.disabled) { apply.click(); qSig = ''; return; }
    if (!analyze || analyze.disabled) { toast('Importa al menos 2 audios para ordenar el set.', true); return; }
    $('m-sort-l').textContent = 'Analizando el set…'; $('m-sort').disabled = true;
    analyze.click();
    let n = 0;
    const iv = setInterval(() => {
      n++;
      if ((apply && !apply.disabled) || n > 240) {
        clearInterval(iv); $('m-sort').disabled = false; $('m-sort-l').textContent = 'Ordenar automáticamente';
        if (apply && !apply.disabled) { apply.click(); qSig = ''; }
      }
    }, 500);
  }

  // ---------------------------------------------------------------- Importar
  function renderFiles() {
    const imp = (nativeEl('djImportStatus') || {}).textContent || '';
    setText('m-imp-h', 'IMPORTADOS' + (imp ? ' · ' + imp.toUpperCase() : ''));
    const sig = tracks.map((t) => t.id + (djReady.has(t.id) ? 1 : 0)).join(',');
    if (sig === fSig) return;
    fSig = sig;
    $('m-files').innerHTML = tracks.length ? tracks.map((t) => {
      const ready = djReady.has(t.id);
      return '<div class="f"><i class="' + (ready ? 'ok' : '') + '">' + (ready ? IC.check.replace('#caff1a', '#10160d') : '●') + '</i><div><b>' + esc(st(t)) + '</b><small>' +
        (durOf(t) ? fmt(durOf(t)) + ' · ' : '') + (t.bpm ? Number(t.bpm).toFixed(1) + ' BPM · ' : '') + (ready ? 'lista' : 'referencia') + '</small></div></div>';
    }).join('') : '<p class="m-help">Todavía no importaste nada.</p>';
    const dl = nativeEl('djDownload');
    $('m-dl').disabled = !dl || dl.disabled;
  }

  // ---------------------------------------------------------------- Agente
  function agentCmd() {
    const s = ($('m-style').value || '').replace(/["\\$`]/g, '').trim();
    return 'synklab-agent --provider ' + prov.v + ' --start' + (s ? ' --style "' + s + '"' : '');
  }
  function updateAgent() {
    const on = !!(nativeEl('djAgentOn') || {}).checked;
    const note = ((nativeEl('djAgentNote') || {}).textContent || '').trim().replace(/^agente:\s*/i, '');
    $('m-ag-state').classList.toggle('on', on);
    setText('m-ag-text', on ? 'Activado · ' + (note || 'esperando comandos') : 'Desactivado · el agente no puede mover el mixer');
    QA('[data-sel="prov"]', ROOT).forEach((b) => { const o = b.dataset.val === prov.v; b.classList.toggle('on', o); b.setAttribute('aria-pressed', String(o)); });
    setText('m-prov-help', { claude: 'Usa claude -p con tu suscripción de Claude Code.', codex: 'Usa codex exec con tu suscripción de ChatGPT.', rules: 'Sin IA: reglas aleatorias. También es el respaldo si la IA tarda demasiado.' }[prov.v]);
    setText('m-cmd', agentCmd());
    $('m-last').hidden = !lastMix;
    if (lastMix) {
      setText('m-last-t', lastMix.from + ' → ' + lastMix.to);
      setHtml('m-last-c', '<span class="m-chip lime">' + lastMix.fade + ' s</span><span class="m-chip">EQ ' + (EQ[lastMix.eq] || lastMix.eq) + '</span><span class="m-chip">' + (FX[lastMix.fx] || lastMix.fx) + '</span>' + (lastMix.filter ? '<span class="m-chip">con filtro</span>' : ''));
    }
  }

  // ---------------------------------------------------------------- Ajustes (mirrors the native controls)
  function updateSettings() {
    QA('[data-sel]', ROOT).forEach((b) => {
      if (b.dataset.sel === 'prov') return;
      const el = nativeEl(b.dataset.sel), on = !!el && String(el.value) === b.dataset.val;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    QA('[data-sw]', ROOT).forEach((b) => { const el = nativeEl(b.dataset.sw); b.setAttribute('aria-checked', String(!!(el && el.checked))); });
    setText('m-eq-help', { off: 'No se toca el EQ durante la mezcla.', bass: 'Intercambia los graves de los dos temas a mitad de la mezcla.', blend: 'Intercambia los graves y además recorta medios y agudos del tema que sale.' }[(nativeEl('djAutoEQ') || {}).value] || '');
  }

  // ---------------------------------------------------------------- loop
  function trackLastMix() {
    const tr = djAuto.transition;
    if (tr && tr !== lastTr) {
      lastTr = tr;
      const f = djDecks[tr.from], t = djDecks[tr.to];
      lastMix = { from: st(f.id && djTrack(f.id)) || '—', to: st(t.id && djTrack(t.id)) || '—', fade: Math.round(tr.duration / 1000), eq: tr.eq, fx: tr.fx, filter: tr.filter };
    }
  }
  function update() {
    if (!mq.matches || document.body.classList.contains('m-more')) return;
    trackLastMix();
    updateSettings();
    if (screen === 'mix') updateMix();
    else if (screen === 'cola') renderQueue();
    else if (screen === 'importar') renderFiles();
    else if (screen === 'agente') updateAgent();
  }
  setInterval(() => { if (!document.hidden) update(); }, 250);
  mq.addEventListener ? mq.addEventListener('change', update) : mq.addListener(update);

  // ---------------------------------------------------------------- events
  function enterMore(name) { document.body.classList.add('m-more'); try { view(name); } catch (e) { /* view not ready */ } window.scrollTo(0, 0); }
  function exitMore() { document.body.classList.remove('m-more'); go('mix'); }
  const dnav = document.getElementById('mobileNav');
  if (dnav) dnav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view="autodj"]');
    if (b && document.body.classList.contains('m-more')) { e.stopImmediatePropagation(); e.preventDefault(); exitMore(); }
  }, true);

  ROOT.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !ROOT.contains(t)) return;
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.nudge) { djNudgePhase(+t.dataset.nudge); return; }
    if (t.dataset.jump) { const L = lanes ? (t.closest('.m-jump').id === 'm-da-jump' ? lanes.fromL : lanes.toL) : null; if (L) beatJump(L, +t.dataset.jump); return; }
    if (t.dataset.fxdeck) { fxDeck = t.dataset.fxdeck; fxAuto = false; syncFx(true); return; }
    if (t.dataset.fxreset) { djResetFX(fxDeck, t.dataset.fxreset); return; }
    if (t.hasAttribute('data-fxresetall')) { djResetAllFX(fxDeck); return; }
    if (t.dataset.pad) { const b = nativeEl('dj' + t.dataset.pad + fxDeck); if (b) b.click(); return; }
    if (t.dataset.sw) { const el = nativeEl(t.dataset.sw); if (el) setNative(t.dataset.sw, !el.checked); return update(); }
    if (t.dataset.sel === 'prov') { prov.v = t.dataset.val; store.set('synklab.m.prov', prov.v); return update(); }
    if (t.dataset.sel) { setNative(t.dataset.sel, t.dataset.val); return update(); }
    if (t.dataset.more) return enterMore(t.dataset.more);
    if (t.dataset.mv) return move(t.dataset.mv, +t.dataset.dir);
    switch (t.id) {
      case 'm-go': { const run = djAuto.enabled; (nativeEl(run ? 'djNext' : 'djStart') || {}).click && nativeEl(run ? 'djNext' : 'djStart').click(); break; }
      case 'm-play': { const L = djAuto.active; if (!djAuto.enabled && !djDecks[L].id) { const st0 = nativeEl('djStart'); if (st0) st0.click(); break; } const b = nativeEl('djPlay' + L); if (b) b.click(); break; } // nothing loaded: play = start the set
      case 'm-sync': djSyncNext(); break;
      case 'm-stop': { const b = nativeEl('djStop'); if (b) b.click(); break; }
      case 'm-pick': { const f = nativeEl('djFileInput'); if (f) f.click(); break; }
      case 'm-sort': sortSet(); break;
      case 'm-prev': { const v = $('m-link').value.trim(); const l = nativeEl('djLink'), f = nativeEl('djLinkForm'); if (!v) { toast('Pega un enlace primero.', true); break; } l.value = v; l.dispatchEvent(new Event('input', { bubbles: true })); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); break; }
      case 'm-dl': { const v = $('m-link').value.trim(), l = nativeEl('djLink'), b = nativeEl('djDownload'); if (!v) { toast('Pega un enlace primero.', true); break; } l.value = v; l.dispatchEvent(new Event('input', { bubbles: true })); if (b && !b.disabled) b.click(); break; }
      case 'm-copy': {
        const text = agentCmd();
        const done = () => { t.textContent = 'Copiado'; setTimeout(() => { t.textContent = 'Copiar'; }, 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast('No se pudo copiar. Selecciona el comando manualmente.', true));
        else toast('Tu navegador no permite copiar desde aquí. Selecciona el comando.', true);
        break;
      }
      default: break;
    }
    setTimeout(update, 60);
  });
  $('m-style').addEventListener('input', () => { store.set('synklab.m.style', $('m-style').value); setText('m-cmd', agentCmd()); });
  go('mix');
})();
