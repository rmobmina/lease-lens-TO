// Compare buildings: the one comparison view in LeaseLens, a purpose-built side-by-side comparison.
//
// Two building summaries of equal width lead the page, one column per building: its address selector, overall
// score, inspection date and a link to its inspection. One short observation from the data follows, then three
// views of the same pair, always A on the left and B on the right:
//   By category      paired bars per inspection area on one scale (fp-profile.js)
//   Every item       one shared matrix: a row per inspection item, grouped by area; item · A · B (fp-rows.js)
//   All of Toronto   the citywide context for every item (or the ward's, when a ward filter is on, and it says so)
//
// One layout, one pair of building selectors (A and B) and one comparison state (main.js state.fp), whichever
// way the reader arrives; the entry point only supplies the first selection:
//   Same score, different story   #/compare          an example pair with the same score
//   a building's inspection       #/compare/<A>      that building as A; B is a building with exactly the same
//                                                    score in the same scoring system (the most different one),
//                                                    or empty with a note when there is none
//   the map's Compare mode        #/compare/<A>/<B>  exactly that pair, whatever their scores
// Either building can be replaced through address search, including with a building of a different score or one
// evaluated only under the 2017 – 2023 system. Both actual scores are always shown. Scores and ratings are compared
// only within one scoring system: a pair from the two systems lists each building's items side by side, each on its
// own scale, and says so. All data work lives in ../fingerprint-model.js; this file only draws and handles input.

import { enhanceSelect } from '../components/select.js';
import { initSearch } from '../atlas/search.js';
import { itemLabel } from '../model.js';
import { itemStats, buildingProfile, eraProfile, pairRows, rowMatches, pairObservation, sameScorePairs, sameScoreMatch, scoreOptions, cityFindings, SCALES, UNCOMMON_SHARE, FP_GROUPS } from '../fingerprint-model.js';
import { tip, pct, fmt, esc, titleCase, formatDate, cssVar, anchorEvent } from '../ui.js';
import { renderProfile } from './fp-profile.js';
import { renderGlance } from './fp-glance.js';
import { fitRows, areaPicker } from './fp-fit.js';
import { rowsHtml, colHead, bindItemTips } from './fp-rows.js';
import { reducedMotion } from '../motion.js';

const $ = (id) => document.getElementById(id);
const GAP = 3;
const PER_ROW = 13; // the largest group has 13 items, so each group fits on one row when there's room
const reduceMotion = reducedMotion;

let layoutCache = { key: null, layout: null };
let searchCache = { key: null, list: [] };
let wired = false;
// One view at a time (By category · Every item · All of Toronto), swapped in place so the page fits the
// window. Charts measure the panel they are drawn in, so the shown panel is redrawn when it changes.
const TABS = ['profile', 'items', 'city'];
let tab = 'profile';
let last = null;
let shown = null; // the pair on screen, for the address suggestions
// Every item: which rows to show, which area (one at a time) and the first row of the page shown. The page goes
// back to the first whenever the pair, the area or the filter changes.
let filter = 'all';
let itemsArea = null;
let itemsFirst = 0;
let profileFirst = 0;
let cityArea = null;
let pairKey = '';
const SHORT = new Map(FP_GROUPS.map((g) => [g.key, g.short]));
// an area's short name, with everything after its first word dropped on phones ("Shared spaces" → "Shared")
const phoneShort = (s) => { const [w, ...rest] = s.split(' '); return rest.length ? `${w}<span class="fp-wide-only"> ${rest.join(' ')}</span>` : w; };

const ratingColor = (v) => cssVar(`--fp-${v}`);
const sysName = (r) => SCALES[r.era].system;

