// 마크다운 → 화면에 넣을 HTML (위험한 태그 · 속성 제거)
import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: false });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface RenderOpts {
  /** [[이름]] 을 세계관 링크로 표시 (아니면 그냥 글) */
  links?: boolean;
}

/** 원고 안 표시를 리더용으로 바꾼다: %%작가 메모%% 는 지우고, [[이름|보일 말]] 은 보일 말로 */
export function preprocess(md: string, opts: RenderOpts = {}): string {
  return md
    .replace(/%%[\s\S]*?%%/g, '')
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
    // 원고 안 그림은 밖의 주소만 (내 서버 주소로 무언가를 부르지 않게)
    if (!/^https:\/\//.test(img.getAttribute('src') ?? '')) img.remove();
    else img.setAttribute('loading', 'lazy');
  });
  d.querySelectorAll('a').forEach((a) => {
    a.setAttribute('rel', 'noopener noreferrer');
    a.setAttribute('target', '_blank');
  });
  d.querySelectorAll('hr').forEach((hr) => hr.classList.add('scene'));
  return d.innerHTML;
}

export function renderMd(md: string, opts: RenderOpts = {}): string {
  return sanitize(marked.parse(preprocess(md, opts), { async: false }) as string);
}
