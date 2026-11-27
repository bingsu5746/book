// EPUB 3 만들기 (전자책 앱 · 단말기에서 읽기). 장마다 XHTML 하나, 목차(nav + toc.ncx), 명조 기본 서식.
import { strToU8, zipSync, type Zippable } from 'fflate';
import { renderMd } from './md';
import type { ReadNode } from './types';
import { coverSvg, type CoverStyle } from './cover';
import { bookStyleOf, chapterHeading, convertQuotes, type BookStyle } from './bookStyle';
import { FACES, faceFiles, type FaceId } from './typeset/settings';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** 브라우저가 만든 HTML 조각을 XHTML(닫는 태그 · 따옴표가 엄격한 모양)로 */
function toXhtml(html: string): string {
  const doc = document.implementation.createHTMLDocument('');
  doc.body.innerHTML = html;
  const ser = new XMLSerializer();
  return [...doc.body.childNodes].map((n) => ser.serializeToString(n)).join('\n').replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
}

/** 전자책 서식. 책에 인쇄 설정이 있으면 장 시작 · 대사 · 들여쓰기 · 글꼴이 인쇄용 PDF 와 같게 */
function makeCss(st: BookStyle | undefined, fonts: boolean, headFont: boolean): string {
  const first = st ? (st.firstIndent ? 'h1+p,p.scene+p' : 'h1+p,h2+p,hr.short+p,p.scene+p,hr+p') : 'h1+p,h2+p,p.scene+p,hr+p';
  const lines = [
    `body{font-family:${fonts ? "'BookBody',serif" : 'serif'};line-height:1.8;margin:0 5%;word-break:keep-all${st?.tracking ? `;letter-spacing:${st.tracking}em` : ''}}`,
    `h1{text-align:center;margin:30% 0 0;font-size:1.6em}`,
    `h2{margin:${st?.chapterDrop === 'low' ? '30%' : '2em'} 0 ${st?.chapterAlign === 'left' ? '.5em' : '1.4em'};font-size:1.25em${st?.chapterAlign === 'center' ? ';text-align:center' : ''}}`,
    `p{margin:0;text-indent:1em;text-align:justify}`,
    `${first}{text-indent:0}`,
    `p.scene,hr{text-align:center;color:#888;border:0;margin:1em 0}`,
    `blockquote{margin:.6em 0 .6em 1em;color:#555}`,
    `.title{text-align:center;margin-top:35%}`,
    `.title p{text-indent:0;text-align:center}`,
  ];
  if (st) {
    lines.push(`h2 .cn{display:block;font-size:.8em;font-weight:normal;margin-bottom:.25em}`, `h2 .ct{display:block}`);
    lines.push(`hr.short{width:2.4em;margin:0 0 1.4em 0;border:0;border-top:1px solid #333;text-align:left}`);
    if (st.dialogue === 'flush') lines.push(`p.dlg{text-indent:0}`);
  }
  if (headFont) lines.push(`h1,h2,.title h1{font-family:'BookHead','BookBody',serif}`);
  return lines.join('\n');
}
const fontFaces = (id: string, files: { r: string; b: string }) => `@font-face{font-family:'${id}';font-weight:normal;src:url(fonts/${files.r})}\n@font-face{font-family:'${id}';font-weight:bold;src:url(fonts/${files.b})}`;

const page = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko" lang="ko">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`;

/** 전자책에 넣을 글꼴(쓴 글자만 남긴 것) */
export interface EpubFonts {
  body?: { regular: Uint8Array; bold: Uint8Array };
  head?: { regular: Uint8Array; bold: Uint8Array };
}

