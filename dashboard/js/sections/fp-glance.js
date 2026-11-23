// Compare buildings: the pair at a glance, beside "By category".
//
//   Where the scores sit   every evaluated building's score as a histogram (grey), with the pair's scores marked
//                          (navy first, blue second, each named by address underneath), so "83" reads as low,
//                          typical or high. Equal scores share one marker. Only current-system buildings are placed.
//   How items were rated   one 100% bar per building: its rated items split by mark (top, middle, low, lowest), in
//                          the item-rating colours, with the counts. N/A and missing ratings are left out.
//
// Both are drawn to the space the column has, and redrawn when it changes.

import { esc, titleCase, fmt, pct, cssVar, tip, anchorEvent } from '../ui.js';

const STEPS = [
  { key: 'top', label: 'Top mark', color: '--fp-3' },
  { key: 'mid', label: 'Middle', color: '--fp-2' },
  { key: 'low', label: 'Low', color: '--fp-1' },
  { key: 'lowest', label: 'Lowest', color: '--fp-0' },
];
const stepOf = (v, S) => (v <= S.lowMax ? (v === S.min ? 'lowest' : 'low') : v === S.max ? 'top' : 'mid');

export function ratingMix(p) {
  const n = { top: 0, mid: 0, low: 0, lowest: 0 };
  for (const g of p.groups) for (const i of g.items) if (i.status === 'rated') n[stepOf(i.rating, p.scale)]++;
  return n;
}

export function renderGlance(root, pa, pb, { scores, era }) {
  if (!root) return;
  if (!pa || !pb) { root.hidden = true; return; }
  root.hidden = false;
  drawScores(root.querySelector('#fp-g-scores'), pa, pb, scores, era);
  drawMix(root.querySelector('#fp-g-mix'), pa, pb);
}

