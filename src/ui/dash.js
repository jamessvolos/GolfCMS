// Career dashboard — reads the caddie decision log and tells the strokes-gained story.
const KEY = 'golfcms.caddie.log.v1';
const CAL_KEY = 'golfcms.calibration.v1';
const app = document.getElementById('app');

const COL = { line: '#6fd08c', avg: '#ffd166', dim: '#9db8a5', bad: '#e07070' };

function loadLog() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? '[]'); }
  catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.filter(e =>
    e && typeof e === 'object' &&
    Number.isFinite(e.sgLost) && Number.isFinite(e.points) &&
    Number.isFinite(e.risk) && Number.isFinite(e.caddieRisk) &&
    e.round !== undefined
  );
}

const fmt = (n, d = 2) => Number.isFinite(n) ? n.toFixed(d) : '—';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

function tiles(log) {
  const wrap = el('div', '');
  wrap.id = 'tiles';
  const rounds = new Set(log.map(e => e.round)).size;
  const totalSG = log.reduce((s, e) => s + e.sgLost, 0);
  const defs = [
    [String(log.length), 'decisions logged'],
    [fmt(avg(log.map(e => e.points)), 0), 'avg points / decision'],
    [fmt(totalSG), 'total SG lost'],
    [fmt(rounds ? totalSG / rounds : 0), `SG lost / round (${rounds} round${rounds === 1 ? '' : 's'})`],
  ];
  for (const [big, lbl] of defs) {
    const t = el('div', 'tile');
    t.append(el('div', 'big', esc(big)), el('div', 'lbl', esc(lbl)));
    wrap.append(t);
  }
  return wrap;
}

function leaks(log) {
  const sec = el('section');
  sec.append(el('h2', '', 'Where you leak strokes'));
  const cats = [
    ['tee', 'Tee', COL.avg],
    ['approach', 'Approach', COL.line],
  ].map(([id, name, color]) => {
    const rows = log.filter(e => e.category === id);
    return { id, name, color, count: rows.length, avgSG: avg(rows.map(e => e.sgLost)) };
  });
  const maxAvg = Math.max(...cats.map(c => c.avgSG), 0.0001);
  for (const c of cats) {
    const row = el('div', 'bar-row');
    const pct = Math.max(2, (c.avgSG / maxAvg) * 100);
    row.append(el('div', 'name', esc(c.name)));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = pct + '%';
    fill.style.background = c.color;
    track.append(fill);
    row.append(track, el('div', 'val', `${fmt(c.avgSG)} avg SG lost · ${c.count} shot${c.count === 1 ? '' : 's'}`));
    sec.append(row);
  }
  const [tee, appr] = cats;
  let sentence;
  if (!tee.count && !appr.count) sentence = 'No categorized decisions yet.';
  else if (!appr.count || (tee.count && tee.avgSG > appr.avgSG)) {
    sentence = `Your <span class="hot">tee decisions</span> are the leakier category — averaging ${fmt(tee.avgSG)} SG lost vs ${fmt(appr.avgSG)} on approaches. Consider clubbing down when trouble pinches the landing zone.`;
  } else if (appr.avgSG > tee.avgSG) {
    sentence = `Your <span class="hot">approach decisions</span> are the leakier category — averaging ${fmt(appr.avgSG)} SG lost vs ${fmt(tee.avgSG)} off the tee. Aiming at more centers of greens would pay off.`;
  } else {
    sentence = `Dead heat — tee and approach both average ${fmt(tee.avgSG)} SG lost per decision.`;
  }
  sec.append(el('p', 'callout', sentence));
  return sec;
}

function discipline(log) {
  const sec = el('section');
  sec.append(el('h2', '', 'Risk discipline'));
  const delta = avg(log.map(e => e.risk - e.caddieRisk));
  let cls, text;
  if (delta > 5) {
    cls = 'over';
    text = `you run <span class="num">${fmt(delta, 1)}</span> risk points hotter than your caddie suggests — over-aggressive. Those hero lines are where the strokes go.`;
  } else if (delta < -5) {
    cls = 'under';
    text = `you play <span class="num">${fmt(-delta, 1)}</span> risk points safer than your caddie suggests — over-cautious. There are birdies you're leaving on the table.`;
  } else {
    cls = 'disciplined';
    text = `your risk appetite sits within <span class="num">${fmt(Math.abs(delta), 1)}</span> points of the caddie's read — disciplined. Keep trusting the numbers.`;
  }
  sec.append(el('p', 'verdict', `Avg (your risk − caddie risk): <span class="num ${cls}">${delta >= 0 ? '+' : ''}${fmt(delta, 1)}</span> — ${text}`));
  return sec;
}