export function renderFingerprint(ctx, M, state) {
  const { pm } = ctx;
  last = [ctx, M, state];
  wire(ctx);
  syncTabs();
  const off = pm.era !== 'cur';
  $('fp-unavailable').hidden = !off;
  $('fp-main').hidden = off;
  if (off) return;

  // The grid order and the "uncommon" reference always use all of Toronto, so a building's
  // items read the same way whichever ward filter is on.
  if (layoutCache.key !== pm) { const lay = itemStats(pm.latest, pm.cats, itemLabel); layoutCache = { key: pm, layout: lay, scores: pm.latest.map((r) => r.score) }; }
  const layout = layoutCache.layout;
  const other = M.byPeriod.pre;

  // ---- which two buildings -------------------------------------------------
  // state.a / state.b are the reader's choices (or the entry point's); a B that is only suggested is never
  // stored, so replacing A suggests again. A building evaluated only under the 2017 – 2023 system is found there.
  const pool = ctx.latest.length >= 2 ? ctx.latest : pm.latest;
  const options = scoreOptions(pool);
  if (!options.some((o) => o.score === state.score)) state.score = options.some((o) => o.score === 92) ? 92 : d3.median(options, (o) => o.score) | 0;
  const find = (rsn) => (rsn ? pm.latestByRsn.get(rsn) ?? other.latestByRsn.get(rsn) ?? null : null);
  let a = find(state.a);
  let b = find(state.b);
  let pairs = [];
  let mode = 'example';
  let suggested = false;
  if (state.a || state.b) {
    mode = 'custom';
    if (a && !state.b && a.era === pm.era) { b = sameScoreMatch(a, pool.some((r) => r.rsn === a.rsn) ? pool : pm.latest, pm.cats) ?? sameScoreMatch(a, pm.latest, pm.cats); suggested = !!b; }
  } else {
    pairs = sameScorePairs(pool, state.score, pm.cats);
    if (!pairs.length) pairs = sameScorePairs(pm.latest, state.score, pm.cats);
    [a, b] = pairs[state.pairIndex % Math.max(1, pairs.length)] ?? [];
  }
  const profile = (r) => r && (r.era === pm.era ? buildingProfile(r, layout) : eraProfile(r, other.cats, itemLabel));
  const pa = profile(a), pb = profile(b);

  // ---- the two summaries and the examples control ------------------------------
  // The examples menu always shows the score on screen: the pair's score, or building A's when the reader chose
  // their own buildings (choosing a score from it goes back to matched pairs at that score).
  const shownScore = mode === 'custom' && a && a.era === pm.era ? a.score : state.score;
  const opts = options.some((o) => o.score === shownScore) ? options : [...options, { score: shownScore, n: 1 }].sort((x, y) => x.score - y.score);
  const sel = $('fp-score');
  sel.innerHTML = opts.map((o) => `<option value="${o.score}" ${o.score === shownScore ? 'selected' : ''}>${o.score} (${fmt.n(o.n)} building${o.n === 1 ? '' : 's'})</option>`).join('');
  shown = { a, b, pm, other };
  $('fp-examples-wrap').hidden = off;
  $('fp-next').hidden = mode === 'custom' || pairs.length < 2;
  $('fp-next').textContent = pairs.length > 1 ? `Show another pair (${(state.pairIndex % pairs.length) + 1} of ${pairs.length})` : '';
  $('fp-reset').hidden = mode !== 'custom';
  for (const [slot, r] of [['a', a], ['b', b]]) {
    $(`fp-${slot}-name`).textContent = r ? titleCase(r.address) : '';
    // the search bar shows the building's address (left alone while the reader is typing in it)
    if (document.activeElement !== $(`fp-${slot}`)) $(`fp-${slot}`).value = r ? titleCase(r.address) : '';
    $(`fp-${slot}-meta`).innerHTML = summary(r, slot === 'b' && suggested ? 'Suggested: same score' : '');
    $(`fp-${slot}-meta`).classList.toggle('is-empty', !r);
    document.querySelector(`.fp-card[data-slot="${slot}"]`).classList.toggle('is-empty', !r);
  }
  $('fp-b-label').textContent = b && suggested ? 'Second building (suggested, same score): address' : 'Second building: address';

  // ---- intro numbers (computed, not typed) -------------------------------------
  const scores = pm.latest.map((r) => r.score).sort(d3.ascending);
  // the citywide spread lives in the title's ⓘ (read from this hidden source by the info popover)
  $('fp-spread').innerHTML = `<p>Half of Toronto's ${fmt.n(scores.length)} evaluated buildings score between <b>${d3.quantileSorted(scores, 0.25)}</b> and <b>${d3.quantileSorted(scores, 0.75)}</b>, so a score alone separates buildings very little.</p>`;
  renderLegend(pa, pb);

  // ---- the pair -------------------------------------------------------------------
  // Without two buildings there is nothing to line up: say what is missing and what to do, and keep the item
  // views out of the way.
  const ready = !!(pa && pb);
  $('fp-pair').hidden = !ready;
  $('fp-verdict').innerHTML = ready ? observation(pa, pb) : missing({ a, b, mode, pm, score: state.score });
  if (!ready) { $('fp-legend').hidden = true; $('fp-legend-btn').setAttribute('aria-expanded', 'false'); }
  const story = document.body.classList.contains('is-story');
  if (ready) {
    const key = `${a.rsn}|${b.rsn}`;
    if (key !== pairKey) { pairKey = key; itemsArea = null; itemsFirst = 0; profileFirst = 0; if (filter === 'diff' && a.era !== b.era) filter = 'all'; }
  }
  renderProfile($('fp-profile'), pa, pb, { onArea: (k) => { if (document.body.classList.contains('is-story')) return; itemsArea = k; itemsFirst = 0; showTab('items', false, `fp-items-areas`); } });
  if (ready) {
    if (tab === 'items' || story) drawMatrix($('fp-matrix'), pa, pb, ctx);
    for (const slot of ['a', 'b']) ctx.registerShown?.(slot, (slot === 'a' ? a : b).rsn);
  } else $('fp-matrix').innerHTML = '';
  renderTable(pa, pb);
  lastGlance = ready && !story ? { pa, pb, scores: layoutCache.scores, era: pm.era } : null;
  if (!lastGlance) $('fp-glance').hidden = true;

  // ---- Toronto overview (or the ward's, labelled as such) ------------------------------
  if (tab === 'city' && !story) {
    const wardName = ctx.ward ? pm.latest.find((r) => r.ward === ctx.ward)?.wardName ?? 'this ward' : null;
    const cityLayout = ctx.ward ? { groups: layout.groups, stats: itemStats(ctx.latest, pm.cats, itemLabel).stats } : layout;
    const pop = { ward: wardName, n: ctx.ward ? ctx.latest.length : pm.latest.length };
    $('fp-city-title').textContent = pop.ward ? `The same items, for the ${fmt.n(pop.n)} evaluated buildings in ${pop.ward}` : 'The same items, for every building in Toronto';
    renderCityNotes(cityLayout, pop, ready && [pa, pb].some((p) => p.era === 'cur'));
    lastCity = { layout: cityLayout, pop, pair: ready ? { a: pa, b: pb } : null };
    drawCityFitted();
  }
  renderMethod(pm, layout);
  fitShown();
}

// ---- fitting the shown view to the window (fp-fit.js) ------------------------------------------
// By category and Every item page their rows; nothing scrolls. In the guided story the comparison lays itself out
// (story.css), so its area rows are never paged.
function fitShown() {
  const story = document.body.classList.contains('is-story');
  if (tab === 'profile' && lastGlance) renderGlance($('fp-glance'), lastGlance.pa, lastGlance.pb, lastGlance);
  if (tab === 'profile' || story) {
    const rows = [...$('fp-profile').querySelectorAll('.pf-row')];
    profileFirst = fitRows({ box: $('fp-profile-fit'), rows, pager: $('fp-profile-pager'), first: profileFirst, label: 'areas', enabled: !story,
      onPage: (first, dir) => { profileFirst = first; fitShown(); keepPagerFocus($('fp-profile-pager'), dir); } });
  }
  if (tab === 'items' || story) {
    const rows = [...$('fp-matrix').querySelectorAll('.fp-m-row')];
    itemsFirst = fitRows({ box: $('fp-items-fit'), rows, pager: $('fp-items-pager'), first: itemsFirst, label: 'items', enabled: !story,
      onPage: (first, dir) => { itemsFirst = first; fitShown(); keepPagerFocus($('fp-items-pager'), dir); } });
  }
}

