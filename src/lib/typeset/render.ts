// 인쇄용 조판 3단계: 앉힌 쪽들을 PDF 로 그린다. 글꼴은 이 책에 쓴 글자만 남겨(harfbuzz, subset.ts) 파일 안에 넣는다.
// pdf-lib 의 「쓴 글자만 넣기(subset)」는 한글 글꼴에서 글자를 빠뜨려서(시험으로 확인) 쓰지 않고, 줄인 글꼴을 통째로 넣는다.
// 도련(재단 여백)을 넣으면 쪽 크기를 사방 3mm 키우고, 재단선(TrimBox) · 도련(BleedBox)을 적어 둔다.
import { grayscale, PDFDocument, setCharacterSpacing, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { MM, type Geo, type Page } from './layout';
import type { Subsetter } from './subset';

export interface RenderFonts {
  regular: Uint8Array;
  bold: Uint8Array;
  subset?: Subsetter;
  name?: string;
  /** 제목용 다른 글꼴 */
  head?: RenderFonts;
}
export interface RenderInput {
  pages: Page[];
  geo: Geo;
  fonts: RenderFonts;
  images: Map<string, { bytes: Uint8Array; mime: string }>;
  meta: { title: string; author: string };
  bleed: boolean;
  /** 자간 (글자 크기 기준) */
  tracking?: number;
}

export async function renderPdf(r: RenderInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const hf = r.fonts.head;
  // 글꼴(본문 · 제목) × 굵기마다 쓴 글자를 따로 모은다
  const used = { R: '', B: '', hR: '', hB: '' };
  const kind = (it: { bold?: boolean; hd?: boolean }) => ((it.hd && hf ? 'h' : '') + (it.bold ? 'B' : 'R')) as keyof typeof used;
  for (const p of r.pages) for (const it of p.items) if (it.k === 't') used[kind(it)] += it.text;
  // 이름은 「글꼴-굵기」로 적는다 (본명조 · 본고딕은 가변 글꼴에서 굵기를 고정해 원래 이름이 「ExtraLight」로 남아 있어서)
  // 줄인 글꼴은 PDF 규격대로 이름 앞에 대문자 여섯 개와 + 를 붙인다 (인쇄소 검사기가 「일부만 넣은 글꼴」로 알아보게)
  const tag = () => Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('') + '+';
  const embed = async (f: RenderFonts, weight: 'regular' | 'bold', text: string) => {
    let bytes = f[weight];
    if (f.subset) {
      try {
        bytes = f.subset(bytes, { text: text + ' ' });
      } catch {
        /* 못 줄이면 통째로 (파일만 커진다) */
      }
    }
    const w = weight === 'bold' ? 'Bold' : 'Regular';
    return doc.embedFont(bytes, { subset: false, ...(f.name ? { customName: `${f.subset ? tag() : ''}${f.name}-${w}` } : {}) });
  };
  const fonts = {
    R: await embed(r.fonts, 'regular', used.R),
    B: await embed(r.fonts, 'bold', used.B),
    hR: hf ? await embed(hf, 'regular', used.hR) : null,
    hB: hf ? await embed(hf, 'bold', used.hB) : null,
  };
  const imgs = new Map<string, PDFImage>();
  for (const [src, im] of r.images) {
    try {
      imgs.set(src, im.mime === 'image/png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes));
    } catch {
      /* 못 읽는 그림은 건너뛴다 */
    }
  }
  const b = r.bleed ? 3 * MM : 0;
  const { W, H } = r.geo;
  // 검정은 회색조 0 (인쇄소에서 먹 1도로 찍기 좋게 RGB 검정을 쓰지 않는다)
  const ink = grayscale(0);
  const tr = r.tracking ?? 0;
  for (const p of r.pages) {
    const page = doc.addPage([W + 2 * b, H + 2 * b]);
    if (b) {
      page.setTrimBox(b, b, W, H);
      page.setBleedBox(0, 0, W + 2 * b, H + 2 * b);
    }
    for (const it of p.items) {
      if (it.k === 't') {
        const f = fonts[kind(it)] ?? fonts[it.bold ? 'B' : 'R'];
        if (tr) page.pushOperators(setCharacterSpacing(tr * it.size));
        page.drawText(it.text, { x: b + it.x, y: b + H - it.y, size: it.size, font: f, color: ink });
      }
      else if (it.k === 'rule') page.drawLine({ start: { x: b + it.x, y: b + H - it.y }, end: { x: b + it.x + it.w, y: b + H - it.y }, thickness: it.t, color: ink });
      else {
        const im = imgs.get(it.src);
        if (im) page.drawImage(im, { x: b + it.x, y: b + H - it.y - it.h, width: it.w, height: it.h });
      }
    }
  }
  doc.setTitle(r.meta.title || '제목 없음');
  if (r.meta.author) doc.setAuthor(r.meta.author);
  doc.setLanguage('ko-KR');
  doc.setCreator('서재');
  doc.setProducer('서재 (pdf-lib)');
  // 객체를 묶어 압축하지 않는다: 오래된 인쇄소 점검 도구도 읽을 수 있고, 글꼴 이름이 파일에 그대로 보인다
  return doc.save({ useObjectStreams: false });
}
