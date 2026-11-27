// 마크다운 → 화면에 넣을 HTML (위험한 태그 · 속성 제거)
import { Marked } from 'marked';
import { extractNotes, NOTE_REF, noteLabel } from './footnotes';

const marked = new Marked({ gfm: true, breaks: false });
/** 내가 쓴 책: 한 번 친 엔터도 줄바꿈으로 (집필실에서 본 그대로) */
const markedBr = new Marked({ gfm: true, breaks: true });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface RenderOpts {
  /** [[이름]] 을 세계관 링크로 표시 (아니면 그냥 글) */
  links?: boolean;
  /** 한 번 친 엔터를 줄바꿈으로 보이기 (내가 쓴 책). 들인 책은 끄기: 옛 글은 줄 끝마다 엔터가 있어서 */
  breaks?: boolean;
}

/** 주석: 낱말 옆 [^1] 은 위첨자 * 로, [^1]: 설명 줄은 장 끝 주석 목록으로 */
function footnotes(md: string): string {
  const { body, notes } = extractNotes(md);
  if (!notes.size) return md;
  const used: string[] = [];
  const out = body.replace(NOTE_REF, (m, id: string) => {
    if (!notes.has(id)) return m;
    let i = used.indexOf(id);
    if (i < 0) i = used.push(id) - 1;
    return `<sup class="fn" data-note="${esc(notes.get(id)!)}">${noteLabel(i + 1)}</sup>`;
  });
  if (!used.length) return out;
  return `${out.trimEnd()}\n\n<div class="footnotes">${used.map((id, i) => `<p><span class="fn-mark">${noteLabel(i + 1)}</span> ${esc(notes.get(id)!)}</p>`).join('')}</div>\n`;
}

/** 원고 안 표시를 리더용으로 바꾼다: %%작가 메모%% 는 지우고, [[이름|보일 말]] 은 보일 말로 */
export function preprocess(md: string, opts: RenderOpts = {}): string {
  return footnotes(md.replace(/%%[\s\S]*?%%/g, ''))
    .replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_, name: string, label?: string) =>
      opts.links ? `<span class="wl" data-entry="${esc(name.trim())}">${esc((label ?? name).trim())}</span>` : (label ?? name),
    );
}

export function sanitize(html: string): string {
  const d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('script,iframe,object,embed,style,link,form,input,button,textarea,select,meta,base,svg,math').forEach((e) => e.remove());
  d.querySelectorAll('*').forEach((el) =>
    [...el.attributes].forEach((a) => {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'style' || n === 'srcset' || ((n === 'href' || n === 'src') && /^\s*(javascript|data|vbscript):/i.test(a.value))) el.removeAttribute(a.name);
    }),
  );
  d.querySelectorAll('img').forEach((img) => {
    // 원고 안 그림은 밖의 https 주소, 또는 이 책에 올린 사진(/api/bimg/…)만
    const src = img.getAttribute('src') ?? '';
    if (!/^https:\/\//.test(src) && !/^\/api\/bimg\/[a-z0-9]+$/.test(src)) return img.remove();
    img.setAttribute('loading', 'lazy');
    // 「1200x800」 제목은 그림 크기: 미리 자리를 잡아 쪽 나눔이 흔들리지 않게
    const m = (img.getAttribute('title') ?? '').match(/^(\d+)x(\d+)$/);
    if (m) {
      img.setAttribute('width', m[1]);
      img.setAttribute('height', m[2]);
      img.removeAttribute('title');
    }
    img.classList.add('ms-img');
    const p = img.parentElement;
    if (p?.tagName === 'P' && p.childNodes.length === 1) p.classList.add('figure');
    const alt = img.getAttribute('alt');
    if (alt && p?.classList.contains('figure')) {
      const cap = document.createElement('span');
      cap.className = 'caption';
      cap.textContent = alt;
      p.appendChild(cap);
    }
  });
  d.querySelectorAll('a').forEach((a) => {
    a.setAttribute('rel', 'noopener noreferrer');
    a.setAttribute('target', '_blank');
  });
  d.querySelectorAll('hr').forEach((hr) => hr.classList.add('scene'));
  return d.innerHTML;
}

export function renderMd(md: string, opts: RenderOpts = {}): string {
  const html = (opts.breaks ? markedBr : marked).parse(preprocess(md, opts), { async: false }) as string;
  // <br> 뒤에 엔터를 남겨 글자 위치(책갈피 · 밑줄 · 주석)가 줄바꿈을 보이기 전과 같게
  return sanitize(opts.breaks ? html.replace(/<br>(?!\n)/g, '<br>\n') : html);
}
