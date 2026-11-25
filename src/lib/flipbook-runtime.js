/**
 * The flipbook reader: pages that turn like paper (StPageFlip, MIT licence)
 * with contents, page pictures, search, zoom, hotspots (links, pages, video,
 * sound and notes), a page-turn sound and a kiosk mode.
 *
 * Plain JavaScript without imports: Benchtop runs it, and exported flipbooks
 * carry a copy, so they work offline from a single HTML file.  Types are in
 * flipbook-runtime.d.ts.
 */

const STYLE_ID = 'fbk-style';

const STYLE = `
.fbk { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 280px; overflow: hidden;
  background: #1d2126; color: #eef1f4; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; outline: none; }
.fbk:focus-visible { box-shadow: inset 0 0 0 3px #56b4e9; }
.fbk [hidden] { display: none !important; }
.fbk-stage { position: relative; flex: 1; min-height: 0; padding: 18px 18px 10px; background-position: center; background-size: cover; }
.fbk-holder { position: relative; width: 100%; height: 100%; }
.fbk-book { width: 100%; height: 100%; }
.fbk-page { overflow: hidden; background: #ffffff; }
.fbk-page img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none;
  user-select: none; -webkit-user-drag: none; }
.fbk-page-number { position: absolute; bottom: 6px; left: 0; right: 0; color: #6b7480; font-size: 11px; text-align: center; pointer-events: none; }
.fbk-hot { position: absolute; padding: 0; border: 2px solid transparent; border-radius: 4px; background: rgba(86, 180, 233, 0.16);
  cursor: pointer; }
.fbk-hot:hover, .fbk-hot:focus-visible { border-color: #0072b2; background: rgba(86, 180, 233, 0.32); outline: none; }
.fbk-empty { display: grid; place-items: center; height: 100%; color: #b8c0c9; }
.fbk-bar { position: relative; z-index: 6; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px 6px;
  padding: 6px 10px; background: #14171b; }
.fbk-bar button, .fbk-panel button, .fbk-zoom button, .fbk-pop button { min-width: 34px; height: 32px; padding: 0 9px; border: 1px solid #3a424c;
  border-radius: 6px; background: #262c33; color: #eef1f4; font: inherit; cursor: pointer; }
.fbk-bar button:hover, .fbk-panel button:hover, .fbk-zoom button:hover, .fbk-pop button:hover { background: #313942; }
.fbk-bar button:focus-visible, .fbk-panel button:focus-visible, .fbk-zoom button:focus-visible, .fbk-pop button:focus-visible,
.fbk-panel input:focus-visible { outline: 2px solid #56b4e9; outline-offset: 1px; }
.fbk-bar button[aria-pressed="true"] { border-color: #56b4e9; background: #1f3a4d; }
.fbk-bar .fbk-gap { width: 10px; }
.fbk-where { min-width: 150px; color: #d5dbe1; text-align: center; font-variant-numeric: tabular-nums; }
.fbk-panel { position: absolute; top: 0; bottom: 44px; left: 0; z-index: 7; display: flex; flex-direction: column; width: min(330px, 88%);
  background: #20252b; box-shadow: 4px 0 18px rgba(0, 0, 0, 0.4); }
.fbk-panel-head { display: flex; gap: 4px; padding: 8px; border-bottom: 1px solid #333b44; }
.fbk-tabs { display: flex; gap: 4px; }
.fbk-panel-head button[aria-selected="true"] { border-color: #56b4e9; background: #1f3a4d; }
.fbk-panel-head .fbk-close { margin-left: auto; }
.fbk-panel-body { flex: 1; min-height: 0; padding: 10px; overflow: auto; }
.fbk-panel ol, .fbk-panel ul { margin: 0; padding: 0; list-style: none; }
.fbk-panel li + li { margin-top: 4px; }
.fbk-panel .fbk-item { display: flex; justify-content: space-between; gap: 10px; width: 100%; height: auto; min-height: 32px; padding: 6px 9px;
  text-align: left; }
.fbk-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); gap: 8px; }
.fbk-thumbs button { display: grid; gap: 3px; justify-items: center; height: auto; padding: 4px; }
.fbk-thumbs img, .fbk-thumbs .fbk-blank { display: block; width: 100%; aspect-ratio: var(--fbk-ratio); background: #ffffff; object-fit: contain; }
.fbk-thumbs button.is-current { border-color: #56b4e9; }
.fbk-search { display: flex; gap: 6px; margin-bottom: 10px; }
.fbk-search input { flex: 1; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid #3a424c; border-radius: 6px; background: #14171b; color: #eef1f4; font: inherit; }
.fbk-result { display: block; width: 100%; height: auto; padding: 6px 8px; text-align: left; }
.fbk-result mark { background: #ffd400; color: #000000; }
.fbk-note { color: #b8c0c9; }
.fbk-pop { position: absolute; inset: 0; z-index: 9; display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(0, 0, 0, 0.6); }
.fbk-pop-box { display: grid; gap: 10px; max-width: min(760px, 94%); max-height: 90%; padding: 16px; overflow: auto; border-radius: 10px;
  background: #ffffff; color: #1a1f24; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5); }
.fbk-pop-box h2 { margin: 0; font-size: 18px; }
.fbk-pop-box p { margin: 0; white-space: pre-wrap; }
.fbk-pop-box video { max-width: 100%; max-height: 70vh; background: #000000; }
.fbk-pop-box .fbk-close { justify-self: end; background: #eef1f4; color: #1a1f24; border-color: #c4ccd4; }
.fbk-zoom { position: absolute; inset: 0 0 44px; z-index: 8; display: flex; flex-direction: column; background: #111417; }
.fbk-zoom-bar { display: flex; justify-content: center; gap: 6px; padding: 6px; }
.fbk-zoom-view { flex: 1; min-height: 0; overflow: auto; }
.fbk-zoom-pages { display: flex; justify-content: center; gap: 0; width: max-content; min-width: 100%; margin: 0 auto; padding: 10px; box-sizing: border-box; }
.fbk-zoom-pages img, .fbk-zoom-pages .fbk-blank { display: block; background: #ffffff; }
.fbk-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

/** Which pages (from 0, in book order) are side by side when page `index` is open. */
export function spreadOf(index, count, cover, landscape) {
  if (count <= 0) return [];
  const i = Math.max(0, Math.min(count - 1, index));
  if (!landscape) return [i];
  if (cover) {
    if (i === 0) return [0];
    const left = i % 2 === 1 ? i : i - 1;
    return left + 1 < count ? [left, left + 1] : [left];
  }
  const left = i - (i % 2);
  return left + 1 < count ? [left, left + 1] : [left];
}

/** Pages whose text has `query` (any case), with a few words around the first place. */
export function findText(texts, query) {
  const needle = String(query || '')
    .trim()
    .toLowerCase();
  if (!needle) return [];
  const found = [];
  texts.forEach((text, page) => {
    const haystack = String(text || '');
    const at = haystack.toLowerCase().indexOf(needle);
    if (at < 0) return;
    found.push({
      page,
      before: haystack.slice(Math.max(0, at - 40), at).replace(/\s+/g, ' '),
      match: haystack.slice(at, at + needle.length),
      after: haystack.slice(at + needle.length, at + needle.length + 40).replace(/\s+/g, ' '),
    });
  });
  return found;
}

/** What a hotspot does, in words (its accessible name when it has no label). */
export function describeAction(action) {
  if (!action) return 'Hotspot';
  if (action.kind === 'link') return `Open ${action.url}`;
  if (action.kind === 'page') return `Go to page ${action.page}`;
  if (action.kind === 'video') return 'Play the video';
  if (action.kind === 'audio') return 'Play the sound';
  return action.title ? `Note: ${action.title}` : 'Read the note';
}

/**
 * A short swish of filtered noise, like a page turning.  Browsers let a page make sound only
 * after a person has touched it, so the sound is set up on the first touch or key (`wake`).
 */
function pageSound() {
  let context = null;
  return {
    wake() {
      try {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!context && Context) context = new Context();
        if (context?.state === 'suspended') context.resume().catch(() => undefined);
      } catch {
        context = null;
      }
    },
    play() {
      if (context?.state !== 'running') return;
      try {
        const length = Math.floor(context.sampleRate * 0.32);
        const buffer = context.createBuffer(1, length, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
          const t = i / length;
          data[i] = (Math.random() * 2 - 1) * (1 - t) ** 2 * Math.min(1, t * 14);
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 0.8;
        filter.frequency.setValueAtTime(2200, context.currentTime);
        filter.frequency.exponentialRampToValueAtTime(700, context.currentTime + 0.3);
        const gain = context.createGain();
        gain.gain.value = 0.32;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(context.destination);
        source.start();
      } catch {
        // No sound on this device.
      }
    },
  };
}

function make(doc, tag, className, attributes) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
  return node;
}

function button(doc, label, text, name) {
  const b = make(doc, 'button', '', { type: 'button', 'aria-label': label, title: label });
  b.textContent = text;
  if (name) b.dataset.fbk = name;
  return b;
}

/**
 * Shows `book` in `root` and returns a controller.  `deps.PageFlip` is the StPageFlip class;
 * pages whose `src` is empty are asked for with `deps.loadPage(index)` as they come near.
 */
export function mountFlipbook(root, book, deps) {
  const doc = root.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const style = make(doc, 'style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    doc.head.append(style);
  }
  const settings = book.settings || {};
  const count = book.pages.length;
  const rtl = !!settings.rtl;
  const cover = !!settings.cover;
  /** Reading order and book order are the same, or mirrored in a right-to-left book. */
  const order = (i) => (rtl ? count - 1 - i : i);
  const ratio = book.width > 0 && book.height > 0 ? book.width / book.height : Math.SQRT1_2;

  root.textContent = '';
  root.classList.add('fbk');
  root.tabIndex = 0;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-roledescription', 'flipbook');
  root.setAttribute('aria-label', book.title || 'Flipbook');
  root.style.setProperty('--fbk-ratio', String(ratio));
  root.dataset.pages = String(count);

  const stage = make(doc, 'div', 'fbk-stage');
  if (settings.background) stage.style.backgroundColor = settings.background;
  if (settings.backgroundImage) stage.style.backgroundImage = `url("${settings.backgroundImage}")`;
  const holder = make(doc, 'div', 'fbk-holder');
  stage.append(holder);

  const bar = make(doc, 'div', 'fbk-bar', { role: 'toolbar', 'aria-label': 'Flipbook' });
  const contentsButton = button(doc, 'Contents, pages and search', '☰', 'panel');
  const firstButton = button(doc, rtl ? 'Last page' : 'First page', '⏮', 'first');
  const leftButton = button(doc, rtl ? 'Next page' : 'Previous page', '‹', 'left');
  const where = make(doc, 'span', 'fbk-where');
  const rightButton = button(doc, rtl ? 'Previous page' : 'Next page', '›', 'right');
  const lastButton = button(doc, rtl ? 'First page' : 'Last page', '⏭', 'last');
  const zoomButton = button(doc, 'Zoom in on these pages', '🔍', 'zoom');
  const soundButton = button(doc, 'Page-turn sound', '♪', 'sound');
  const fullButton = button(doc, 'Full screen', '⛶', 'full');
  let soundOn = !!settings.sound;
  soundButton.setAttribute('aria-pressed', String(soundOn));
  const gap = () => make(doc, 'span', 'fbk-gap');
  bar.append(contentsButton, gap(), firstButton, leftButton, where, rightButton, lastButton, gap(), zoomButton, soundButton, fullButton);

  const live = make(doc, 'div', 'fbk-live', { 'aria-live': 'polite' });
  const panel = make(doc, 'div', 'fbk-panel', { role: 'dialog', 'aria-label': 'Contents, pages and search' });
  panel.hidden = true;
  const pop = make(doc, 'div', 'fbk-pop', { role: 'dialog', 'aria-modal': 'true' });
  pop.hidden = true;
  const zoom = make(doc, 'div', 'fbk-zoom', { role: 'dialog', 'aria-label': 'Zoomed pages' });
  zoom.hidden = true;
  root.append(stage, bar, panel, zoom, pop, live);

  const sound = pageSound();
  let flip = null;
  let pageNodes = [];
  let landscape = true;
  let current = 0;
  let destroyed = false;
  let lastInput = Date.now();
  let lastTurn = Date.now();
  const loading = new Set();

  if (!count) {
    holder.append(Object.assign(make(doc, 'p', 'fbk-empty'), { textContent: 'This flipbook has no pages yet.' }));
  }

  /** Asks for the pictures of pages (reading order) that have none yet. */
  const ensure = (pages) => {
    for (const r of pages) {
      const data = book.pages[r];
      if (!data || data.src || loading.has(r) || !deps.loadPage) continue;
      loading.add(r);
      Promise.resolve(deps.loadPage(r))
        .then((src) => {
          if (destroyed || !src) return;
          data.src = src;
          for (const img of root.querySelectorAll(`img[data-page="${r}"]`)) img.src = src;
        })
        .catch(() => undefined)
        .finally(() => loading.delete(r));
    }
  };

  const act = (action) => {
    if (!action) return;
    if (action.kind === 'link') {
      if (deps.openLink) deps.openLink(action.url);
      else window.open(action.url, '_blank', 'noopener,noreferrer');
    } else if (action.kind === 'page') goTo(Math.max(0, Number(action.page) - 1));
    else showPopup(action);
  };

  const pagePicture = (r, className) => {
    const data = book.pages[r];
    if (data && (data.src || deps.loadPage)) {
      const img = make(doc, 'img', className || '', { alt: `Page ${r + 1}`, 'data-page': String(r), draggable: 'false' });
      if (data.src) img.src = data.src;
      return img;
    }
    const blank = make(doc, 'div', `fbk-blank ${className || ''}`, { role: 'img', 'aria-label': `Page ${r + 1}` });
    if (data?.color) blank.style.background = data.color;
    return blank;
  };

  const buildPages = () =>
    Array.from({ length: count }, (_, b) => {
      const r = order(b);
      const data = book.pages[r];
      const node = make(doc, 'div', 'fbk-page');
      if (settings.hardCovers && (r === 0 || r === count - 1)) node.dataset.density = 'hard';
      if (data.color) node.style.background = data.color;
      if (data.src || deps.loadPage) node.append(pagePicture(r));
      if (settings.pageNumbers) node.append(Object.assign(make(doc, 'span', 'fbk-page-number'), { textContent: String(r + 1) }));
      for (const spot of data.hotspots || []) {
        const name = spot.label || describeAction(spot.action);
        const hot = make(doc, 'button', 'fbk-hot', { type: 'button', 'aria-label': name, title: name, 'data-hotspot': spot.id || '' });
        hot.style.left = `${spot.x * 100}%`;
        hot.style.top = `${spot.y * 100}%`;
        hot.style.width = `${spot.w * 100}%`;
        hot.style.height = `${spot.h * 100}%`;
        hot.addEventListener('click', (event) => {
          event.stopPropagation();
          act(spot.action);
        });
        node.append(hot);
      }
      return node;
    });

  /** Pages in view, in reading order. */
  const visible = () =>
    spreadOf(order(current), count, cover, landscape)
      .map(order)
      .sort((a, b) => a - b);

  const showWhere = () => {
    const pages = visible();
    const text = !count ? 'No pages' : pages.length > 1 ? `Pages ${pages[0] + 1}–${pages[pages.length - 1] + 1} of ${count}` : `Page ${(pages[0] || 0) + 1} of ${count}`;
    where.textContent = text;
    live.textContent = text;
    root.dataset.page = String((pages[0] || 0) + 1);
    root.dataset.orientation = landscape ? 'landscape' : 'portrait';
    const first = pages[0] || 0;
    const last = pages[pages.length - 1] || 0;
    const atStart = first <= 0;
    const atEnd = last >= count - 1;
    // The buttons on the left go back in a left-to-right book and forward in a right-to-left one.
    leftButton.disabled = rtl ? atEnd : atStart;
    firstButton.disabled = rtl ? atEnd : atStart;
    rightButton.disabled = rtl ? atStart : atEnd;
    lastButton.disabled = rtl ? atStart : atEnd;
    // Hotspots on pages out of view are skipped by Tab.
    const shown = new Set(pages);
    pageNodes.forEach((node, b) => {
      for (const hot of node.querySelectorAll('.fbk-hot')) hot.tabIndex = shown.has(order(b)) ? 0 : -1;
    });
    ensure([first - 2, first - 1, ...pages, last + 1, last + 2, last + 3].filter((r) => r >= 0 && r < count));
    if (deps.onPage) deps.onPage(first + 1);
  };

  const create = (startReading) => {
    if (!count) return;
    if (flip) {
      try {
        flip.destroy();
      } catch {
        // Already gone.
      }
    }
    holder.textContent = '';
    const bookNode = make(doc, 'div', 'fbk-book');
    holder.append(bookNode);
    pageNodes = buildPages();
    for (const node of pageNodes) bookNode.append(node);
    const single = settings.spread === 'single';
    flip = new deps.PageFlip(bookNode, {
      width: Math.max(50, book.width || 595),
      height: Math.max(50, book.height || 842),
      size: 'stretch',
      // A single page at a time: the book is always "too narrow" for two.
      minWidth: single ? 100000 : 120,
      maxWidth: 5000,
      minHeight: 100,
      maxHeight: 7000,
      autoSize: false,
      showCover: cover,
      usePortrait: true,
      drawShadow: true,
      maxShadowOpacity: 0.45,
      flippingTime: Math.max(200, Number(settings.flipTime) || 800),
      mobileScrollSupport: false,
      clickEventForward: true,
      showPageCorners: true,
      startPage: order(Math.max(0, Math.min(count - 1, startReading))),
    });
    if (single) bookNode.style.minWidth = '0px';
    flip.on('flip', (event) => {
      current = order(Number(event.data) || 0);
      lastTurn = Date.now();
      if (soundOn) sound.play();
      showWhere();
    });
    flip.on('changeOrientation', (event) => {
      landscape = event.data === 'landscape';
      showWhere();
    });
    flip.loadFromHTML(pageNodes);
    landscape = flip.getOrientation() !== 'portrait';
    current = order(flip.getCurrentPageIndex());
    showWhere();
  };

  const forward = () => flip && (rtl ? flip.flipPrev() : flip.flipNext());
  const back = () => flip && (rtl ? flip.flipNext() : flip.flipPrev());
  /** Opens page `r` (reading order, from 0). */
  const goTo = (r) => {
    if (!flip) return;
    const target = order(Math.max(0, Math.min(count - 1, r)));
    if (Math.abs(target - flip.getCurrentPageIndex()) <= 2) flip.flip(target);
    else flip.turnToPage(target);
    current = order(target);
    lastTurn = Date.now();
    showWhere();
  };
  const left = () => (rtl ? forward() : back());
  const right = () => (rtl ? back() : forward());

  // ------------------------------------------------------------ the side panel

  let tab = 'contents';
  const panelBody = make(doc, 'div', 'fbk-panel-body', { role: 'tabpanel' });
  const panelHead = make(doc, 'div', 'fbk-panel-head');
  const tabList = make(doc, 'div', 'fbk-tabs', { role: 'tablist', 'aria-label': 'Show' });
  const tabs = [
    ['contents', 'Contents'],
    ['pages', 'Pages'],
    ['search', 'Search'],
  ].map(([value, label]) => {
    const b = button(doc, label, label, `tab-${value}`);
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      tab = value;
      fillPanel();
    });
    return [value, b];
  });
  const closePanel = button(doc, 'Close', '✕', 'panel-close');
  closePanel.classList.add('fbk-close');
  closePanel.addEventListener('click', () => togglePanel(false));
  tabList.append(...tabs.map(([, b]) => b));
  panelHead.append(tabList, closePanel);
  panel.append(panelHead, panelBody);
  let lastQuery = '';

  const fillPanel = () => {
    for (const [value, b] of tabs) b.setAttribute('aria-selected', String(value === tab));
    panelBody.textContent = '';
    if (tab === 'contents') {
      const entries = (book.contents || []).filter((c) => c?.title);
      if (!entries.length) {
        panelBody.append(Object.assign(make(doc, 'p', 'fbk-note'), { textContent: 'This flipbook has no contents list.' }));
        return;
      }
      const list = make(doc, 'ol');
      for (const entry of entries) {
        const item = make(doc, 'li');
        const b = make(doc, 'button', 'fbk-item', { type: 'button' });
        b.append(Object.assign(make(doc, 'span'), { textContent: entry.title }), Object.assign(make(doc, 'span'), { textContent: String(entry.page) }));
        b.addEventListener('click', () => {
          goTo(Number(entry.page) - 1);
          togglePanel(false);
        });
        item.append(b);
        list.append(item);
      }
      panelBody.append(list);
    } else if (tab === 'pages') {
      const grid = make(doc, 'div', 'fbk-thumbs');
      const shown = new Set(visible());
      for (let r = 0; r < count; r++) {
        const b = make(doc, 'button', shown.has(r) ? 'is-current' : '', { type: 'button', 'aria-label': `Page ${r + 1}` });
        b.append(pagePicture(r), Object.assign(make(doc, 'span'), { textContent: String(r + 1) }));
        b.addEventListener('click', () => {
          goTo(r);
          togglePanel(false);
        });
        grid.append(b);
      }
      panelBody.append(grid);
      ensure(Array.from({ length: Math.min(count, 60) }, (_, r) => r));
    } else {
      const form = make(doc, 'form', 'fbk-search', { role: 'search' });
      const input = make(doc, 'input', '', { type: 'search', 'aria-label': 'Words to find', placeholder: 'Find words' });
      input.value = lastQuery;
      const go = button(doc, 'Find', 'Find', 'find');
      go.type = 'submit';
      form.append(input, go);
      const results = make(doc, 'div', '', { 'aria-live': 'polite' });
      const run = () => {
        lastQuery = input.value;
        results.textContent = '';
        const found = findText(
          book.pages.map((p) => p.text || ''),
          lastQuery,
        );
        if (!lastQuery.trim()) return;
        if (!book.pages.some((p) => p.text)) {
          results.append(Object.assign(make(doc, 'p', 'fbk-note'), { textContent: 'These pages are pictures without text to search.' }));
          return;
        }
        results.append(Object.assign(make(doc, 'p', 'fbk-note'), { textContent: found.length ? `Found on ${found.length} page${found.length === 1 ? '' : 's'}.` : 'Not found.' }));
        const list = make(doc, 'ul');
        for (const hit of found.slice(0, 200)) {
          const item = make(doc, 'li');
          const b = make(doc, 'button', 'fbk-result', { type: 'button' });
          const mark = make(doc, 'mark');
          mark.textContent = hit.match;
          b.append(`p. ${hit.page + 1}: …${hit.before}`, mark, `${hit.after}…`);
          b.addEventListener('click', () => {
            goTo(hit.page);
            togglePanel(false);
          });
          item.append(b);
          list.append(item);
        }
        results.append(list);
      };
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        run();
      });
      panelBody.append(form, results);
      if (lastQuery) run();
      setTimeout(() => input.focus(), 0);
    }
  };

  const togglePanel = (open) => {
    const show = open === undefined ? panel.hidden : open;
    panel.hidden = !show;
    contentsButton.setAttribute('aria-expanded', String(show));
    if (show) {
      fillPanel();
      (panel.querySelector('[aria-selected="true"]') || closePanel).focus();
    } else root.focus();
  };

  // ------------------------------------------------------------ pop-ups and zoom

  let popupMedia = null;
  const closePopup = () => {
    if (pop.hidden) return;
    pop.hidden = true;
    pop.textContent = '';
    popupMedia = null;
    root.focus();
  };
  function showPopup(action) {
    pop.textContent = '';
    const box = make(doc, 'div', 'fbk-pop-box');
    const close = button(doc, 'Close', 'Close', 'popup-close');
    close.classList.add('fbk-close');
    close.addEventListener('click', closePopup);
    const title = make(doc, 'h2');
    box.append(close, title);
    if (action.kind === 'note') {
      title.textContent = action.title || 'Note';
      box.append(Object.assign(make(doc, 'p'), { textContent: action.text || '' }));
    } else {
      const media = book.media?.[action.media];
      title.textContent = action.title || (action.kind === 'video' ? 'Video' : 'Sound');
      if (!media) box.append(Object.assign(make(doc, 'p'), { textContent: 'This media file is missing.' }));
      else {
        popupMedia = make(doc, action.kind === 'video' ? 'video' : 'audio', '', { controls: '' });
        popupMedia.src = media.url;
        box.append(popupMedia);
        Promise.resolve(popupMedia.play()).catch(() => undefined);
      }
    }
    pop.setAttribute('aria-label', title.textContent);
    pop.append(box);
    pop.hidden = false;
    close.focus();
  }
  pop.addEventListener('click', (event) => {
    if (event.target === pop) closePopup();
  });

  let zoomLevel = 2;
  // Scrolled with the keyboard too, so it can take focus.
  const zoomView = make(doc, 'div', 'fbk-zoom-view', { tabindex: '0', role: 'region', 'aria-label': 'Zoomed pages' });
  const zoomPages = make(doc, 'div', 'fbk-zoom-pages');
  zoomView.append(zoomPages);
  const zoomBar = make(doc, 'div', 'fbk-zoom-bar');
  const zoomOut = button(doc, 'Zoom out', '−', 'zoom-out');
  const zoomIn = button(doc, 'Zoom in', '+', 'zoom-in');
  const zoomClose = button(doc, 'Close the zoom', 'Close', 'zoom-close');
  zoomBar.append(zoomOut, zoomIn, zoomClose);
  zoom.append(zoomBar, zoomView);
  const fillZoom = () => {
    zoomPages.textContent = '';
    const height = Math.max(200, holder.clientHeight) * zoomLevel;
    for (const r of rtl ? [...visible()].reverse() : visible()) {
      const picture = pagePicture(r);
      picture.style.height = `${height}px`;
      picture.style.width = `${height * ratio}px`;
      zoomPages.append(picture);
    }
  };
  const toggleZoom = (open) => {
    const show = open === undefined ? zoom.hidden : open;
    zoom.hidden = !show;
    zoomButton.setAttribute('aria-pressed', String(show));
    if (show) {
      fillZoom();
      zoomIn.focus();
    } else root.focus();
  };
  const zoomBy = (factor) => {
    zoomLevel = Math.max(1, Math.min(5, zoomLevel * factor));
    if (zoom.hidden) toggleZoom(true);
    else fillZoom();
  };
  zoomIn.addEventListener('click', () => zoomBy(1.5));
  zoomOut.addEventListener('click', () => zoomBy(1 / 1.5));
  zoomClose.addEventListener('click', () => toggleZoom(false));

  // ------------------------------------------------------------ controls

  contentsButton.addEventListener('click', () => togglePanel());
  leftButton.addEventListener('click', left);
  rightButton.addEventListener('click', right);
  firstButton.addEventListener('click', () => goTo(rtl ? count - 1 : 0));
  lastButton.addEventListener('click', () => goTo(rtl ? 0 : count - 1));
  zoomButton.addEventListener('click', () => toggleZoom());
  soundButton.addEventListener('click', () => {
    soundOn = !soundOn;
    soundButton.setAttribute('aria-pressed', String(soundOn));
    if (soundOn) sound.wake();
  });
  const toggleFull = () => {
    if (doc.fullscreenElement) doc.exitFullscreen().catch(() => undefined);
    else if (root.requestFullscreen) root.requestFullscreen().catch(() => undefined);
  };
  fullButton.addEventListener('click', toggleFull);
  const onFullscreen = () => fullButton.setAttribute('aria-pressed', String(doc.fullscreenElement === root));
  doc.addEventListener('fullscreenchange', onFullscreen);

  const onKey = (event) => {
    if (event.target?.closest?.('input, textarea, select')) return;
    const key = event.key;
    if (key === 'Escape') {
      if (!pop.hidden) closePopup();
      else if (!zoom.hidden) toggleZoom(false);
      else if (!panel.hidden) togglePanel(false);
      else return;
    } else if (!pop.hidden || !panel.hidden) return;
    else if (key === 'ArrowLeft') left();
    else if (key === 'ArrowRight') right();
    else if (key === 'PageDown' || (key === ' ' && event.target === root)) forward();
    else if (key === 'PageUp') back();
    else if (key === 'Home') goTo(0);
    else if (key === 'End') goTo(count - 1);
    else if (key === '+' || key === '=') zoomBy(1.5);
    else if (key === '-') {
      if (zoom.hidden) return;
      zoomBy(1 / 1.5);
    } else if (key === 'f' || key === 'F') toggleFull();
    else return;
    event.preventDefault();
  };
  root.addEventListener('keydown', onKey);
  const touched = (event) => {
    lastInput = Date.now();
    if (soundOn && (event.type === 'pointerdown' || event.type === 'keydown')) sound.wake();
  };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) root.addEventListener(type, touched, { passive: true });

  // Kiosk: turn pages by themselves, and go back to the start when nobody has touched the book for a while.
  const timer = setInterval(() => {
    if (!flip || destroyed) return;
    const now = Date.now();
    const idle = now - lastInput;
    const reset = Number(settings.idleReset) || 0;
    const auto = Number(settings.autoFlip) || 0;
    if (reset > 0 && idle > reset * 1000) {
      const atStart = visible()[0] === 0;
      if (!atStart || !pop.hidden || !panel.hidden || !zoom.hidden) {
        closePopup();
        togglePanel(false);
        toggleZoom(false);
        goTo(0);
      }
      lastInput = now;
      return;
    }
    if (auto > 0 && idle > auto * 1000 && now - lastTurn > auto * 1000 && pop.hidden && panel.hidden && zoom.hidden) {
      const pages = visible();
      if ((pages[pages.length - 1] || 0) >= count - 1) goTo(0);
      else forward();
      lastTurn = now;
    }
  }, 500);

  // The book follows its box (side panels, full screen), not only the window.
  let observer = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      if (flip && !destroyed) flip.update();
    });
    observer.observe(holder);
  }

  create(Math.max(0, Math.min(count - 1, Number(deps.startPage) || 0)));

  return {
    next: forward,
    previous: back,
    goTo,
    current: () => visible()[0] || 0,
    visible,
    destroy() {
      destroyed = true;
      clearInterval(timer);
      if (observer) observer.disconnect();
      doc.removeEventListener('fullscreenchange', onFullscreen);
      root.removeEventListener('keydown', onKey);
      if (popupMedia) popupMedia.pause();
      try {
        if (flip) flip.destroy();
      } catch {
        // Already gone.
      }
      flip = null;
      root.textContent = '';
    },
  };
}