function drawScores(box, pa, pb, scores, era) {
  if (!box) return;
  box.innerHTML = '';
  const W = Math.max(200, box.clientWidth), H = Math.max(96, Math.min(280, box.clientHeight || 140));
  const m = { t: 26, r: 10, b: 20, l: 10 };
  const sorted = scores.slice().sort(d3.ascending);
  const lo = Math.max(0, Math.floor(Math.min(d3.quantileSorted(sorted, 0.005), pa.rec.score, pb.rec.score) / 5) * 5);
  const x = d3.scaleLinear([lo, 100], [m.l, W - m.r]);
  const bins = d3.bin().domain([lo, 101]).thresholds(d3.range(lo, 101, 2))(sorted.filter((s) => s >= lo));
  const y = d3.scaleLinear([0, d3.max(bins, (b) => b.length)], [H - m.b, m.t]);
  const q1 = d3.quantileSorted(sorted, 0.25), q3 = d3.quantileSorted(sorted, 0.75);
  const on = [['a', pa], ['b', pb]].filter(([, p]) => p.era === era);
  const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img');
  const hit = new Map(on.map(([s, p]) => [s, p]));
  const binOf = (s) => bins.find((b) => s >= b.x0 && s < b.x1);
  svg.append('g').selectAll('rect').data(bins).join('rect')
    .attr('class', (b) => `fp-g-bin${[...hit].filter(([, p]) => binOf(p.rec.score) === b).map(([k]) => ` is-${k}`).join('')}`)
    .attr('x', (b) => x(b.x0) + 1).attr('width', (b) => Math.max(1, x(b.x1) - x(b.x0) - 2))
    .attr('y', (b) => y(b.length)).attr('height', (b) => Math.max(0, y(0) - y(b.length)))
    .attr('rx', 1.5);
  // hover: a full-height target per bin, so thin bars are easy to hit
  const binTip = (b) => {
    const who = [...hit].filter(([, p]) => binOf(p.rec.score) === b).map(([, p]) => `<dt>${esc(titleCase(p.rec.address))}</dt><dd><b>${p.rec.score}</b></dd>`).join('');
    return `<div class="tt-title">Score ${b.x0}${b.x1 - b.x0 > 1 ? `–${Math.min(100, b.x1 - 1)}` : ''}</div><dl><dt>Buildings</dt><dd><b>${fmt.n(b.length)}</b> (${pct(b.length / sorted.length, 1)})</dd>${who}</dl>`;
  };
  svg.append('g').attr('class', 'fp-g-hits').selectAll('rect').data(bins).join('rect')
    .attr('x', (b) => x(b.x0)).attr('width', (b) => Math.max(1, x(b.x1) - x(b.x0))).attr('y', m.t - 6).attr('height', H - m.b - m.t + 6)
    .attr('fill', 'transparent')
    .on('mouseenter', function (ev, b) { d3.select(this).classed('is-hot', true); tip.show(binTip(b), ev); })
    .on('mousemove', (ev) => tip.move(ev))
    .on('mouseleave', function () { d3.select(this).classed('is-hot', false); tip.hide(); });
  svg.append('line').attr('class', 'fp-g-base').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0) + 0.5).attr('y2', y(0) + 0.5);
  for (const t of [lo, ...d3.range(Math.ceil(lo / 10) * 10, 101, 10)].filter((t, i, a) => a.indexOf(t) === i && (t === lo || t - lo >= 6))) {
    svg.append('text').attr('class', 'fp-g-tick').attr('x', x(t)).attr('y', H - 5).attr('text-anchor', t === 100 ? 'end' : t === lo ? 'start' : 'middle').text(t);
  }
  // The pair: a line down to the axis and its score in a chip at the top (navy for the first building, blue for the
  // second). Chips that would touch are nudged apart. Two equal scores share ONE marker and one caption.
  const name = (p) => esc(titleCase(p.rec.address));
  const better = (sc) => pct(d3.bisectLeft(sorted, sc) / sorted.length);
  const same = on.length === 2 && pa.rec.score === pb.rec.score;
  const marks = (same ? [{ s: 'same', score: pa.rec.score, ps: [pa, pb] }] : on.map(([s, p]) => ({ s, score: p.rec.score, ps: [p] })))
    .map((d) => ({ ...d, x: x(d.score + 0.5), w: 14 + String(d.score).length * 8 })).sort((u, v) => u.x - v.x);
  marks.forEach((d) => { d.cx = Math.max(m.l + d.w / 2, Math.min(W - m.r - d.w / 2, d.x)); });
  if (marks.length === 2) {
    const need = (marks[0].w + marks[1].w) / 2 + 4;
    if (marks[1].cx - marks[0].cx < need) {
      const mid = (marks[0].cx + marks[1].cx) / 2;
      marks[0].cx = mid - need / 2; marks[1].cx = mid + need / 2;
      if (marks[0].cx < m.l + marks[0].w / 2) { marks[0].cx = m.l + marks[0].w / 2; marks[1].cx = marks[0].cx + need; }
      if (marks[1].cx > W - m.r - marks[1].w / 2) { marks[1].cx = W - m.r - marks[1].w / 2; marks[0].cx = marks[1].cx - need; }
    }
  }
  for (const d of marks) {
    const g = svg.append('g').attr('class', `fp-g-mark is-${d.s}`)
      .on('mouseenter', (ev) => tip.show(`<div class="tt-title">Score ${d.score}</div><dl>${d.ps.map((p) => `<dt>${name(p)}</dt><dd><b>${d.score}</b>/100</dd>`).join('')}<dt>Higher than</dt><dd>${better(d.score)} of Toronto buildings</dd></dl>`, ev))
      .on('mousemove', (ev) => tip.move(ev))
      .on('mouseleave', () => tip.hide());
    g.append('title').text(d.ps.map((p) => `${titleCase(p.rec.address)}: ${d.score}`).join('; '));
    g.append('line').attr('x1', d.x).attr('x2', d.x).attr('y1', 20).attr('y2', y(0));
    g.append('rect').attr('x', d.cx - d.w / 2).attr('y', 2).attr('width', d.w).attr('height', 18).attr('rx', 9);
    g.append('text').attr('x', d.cx).attr('y', 15).attr('text-anchor', 'middle').text(d.score);
  }
  const note = box.parentElement.querySelector('.fp-g-note');
  if (note) {
    const who = (s, p) => `<span class="fp-g-who is-${s}"><i aria-hidden="true"></i>${name(p)}</span>`;
    const off = [['a', pa], ['b', pb]].filter(([, p]) => p.era !== era);
    note.innerHTML = same
      ? `<span class="fp-g-line">Both scored <b>${pa.rec.score}</b>, higher than <b>${better(pa.rec.score)}</b> of Toronto buildings.</span>`
      : [...on.map(([s, p]) => `<span class="fp-g-line">${who(s, p)} <b>${p.rec.score}</b>, higher than <b>${better(p.rec.score)}</b></span>`),
        ...off.map(([, p]) => `<span class="fp-g-line">${name(p)} was scored under the older system, so it isn’t placed here.</span>`)].join('');
  }
  svg.attr('aria-label', `Scores of Toronto’s ${fmt.n(sorted.length)} evaluated buildings. Half score between ${q1} and ${q3}. ${same ? `Both buildings scored ${pa.rec.score}, higher than ${better(pa.rec.score)} of buildings.` : on.map(([, p]) => `${titleCase(p.rec.address)} scored ${p.rec.score}, higher than ${better(p.rec.score)} of buildings.`).join(' ')}`);
}

