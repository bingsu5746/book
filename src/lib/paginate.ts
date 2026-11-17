// 쪽 나누기 (아티팩트 「작은 서재」의 방식을 옮김): 측정용 쪽에 문단을 하나씩 넣어 보고, 넘치면 다음 쪽.
// 긴 문단 · 목록 · 표는 쪽 경계에서 쪼갠다. 모든 덩어리에 data-n(장 id) · data-o(장 안 글자 위치)를 달아
// 화면 크기가 달라도 같은 자리를 다시 찾을 수 있게 한다.
import { renderMd } from './md';
import type { ReadNode } from './types';

export interface Page {
  html: string;
  sec: string;
  cls: string;
  n: string;
  o: number;
}
export interface TocEntry {
  t: string;
  lv: number;
  p: number;
  n: string;
}

/** 장들을 쪽에 넣을 덩어리(요소)로 */
/** 덩어리 안 글에서 이름이 처음 나오는 곳을 세계관 링크(span.wl)로 감싼다 (장마다 이름당 한 번) */
function linkNames(el: HTMLElement, re: RegExp, seen: Set<string>) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (w.nextNode()) if (!(w.currentNode.parentElement?.closest('.wl'))) texts.push(w.currentNode as Text);
  for (const t of texts) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let node = t;
    while ((m = re.exec(node.data))) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      const mid = node.splitText(m.index);
      const rest = mid.splitText(m[0].length);
      const span = document.createElement('span');
      span.className = 'wl';
      span.dataset.entry = m[0];
      mid.parentNode!.insertBefore(span, mid);
      span.appendChild(mid);
      node = rest;
      re.lastIndex = 0;
    }
  }
}

export function buildBlocks(nodes: ReadNode[], opts: { links?: boolean; names?: string[]; breaks?: boolean } = {}): HTMLElement[] {
  const names = (opts.names ?? []).filter((n) => n.trim().length >= 2).sort((a, b) => b.length - a.length);
  const nameRe = names.length ? new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null;
  const out: HTMLElement[] = [];
  let toc = 0;
  let lastKind = '';
  for (const node of nodes) {
    const head = (tag: string, text: string) => {
      const h = document.createElement(tag);
      h.textContent = text;
      h.dataset.n = node.id;
      h.dataset.o = '0';
      h.dataset.toc = String(toc++);
      h.dataset.kind = node.kind;
      out.push(h);
    };
    if (node.kind === 'part') head('h1', node.title || '');
    else if (node.kind === 'chapter') head('h2', node.title || '');
    else if (node.kind === 'scene' && lastKind === 'scene') {
      const hr = document.createElement('p');
      hr.className = 'scene';
      hr.textContent = '*   *   *';
      hr.dataset.n = node.id;
      hr.dataset.o = '0';
      out.push(hr);
    }
    lastKind = node.kind;
    const wrap = document.createElement('div');
    wrap.innerHTML = renderMd(node.body, opts);
    let o = 0;
    const seen = new Set<string>();
    for (const c of [...wrap.childNodes]) {
      let el: HTMLElement;
      if (c.nodeType === 3) {
        if (!c.textContent?.trim()) continue;
        el = document.createElement('p');
        el.textContent = c.textContent.trim();
      } else if (c.nodeType === 1) el = c as HTMLElement;
      else continue;
      el.dataset.n = node.id;
      el.dataset.o = String(o);
      if (nameRe && !/^H[1-6]$/.test(el.tagName)) linkNames(el, nameRe, seen);
      o += (el.textContent ?? '').length;
      out.push(el);
    }
  }
  return out;
}

const tokens = (text: string, pre: boolean) => text.split(pre ? /(\n)/ : /(\s+)/);
function countWords(el: Element, pre: boolean) {
  let c = 0;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) tokens((w.currentNode as Text).data, pre).forEach((p, k) => (k % 2 === 0 && (pre || p) ? c++ : 0));
  return c;
}
function slice(el: HTMLElement, a: number, b: number, pre: boolean): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  let i = 0;
  const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (w.nextNode()) nodes.push(w.currentNode as Text);
  for (const t of nodes) {
    let out = '';
    tokens(t.data, pre).forEach((p, k) => {
      if (k % 2 === 0) {
        if (!pre && !p) return;
        if (i >= a && i < b) out += p;
        i++;
      } else if (i > a && i < b) out += p;
    });
    t.data = out;
  }
  return c;
}

