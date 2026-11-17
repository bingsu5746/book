// 앞붙이 · 뒷붙이: 헌사(맨 앞) · 작가의 말 · 판권면(맨 뒤). 책 meta.matter 에 적어 두면 리더 · 판 · 전자책에 들어간다.
// 서버(판 찍기)와 화면(리더 · 내보내기)이 같은 함수를 쓴다. DOM 을 쓰지 않는다.

export interface Matter {
  dedication?: string;
  afterword?: string;
  colophon?: boolean;
}
export interface MatterNode {
  id: string;
  kind: 'chapter' | 'scene';
  depth: number;
  title: string;
  body: string;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const html = (s: string, cls: string) =>
  `<div class="${cls}">${s
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;

export function readMatter(meta: unknown): Matter {
  const m = (meta && typeof meta === 'object' ? (meta as { matter?: unknown }).matter : null) as Matter | null;
  if (!m || typeof m !== 'object') return {};
  return { dedication: typeof m.dedication === 'string' ? m.dedication.slice(0, 2000) : '', afterword: typeof m.afterword === 'string' ? m.afterword.slice(0, 50000) : '', colophon: m.colophon === true };
}

/** 원고 앞 · 뒤에 붙일 칸들 */
export function matterNodes(book: { title: string; author: string; meta?: unknown }, edition: { number?: number; date: string }, opts: { plain?: boolean } = {}): { front: MatterNode[]; back: MatterNode[] } {
  const m = readMatter(book.meta);
  // 글(txt) · 마크다운으로 내보낼 때는 HTML 없이 문단만
  const paras = (s: string, cls: string) => (opts.plain ? s.trim() : html(s, cls));
  const front: MatterNode[] = [];
  const back: MatterNode[] = [];
  if (m.dedication?.trim()) front.push({ id: 'm-dedication', kind: 'scene', depth: 0, title: '', body: paras(m.dedication, 'dedication') });
  if (m.afterword?.trim()) back.push({ id: 'm-afterword', kind: 'chapter', depth: 0, title: '작가의 말', body: m.afterword.trim() });
  if (m.colophon) {
    const lines = [book.title, book.author ? `지은이 ${book.author}` : '', `${edition.number ? `${edition.number}판 · ` : ''}${edition.date}`].filter(Boolean).join('\n\n');
    back.push({ id: 'm-colophon', kind: 'scene', depth: 0, title: '', body: paras(lines, 'colophon') });
  }
  return { front, back };
}
export const isMatter = (id: string) => id.startsWith('m-');