// after paging, focus stays on the same button, or moves to the other one when that end is reached
function keepPagerFocus(pager, dir) {
  (pager.querySelector(`[data-page="${dir}"]:not(:disabled)`) ?? pager.querySelector('[data-page]:not(:disabled)'))?.focus();
}

// All of Toronto: the full chart when its area headings and columns stay legible at this width; otherwise one
// area at a time, so the columns keep their room.
let lastCity = null;
let lastGlance = null;   // the pair at a glance, redrawn with the panel
const CITY_MIN_CELL = 12;
// The strips under the city's columns: one per building of the pair scored in the current system, labelled with a
// short form of its address; the labels' width (measured in the page's own font) sets the gutter on the left.
const stripSides = (pair) => (pair ? [['a', pair.a], ['b', pair.b]].filter(([, p]) => p.era === 'cur') : []);
const shortAddr = (rec) => { const t = titleCase(rec.address); return t.length <= 22 ? t : `${t.slice(0, 21).replace(/\s+\S*$/, '')}…`; };
function stripGut(pair, box) {
  const sides = stripSides(pair);
  if (!sides.length) return 0;
  const w = Math.max(...sides.map(([, p]) => {
    const s = document.createElement('span');
    s.className = 'fp-strip-name';
    s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
    s.textContent = shortAddr(p.rec);
    box.appendChild(s);
    const x = s.getBoundingClientRect().width;
    s.remove();
    return x;
  }));
  return Math.ceil(Math.min(170, w)) + 22;   // swatch, label, gap
}
function drawCityFitted() {
  if (!lastCity) return;
  const { layout, pop } = lastCity;
  const box = $('fp-city-chart');
  const items = layout.groups.reduce((n, g) => n + g.items.length, 0);
  const usable = box.clientWidth - 14 * (layout.groups.length - 1) - stripGut(lastCity.pair, box);
  const cell = (usable + GAP) / items - GAP;
  const titles = layout.groups.every((g) => g.items.length * (cell + GAP) >= (g.short ?? g.label).length * 7.5 * (parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1));
  const full = box.clientWidth >= 760 && cell >= CITY_MIN_CELL && titles;
  const pick = $('fp-city-areas');
  pick.hidden = full;
  if (full) { drawCity(box, layout, pop, { pair: lastCity.pair }); return; }
  if (!layout.groups.some((g) => g.key === cityArea)) cityArea = layout.groups[0].key;
  areaPicker(pick, layout.groups.map((g) => ({ key: g.key, short: phoneShort(g.short ?? SHORT.get(g.key) ?? g.label), label: g.label })), cityArea, (k) => { cityArea = k; drawCityFitted(); });
  drawCity(box, { ...layout, groups: layout.groups.filter((g) => g.key === cityArea) }, pop, { one: true, pair: lastCity.pair });
}

function syncTabs() {
  for (const t of TABS) {
    const btn = $(`fp-tab-${t}`), on = t === tab;
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
    $(`fp-panel-${t}`).hidden = !on;
  }
}
function showTab(t, focus = false, focusAfter = null) {
  if (t === tab) { if (last) renderFingerprint(...last); return; }
  tab = t;
  syncTabs();
  if (focus) $(`fp-tab-${t}`).focus();
  const panel = $(`fp-panel-${t}`);
  if (!reduceMotion()) panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  if (last) renderFingerprint(...last);
  if (focusAfter) $(focusAfter)?.querySelector('[aria-checked="true"]')?.focus();
}

