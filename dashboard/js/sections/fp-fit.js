// Compare buildings: fitting rows to the window. The comparison never scrolls, neither the page nor a panel: rows
// that don't fit are split into pages, with a range ("1–5 of 12") and Previous / Next.
//
// The space is measured, never guessed: the rows are laid out at their real width, font and Display text size
// (so a wrapped label counts as the two lines it takes), then packed into pages that fit the box the panel
// actually has after the app header, breadcrumb, controls and tabs. Re-run on any resize or setting change.

// Page boundaries for rows of the given heights within `avail` pixels: [[start, end), …]. A row taller than the
// box still gets a page of its own, so every row stays reachable.
export function pageBreaks(heights, avail) {
  const pages = [];
  let start = 0, h = 0;
  heights.forEach((x, i) => {
    if (i > start && h + x > avail) { pages.push([start, i]); start = i; h = 0; }
    h += x;
  });
  pages.push([start, heights.length]);
  return pages;
}

// Fit `rows` (elements inside `box`) to `box`'s height, showing the page that holds row `first`.
//   fixed    the height inside the box that isn't rows (a table head, a caption), measured with every row shown
//   pager    the element for the range and the buttons; shown only when there is more than one page
//   label    what the rows are ("items", "areas"), for the range and the buttons' names
//   onPage   called with the new first row when the reader pages
// Returns the first row of the page shown.
export function fitRows({ box, rows, pager, first = 0, label = 'rows', onPage, enabled = true }) {
  rows.forEach((r) => { r.hidden = false; });
  if (!enabled || !rows.length || !box.clientHeight) { pager.hidden = true; pager.innerHTML = ''; return 0; }
  const measure = () => {
    const heights = rows.map((r) => r.getBoundingClientRect().height);
    const content = box.firstElementChild?.getBoundingClientRect().height ?? 0;
    const fixed = content - heights.reduce((a, b) => a + b, 0);
    return pageBreaks(heights, box.clientHeight - fixed - 1);
  };
  // first without the pager; if the rows need pages, again with the pager taking its line
  pager.hidden = true;
  let pages = measure();
  if (pages.length > 1) { pager.hidden = false; pager.innerHTML = pagerHtml(pages[0], rows.length, 0, 1, label); pages = measure(); }
  const i = Math.max(0, pages.findIndex(([s, e]) => first >= s && first < e));
  const [s, e] = pages[i];
  rows.forEach((r, k) => { r.hidden = k < s || k >= e; });
  if (pages.length > 1) {
    pager.innerHTML = pagerHtml([s, e], rows.length, i, pages.length, label);
    pager.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
      const to = pages[i + (b.dataset.page === 'next' ? 1 : -1)];
      if (to) onPage?.(to[0], b.dataset.page);
    }));
  } else { pager.hidden = true; pager.innerHTML = ''; }
  return s;
}

function pagerHtml([s, e], n, i, count, label) {
  return `<p class="fp-range" aria-live="polite"><b>${s + 1}${e - s > 1 ? `–${e}` : ''}</b> of ${n} ${label}</p>
    <button type="button" class="btn btn-sm" data-page="prev" ${i === 0 ? 'disabled' : ''} aria-label="Previous ${label}"><span aria-hidden="true">←</span> Previous</button>
    <button type="button" class="btn btn-sm" data-page="next" ${i >= count - 1 ? 'disabled' : ''} aria-label="Next ${label}">Next <span aria-hidden="true">→</span></button>`;
}

// One area at a time: a compact picker (a radio group; arrow keys move and select).
export function areaPicker(el, areas, current, onPick) {
  el.innerHTML = areas.map((a) => `<button type="button" role="radio" class="fp-area-btn" data-key="${a.key}" aria-checked="${a.key === current}" tabindex="${a.key === current ? 0 : -1}"
    ${a.disabled ? 'disabled' : ''} title="${a.title ?? a.label}" aria-label="${a.label}${a.count != null ? `, ${a.count}` : ''}">${a.short}${a.count != null ? ` <span class="fp-filter-n">${a.count}</span>` : ''}</button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('[data-key]'); if (b && !b.disabled) onPick(b.dataset.key); };
  el.onkeydown = (e) => {
    const on = [...el.querySelectorAll('[data-key]:not(:disabled)')];
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d == null || !on.length) return;
    e.preventDefault();
    const i = on.findIndex((b) => b.dataset.key === current);
    const next = on[(i + d + on.length) % on.length].dataset.key;
    onPick(next);
    requestAnimationFrame(() => el.querySelector(`[data-key="${next}"]`)?.focus());
  };
}
