// "Is this score still current?" One building's evaluations over time (D3).
// Points are connected only within one scoring system; the change shown for each point is
// against the previous evaluation in the SAME system. Selecting a point shows that inspection
// in the X-Ray above (every evaluation in the data has item-level ratings).

import { timelineSegments, trendSummary } from '../xray-model.js';
import { tip, esc, formatDate, signed, cssVar, anchorEvent } from '../ui.js';
import { reducedMotion } from '../motion.js';

const SYSTEM = { pre: '2017 – 2023 system', cur: '2023 – now system' };

// `where` names what a point opens, so the same chart reads correctly beside the map ('inMap': the
// point opens the X-Ray) and inside the X-Ray ('inXray': it replaces the inspection shown above).
const WORDS = {
  inXray: { shown: 'Shown in the X-Ray above.', pick: 'Click to show this inspection in the X-Ray.', aShown: ' Shown in the X-Ray.', aPick: ' Press Enter to show it in the X-Ray.', group: 'Enter to show one in the X-Ray' },
  inMap: { shown: 'The latest evaluation, shown on the map.', pick: 'Click to inspect this evaluation in the X-Ray.', aShown: ' Shown on the map.', aPick: ' Press Enter to inspect it in the X-Ray.', group: 'Enter to inspect one in the X-Ray' },
};