// ---- input --------------------------------------------------------------------------
function wire(ctx) {
  if (wired) return;
  wired = true;
  $('fp-score').addEventListener('change', (e) => ctx.setFp({ score: +e.target.value, pairIndex: 0, a: null, b: null }));
  enhanceSelect($('fp-score'), { search: true, searchLabel: 'Search scores', placeholder: 'Find a score…', labelledBy: 'fp-score-label', className: 'fp-score-select' });
  $('fp-next').addEventListener('click', () => ctx.setFp((s) => ({ pairIndex: s.pairIndex + 1 })));
  $('fp-reset').addEventListener('click', () => ctx.setFp({ a: null, b: null, pairIndex: 0 }, '#/compare'));
  // The two address searches (first and second building): every evaluated building (the latest evaluation of each; a building only
  // evaluated before 2023 is listed with its system). Empty, a field suggests buildings with the same score as
  // the other building; each option says how its score relates.
  const searchable = () => {
    if (!shown) return [];
    if (searchCache.key !== shown.pm) searchCache = { key: shown.pm, list: [...shown.pm.latest, ...shown.other.latest.filter((r) => !shown.pm.latestByRsn.has(r.rsn))] };
    return searchCache.list;
  };
  const pick = (slot) => {
    const other = slot === 'a' ? 'b' : 'a';
    const sameAs = (r) => shown?.[other] && r.era === shown[other].era && r.score === shown[other].score && r.rsn !== shown[other].rsn;
    initSearch($(`fp-${slot}`), $(`fp-${slot}-list`), {
      source: searchable,
      describe: (r) => {
        const o = shown?.[other];
        const rel = !o ? '' : r.era !== o.era ? ` · ${sysName(r)} system` : r.score === o.score ? ' · same score' : ` · ${r.score > o.score ? '+' : '−'}${Math.abs(r.score - o.score)} vs ${esc(shortAddr(o))}`;
        return `${esc(r.wardName)} · score <b class="tnum">${r.score}</b>${!o && r.era !== shown?.pm.era ? ` · ${sysName(r)} system` : rel}`;
      },
      suggest: () => {
        if (!shown?.[other]) return null;
        const pool = searchable().filter(sameAs);
        return pool.length ? { label: `Also scored ${shown[other].score}`, records: d3.shuffle(pool.slice()).slice(0, 6) } : null;
      },
      noMatch: () => 'No evaluated building matches that address.',
      // Replacing one building keeps the other. A B the reader chose stays, whatever its score; a B that was
      // only suggested is suggested again for the new A. Picking the building already in the other slot swaps nothing.
      onPick: (r) => {
        if (shown?.[other]?.rsn === r.rsn) { $('fp-status').textContent = `${titleCase(r.address)} is already being compared.`; return; }
        $(`fp-${slot}`).value = titleCase(r.address);
        ctx.setFp((s) => (slot === 'a'
          ? { a: r.rsn, b: s.b && s.b !== r.rsn ? s.b : null }
          : { a: s.a ?? shown?.a?.rsn, b: r.rsn }));
      },
    });
  };
  pick('a');
  pick('b');
  // The search bar holds the building's address: focusing it selects the address, so typing replaces it; leaving it
  // without picking a building puts the address back.
  for (const slot of ['a', 'b']) {
    const input = $(`fp-${slot}`);
    input.addEventListener('focus', () => requestAnimationFrame(() => input.select()));
    input.addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement === input) return;
      const r = shown?.[slot];
      input.value = r ? titleCase(r.address) : '';
    }, 150));
  }
  $('fp-goto-cur').addEventListener('click', () => ctx.setPeriod('cur'));
  // tabs: click, and arrow keys / Home / End between them (the APG tabs pattern, automatic activation)
  for (const t of TABS) $(`fp-tab-${t}`).addEventListener('click', () => showTab(t));
  $('fp-tab-profile').parentElement.addEventListener('keydown', (e) => {
    const i = TABS.indexOf(tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    showTab(TABS[(next + TABS.length) % TABS.length], true);
  });
  // Every item: the filter (a radio group: arrow keys move and select) and the areas (one open at a time under
  // "Show all"; every matching area open under the other two filters)
  const setFilter = (f, focus) => {
    if (f === filter || $(`fp-filter-${f}`)?.disabled) return;
    filter = f; itemsFirst = 0;
    if (last) renderFingerprint(...last);
    if (focus) $(`fp-filter-${f}`)?.focus();
  };
  $('fp-filter').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) setFilter(b.dataset.filter); });
  $('fp-filter').addEventListener('keydown', (e) => {
    const on = [...$('fp-filter').querySelectorAll('[data-filter]:not(:disabled)')];
    const i = on.findIndex((b) => b.dataset.filter === filter);
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d == null || !on.length) return;
    e.preventDefault();
    setFilter(on[(i + d + on.length) % on.length].dataset.filter, true);
  });
  // Example pairs: a compact disclosure beside the title (Esc or a click outside closes it)
  const ex = $('fp-examples'), exBtn = $('fp-examples-btn');
  const setEx = (open) => { ex.hidden = !open; exBtn.setAttribute('aria-expanded', String(open)); };
  exBtn.addEventListener('click', () => setEx(ex.hidden));
  $('fp-examples-wrap').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ex.hidden && !e.target.closest('.ll-select.is-open')) { e.stopPropagation(); setEx(false); exBtn.focus(); } });
  document.addEventListener('pointerdown', (e) => { if (!ex.hidden && !e.target.closest('#fp-examples-wrap, .ll-select-pop')) setEx(false); });
  // the rating legend: a labelled disclosure beside the tabs
  $('fp-legend-btn').addEventListener('click', () => {
    const open = $('fp-legend').hidden;
    $('fp-legend').hidden = !open;
    $('fp-legend-btn').setAttribute('aria-expanded', String(open));
  });
  // the full table and the method open on request, in dialogs
  for (const [btn, dlg] of [['fp-table-open', 'fp-table-dialog'], ['fp-method-open', 'fp-method-dialog']]) {
    const d = $(dlg);
    $(btn).addEventListener('click', () => d.showModal());
    d.querySelector('[data-close]').addEventListener('click', () => d.close());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => $(btn).focus());
  }
  // charts follow the panel's size
  let raf = 0;
  // the shown view is fitted again whenever its space changes (window, Display text size, the legend opening)
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!last || $('fp-main').closest('[hidden]')) return; if (tab === 'city') drawCityFitted(); else fitShown(); }); })
    .observe($('fp-panel-items').parentElement);
  new ResizeObserver(() => { if (tab === 'city' && lastCity) { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawCityFitted); } }).observe($('fp-city-chart'));
}

// ---- the summaries -------------------------------------------------------------------------
// Under each building's address field: its overall score, when it was inspected, where it is, and its inspection.
function summary(r, note = '') {
  if (!r) return '';
  // one compact line under the address, wrapping cleanly: the score, then the date and ward, then the link
  return `${note ? `<span class="fp-pick-note">${esc(note)}</span>` : ''}
    <span class="fp-big"><b class="tnum">${r.score}</b><span>/100</span></span>
    <span class="fp-scorebar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, r.score))}%"></i></span>
    <span class="fp-facts"><span class="fp-sr-phone">Inspected </span>${formatDate(r.date)}<span class="fp-ward"> · ${esc(r.wardName)}</span>${r.era !== 'cur' ? ` · ${sysName(r)} system` : ''}</span>
    <a class="fp-meta-link" href="#/xray/${r.rsn}">View inspection<span class="visually-hidden"> of ${esc(titleCase(r.address))}</span> <span aria-hidden="true">→</span></a>`;
}