function loadCalibration() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(CAL_KEY) ?? '[]'); }
  catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.filter(e => e && typeof e === 'object' &&
    Number.isFinite(e.predicted) && Number.isFinite(e.actual));
}

function calibration(log) {
  const cal = loadCalibration();
  if (!cal.length) return null;
  const sec = el('section');
  sec.append(el('h2', '', 'Calibration'));
  // bias: what you actually carded minus what the model called off the tee
  const bias = avg(cal.map(e => e.actual - e.predicted));
  let cls, verdict;
  if (bias > 0.25) {
    cls = 'over';
    verdict = "the caddie's model runs <span class=\"num\">hot</span> for you — it promises more than your execution delivers. Trust the reads, but budget the extra strokes.";
  } else if (bias < -0.25) {
    cls = 'under';
    verdict = "the caddie's model runs <span class=\"num\">cold</span> for you — you beat its forecast. Your execution is better than the profile assumes; consider a tighter handicap setting.";
  } else {
    cls = 'disciplined';
    verdict = "the caddie's model runs <span class=\"num\">honest</span> for you — predictions and cards agree. What it says a hole costs is what it costs.";
  }
  sec.append(el('p', 'verdict',
    `Mean (actual − predicted) over <span class="num">${cal.length}</span> hole${cal.length === 1 ? '' : 's'}: ` +
    `<span class="num ${cls}">${bias >= 0 ? '+' : ''}${fmt(bias)}</span> strokes — ${verdict}`));
  // decision tax: what your aiming choices cost, scaled to a full 18
  const meanSG = avg(log.map(e => e.sgLost));
  const decPerHole = avg(cal.map(e => Number.isFinite(e.n) ? e.n : 0)) || 0;
  const tax = meanSG * decPerHole * 18;
  sec.append(el('p', 'callout',
    `Decision tax per 18: <span class="hot">${fmt(tax, 1)}</span> strokes ` +
    `(${fmt(meanSG)} SG lost/decision × ${fmt(decPerHole, 1)} decisions/hole × 18).`));
  return sec;
}

function movingAvg(vals, w) {
  return vals.map((_, i) => {
    const s = Math.max(0, i - w + 1);
    return avg(vals.slice(s, i + 1));
  });
}

function trend(log) {
  const sec = el('section');
  const recent = log.slice(-100);
  sec.append(el('h2', '', `Trend — points per decision (last ${recent.length})`));
  const canvas = el('canvas');
  canvas.id = 'spark';
  sec.append(canvas);
  const legend = el('div', 'legend',
    `<span><span class="chip" style="background:${COL.line}"></span>points / decision</span>` +
    `<span><span class="chip" style="background:${COL.avg};height:5px"></span>10-decision moving average</span>`);
  const readout = el('div', '');
  readout.id = 'spark-read';
  readout.textContent = 'Hover the chart to read individual decisions.';
  sec.append(legend, readout);

  const vals = recent.map(e => e.points);
  const ma = movingAvg(vals, 10);

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600, h = 130;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 34, r: 8, t: 8, b: 16 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const x = i => pad.l + (vals.length === 1 ? iw / 2 : (i / (vals.length - 1)) * iw);
    const y = v => pad.t + (1 - v / 1000) * ih;

    // recessive gridlines + axis labels
    ctx.strokeStyle = 'rgba(157,184,165,0.18)';
    ctx.fillStyle = COL.dim;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.lineWidth = 1;
    for (const v of [0, 500, 1000]) {
      ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke();
      ctx.fillText(String(v), pad.l - 5, y(v) + 3);
    }

    const line = (arr, color, width) => {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      arr.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
      ctx.stroke();
    };
    if (vals.length === 1) {
      ctx.fillStyle = COL.line;
      ctx.beginPath(); ctx.arc(x(0), y(vals[0]), 4, 0, Math.PI * 2); ctx.fill();
    } else {
      line(vals, COL.line, 1.5);
      line(ma, COL.avg, 3);
    }
    canvas._geom = { x, pad, iw };
  };

  canvas.addEventListener('mousemove', ev => {
    if (!canvas._geom || !vals.length) return;
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const { pad, iw } = canvas._geom;
    const i = Math.max(0, Math.min(vals.length - 1,
      Math.round(((px - pad.l) / Math.max(iw, 1)) * (vals.length - 1))));
    const e = recent[i];
    readout.textContent = `Decision ${i + 1}/${vals.length}: ${Math.round(e.points)} pts · ${fmt(e.sgLost)} SG lost · ${e.category} · round ${e.round}, hole ${e.hole} (10-avg ${Math.round(ma[i])})`;
  });
  canvas.addEventListener('mouseleave', () => {
    readout.textContent = 'Hover the chart to read individual decisions.';
  });

  // draw after insertion so clientWidth is real
  requestAnimationFrame(draw);
  window.addEventListener('resize', draw);
  return sec;
}