// Two ways to use a point:
//   onPick(uid)    a point opens that evaluation at once (beside the map, in the story).
//   onSelect(uid)  a point becomes the chart's selection (Building Explorer History): a ring moves to it and the
//                  page shows what was picked, with its own "Inspect this evaluation" action. ← → move between points.
// summary: false leaves the headline to the page (the Explorer writes its own).
// legendInside: the given height includes the legend (the chart fills a fixed box); otherwise the legend adds to it.
//
// Annotations: the score above each marker, the change from the previous evaluation IN THE SAME SYSTEM below it.
// Which scoring systems the building has are named in a compact legend above the plot (never inside it). Labels
// that would overlap give way by priority (the selected or shown point, then the latest, then the most recent);
// a hidden label's exact value is still in the point's tooltip (hover, focus, tap) and its accessible name.
export function renderTimeline(box, { points, shown, era, P, systemChange, onPick, onSelect, selected = null, where = 'inXray', height: fixedH = 230, brief = false, summary: withSummary = true, legendInside = false }) {
  const W = onSelect ? { ...WORDS[where], shown: 'The inspection shown in the Inspection view.', pick: 'Select to see this evaluation.', aShown: ' Shown in the Inspection view.', aPick: '', group: 'Enter to select one' } : WORDS[where];
  box.innerHTML = '';
  const summary = document.createElement('p');
  summary.className = 'xr-tl-summary';
  if (withSummary) box.append(summary);

  const t = trendSummary(points, era);
  const other = points.filter((p) => p.era !== era).length;
  const otherTxt = other && brief ? ` Grey: ${other} earlier-system evaluation${other === 1 ? '' : 's'}, not compared.` : other ? ` This building also has ${other} evaluation${other === 1 ? '' : 's'} in the ${era === 'cur' ? '2017 – 2023' : '2023 – now'} system, drawn in grey. Those scores used different items and a different scale, so they aren't connected or compared.` : '';
  if (t.kind === 'empty') {
    summary.innerHTML = `No evaluations in the ${esc(P.long)}.${otherTxt}`;
    if (!points.length) return;
  } else if (t.kind === 'single') {
    summary.innerHTML = `Only one evaluation in the ${esc(P.long)} (${formatDate(t.latest.rec.date)}, score <b>${t.latest.rec.score}</b>). There isn't enough history to show a trend yet.${otherTxt}`;
  } else {
    const d = t.latest.delta;
    summary.innerHTML = `${d === 0 ? 'No change' : `<b>${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)} point${Math.abs(d) === 1 ? '' : 's'}</b>`} at the latest evaluation (${formatDate(t.latest.rec.date)}, score <b>${t.latest.rec.score}</b>) compared with the one before (${formatDate(t.latest.prev.date)}, ${t.latest.prev.score}).
      ${t.n > 2 ? `${t.n} evaluations in this system, ${signed(t.total)} points overall.` : ''}${brief ? '' : ' A score describes the building on inspection day, so an older score may no longer reflect it.'}${otherTxt}`;
  }

  // the legend: only the systems this building's history has, swatches drawn like the lines
  const eras = ['cur', 'pre'].filter((e) => points.some((p) => p.era === e)).sort((a, b) => (a === era ? -1 : b === era ? 1 : 0));
  const legend = document.createElement('p');
  legend.className = 'xr-tl-legend';
  legend.innerHTML = eras.map((e) => `<span class="xr-tl-key"><span class="xr-tl-swatch${e === era ? '' : ' is-other'}" aria-hidden="true"></span>${SYSTEM[e]}${e === era ? '' : ' (not compared)'}</span>`).join('');
  box.append(legend);

  const width = Math.max(200, Math.min(box.clientWidth || 260, box.getBoundingClientRect().width || Infinity)); // never wider than its box
  const height = Math.max(120, fixedH - (legendInside ? legend.offsetHeight + 4 : 0));
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;   // Display text size
  // room for a score label above the top marker and a change label below the lowest one
  const m = { top: Math.round(30 * fs), right: 16, bottom: Math.round(30 * fs), left: Math.round(34 * fs) };
  if (onSelect) { m.top = Math.round(36 * fs); m.right = 20; m.left = Math.round(40 * fs); }
  // the left margin fits the widest score tick ("100") at the current text size
  {
    const probe = d3.select(box).append('svg').attr('width', 0).attr('height', 0).attr('class', 'xr-tl').style('position', 'absolute');
    const t = probe.append('g').attr('class', 'axis').append('g').attr('class', 'tick').append('text').text('100');
    m.left = Math.max(m.left, Math.ceil(t.node().getBBox().width) + 12);
    probe.remove();
  }
  const times = points.map((p) => p.rec.time);
  let [t0, t1] = [Math.min(...times), Math.max(...times)];
  const pad = Math.max(864e5 * 120, (t1 - t0) * 0.08);
  t0 -= pad; t1 += pad;
  // at least two years on the axis, so its ticks are always whole years (one evaluation, or close dates)
  const YEAR = 864e5 * 365.25;
  if (t1 - t0 < 2 * YEAR) { const mid = (t0 + t1) / 2; t0 = mid - YEAR; t1 = mid + YEAR; }
  const x = d3.scaleTime().domain([t0, t1]).range([m.left, width - m.right]);
  const minScore = Math.min(...points.map((p) => p.rec.score));
  const y = d3.scaleLinear().domain([Math.min(50, Math.floor((minScore - 10) / 10) * 10), 100]).range([height - m.bottom, m.top]);

  const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height)
    .attr('class', `xr-tl${onSelect ? ' xr-tl-select' : ''}`).attr('role', 'group').attr('aria-label', `Score history: ${points.length} evaluation${points.length === 1 ? '' : 's'}. Use Tab to move between points and ${W.group}.`);

  // system change marker (only if the building's history spans it)
  const change = new Date(systemChange + 'T00:00:00').getTime();
  // both systems present: the older one's span shaded, with a dashed divider at the change (named in the legend)
  if (eras.length > 1 && change > t0 && change < t1) {
    svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', x(change) - m.left).attr('height', height - m.bottom - m.top).attr('fill', cssVar('--surface-2'));
    svg.append('line').attr('class', 'xr-tl-divider').attr('x1', x(change)).attr('x2', x(change)).attr('y1', m.top).attr('y2', height - m.bottom).attr('stroke', cssVar('--axis')).attr('stroke-dasharray', '3 3');
  }
  // as many score ticks as the plot height has room for at this text size (a short popup gets fewer)
  const yTicks = Math.max(2, Math.min(5, Math.floor((height - m.top - m.bottom) / (26 * fs))));
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(yTicks).tickSize(-(width - m.left - m.right)).tickFormat(''));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(yTicks).tickSizeOuter(0));
  // whole years, as many as fit; a year label that would touch the score axis or the edge is left out
  const years = Math.max(1, Math.ceil(((t1 - t0) / YEAR) / Math.max(1, Math.floor((width - m.left - m.right) / (48 * fs)))));
  const xAxis = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).ticks(d3.timeYear.every(years)).tickFormat(d3.timeFormat('%Y')).tickSizeOuter(0));
  xAxis.selectAll('.tick').each(function () {
    const b = this.getBBox(), cx = +this.getAttribute('transform').match(/translate\(([-\d.]+)/)[1];
    if (cx + b.x < m.left - 4 || cx + b.x + b.width > width) d3.select(this).select('text').attr('opacity', 0);
  });

  const accent = cssVar('--accent'), muted = cssVar('--muted'), surface = cssVar('--surface');
  const colorOf = (p) => (p.era === era ? accent : muted);
  for (const s of timelineSegments(points)) {
    svg.append('path').datum(s.points).attr('fill', 'none').attr('stroke', colorOf(s.points[0])).attr('stroke-width', s.points[0].era === era ? 2 : 1.25)
      .attr('stroke-dasharray', s.points[0].era === era ? null : '4 3')
      .attr('d', d3.line().x((p) => x(p.rec.time)).y((p) => y(p.rec.score)));
  }

  const latestInEra = points.filter((p) => p.era === era).at(-1);
  const isSel = (p) => (onSelect ? p.rec.uid === selected : p.rec === shown);
  const g = svg.append('g').selectAll('g').data(points).join('g')
    .attr('class', (p) => `xr-tl-pt${isSel(p) ? ' is-shown' : ''}${p.rec === shown ? ' is-current' : ''}`)
    .attr('transform', (p) => `translate(${x(p.rec.time)},${y(p.rec.score)})`)
    .attr('tabindex', (p) => (!onSelect || isSel(p) || (!points.some(isSel) && p === points.at(-1)) ? 0 : -1)).attr('role', 'button')
    .attr('aria-pressed', (p) => String(isSel(p)))
    .attr('aria-label', (p) => `${formatDate(p.rec.date)}, score ${p.rec.score}, ${SYSTEM[p.era]}. ${deltaText(p)}${p === latestInEra ? ' Latest in this system.' : ''}${p.rec === shown ? W.aShown : W.aPick}`);
  g.append('circle').attr('r', 16).attr('fill', 'transparent'); // generous hit target
  // the selection ring: one element that travels to the chosen point (Explorer), or a ring per shown point
  let ring = null;
  if (onSelect) {
    const at = points.find(isSel);
    ring = svg.append('circle').attr('class', 'xr-tl-ring').attr('r', 11).attr('fill', 'none').attr('stroke', accent).attr('stroke-width', 2)
      .attr('pointer-events', 'none').attr('opacity', at ? 1 : 0)
      .attr('cx', at ? x(at.rec.time) : 0).attr('cy', at ? y(at.rec.score) : 0);
  } else g.filter((p) => p.rec === shown).append('circle').attr('r', 10).attr('fill', 'none').attr('stroke', accent).attr('stroke-width', 2);
  g.append('circle').attr('r', (p) => (p === latestInEra ? 6.5 : 5))
    .attr('fill', (p) => (p.era === era ? accent : surface)).attr('stroke', (p) => (p.era === era ? surface : muted)).attr('stroke-width', 2);
  // the score above each marker (the latest in bold), the same-system change below it
  g.append('text').attr('class', (p) => `xr-tl-score ${p === latestInEra ? 'annot' : 'annot-sub'}`).attr('y', onSelect ? -19 : -15).attr('text-anchor', 'middle')
    .attr('aria-hidden', 'true').text((p) => p.rec.score);
  g.filter((p) => p.delta != null).append('text').attr('class', 'xr-tl-delta annot-sub').attr('y', onSelect ? 19 : 14).attr('dy', '0.71em').attr('text-anchor', 'middle')
    .attr('aria-hidden', 'true').text((p) => (p.delta === 0 ? '±0' : signed(p.delta)));
  const layoutLabels = () => placeLabels(g, points, { bounds: [0, width], priority: (p) => (isSel(p) ? 3 : p.rec === shown ? 2 : p === latestInEra ? 1 : 0) });
  layoutLabels();
  if (ring) ring.raise();

  const html = (p) => `<div class="tt-title">${p.rec.score} / 100</div><div class="tt-sub">${formatDate(p.rec.date)} · ${SYSTEM[p.era]}</div>
    <dl><dt>Change</dt><dd>${deltaText(p)}</dd></dl><p class="tt-hint">${p.rec === shown ? W.shown : W.pick}</p>`;
  const reduced = reducedMotion();
  const choose = (p) => {
    tip.hide();
    if (!onSelect) { onPick(p.rec.uid); return; }
    selected = p.rec.uid;
    g.classed('is-shown', isSel).attr('aria-pressed', (d) => String(isSel(d))).attr('tabindex', (d) => (isSel(d) ? 0 : -1));
    layoutLabels();   // the newly selected point's labels take priority
    // the ring travels to the new point (interruptible: a new choice restarts from where it is)
    ring.interrupt().transition().duration(reduced ? 0 : 280).ease(d3.easeCubicOut)
      .attr('cx', x(p.rec.time)).attr('cy', y(p.rec.score)).attr('opacity', 1);
    onSelect(p.rec.uid);
  };
  const nodes = g.nodes();
  g.on('mouseenter', (ev, p) => tip.show(html(p), ev)).on('mousemove', (ev) => tip.move(ev)).on('mouseleave', () => tip.hide())
    .on('focus', function (ev, p) { tip.show(html(p), anchorEvent(this)); }).on('blur', () => tip.hide())
    .on('click', (ev, p) => choose(p))
    .on('keydown', function (ev, p) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); choose(p); return; }
      if (!onSelect) return;
      const i = nodes.indexOf(this);
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: nodes.length - 1 }[ev.key];
      if (j == null || j < 0 || j >= nodes.length) return;
      ev.preventDefault();
      nodes[j].focus();
      choose(points[j]);
    });
}