// ---- the observation ------------------------------------------------------------------------
// One short sentence from the data, only where it helps. Score wording only when the two systems are comparable.
function observation(pa, pb) {
  const o = pairObservation(pa, pb);
  const P = { a: pa, b: pb };
  const name = (p) => `<b>${esc(titleCase(p.rec.address))}</b>`;
  const lows = (p) => (p.low.length ? `${p.low.length} of ${p.rated}` : `none of ${p.rated}`);
  const score = pa.rec.score;
  if (o.kind === 'systems') return `${name(pa)} was scored under the ${sysName(pa.rec)} system and ${name(pb)} under the ${sysName(pb.rec)} system. The two rated different items on different scales, so their scores and ratings can’t be compared directly; each building’s items are listed side by side.`;
  if (o.kind === 'scores') {
    const hi = P[o.hi], lo = P[o.hi === 'a' ? 'b' : 'a'];
    return `${name(hi)} scored ${o.points} point${o.points === 1 ? '' : 's'} higher and had ${lows(hi)} items rated low. ${name(lo)} had ${lows(lo)}.`;
  }
  if (o.kind === 'same-score-lows') {
    const g = o.area;
    const where = g ? ` The biggest gap is in ${esc(g.label.toLowerCase())}: ${g.a.low} of ${g.a.rated} against ${g.b.low} of ${g.b.rated}.` : '';
    return `Both scored ${score}, but ${name(pa)} had ${lows(pa)} items rated low and ${name(pb)} had ${lows(pb)}.${where}`;
  }
  if (o.kind === 'same-score-items') return `Both scored ${score} and had ${pa.low.length} item${pa.low.length === 1 ? '' : 's'} rated low, but ${o.sharedLow ? `only ${o.sharedLow} of them on the same item` : 'never on the same item'}.`;
  return o.diffRows ? `Both scored ${score}, with the same number of items rated low; inspectors rated ${o.diffRows} item${o.diffRows === 1 ? '' : 's'} differently.` : '';
}

// When there is no pair to draw: what is missing, and what the reader can do about it.
function missing({ a, b, mode, pm, score }) {
  const sys = SCALES[pm.era].system;
  if (a && !b && a.era !== pm.era) return `<b>${esc(titleCase(a.address))}</b> was last evaluated in ${a.date.slice(0, 4)}, under the ${sysName(a)} scoring system. Choose a second building to set beside it. Items from two systems are listed side by side, but their scores and ratings aren’t compared.`;
  if (a && !b) return `No other building scored exactly <b>${a.score}</b> under the ${sys} system. Choose any building as the second building; both scores will be shown.`;
  if (!a && b) return 'Choose a first building to compare.';
  return mode === 'example' ? `Fewer than two buildings scored ${score} under the ${sys} system, so there’s no example pair at that score. Choose another score or type two addresses.` : 'Choose two buildings to compare.';
}

// ---- every item: one area at a time ----------------------------------------------------------
// One row per inspection item with three columns: the item and each building's rating. Items are matched
// by their inspection identifier, so each keeps its row even when only one building has a rating. A filter narrows
// the rows; one area is shown at a time (picked above the table), and its rows are paged to fit (fitShown), never
// scrolled. In the guided story every area is listed at once.
function drawMatrix(table, pa, pb, ctx) {
  const P = { a: pa, b: pb };
  const groups = pairRows(pa, pb);
  const rows = groups.flatMap((g) => g.rows);
  const count = { all: rows.length, diff: rows.filter((r) => r.diff).length, low: rows.filter((r) => r.low).length };
  const twoSystems = pa.era !== pb.era;
  const story = document.body.classList.contains('is-story');
  const LABEL = { all: 'Show all', diff: 'Rated differently', low: 'Rated low in either building' };
  const SHORT_F = { all: 'All', diff: 'Different', low: 'Low in either' };   // phones: the same filters, shorter words
  $('fp-filter').innerHTML = ['all', 'diff', 'low'].map((f) => {
    const off = f === 'diff' && twoSystems;
    return `<button type="button" role="radio" class="fp-filter-btn" id="fp-filter-${f}" data-filter="${f}" aria-checked="${filter === f}" tabindex="${filter === f ? 0 : -1}"
      aria-label="${LABEL[f]}, ${off ? 'not available across two scoring systems' : `${count[f]} items`}"
      ${off ? 'disabled title="Needs ratings from the same scoring system on both sides"' : ''}><span class="fp-f-long">${LABEL[f]}</span><span class="fp-f-short" aria-hidden="true">${SHORT_F[f]}</span> <span class="fp-filter-n">${off ? '–' : count[f]}</span></button>`;
  }).join('');

  const shownGroups = groups.map((g) => ({ ...g, rows: g.rows.filter((r) => rowMatches(r, filter)) }));
  // which area: the one chosen, while it has matching rows; else the area where the two differ most; else the first with rows
  if (!shownGroups.find((g) => g.key === itemsArea)?.rows.length) {
    const withRows = shownGroups.filter((g) => g.rows.length);
    const best = d3.greatest(withRows, (g) => Math.abs(g.a.low - g.b.low) * 100 + g.rows.filter((r) => r.diff).length);
    itemsArea = (best ?? withRows[0] ?? shownGroups[0]).key;
    itemsFirst = 0;
  }
  const pick = $('fp-items-areas');
  pick.hidden = story;
  areaPicker(pick, shownGroups.map((g) => ({ key: g.key, short: phoneShort(SHORT.get(g.key) ?? g.label), label: g.label, count: g.rows.length, disabled: !g.rows.length,
    title: `${g.label}: ${g.rows.length} item${g.rows.length === 1 ? '' : 's'}${filter !== 'all' ? ' shown' : ''}` })), itemsArea, (k) => {
    if (k === itemsArea) return;
    itemsArea = k; itemsFirst = 0;
    if (last) renderFingerprint(...last);
  });

  const side = (g, slot) => (g[slot].rated ? `${g[slot].low} of ${g[slot].rated} rated low` : 'No rated items');
  const visible = story ? shownGroups.filter((g) => g.rows.length) : shownGroups.filter((g) => g.key === itemsArea && g.rows.length);
  table.innerHTML = `<caption class="visually-hidden">Inspection items for ${esc(titleCase(pa.rec.address))} and ${esc(titleCase(pb.rec.address))}${story ? '' : `: ${esc(visible[0]?.label ?? '')}`}${filter !== 'all' ? `, ${LABEL[filter].toLowerCase()} only` : ''}</caption>
    <colgroup><col class="fp-m-col-item" /><col class="fp-m-col-r" /><col class="fp-m-col-r" /></colgroup>
    <thead><tr><th scope="col" class="fp-m-h-item">Inspection item</th><th scope="col" class="fp-m-h" data-slot="a">${colHead(P, 'a')}</th><th scope="col" class="fp-m-h" data-slot="b">${colHead(P, 'b')}</th></tr></thead>
    ${visible.length ? visible.map((g) => `<tbody class="fp-m-group is-open" data-key="${g.key}">
      <tr class="fp-m-grow"><th scope="colgroup"><span class="fp-m-gbtn"><span class="fp-m-glabel">${esc(g.label)}</span></span></th><td class="fp-m-gcount" data-slot="a">${side(g, 'a')}</td><td class="fp-m-gcount" data-slot="b">${side(g, 'b')}</td></tr>
      ${rowsHtml(g.rows, P)}
    </tbody>`).join('') : `<tbody><tr><td colspan="3" class="fp-m-none">${filter === 'diff' ? 'No item was rated differently: both buildings got the same rating on every item rated in both.' : 'Neither building had an item rated low.'}</td></tr></tbody>`}`;
  bindItemTips(table, groups, P, $('fp-live'));
}