export function makeEpub(book: { title: string; author: string; id: string; color?: string; meta?: Record<string, unknown> }, nodes: ReadNode[], opts: { breaks?: boolean; coverImage?: { mime: string; bytes: Uint8Array }; images?: Map<string, { mime: string; bytes: Uint8Array }>; fonts?: EpubFonts } = {}): Uint8Array {
  const st = bookStyleOf(book.meta);
  const fx = opts.fonts;
  // 인쇄 서식대로 따옴표 모양을 맞추고, 대사 문단에 표시를 단다
  const md = (body: string) => convertQuotes(body, st?.quotes);
  const render = (body: string) => toXhtml(renderMd(md(body), opts)).replace(/<p>(?=(?:[“「『‘"]|&quot;))/g, '<p class="dlg">');
  const img = opts.coverImage;
  const coverFile = img ? `cover.${img.mime === 'image/png' ? 'png' : img.mime === 'image/webp' ? 'webp' : 'jpg'}` : 'cover.svg';
  // 부는 혼자 한 쪽, 장 · 장면은 장 단위로 묶어 한 파일
  const chapters: { id: string; title: string; level: number; html: string }[] = [];
  let lastKind = '';
  const headTag = (title: string) => {
    const h = chapterHeading(title, st?.chapterNumber);
    const inner = h.num ? `<span class="cn">${esc(h.num)}</span> <span class="ct">${esc(h.name)}</span>` : esc(title);
    return `<h2>${inner}</h2>${st?.chapterAlign === 'left' ? '<hr class="short"/>' : ''}`;
  };
  for (const n of nodes) {
    if (n.id.startsWith('m-') && n.kind === 'scene') {
      // 헌사 · 판권면: 제목 없이 한 쪽으로 (목차에는 이름만)
      chapters.push({ id: `c${chapters.length + 1}`, title: n.id === 'm-dedication' ? '헌사' : '판권', level: 2, html: render(n.body) });
      lastKind = 'part';
      continue;
    }
    if (n.kind === 'part') {
      chapters.push({ id: `c${chapters.length + 1}`, title: n.title, level: 1, html: `<h1>${esc(n.title)}</h1>\n${n.body.trim() ? render(n.body) : ''}` });
    } else if (n.kind === 'chapter' || !chapters.length || lastKind === 'part') {
      chapters.push({ id: `c${chapters.length + 1}`, title: n.title || `${chapters.length + 1}`, level: 2, html: `${headTag(n.title)}\n${render(n.body)}` });
    } else {
      // 장면: 앞 장에 이어 붙이고 장면 나눔 표시
      chapters[chapters.length - 1].html += `\n<p class="scene">*&#160;&#160;*&#160;&#160;*</p>\n${render(n.body)}`;
    }
    lastKind = n.kind;
  }
  const uid = `urn:uuid:${book.id.padEnd(32, '0').slice(0, 8)}-${book.id.padEnd(32, '0').slice(8, 12)}-4000-8000-${book.id.padEnd(32, '0').slice(12, 24)}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    'OEBPS/style.css': strToU8([makeCss(st, !!fx?.body, !!fx?.head), fx?.body ? fontFaces('BookBody', { r: 'body-r.ttf', b: 'body-b.ttf' }) : '', fx?.head ? fontFaces('BookHead', { r: 'head-r.ttf', b: 'head-b.ttf' }) : ''].filter(Boolean).join('\n')),
    [`OEBPS/${coverFile}`]: img ? img.bytes : strToU8(coverSvg({ title: book.title, author: book.author, color: book.color, id: book.id, style: book.meta?.coverStyle as CoverStyle | undefined })),
    'OEBPS/cover.xhtml': strToU8(page(book.title, `<div style="text-align:center;margin:0"><img src="${coverFile}" alt="${esc(book.title)} 표지" style="max-width:100%;max-height:100vh"/></div>`)),
    'OEBPS/title.xhtml': strToU8(page(book.title, `<div class="title"><h1>${esc(book.title)}</h1>${book.author ? `<p>${esc(book.author)}</p>` : ''}</div>`)),
    'OEBPS/nav.xhtml': strToU8(
      page(
        '목차',
        `<nav epub:type="toc" id="toc"><h2>목차</h2><ol>${chapters.map((c) => `<li><a href="${c.id}.xhtml">${esc(c.title || '·')}</a></li>`).join('')}</ol></nav>`,
      ),
    ),
    'OEBPS/toc.ncx': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/></head><docTitle><text>${esc(book.title)}</text></docTitle><navMap>${chapters
      .map((c, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(c.title || '·')}</text></navLabel><content src="${c.id}.xhtml"/></navPoint>`)
      .join('')}</navMap></ncx>`),
  };
  // 원고 속 사진: 파일 안에 넣고 주소를 바꾼다 (전자책 앱은 인터넷 주소를 못 읽는 경우가 많다)
  const used: { id: string; href: string; mime: string }[] = [];
  for (const c of chapters)
    c.html = c.html.replace(/src="(\/api\/bimg\/([a-z0-9]+))"/g, (m, src: string, id: string) => {
      const im = opts.images?.get(src);
      if (!im) return m;
      const href = `img/${id}.${im.mime === 'image/png' ? 'png' : im.mime === 'image/webp' ? 'webp' : 'jpg'}`;
      if (!used.some((u) => u.id === id)) {
        used.push({ id, href, mime: im.mime });
        files[`OEBPS/${href}`] = im.bytes;
      }
      return `src="${href}"`;
    });
  const fontItems: string[] = [];
  for (const [k, f] of [['body', fx?.body], ['head', fx?.head]] as const)
    if (f) for (const [w, bytes] of [['r', f.regular], ['b', f.bold]] as const) {
      files[`OEBPS/fonts/${k}-${w}.ttf`] = bytes;
      fontItems.push(`<item id="font-${k}-${w}" href="fonts/${k}-${w}.ttf" media-type="font/ttf"/>`);
    }
  for (const c of chapters) files[`OEBPS/${c.id}.xhtml`] = strToU8(page(c.title, c.html));
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ko">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uid}</dc:identifier>
<dc:title>${esc(book.title)}</dc:title>
${book.author ? `<dc:creator>${esc(book.author)}</dc:creator>` : ''}
<dc:language>ko</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
<item id="cover-image" href="${coverFile}" media-type="${img ? img.mime : 'image/svg+xml'}" properties="cover-image"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
${chapters.map((c) => `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
${used.map((u) => `<item id="img-${u.id}" href="${u.href}" media-type="${u.mime}"/>`).join('\n')}
${fontItems.join('\n')}
</manifest>
<spine toc="ncx">
<itemref idref="cover"/>
<itemref idref="title"/>
${chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n')}
</spine>
</package>`);
  return zipSync(files);
}

/** 그림 표지가 있으면 받아서 넣는다 (못 받으면 글자 표지로) */
export async function makeEpubWithCover(book: Parameters<typeof makeEpub>[0], nodes: ReadNode[], opts: { breaks?: boolean } = {}): Promise<Uint8Array> {
  const meta = book.meta as { coverImage?: unknown; coverMode?: unknown } | undefined;
  let coverImage: { mime: string; bytes: Uint8Array } | undefined;
  if (meta?.coverImage && meta.coverMode !== 'text') {
    try {
      const r = await fetch(`/api/books/${book.id}/cover?v=${meta.coverImage}`, { credentials: 'same-origin' });
      if (r.ok) coverImage = { mime: (r.headers.get('content-type') ?? 'image/jpeg').split(';')[0], bytes: new Uint8Array(await r.arrayBuffer()) };
    } catch {
      /* 글자 표지로 */
    }
  }
  // 원고 속 사진도 받아 둔다
  const images = new Map<string, { mime: string; bytes: Uint8Array }>();
  for (const src of new Set(nodes.flatMap((n) => [...n.body.matchAll(/\((\/api\/bimg\/[a-z0-9]+)/g)].map((m) => m[1])))) {
    try {
      const r = await fetch(src, { credentials: 'same-origin' });
      if (r.ok) images.set(src, { mime: (r.headers.get('content-type') ?? 'image/jpeg').split(';')[0], bytes: new Uint8Array(await r.arrayBuffer()) });
    } catch {
      /* 못 받은 사진은 빼고 */
    }
  }
  // 인쇄 서식이 있으면 고른 글꼴을 쓴 글자만 남겨 전자책 안에 넣는다 (못 받으면 기기 글꼴로)
  let fonts: EpubFonts | undefined;
  const st = bookStyleOf(book.meta);
  if (st) {
    try {
      const { loadSubsetter } = await import('./typeset/subset');
      const wasm = (await import('harfbuzzjs/dist/harfbuzz-subset.wasm?url')).default;
      const sub = await loadSubsetter(wasm);
      const text = [...new Set([...nodes.map((n) => n.title + n.body).join('') + book.title + book.author, ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), ...'·…—“”‘’「」『』※'])].join('');
      const get = async (id: FaceId) => {
        const [r, b] = await Promise.all(faceFiles(id).map(async (u) => {
          const res = await fetch(u);
          if (!res.ok) throw new Error(FACES[id].name);
          return new Uint8Array(await res.arrayBuffer());
        }));
        return { regular: sub(r, { text }), bold: sub(b, { text }) };
      };
      fonts = { body: await get(st.face) };
      if (st.headFace !== 'same' && st.headFace !== st.face) fonts.head = await get(st.headFace);
    } catch {
      fonts = undefined;
    }
  }
  return makeEpub(book, nodes, { ...opts, coverImage, images, fonts });
}
