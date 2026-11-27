// 내보내기: 마크다운 · 글(txt) · 인쇄용 HTML
import { renderMd } from './md';
import { plain } from './text';
import { notesToPlain } from './footnotes';
import type { ReadNode } from './types';

export function toMarkdown(title: string, author: string, nodes: ReadNode[]): string {
  const out = [`# ${title}`, author ? `\n${author}\n` : ''];
  for (const n of nodes) {
    if (n.kind === 'part') out.push(`\n# ${n.title}\n`);
    else if (n.kind === 'chapter') out.push(`\n## ${n.title}\n`);
    else if (n.kind === 'scene' && !n.id.startsWith('m-')) out.push('\n***\n');
    if (n.body.trim()) out.push(n.body.replace(/%%[\s\S]*?%%/g, '').trim());
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function toText(title: string, author: string, nodes: ReadNode[]): string {
  const out = [title, author, ''];
  for (const n of nodes) {
    if (n.kind === 'part' || n.kind === 'chapter') out.push('', n.title, '');
    else if (n.kind === 'scene' && !n.id.startsWith('m-')) out.push('', '*', '');
    out.push(notesToPlain(plain(n.body)).trim());
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 제목 쪽 + 본문 (인쇄용 HTML · PDF 가 같이 쓴다). 앞붙이 · 뒷붙이 칸(id 가 m- 로 시작)은 장면 나눔 표시 없이 */
export function bookBodyHtml(title: string, author: string, nodes: ReadNode[], opts: { breaks?: boolean; cover?: string } = {}): string {
  const body = nodes
    .map((n) => {
      const m = n.id.startsWith('m-');
      const head = n.kind === 'part' ? `<h1 class="part">${esc(n.title)}</h1>` : n.kind === 'chapter' ? `<h2>${esc(n.title)}</h2>` : n.kind === 'scene' && !m ? '<p class="scene">*&nbsp;&nbsp;*&nbsp;&nbsp;*</p>' : '';
      return head + renderMd(n.body, opts);
    })
    .join('\n');
  return `${opts.cover ? `<div class="cover"><img src="${opts.cover}" alt="${esc(title)} 표지"></div>` : ''}<div class="title"><h1>${esc(title)}</h1>${author ? `<p style="text-indent:0">${esc(author)}</p>` : ''}</div>\n${body}`;
}

export function toHtml(title: string, author: string, nodes: ReadNode[], opts: { breaks?: boolean } = {}): string {
  const inner = bookBodyHtml(title, author, nodes, opts);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
body{font:17px/1.85 "Noto Serif KR","Nanum Myeongjo",serif;color:#1f1d1a;background:#fff;max-width:36em;margin:3em auto;padding:0 1.2em;word-break:keep-all}
h1,h2{font-weight:600;line-height:1.4} h1.part{page-break-before:always;text-align:center;margin:30vh 0 0} h2{page-break-before:always;margin:3em 0 1.6em;font-size:1.25em}
p{margin:0;text-indent:1em;text-align:justify} h2+p,.scene+p{text-indent:0} .scene{text-align:center;color:#888;margin:1em 0;text-indent:0}
blockquote{margin:.6em 0;padding-left:1em;border-left:2px solid #ddd;color:#555} .title{text-align:center;margin:30vh 0 2em} .title h1{font-size:2em}
.dedication{text-align:center;font-style:italic;margin:30vh 0 0} .colophon{text-align:center;font-size:.85em;color:#555;margin:40vh 0 0} .dedication p,.colophon p{text-indent:0;text-align:center}
@page{margin:22mm 20mm} @media print{body{margin:0;max-width:none}}
</style></head><body>
${inner}
</body></html>`;
}

export function download(name: string, content: string | Blob, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[\\/:*?"<>|]+/g, '_');
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