// Show every label that fits; where two would overlap, the lower-priority one (then the older one) is hidden. A
// label near either edge is shifted inward rather than cut off. Hidden labels' values stay in the tooltip and
// the point's accessible name.
function placeLabels(g, points, { bounds: [lo, hi], priority }) {
  // each label's own spot (score above, change below), then beside the marker if that spot is taken
  const labels = [];
  g.each(function (p, i) {
    const m = this.transform.baseVal.consolidate()?.matrix;
    const ox = m ? m.e : 0, oy = m ? m.f : 0;
    d3.select(this).selectAll('text').each(function () {
      const t = d3.select(this).attr('opacity', null).attr('dx', null);
      const score = t.classed('xr-tl-score');
      if (this.dataset.homeY == null) this.dataset.homeY = t.attr('y');   // its own spot, kept across re-layouts
      const home = { x: 0, y: +this.dataset.homeY, anchor: 'middle' };
      t.attr('y', home.y);
      t.attr('x', 0).attr('text-anchor', 'middle');
      const b = this.getBBox();
      const mid = b.y + b.height / 2 - home.y;   // the text's vertical centre, relative to its y
      const side = score ? -1 : 1;               // a score moves to the upper side, a change to the lower
      const off = priority(p) >= 2 ? 20 : 10;   // clear of the selection and focus rings
      const spots = [home,
        { x: -off, y: side * 4 - mid, anchor: 'end' }, { x: off, y: side * 4 - mid, anchor: 'start' }];
      labels.push({ t, p, i, score, ox, oy, w: b.width, h: b.height, top: b.y - home.y, spots });
    });
  });
  const boxOf = (L, s) => {
    const left = L.ox + s.x - (s.anchor === 'middle' ? L.w / 2 : s.anchor === 'end' ? L.w : 0);
    let dx = 0;
    if (left < lo + 2) dx = lo + 2 - left; else if (left + L.w > hi - 2) dx = hi - 2 - (left + L.w);
    return { dx, l: left + dx - 2, r: left + dx + L.w + 2, t: L.oy + s.y + L.top, b: L.oy + s.y + L.top + L.h };
  };
  const dots = [];
  // other markers (with their selection ring) are obstacles: a label never sits on another point
  g.each(function (p) { const m = this.transform.baseVal.consolidate()?.matrix; const r = priority(p) >= 2 ? 14 : 7; if (m) dots.push({ p, l: m.e - r, r: m.e + r, t: m.f - r, b: m.f + r }); });
  const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  labels.sort((a, b) => priority(b.p) - priority(a.p) || (b.score - a.score) || b.i - a.i);
  const kept = [];
  for (const L of labels) {
    const spot = L.spots.map((s) => ({ s, box: boxOf(L, s) }))
      .find(({ box }) => !kept.some((k) => hit(k, box)) && !dots.some((d) => d.p !== L.p && hit(d, box)));   // its own spots are already clear of its own ring
    if (!spot) { L.t.attr('opacity', 0); continue; }
    L.t.attr('x', spot.s.x).attr('y', spot.s.y).attr('text-anchor', spot.s.anchor).attr('dx', spot.box.dx || null);
    kept.push(spot.box);
  }
}

function deltaText(p) {
  if (p.delta == null) return p.prev == null && p.era === 'cur' ? 'First evaluation in the 2023 – now system; not compared with older scores.' : 'First evaluation in this system.';
  return p.delta === 0 ? `No change from ${formatDate(p.prev.date)}.` : `${signed(p.delta)} points since ${formatDate(p.prev.date)} (${p.prev.score}).`;
}
