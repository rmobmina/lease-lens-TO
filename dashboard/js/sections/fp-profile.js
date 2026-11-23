// By category: the comparison at a glance, as a mirrored ("butterfly") bar chart.
//
// One row per inspection area. The first building's bar grows LEFT from the centre, the second's grows RIGHT, with
// the area named between them; both in the concern red. Each column is headed by its building's address (with the
// building's navy or blue rule under it); on phones, where the rows stack, each bar is labelled with the address.
// Both sides share ONE percentage scale: the share of that area's rated items that were rated low. Each side keeps
// its own count and denominator ("2 of 12"); N/A and missing ratings are never in the denominator, and an area with
// nothing rated says "No rated items" instead of drawing a zero.
//
// Selecting an area opens its items in "Every item" (onArea). Bars ease from their previous widths, so picking
// another pair moves them. The rows are fitted to the panel by the caller (fp-fit.js) and paged if they don't fit.

import { esc, titleCase, pct, tip, anchorEvent } from '../ui.js';
import { pairedProfile } from '../fingerprint-model.js';
import { reducedMotion } from '../motion.js';

const prevW = new Map();   // `${area}:${slot}` → the width drawn last

export function renderProfile(box, pa, pb, { onArea } = {}) {
  if (!pa || !pb) { box.innerHTML = ''; box.hidden = true; return []; }
  box.hidden = false;
  const { rows, domain } = pairedProfile(pa, pb);
  const twoSystems = pa.era !== pb.era;

  const name = (p) => esc(titleCase(p.rec.address));
  const width = (g) => (g.rated ? Math.max(0, Math.min(100, (g.low / g.rated / domain) * 100)) : 0);
  const spoken = (g) => (g.rated ? `${g.low} of ${g.rated} rated low` : 'no rated items');
  const cell = (r, slot) => {
    const g = r[slot], key = `${r.key}:${slot}`;
    return `<td class="pf-cell${g.rated ? '' : ' is-none'}" data-slot="${slot}">
        <span class="pf-who" aria-hidden="true">${name(slot === 'a' ? pa : pb)}</span>
        <span class="pf-track" data-key="${key}" style="--w:${(prevW.get(key) ?? 0).toFixed(2)}%" data-w="${width(g).toFixed(2)}"><span class="pf-bar"></span></span>
        <span class="pf-val">${g.rated ? `<b>${g.low}</b> of ${g.rated}` : 'No rated items'}</span>
      </td>`;
  };
  const ticks = [0, domain / 2, domain].map((t) => `<span>${t ? pct(t) : '0'}</span>`);
  const axis = (slot) => `<div class="pf-axis" data-slot="${slot}">${(slot === 'a' ? [...ticks].reverse() : ticks).join('')}</div>`;

  box.innerHTML = `<table class="pf"><colgroup><col /><col class="pf-col-area" /><col /></colgroup>
    <caption class="pf-cap visually-hidden">Share of each area’s rated items rated low${twoSystems ? ', each on its own system’s scale (0–1 of 3, or 1–2 of 5)' : ' (0 or 1 of 3)'}, one scale for A and B. N/A and missing ratings are left out. Select an area for its items.</caption>
    <thead><tr>
      <th scope="col" class="pf-h" data-slot="a"><span class="pf-key">${name(pa)}</span></th>
      <th scope="col" class="pf-h-area">Inspection area</th>
      <th scope="col" class="pf-h" data-slot="b"><span class="pf-key">${name(pb)}</span></th>
    </tr></thead>
    <tbody>${rows.map((r) => `
      <tr class="pf-row" data-key="${r.key}">
        ${cell(r, 'a')}
        <th scope="row" class="pf-area"><button type="button" class="pf-row-btn" data-key="${r.key}"
          aria-label="${esc(r.label)}: ${name(pa)} ${spoken(r.a)}, ${name(pb)} ${spoken(r.b)}. Show its items."><span class="pf-label">${esc(r.label)}</span></button></th>
        ${cell(r, 'b')}
      </tr>`).join('')}</tbody>
    <tfoot aria-hidden="true"><tr><td>${axis('a')}</td><td></td><td>${axis('b')}</td></tr></tfoot></table>`;

  const table = box.querySelector('table');
  table.addEventListener('click', (e) => {
    const btn = e.target.closest('.pf-row-btn');
    if (btn) onArea?.(btn.dataset.key);
  });
  // hover anywhere on a row (or focus its area button) for both buildings' numbers
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const line = (slot, p, g) => `<dt>${name(p)}</dt><dd>${g.rated ? `<b>${g.low} of ${g.rated}</b> rated low (${pct(g.low / g.rated)})` : 'No rated items'}</dd>`;
  const tipHtml = (r) => `<div class="tt-title">${esc(r.label)}</div><dl>${line('a', pa, r.a)}${line('b', pb, r.b)}</dl><div class="tt-sub">Select to see its items</div>`;
  table.querySelectorAll('.pf-row').forEach((tr) => {
    const r = byKey.get(tr.dataset.key), btn = tr.querySelector('.pf-row-btn');
    tr.addEventListener('mouseenter', (e) => tip.show(tipHtml(r), e));
    tr.addEventListener('mousemove', (e) => tip.move(e));
    tr.addEventListener('mouseleave', () => tip.hide());
    btn.addEventListener('focus', () => tip.show(tipHtml(r), anchorEvent(btn)));
    btn.addEventListener('blur', () => tip.hide());
  });
  // the bars ease from their last widths to the new ones
  const tracks = [...table.querySelectorAll('.pf-track')];
  const set = () => tracks.forEach((t) => { t.style.setProperty('--w', `${t.dataset.w}%`); prevW.set(t.dataset.key, +t.dataset.w); });
  if (reducedMotion()) set(); else requestAnimationFrame(() => requestAnimationFrame(set));
  return [...table.querySelectorAll('.pf-row')];
}
