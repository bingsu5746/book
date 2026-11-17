// 파일 → 책. 지원: .epub · .txt · .md · .html · .docx · .pdf(글자가 든 PDF만)
import { strFromU8, unzipSync } from 'fflate';
import { htmlToMd } from './htmlToMd';
import { chunk, splitMarkdown, type DraftNode, type SplitResult } from './split';

export interface ImportedBook extends SplitResult {
  author: string;
  source: string;
  notes: string[];
}

export const ACCEPT = '.epub,.txt,.md,.markdown,.html,.htm,.xhtml,.docx,.pdf,text/plain,text/markdown,text/html,application/epub+zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const baseName = (n: string) => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();

/** 글자 파일 읽기: UTF-8 이 아니면 한국어 옛 방식(EUC-KR/CP949)으로 */
export function decodeText(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(u8);
  }
}

/** 줄마다 끊긴 글(옛 txt 소설 등)을 문단으로 합친다: 빈 줄이 거의 없고 줄이 짧으면 문단 = 빈 줄 또는 들여쓰기 */
export function normalizePlain(text: string): string {
  const t = text.replace(/\r\n?/g, '\n');
  const lines = t.split('\n');
  const blank = lines.filter((l) => !l.trim()).length;
  if (blank > lines.length * 0.15) return t.replace(/\n{3,}/g, '\n\n');
  // 빈 줄이 드물면 줄 하나 = 문단 으로 본다
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n\n');
}