export function paginate(body: HTMLElement, source: HTMLElement[], opts: { partPage: boolean; chapterBreak: boolean }): { pages: Page[]; toc: TocEntry[] } {
  body.innerHTML = '';
  const over = () => body.scrollHeight > body.clientHeight + 1;
  const queue = source.map((e) => e.cloneNode(true) as HTMLElement);
  const pages: Page[] = [];
  const tocSeen: { t: string; lv: number; k: string; n: string }[] = [];
  let section = '';
  let pageCls = '';
  const isHead = (el: Element | null) => !!el && /^H[1-6]$/.test(el.tagName);
  const startOf = () => {
    const f = body.querySelector<HTMLElement>('[data-n]');
    return { n: f?.dataset.n ?? '', o: Number(f?.dataset.o ?? 0) };
  };
  const flush = () => {
    let carry: Element | null = null;
    if (isHead(body.lastElementChild) && body.children.length > 1) {
      carry = body.lastElementChild;
      carry!.remove();
    }
    pages.push({ html: body.innerHTML, sec: section, cls: pageCls + (body.classList.contains('chapter') ? ' chapter' : ''), ...startOf() });
    body.innerHTML = '';
    pageCls = '';
    body.classList.remove('chapter');
    if (carry) body.appendChild(carry);
  };
  const trySplit = (b: HTMLElement): [HTMLElement, HTMLElement] | null => {
    const tag = b.tagName;
    if (tag === 'UL' || tag === 'OL') {
      const items = [...b.children];
      const a = b.cloneNode(false) as HTMLElement;
      body.appendChild(a);
      let k = 0;
      for (; k < items.length; k++) {
        a.appendChild(items[k].cloneNode(true));
        if (over()) {
          a.lastChild!.remove();
          break;
        }
      }
      a.remove();
      if (k === 0 || k === items.length) return null;
      const rest = b.cloneNode(false) as HTMLElement;
      items.slice(k).forEach((li) => rest.appendChild(li));
      if (tag === 'OL') rest.setAttribute('start', String((+(b.getAttribute('start') ?? 1) || 1) + k));
      rest.dataset.o = String(Number(b.dataset.o ?? 0) + (a.textContent ?? '').length);
      return [a, rest];
    }
    if (tag === 'P' || tag === 'BLOCKQUOTE' || tag === 'PRE') {
      const pre = tag === 'PRE';
      const total = countWords(b, pre);
      if (total < 2) return null;
      let lo = 0;
      let hi = total - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const c = slice(b, 0, mid, pre);
        body.appendChild(c);
        const ok = !over();
        c.remove();
        if (ok) lo = mid;
        else hi = mid - 1;
      }
      if (lo === 0) return null;
      const first = slice(b, 0, lo, pre);
      const rest = slice(b, lo, total, pre);
      if (!pre) {
        first.classList.add('split-a');
        rest.classList.add('split-b');
      }
      rest.dataset.o = String(Number(b.dataset.o ?? 0) + (first.textContent ?? '').length);
      return [first, rest];
    }
    return null;
  };

  while (queue.length) {
    const b = queue.shift()!;
    if (b.dataset.toc != null && !b.classList.contains('split-b')) tocSeen.push({ t: b.textContent ?? '', lv: b.tagName === 'H1' ? 1 : 2, k: b.dataset.toc, n: b.dataset.n ?? '' });
    if (b.tagName === 'H1' && opts.partPage) {
      if (body.firstChild) flush();
      section = b.textContent ?? '';
      body.appendChild(b);
      pageCls = 'center';
      flush();
      continue;
    }
    if (b.tagName === 'H2' && opts.chapterBreak && body.firstChild) flush();
    if (b.tagName === 'H1' || b.tagName === 'H2') {
      section = b.textContent ?? '';
      if (b.tagName === 'H2' && opts.chapterBreak && !body.firstChild) body.classList.add('chapter');
    }
    body.appendChild(b);
    if (!over()) continue;
    b.remove();
    const empty = !body.firstChild;
    const parts = trySplit(b);
    if (parts) {
      body.appendChild(parts[0]);
      flush();
      queue.unshift(parts[1]);
      continue;
    }
    if (empty) {
      body.appendChild(b);
      flush();
      continue;
    }
    flush();
    queue.unshift(b);
  }
  if (body.firstChild) pages.push({ html: body.innerHTML, sec: section, cls: pageCls + (body.classList.contains('chapter') ? ' chapter' : ''), ...startOf() });
  if (!pages.length) pages.push({ html: '', sec: '', cls: '', n: '', o: 0 });
  body.innerHTML = '';
  const toc = tocSeen.map((e) => ({ t: e.t, lv: e.lv, n: e.n, p: Math.max(0, pages.findIndex((p) => p.html.includes(`data-toc="${e.k}"`))) }));
  return { pages, toc };
}

/** 저장해 둔 자리(장 id + 글자 위치)가 들어 있는 쪽 번호 */
export function pageOf(pages: Page[], order: string[], n: string, o: number): number {
  const rank = (x: string) => order.indexOf(x);
  const target = rank(n);
  if (target < 0) return 0;
  let best = 0;
  pages.forEach((p, i) => {
    const r = rank(p.n);
    if (r < target || (r === target && p.o <= o)) best = i;
  });
  return best;
}