// Hover, focus and arrow keys. One tab stop per chart; arrows move between items.
// Hovering an item highlights the same item in every chart on the page (linked comparison).
const hotCol = (col) => document.querySelectorAll('#fp-main [data-col]').forEach((n) => n.classList.toggle('is-hot', n.dataset.col === col));
function bindCells(svg, cells, flat, tipHtml, spoken, label = 'Inspection items') {
  const hot = hotCol;
  // the cells are bound to their positions; the tooltip data is the matching entry of `flat`
  const of = (node) => flat[cells.nodes().indexOf(node)];
  cells.on('mouseenter', function (ev) { const d = of(this); hot(d.col); tip.show(tipHtml(d), ev); })
    .on('click', function () { const d = of(this); hot(d.col); tip.show(tipHtml(d), anchorEvent(this)); }) // touch
    .on('mousemove', (ev) => tip.move(ev))
    .on('mouseleave', () => { hot(null); tip.hide(); });
  const group = svg.select('.fp-cells').attr('tabindex', 0).attr('role', 'group')
    .attr('aria-label', `${label}. Use the arrow keys to move between items.`);
  let idx = -1;
  const nodes = cells.nodes();
  const show = (i) => {
    idx = Math.max(0, Math.min(flat.length - 1, i));
    const d = flat[idx];
    hot(d.col);
    tip.show(tipHtml(d), anchorEvent(nodes[idx]));
    $('fp-live').textContent = spoken(d);
  };
  group.on('focus', () => show(idx < 0 ? 0 : idx))
    .on('blur', () => { hot(null); tip.hide(); })
    .on('keydown', (ev) => {
      const k = ev.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) return;
      ev.preventDefault();
      ev.stopPropagation(); // don't let ← / → page between questions
      if (k === 'ArrowLeft') show(idx - 1);
      if (k === 'ArrowRight') show(idx + 1);
      if (k === 'Home') show(0);
      if (k === 'End') show(flat.length - 1);
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        // jump to the same position in the previous / next row of squares
        const cur = flat[idx];
        const rowsY = [...new Set(flat.map((f) => f.y))];
        const ri = rowsY.indexOf(cur.y) + (k === 'ArrowDown' ? 1 : -1);
        if (ri < 0 || ri >= rowsY.length) return;
        const inRow = flat.map((f, i) => [f, i]).filter(([f]) => f.y === rowsY[ri]);
        show(d3.least(inRow, ([f]) => Math.abs(f.x - cur.x))[1]);
      }
    });
}