async function fromEpub(buf: ArrayBuffer, name: string): Promise<ImportedBook> {
  const files = unzipSync(new Uint8Array(buf));
  const get = (p: string) => files[p] ?? files[decodeURIComponent(p)] ?? Object.entries(files).find(([k]) => k.toLowerCase() === p.toLowerCase())?.[1];
  const xml = (s: string, type: DOMParserSupportedType = 'application/xml') => new DOMParser().parseFromString(s, type);
  const container = get('META-INF/container.xml');
  if (!container) throw new Error('EPUB 파일 안의 목차 정보를 찾지 못했어요.');
  const opfPath = xml(strFromU8(container)).querySelector('rootfile')?.getAttribute('full-path') ?? '';
  const opfRaw = get(opfPath);
  if (!opfRaw) throw new Error('EPUB 파일 안의 책 정보를 찾지 못했어요.');
  const opf = xml(strFromU8(opfRaw));
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const resolve = (base: string, href: string) => {
    const parts = (base + href.split('#')[0]).split('/');
    const out: string[] = [];
    for (const p of parts) p === '..' ? out.pop() : p !== '.' && out.push(p);
    return out.join('/');
  };
  const meta = (tag: string) => [...opf.getElementsByTagNameNS('*', tag)].map((e) => e.textContent?.trim() ?? '').filter(Boolean);
  const title = meta('title')[0] || baseName(name);
  const author = meta('creator').join(', ');
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const it of opf.getElementsByTagNameNS('*', 'item')) manifest.set(it.getAttribute('id') ?? '', { href: resolve(dir, it.getAttribute('href') ?? ''), type: it.getAttribute('media-type') ?? '', props: it.getAttribute('properties') ?? '' });
  // 목차 이름: EPUB3 nav 또는 EPUB2 toc.ncx
  const names = new Map<string, string>();
  const navItem = [...manifest.values()].find((m) => m.props.split(' ').includes('nav'));
  if (navItem && get(navItem.href)) {
    const nav = xml(strFromU8(get(navItem.href)!), 'text/html');
    const navDir = navItem.href.includes('/') ? navItem.href.slice(0, navItem.href.lastIndexOf('/') + 1) : '';
    for (const a of nav.querySelectorAll('nav a[href]')) {
      const p = resolve(navDir, a.getAttribute('href')!);
      if (!names.has(p)) names.set(p, a.textContent?.trim() ?? '');
    }
  }
  const ncxId = opf.getElementsByTagNameNS('*', 'spine')[0]?.getAttribute('toc');
  const ncx = ncxId ? manifest.get(ncxId) : [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
  if (ncx && get(ncx.href)) {
    const doc = xml(strFromU8(get(ncx.href)!));
    const ncxDir = ncx.href.includes('/') ? ncx.href.slice(0, ncx.href.lastIndexOf('/') + 1) : '';
    for (const np of doc.getElementsByTagNameNS('*', 'navPoint')) {
      const src = np.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src');
      const label = np.getElementsByTagNameNS('*', 'text')[0]?.textContent?.trim();
      if (src && label) {
        const p = resolve(ncxDir, src);
        if (!names.has(p)) names.set(p, label);
      }
    }
  }
  const nodes: DraftNode[] = [];
  const notes: string[] = [];
  let n = 0;
  let skippedImages = 0;
  for (const ref of opf.getElementsByTagNameNS('*', 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item || !/html|xml/.test(item.type)) continue;
    const raw = get(item.href);
    if (!raw) continue;
    const src = strFromU8(raw);
    let doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(src, 'text/html');
    skippedImages += doc.querySelectorAll('img,image').length;
    const md = htmlToMd(doc);
    if (!md.replace(/[#*\s]/g, '')) continue;
    // 장 제목: 목차 이름 → 첫 제목 → 번호
    const firstHead = md.match(/^#{1,6}\s+(.+)$/m)?.[1];
    let body = md;
    let t = names.get(item.href) || firstHead || '';
    if (firstHead && (t === firstHead || !names.get(item.href))) body = md.replace(/^#{1,6}\s+.+\n*/m, '');
    if (!t) t = `${nodes.length + 1}`;
    for (const [k, part] of chunk(body.trim()).entries()) nodes.push({ tmp: `e${n++}`, kind: 'chapter', title: k ? `${t} (${k + 1})` : t, body: part, sort: nodes.length });
  }
  if (!nodes.length) throw new Error('EPUB 안에서 글을 찾지 못했어요.');
  if (skippedImages) notes.push(`그림 ${skippedImages}개는 가져오지 않았어요 (글만 들입니다).`);
  return { title, author, nodes, source: 'epub', notes };
}

async function fromDocx(buf: ArrayBuffer, name: string): Promise<ImportedBook> {
  const files = unzipSync(new Uint8Array(buf));
  const docXml = files['word/document.xml'];
  if (!docXml) throw new Error('Word 문서 안에서 본문을 찾지 못했어요.');
  const doc = new DOMParser().parseFromString(strFromU8(docXml), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // 제목 단계: 문단 서식 이름(Heading1 · 제목 1 · 1) 또는 styles.xml 의 outlineLvl
  const outline = new Map<string, number>();
  if (files['word/styles.xml']) {
    const st = new DOMParser().parseFromString(strFromU8(files['word/styles.xml']), 'application/xml');
    for (const s of st.getElementsByTagNameNS(W, 'style')) {
      const id = s.getAttributeNS(W, 'styleId') ?? '';
      const lvl = s.getElementsByTagNameNS(W, 'outlineLvl')[0]?.getAttributeNS(W, 'val');
      const nm = s.getElementsByTagNameNS(W, 'name')[0]?.getAttributeNS(W, 'val') ?? '';
      if (lvl != null) outline.set(id, +lvl + 1);
      else {
        const m = nm.match(/heading\s*(\d)|제목\s*(\d)/i);
        if (m) outline.set(id, +(m[1] ?? m[2]));
      }
    }
  }
  const lines: string[] = [];
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') ?? '';
    let level = outline.get(style) ?? 0;
    if (!level) {
      const m = style.match(/heading\s*(\d)|^(\d)$|제목\s*(\d)/i);
      if (m) level = +(m[1] ?? m[2] ?? m[3]);
    }
    let text = '';
    for (const r of p.getElementsByTagNameNS(W, 'r')) {
      let t = '';
      for (const c of r.childNodes) {
        const ln = (c as Element).localName;
        if (ln === 't') t += c.textContent ?? '';
        else if (ln === 'tab') t += ' ';
        else if (ln === 'br') t += '\n';
      }
      if (!t) continue;
      const rpr = r.getElementsByTagNameNS(W, 'rPr')[0];
      const on = (tag: string) => {
        const e = rpr?.getElementsByTagNameNS(W, tag)[0];
        return !!e && e.getAttributeNS(W, 'val') !== '0' && e.getAttributeNS(W, 'val') !== 'false';
      };
      if (!level && t.trim() && on('b')) t = `**${t}**`;
      else if (!level && t.trim() && on('i')) t = `*${t}*`;
      text += t;
    }
    text = text.replace(/\*\*\*\*/g, '').replace(/\n/g, '  \n');
    if (level >= 1 && level <= 6 && text.trim()) lines.push(`${'#'.repeat(level)} ${text.replace(/\*/g, '').trim()}`);
    else lines.push(text.trim());
  }
  const md = lines.join('\n\n').replace(/\n{3,}/g, '\n\n');
  const core = files['docProps/core.xml'] ? new DOMParser().parseFromString(strFromU8(files['docProps/core.xml']), 'application/xml') : null;
  const r = splitMarkdown(md, core?.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() || baseName(name));
  return { ...r, author: core?.getElementsByTagNameNS('*', 'creator')[0]?.textContent?.trim() ?? '', source: 'docx', notes: [] };
}

async function fromPdf(buf: ArrayBuffer, name: string): Promise<ImportedBook> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    let lastY: number | null = null;
    const lines: string[] = [];
    for (const it of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      const y = it.transform?.[5] ?? 0;
      if (lastY != null && Math.abs(y - lastY) > 2 && line) {
        lines.push(line);
        line = '';
      }
      line += it.str;
      lastY = y;
      if (it.hasEOL) {
        lines.push(line);
        line = '';
        lastY = null;
      }
    }
    if (line) lines.push(line);
    // 줄 끝이 문장 끝(. ? ! 」 ” 다)이면 문단을 나누고, 아니면 이어 붙인다
    let para = '';
    const paras: string[] = [];
    for (const l of lines.map((x) => x.trim()).filter(Boolean)) {
      para += (para && !/[-­]$/.test(para) && /[A-Za-z]$/.test(para) ? ' ' : para ? ' ' : '') + l;
      if (/[.?!。」』”"'’…]$|다$/.test(l)) {
        paras.push(para);
        para = '';
      }
    }
    if (para) paras.push(para);
    pages.push(paras.join('\n\n'));
  }
  const text = pages.join('\n\n');
  if (text.replace(/\s/g, '').length < 20) throw new Error('이 PDF 에서 글자를 찾지 못했어요. 스캔한(사진) PDF 는 들일 수 없어요.');
  const info = (await pdf.getMetadata().catch(() => null))?.info as { Title?: string; Author?: string } | undefined;
  const r = splitMarkdown(text, info?.Title?.trim() || baseName(name));
  return { ...r, author: info?.Author?.trim() ?? '', source: 'pdf', notes: ['PDF 는 글자만 가져와요. 문단 나눔이 원본과 다를 수 있어요.'] };
}

export async function importFile(file: File): Promise<ImportedBook> {
  const ext = (file.name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  const buf = await file.arrayBuffer();
  return importBytes(buf, file.name, ext);
}

export async function importBytes(buf: ArrayBuffer, name: string, ext: string): Promise<ImportedBook> {
  if (ext === 'epub') return fromEpub(buf, name);
  if (ext === 'docx') return fromDocx(buf, name);
  if (ext === 'pdf') return fromPdf(buf, name);
  const text = decodeText(buf);
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const r = splitMarkdown(htmlToMd(doc), doc.title?.trim() || baseName(name));
    return { ...r, author: doc.querySelector('meta[name=author]')?.getAttribute('content') ?? '', source: 'html', notes: [] };
  }
  if (ext === 'md' || ext === 'markdown') return { ...splitMarkdown(text, baseName(name)), author: '', source: 'md', notes: [] };
  // .txt: 구텐베르크 머리말 · 꼬리말은 잘라 낸다
  let t = text;
  const start = t.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (start >= 0) t = t.slice(t.indexOf('\n', start) + 1);
  const end = t.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (end >= 0) t = t.slice(0, end);
  return { ...splitMarkdown(normalizePlain(t), baseName(name)), author: '', source: 'txt', notes: [] };
}