function drawMix(box, pa, pb) {
  if (!box) return;
  const rows = [['a', pa], ['b', pb]].map(([s, p]) => {
    const n = ratingMix(p), total = n.top + n.mid + n.low + n.lowest;
    const segs = STEPS.filter((st) => n[st.key]).map((st) => {
      const w = (n[st.key] / total) * 100;
      const range = p.scale.max === 3 ? { top: '3', mid: '2', low: '1', lowest: '0' }[st.key] : { top: '5', mid: '3–4', low: '2', lowest: '1' }[st.key];
      return `<span class="fp-mix-seg is-${st.key}" style="flex-grow:${n[st.key]}; background:${cssVar(st.color)}" data-tip="${esc(`${st.label} (${range} of ${p.scale.max}): ${n[st.key]} of ${total} items, ${pct(n[st.key] / total)}`)}">${w >= 9 ? `<span>${n[st.key]}</span>` : ''}</span>`;
    }).join('');
    const low = n.low + n.lowest;
    return `<div class="fp-mix-row" data-slot="${s}">
      <div class="fp-mix-head"><span class="fp-g-who is-${s}"><i aria-hidden="true"></i>${esc(titleCase(p.rec.address))}</span><span class="fp-mix-val"><b>${low}</b> rated low</span></div>
      <div class="fp-mix-bar" role="img" aria-label="${esc(titleCase(p.rec.address))}: ${STEPS.map((st) => `${n[st.key]} ${st.label.toLowerCase()}`).join(', ')}, of ${total} rated items">${total ? segs : '<span class="fp-mix-none">No rated items</span>'}</div>
    </div>`;
  }).join('');
  const scaleNote = pa.era !== pb.era ? '<span class="fp-mix-sys">Each on its own system’s scale.</span>' : '';
  box.innerHTML = `${rows}<div class="fp-mix-key" aria-hidden="true">${STEPS.map((st) => `<span><i style="background:${cssVar(st.color)}"></i>${st.label}</span>`).join('')}</div>${scaleNote}`;
  box.querySelectorAll('.fp-mix-seg').forEach((el) => {
    el.addEventListener('mouseenter', (e) => tip.show(`<div class="tt-title">${el.dataset.tip}</div>`, e));
    el.addEventListener('mousemove', (e) => tip.move(e));
    el.addEventListener('mouseleave', () => tip.hide());
    el.addEventListener('click', () => tip.show(`<div class="tt-title">${el.dataset.tip}</div>`, anchorEvent(el)));
  });
}