function roundsTable(log) {
  const sec = el('section');
  sec.append(el('h2', '', 'Recent rounds'));
  const order = [];           // rounds in order of first appearance (log is oldest→newest)
  const byRound = new Map();
  for (const e of log) {
    if (!byRound.has(e.round)) { byRound.set(e.round, []); order.push(e.round); }
    byRound.get(e.round).push(e);
  }
  const last8 = order.slice(-8).reverse(); // newest first
  const wrap = el('div', 'tbl-wrap');
  const table = el('table');
  table.innerHTML = '<thead><tr><th>Seed</th><th class="num">Decisions</th><th class="num">Avg pts</th><th class="num">Worst decision (SG)</th></tr></thead>';
  const tbody = el('tbody');
  for (const r of last8) {
    const rows = byRound.get(r);
    const tr = el('tr');
    tr.innerHTML =
      `<td>${esc(r)}</td>` +
      `<td class="num">${rows.length}</td>` +
      `<td class="num">${fmt(avg(rows.map(e => e.points)), 0)}</td>` +
      `<td class="num">${fmt(Math.max(...rows.map(e => e.sgLost)))}</td>`;
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  sec.append(wrap);
  return sec;
}

function hcpSplit(log) {
  const byHcp = new Map();
  for (const e of log) {
    const k = String(e.hcp ?? 'unknown');
    if (!byHcp.has(k)) byHcp.set(k, []);
    byHcp.get(k).push(e);
  }
  if (byHcp.size < 2) return null;
  const sec = el('section');
  sec.append(el('h2', '', 'By handicap profile'));
  const wrap = el('div', 'tbl-wrap');
  const table = el('table');
  table.innerHTML = '<thead><tr><th>Handicap</th><th class="num">Decisions</th><th class="num">Avg pts</th><th class="num">Avg SG lost</th></tr></thead>';
  const tbody = el('tbody');
  for (const [k, rows] of byHcp) {
    const tr = el('tr');
    tr.innerHTML =
      `<td>${esc(k)}</td>` +
      `<td class="num">${rows.length}</td>` +
      `<td class="num">${fmt(avg(rows.map(e => e.points)), 0)}</td>` +
      `<td class="num">${fmt(avg(rows.map(e => e.sgLost)))}</td>`;
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  sec.append(wrap);
  return sec;
}

function emptyState() {
  const sec = el('section');
  sec.id = 'empty';
  sec.innerHTML =
    '<div class="big">No decisions on the card yet 🏌️</div>' +
    '<p>Play a few holes and every aiming call you make — bold or safe — lands here as a strokes-gained story. Come back after your first round.</p>' +
    '<a class="cta" href="index.html">Tee it up</a>';
  return sec;
}

function render() {
  const log = loadLog();
  app.replaceChildren();
  if (!log.length) { app.append(emptyState()); return; }
  app.append(tiles(log), leaks(log), discipline(log));
  const cal = calibration(log);
  if (cal) app.append(cal);
  app.append(trend(log));
  app.append(roundsTable(log));
  const split = hcpSplit(log);
  if (split) app.append(split);
}

window.__dash = { render };
window.addEventListener('storage', ev => {
  if (!ev.key || ev.key === KEY || ev.key === CAL_KEY) render();
});
render();
