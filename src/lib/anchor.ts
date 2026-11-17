// 주석 자리 찾기: 고른 글(quote) + 앞뒤 몇 글자 + 대략의 위치로, 판이 바뀌어도 같은 문장을 다시 찾는다.
export interface Anchor {
  quote: string;
  prefix: string;
  suffix: string;
  pos: number;
}
const CTX = 32;

export function makeAnchor(text: string, start: number, end: number): Anchor {
  return { quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - CTX), start), suffix: text.slice(end, end + CTX), pos: start };
}

/** 글 안에서 주석 자리를 찾는다. 못 찾으면 null */
export function findAnchor(text: string, a: Anchor): { start: number; end: number } | null {
  if (!a.quote) return null;
  const hits: number[] = [];
  for (let i = text.indexOf(a.quote); i >= 0; i = text.indexOf(a.quote, i + 1)) hits.push(i);
  if (!hits.length) return null;
  const score = (i: number) => {
    let s = 0;
    const pre = text.slice(Math.max(0, i - a.prefix.length), i);
    const suf = text.slice(i + a.quote.length, i + a.quote.length + a.suffix.length);
    for (let k = 1; k <= Math.min(pre.length, a.prefix.length); k++) if (pre[pre.length - k] === a.prefix[a.prefix.length - k]) s++;
    else break;
    for (let k = 0; k < Math.min(suf.length, a.suffix.length); k++) if (suf[k] === a.suffix[k]) s++;
    else break;
    return s * 1000 - Math.min(999, Math.abs(i - a.pos) / 10);
  };
  const best = hits.reduce((b, i) => (score(i) > score(b) ? i : b), hits[0]);
  return { start: best, end: best + a.quote.length };
}

/** 요소 안 글자 위치 범위를 형광펜(mark)으로 감싼다 */
export function highlightRange(root: HTMLElement, start: number, end: number, attrs: Record<string, string>) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  const targets: { node: Text; a: number; b: number }[] = [];
  while (w.nextNode()) {
    const t = w.currentNode as Text;
    const len = t.data.length;
    const a = Math.max(start, pos);
    const b = Math.min(end, pos + len);
    if (a < b) targets.push({ node: t, a: a - pos, b: b - pos });
    pos += len;
    if (pos >= end) break;
  }
  for (const { node, a, b } of targets) {
    const mid = node.splitText(a);
    mid.splitText(b - a);
    const mark = document.createElement('mark');
    for (const [k, v] of Object.entries(attrs)) mark.setAttribute(k, v);
    mid.parentNode!.insertBefore(mark, mid);
    mark.appendChild(mid);
  }
}

/** 고른 범위가 root 글 안 몇 번째 글자부터 몇 번째까지인지 */
export function rangeOffsets(root: HTMLElement, range: Range): { start: number; end: number } | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
}