// ---- Toronto overview: the same grid, each square a 100% column of ratings ----------------
// With a pair chosen, two strips under the columns show how each building of the pair was rated on each item
// (in the same rating colours), so the pair can be read against the whole city item by item. Only a building scored
// in the current system has a strip; the city chart is that system's.
function drawCity(box, layout, pop, { one = false, pair = null } = {}) {
  const n = pop.n;
  box.innerHTML = '';
  const width = Math.max(280, box.clientWidth);
  const wide = width >= 760 || one;   // one area at a time: its columns in one row, sized to the space
  const sides = wide ? stripSides(pair).map(([slot, p]) => ({ slot, p, by: new Map(p.groups.flatMap((g) => g.items).map((i) => [i.col, i])) })) : [];
  const gut = sides.length ? stripGut(pair, box) : 0;
  const ROW = 18, stripH = sides.length ? 8 + sides.length * ROW : 0;
  // Wide screens: groups side by side would get cramped, so lay the groups out in one long row of columns.
  const items = layout.groups.flatMap((g) => g.items.map((col) => ({ col, g })));
  const groupGap = wide ? 14 : 0;
  let cell, colH, height, pos;
  if (wide) {
    const usable = width - gut - groupGap * (layout.groups.length - 1);
    cell = Math.max(8, Math.floor((usable + GAP) / items.length - GAP));
    if (one) cell = Math.min(cell, 56);
    const top = one ? 4 : 34;
    // the columns take the height the chart box has (it is sized by the panel); a small box gets shorter columns
    colH = box.clientHeight > 0 ? Math.max(stripH ? 36 : 60, Math.min(260, box.clientHeight - top - 10 - stripH)) : 120;
    let x = gut, last = null;
    pos = items.map((d) => { if (last && d.g !== last) x += groupGap; last = d.g; const p = { ...d, x, y: top }; x += cell + GAP; return p; });
    height = top + colH + 8 + stripH;
  } else {
    cell = Math.max(16, Math.min(28, Math.floor((width + GAP) / PER_ROW - GAP)));
    colH = Math.round(cell * 2.2);
    let y = 0;
    pos = [];
    for (const g of layout.groups) {
      g.items.forEach((col, i) => pos.push({ col, g, x: (i % PER_ROW) * (cell + GAP), y: y + 22 + Math.floor(i / PER_ROW) * (colH + GAP), titleY: y }));
      y += 22 + Math.ceil(g.items.length / PER_ROW) * (colH + GAP) + 14;
    }
    height = y;
  }
  const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height)
    .attr('role', 'img').attr('aria-label', `How ${fmt.n(n)} buildings${pop.ward ? ` in ${pop.ward}` : ' in Toronto'} were rated on each inspection item, grouped by area. Each column shows the share of buildings at each rating.`);

  // group titles
  for (const g of layout.groups) {
    const first = pos.find((p) => p.g === g), lastP = [...pos].reverse().find((p) => p.g === g);
    if (!first || one) continue;   // one area at a time: the picker above already names it
    if (wide) {
      const span = lastP.x + cell - first.x;
      svg.append('text').attr('class', 'group-title fp-city-title').attr('x', first.x).attr('y', 14).text(span >= g.label.length * 7 + 8 ? g.label : (g.short ?? g.label.split(' ')[0]));
      svg.append('line').attr('class', 'fp-bracket').attr('x1', first.x).attr('x2', lastP.x + cell).attr('y1', 24).attr('y2', 24);
    } else {
      svg.append('text').attr('class', 'group-title').attr('x', 0).attr('y', first.titleY + 14).text(g.label);
    }
  }

  const cols = svg.append('g').attr('class', 'fp-cells').selectAll('g').data(pos).join('g')
    .attr('class', 'fp-cell').attr('data-col', (d) => d.col).attr('transform', (d) => `translate(${d.x},${d.y})`);
  cols.append('rect').attr('class', 'fp-hit').attr('x', -GAP / 2).attr('y', -2).attr('width', cell + GAP).attr('height', colH + 4 + stripH);
  // stacked from the baseline up: 0, 1, 2, then 3 on top, so the low marks read as a bar from the bottom
  cols.each(function (d) {
    const s = layout.stats.get(d.col);
    const gsel = d3.select(this);
    if (!s.rated) { gsel.append('rect').attr('class', 'fp-sq').attr('width', cell).attr('height', colH).attr('fill', 'none'); return; }
    let acc = 0;
    for (const v of [0, 1, 2, 3]) {
      const h = (s.dist[v] / s.rated) * colH;
      if (h <= 0) continue;
      gsel.append('rect').attr('x', 0).attr('width', cell).attr('y', colH - acc - h).attr('height', Math.max(0, h - (v < 3 ? 1 : 0))).attr('fill', ratingColor(v));
      acc += h;
    }
  });
  const baseY = (wide ? pos[0]?.y ?? 34 : 0) + colH + 0.5;
  svg.append('line').attr('class', 'fp-base').attr('x1', gut).attr('x2', one ? pos.at(-1).x + cell : width).attr('y1', baseY).attr('y2', baseY).attr('hidden', wide ? null : true);
  // the pair's own ratings, one strip per building
  sides.forEach(({ slot, p, by }, k) => {
    const y = baseY + 8 + k * ROW;
    const lab = svg.append('g').attr('class', `fp-strip-label is-${slot}`).attr('aria-hidden', 'true');
    lab.append('title').text(titleCase(p.rec.address));
    lab.append('rect').attr('x', 0).attr('y', y + 2).attr('width', 8).attr('height', 8).attr('rx', 2);
    lab.append('text').attr('class', 'fp-strip-name').attr('x', 13).attr('y', y + 10).text(shortAddr(p.rec));
    cols.each(function (d) {
      const it = by.get(d.col);
      const sq = d3.select(this).append('rect').attr('class', `fp-strip${it?.status === 'rated' ? '' : ` is-${it?.status ?? 'blank'}`}`)
        .attr('x', 0.5).attr('y', y - d.y + 0.5).attr('width', Math.max(1, cell - 1)).attr('height', ROW - 5).attr('rx', 2);
      if (it?.status === 'rated') sq.style('fill', ratingColor(it.rating));
    });
  });

  const flat = pos.map((p) => ({ ...p, it: { stat: layout.stats.get(p.col) } }));
  const theirs = (col) => sides.map(({ slot, p, by }) => { const it = by.get(col); return { slot, name: titleCase(p.rec.address), text: it?.status === 'rated' ? `${it.rating} of 3` : it?.status === 'na' ? 'N/A' : 'No rating recorded' }; });
  bindCells(svg, cols, flat, (d) => cityTip(d.it.stat, n, pop, theirs(d.col)),
    (d) => `${d.it.stat.label}: ${pct(d.it.stat.lowShare)} rated 0 or 1, ${pct(d.it.stat.belowTopShare)} rated 2 or lower, across ${fmt.n(d.it.stat.rated)} buildings.${theirs(d.col).map((t) => ` ${t.name}: ${t.text}.`).join('')}`);
}

function cityTip(s, n, pop, theirs = []) {
  const row = (v) => `<dt><span class="swatch bar" style="background:${ratingColor(v)}"></span> ${v}</dt><dd>${pct(s.dist[v] / s.rated, 1)} (${fmt.n(s.dist[v])})</dd>`;
  return `<div class="tt-title">${esc(s.label)}</div><div class="tt-sub">${esc(s.groupLabel)} · ${fmt.n(s.rated)} ${pop.ward ? `${esc(pop.ward)} ` : ''}buildings rated it</div>
    <dl>${[3, 2, 1, 0].map(row).join('')}<dt>N/A</dt><dd>${fmt.n(s.na)} of ${fmt.n(n)} buildings (not counted)</dd>
    ${theirs.map((t) => `<dt>${esc(t.name)}</dt><dd><b>${t.text}</b></dd>`).join('')}</dl>`;
}

