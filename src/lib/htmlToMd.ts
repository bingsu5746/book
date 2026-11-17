// HTML(EPUB · 위키문헌 · .html 파일) → 마크다운. 그림 · 표 서식 · 각주 번호 같은 군더더기는 버린다.
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'HR', 'TABLE', 'TR', 'BR', 'DL', 'DT', 'DD', 'CENTER', 'FIGURE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'POEM']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'IMG', 'SVG', 'FIGCAPTION', 'SUP', 'RT', 'RP', 'BUTTON', 'INPUT']);

function inline(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (SKIP.has(tag)) return '';
  if (tag === 'BR') return '\n';
  const inner = [...el.childNodes].map(inline).join('');
  if (!inner.trim()) return inner;
  if (tag === 'B' || tag === 'STRONG') return `**${inner.trim()}**`;
  if (tag === 'I' || tag === 'EM' || tag === 'CITE') return `*${inner.trim()}*`;
  if (tag === 'RUBY') return [...el.childNodes].filter((c) => !(c.nodeType === 1 && ['RT', 'RP'].includes((c as Element).tagName.toUpperCase()))).map(inline).join('');
  return inner;
}

function hasBlockChild(el: Element) {
  return [...el.children].some((c) => BLOCK.has(c.tagName.toUpperCase()));
}

function blocks(el: Element, out: string[], ctx: { quote: number }) {
  for (const child of [...el.childNodes]) {
    if (child.nodeType === 3) {
      const t = (child.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const c = child as Element;
    const tag = c.tagName.toUpperCase();
    if (SKIP.has(tag)) continue;
    // 위키문헌: 편집 단추 · 목차 · 머리말 틀
    if (c.classList.contains('mw-editsection') || c.id === 'toc' || c.classList.contains('toc') || c.classList.contains('ws-noexport') || c.classList.contains('noprint') || c.classList.contains('reference') || c.classList.contains('references')) continue;
    const h = tag.match(/^H([1-6])$/);
    if (h) {
      const t = inline(c).replace(/\*+/g, '').trim();
      if (t) out.push(`${'#'.repeat(+h[1])} ${t}`);
      continue;
    }
    if (tag === 'HR') {
      out.push('***');
      continue;
    }
    if (tag === 'BLOCKQUOTE') {
      const inner: string[] = [];
      blocks(c, inner, ctx);
      if (inner.length) out.push(inner.map((p) => p.split('\n').map((l) => `> ${l}`).join('\n')).join('\n>\n'));
      continue;
    }
    if (tag === 'UL' || tag === 'OL') {
      const items = [...c.children].filter((li) => li.tagName.toUpperCase() === 'LI');
      const lines = items.map((li, i) => `${tag === 'OL' ? `${i + 1}.` : '-'} ${inline(li).trim()}`).filter((l) => l.replace(/^(-|\d+\.)\s*/, ''));
      if (lines.length) out.push(lines.join('\n'));
      continue;
    }
    if (tag === 'PRE') {
      const t = c.textContent ?? '';
      if (t.trim()) out.push(t.split('\n').map((l) => l.trimEnd()).join('  \n'));
      continue;
    }
    if (tag === 'TABLE') {
      const rows = [...c.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => inline(td).trim()).filter(Boolean).join(' · ')).filter(Boolean);
      if (rows.length) out.push(rows.join('  \n'));
      continue;
    }
    if (BLOCK.has(tag) || tag === 'SPAN' || tag === 'A' || tag === 'FONT') {
      if (hasBlockChild(c)) blocks(c, out, ctx);
      else {
        const t = inline(c)
          .split('\n')
          .map((l) => l.trim())
          .join('  \n')
          .trim();
        if (t) out.push(t);
      }
      continue;
    }
    const t = inline(c).trim();
    if (t) out.push(t);
  }
}

export function htmlToMd(root: Element | Document): string {
  const el = root instanceof Document ? (root.body ?? root.documentElement) : root;
  const out: string[] = [];
  blocks(el, out, { quote: 0 });
  return out
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlStringToMd(html: string): string {
  return htmlToMd(new DOMParser().parseFromString(html, 'text/html'));
}
