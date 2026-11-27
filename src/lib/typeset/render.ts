// 인쇄용 조판 3단계: 앉힌 쪽들을 PDF 로 그린다. 글꼴은 파일 안에 통째로 넣는다(압축되어 글꼴 하나에 약 2MB).
// pdf-lib 의 「쓴 글자만 넣기(subset)」는 이 한글 글꼴에서 글자를 빠뜨려서 쓰지 않는다 (시험으로 확인).
// 도련(재단 여백)을 넣으면 쪽 크기를 사방 3mm 키우고, 재단선(TrimBox) · 도련(BleedBox)을 적어 둔다.
import { PDFDocument, rgb, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { MM, type Geo, type Page } from './layout';

export interface RenderInput {
  pages: Page[];
  geo: Geo;
  fonts: { regular: Uint8Array; bold: Uint8Array };
  images: Map<string, { bytes: Uint8Array; mime: string }>;
  meta: { title: string; author: string };
  bleed: boolean;
}

export async function renderPdf(r: RenderInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(r.fonts.regular, { subset: false });
  const bold = await doc.embedFont(r.fonts.bold, { subset: false });
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
  const ink = rgb(0, 0, 0);
  for (const p of r.pages) {
    const page = doc.addPage([W + 2 * b, H + 2 * b]);
    if (b) {
      page.setTrimBox(b, b, W, H);
      page.setBleedBox(0, 0, W + 2 * b, H + 2 * b);
    }
    for (const it of p.items) {
      if (it.k === 't') page.drawText(it.text, { x: b + it.x, y: b + H - it.y, size: it.size, font: it.bold ? bold : regular, color: ink });
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
  return doc.save();
}