// The two callouts under the chart. Whose buildings they describe is always named: Toronto's, or the ward's
// (with how many buildings) when a ward filter is on.
function renderCityNotes(layout, pop, strips = false) {
  const f = cityFindings(layout);
  const where = pop.ward ? `Among ${esc(pop.ward)}’s ${fmt.n(pop.n)} evaluated buildings` : `Across Toronto’s ${fmt.n(pop.n)} evaluated buildings`;
  const whose = pop.ward ? `${esc(pop.ward)} buildings` : 'buildings';
  const list = (xs, key) => xs.map((s) => `${esc(s.label.toLowerCase())} (${pct(s[key])})`);
  const and = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0] ?? '');
  // the findings sit in the disclosure under the chart, so the chart has the panel to itself
  $('fp-city-notes').innerHTML = `
    <p><b>${where}, the same few items keep getting marked down:</b> ${and(list(f.belowTop, 'belowTopShare'))} were most often rated 2 or lower.</p>
    ${strips ? '<p>The A and B strips under the columns show how your two buildings were rated on each item.</p>' : ''}
    ${f.recordsLow.length ? `<p><b>Paperwork counts too.</b> ${and(f.recordsLow.map((s) => `${pct(s.lowShare)} of ${whose} got a 0 or 1 for their ${esc(s.label.toLowerCase())}`))}. A building can look fine in the lobby and still be missing the records the City requires.</p>` : ''}`;
}

// ---- legend, table, method --------------------------------------------------------------------
function renderLegend(pa, pb) {
  const two = pa && pb && pa.era !== pb.era;
  const chip = (cls, v, label) => `<span class="key"><span class="fp-r-num ${cls}">${v}</span>${label}</span>`;
  const miss = (cls, word, label) => `<span class="key"><span class="fp-r-miss is-${cls}">${word}</span>${label}</span>`;
  $('fp-legend').innerHTML = `
    ${chip('r-top', 3, 'top mark')}${chip('r-mid', 2, '')}${chip('r-low', 1, 'low')}${chip('r-lowest', 0, 'lowest (a real rating)')}
    ${two ? '<span class="key">The 2017 – 2023 system rated 1 to 5; 1 or 2 counts as low there.</span>' : ''}
    ${miss('na', 'N/A', 'doesn’t apply; not counted')}${miss('blank', 'No rating recorded', '')}${two ? miss('absent', 'Not in this scoring system', '') : ''}`;
}

// The full list, as a plain table in a dialog: every item, both ratings, and how often Toronto rated it low.
function renderTable(pa, pb) {
  if (!pa || !pb) { $('fp-table-head').innerHTML = ''; $('fp-table-body').innerHTML = '<tr><td>Choose two buildings to compare.</td></tr>'; return; }
  const txt = (c, S) => (c.status === 'rated' ? `${c.rating} of ${S.max}${c.low ? ' (low)' : ''}` : { na: 'N/A', blank: 'No rating recorded', absent: 'Not in this scoring system' }[c.status]);
  $('fp-table-head').innerHTML = `<tr><th scope="col">Item</th><th scope="col">Area</th><th scope="col">${esc(titleCase(pa.rec.address))}</th><th scope="col">${esc(titleCase(pb.rec.address))}</th><th scope="col">Toronto, rated 0–1</th></tr>`;
  $('fp-table-body').innerHTML = pairRows(pa, pb).flatMap((g) => g.rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${esc(g.label)}</td><td>${txt(r.a, pa.scale)}</td><td>${txt(r.b, pb.scale)}</td><td>${r.stat.rated ? pct(r.stat.lowShare, 1) : '–'}</td></tr>`)).join('');
}

function renderMethod(pm, layout) {
  const nItems = layout.stats.size;
  $('fp-method').innerHTML = `<ul>
    <li><b>Source.</b> City of Toronto Open Data, <a href="https://open.toronto.ca/dataset/apartment-building-evaluation/" target="_blank" rel="noopener">Apartment Building Evaluations</a>, 2023–current file (RentSafeTO), and the 2017–2023 file for buildings evaluated only then. Current evaluations from ${formatDate(pm.dates[0])} to ${formatDate(pm.dates[1])}.</li>
    <li><b>One building, one inspection.</b> Each building is shown with its most recent evaluation. Earlier inspections are not averaged in. ${fmt.n(pm.latest.length)} buildings in the current system.</li>
    <li><b>Ratings.</b> Inspectors rate up to ${nItems} items from 0 to 3. The data doesn't publish a word for each value, so we show the number. 3 is the top mark: the overall score rises with the average item rating. We call 0 or 1 a <b>low rating</b>. A 0 is a real rating, never a missing one. We never call an item “failed”.</li>
    <li><b>Missing is not a problem.</b> N/A means the item doesn't apply (no pool, no elevator); “No rating recorded” means the cell is empty. Neither is counted, in the shares or their denominators. The City's own “areas evaluated” count matches the number of items that are not N/A.</li>
    <li><b>Matching items.</b> Items are matched by the City's item name, so each item keeps one row. “Rated differently” needs a real rating on both sides from the same scoring system.</li>
    <li><b>Two scoring systems.</b> The 2017–2023 system rated 20 different items from 1 to 5 (1 or 2 counts as low). Only one item name (graffiti) appears in both, on different scales. A building evaluated only then can be set beside a current one: its items are listed in the same five areas, marked “Not in this scoring system” on the other side, and no score or rating is compared across the two.</li>
    <li><b>Percentages.</b> Share of an area = items rated low ÷ items rated in that area. Toronto shares = buildings with that rating ÷ buildings where the item was rated. “Uncommon” means fewer than ${pct(UNCOMMON_SHARE)} of rated buildings got a 0 or 1 on that item.</li>
    <li><b>Areas.</b> The five areas are our grouping of the City's item names, chosen so a renter can picture where each item is. Within each area, items are ordered from most to least often low-rated across Toronto.</li>
    <li><b>Example pairs.</b> For a chosen score, we pair the building with the most low ratings with one at the same score that has the fewest. From a building's inspection, the second building is the one with exactly the same score whose ratings differ most.</li>
    <li><b>Limits.</b> Ratings describe common areas on inspection day, not individual units, rents or how the landlord responds.</li>
  </ul>`;
}
