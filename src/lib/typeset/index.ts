// 인쇄용 PDF 만들기: 원고 → 블록 → 조판 → PDF. 화면(내보내기 · 집필실 목차)과 시험이 같은 함수를 쓴다.
import fontkit from '@pdf-lib/fontkit';
import type { Section } from './blocks';
import { toSections } from './blocks';
import { layoutBook, type Metrics, type PrintOptions, type TocEntry } from './layout';
import { renderPdf } from './render';
import { FACES, faceFiles, type FaceId } from './settings';
import { loadSubsetter, type Subsetter } from './subset';
import subsetWasm from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';

export type { PrintOptions } from './layout';
export { SIZES, FONT_SCALE } from './layout';

type FK = ReturnType<typeof fontkit.create>;
export interface Fonts {
  regular: Uint8Array;
  bold: Uint8Array;
  fkRegular: FK;
  fkBold: FK;
  /** 있으면 PDF 에 쓴 글자만 남긴다 (없으면 글꼴을 통째로) */
  subset?: Subsetter;
  /** PDF 에 적을 글꼴 이름 (예: NotoSerifKR → NotoSerifKR-Regular) */
  name?: string;
}
export function openFonts(regular: Uint8Array, bold: Uint8Array, subset?: Subsetter, name?: string): Fonts {
  return { regular, bold, fkRegular: fontkit.create(regular as never), fkBold: fontkit.create(bold as never), subset, name };
}
export function metricsOf(f: Fonts): Metrics {
  return {
    adv(ch, bold) {
      const fk = bold ? f.fkBold : f.fkRegular;
      const g = fk.glyphForCodePoint(ch.codePointAt(0)!);
      return (g?.advanceWidth ?? fk.unitsPerEm * 0.5) / fk.unitsPerEm;
    },
  };
}

/** 글꼴에 없는 글자는 □ 로 바꾸고, 어떤 글자였는지 돌려준다 */
export function replaceMissing(sections: Section[], f: Fonts): string[] {
  const missing = new Set<string>();
  const fix = (t: string) =>
    [...t]
      .map((c) => {
        if (c === '\n' || c === ' ' || f.fkRegular.hasGlyphForCodePoint(c.codePointAt(0)!)) return c;
        missing.add(c);
        return '□';
      })
      .join('');
  for (const s of sections) {
    s.title = fix(s.title);
    for (const b of s.blocks) {
      if (b.t === 'p') for (const r of b.runs) (r.text = fix(r.text)), r.note != null && (r.note = fix(r.note));
      else if (b.t === 'h') b.text = fix(b.text);
      else if (b.t === 'img') b.alt = fix(b.alt);
    }
  }
  return [...missing];
}

export interface PrintResult {
  bytes: Uint8Array;
  pages: number;
  toc: TocEntry[];
  missing: string[];
}

/** nodes: 앞붙이(plain 글) · 원고 칸들. 앞에 목차 칸(m-toc)이 있으면 목차 쪽을 만든다 */
export async function buildPrintPdf(nodes: { id: string; kind: string; title: string; body: string }[], o: PrintOptions & { bleed: boolean }, fonts: Fonts, images: Map<string, { bytes: Uint8Array; mime: string; w: number; h: number }> = new Map()): Promise<PrintResult> {
  const sections = toSections(nodes, true);
  const missing = replaceMissing(sections, fonts);
  missing.push(...[o.title, o.subtitle ?? '', o.author].flatMap((t) => [...t].filter((c) => c !== ' ' && !fonts.fkRegular.hasGlyphForCodePoint(c.codePointAt(0)!))));
  const fix = (t: string) => [...t].map((c) => (c === ' ' || fonts.fkRegular.hasGlyphForCodePoint(c.codePointAt(0)!) ? c : '□')).join('');
  const opts = { ...o, title: fix(o.title), subtitle: o.subtitle ? fix(o.subtitle) : '', author: fix(o.author) };
  const { pages, geo, toc } = layoutBook(sections, metricsOf(fonts), opts, new Map([...images].map(([k, v]) => [k, { w: v.w, h: v.h }])));
  const bytes = await renderPdf({ pages, geo, fonts, images, meta: { title: o.title, author: o.author }, bleed: o.bleed });
  return { bytes, pages: pages.length, toc, missing: [...new Set(missing)] };
}

/** 쪽수만 셈하기 (집필실 목차 쪽수 · 전체 쪽수) — PDF 는 만들지 않는다 */
export function countPages(nodes: { id: string; kind: string; title: string; body: string }[], o: PrintOptions, fonts: Fonts): { pages: number; toc: TocEntry[] } {
  const sections = toSections(nodes, true);
  replaceMissing(sections, fonts);
  const r = layoutBook(sections, metricsOf(fonts), o);
  return { pages: r.pages.length, toc: r.toc };
}

// ---------------------------------------------------------------- 화면에서: 글꼴 · 설정
const fontsP = new Map<FaceId, Promise<Fonts>>();
/** 인쇄용 글꼴을 글꼴마다 한 번만 받는다 (보통 · 굵게 두 파일, settings.ts FACES 의 크기) */
export function loadPrintFonts(face: FaceId = 'gowun'): Promise<Fonts> {
  let p = fontsP.get(face);
  if (!p) {
    p = Promise.all([
      ...faceFiles(face).map(async (u) => {
        const r = await fetch(u);
        if (!r.ok) throw new Error('인쇄용 글꼴을 받지 못했어요. 인터넷 연결을 확인해 주세요.');
        return new Uint8Array(await r.arrayBuffer());
      }),
    ]).then(async ([a, b]) => openFonts(a, b, await loadSubsetter(subsetWasm).catch(() => undefined), FACES[face].file));
    p.catch(() => fontsP.delete(face));
    fontsP.set(face, p);
  }
  return p;
}

export { DEFAULT_PRINT, FACES, printSettingsOf, type FaceId, type PrintSettings } from './settings';
