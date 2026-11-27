// 인쇄용 PDF 만들기: 원고 → 블록 → 조판 → PDF. 화면(내보내기 · 집필실 목차)과 시험이 같은 함수를 쓴다.
import fontkit from '@pdf-lib/fontkit';
import type { Section } from './blocks';
import { toSections } from './blocks';
import { layoutBook, MM, type Issue, type Metrics, type PrintOptions, type TocEntry } from './layout';
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
  /** 제목(표제지 · 부 · 장 · 소제목)에 쓸 다른 글꼴 (없으면 본문 글꼴 그대로) */
  head?: Fonts;
}
export function openFonts(regular: Uint8Array, bold: Uint8Array, subset?: Subsetter, name?: string, head?: Fonts): Fonts {
  return { regular, bold, fkRegular: fontkit.create(regular as never), fkBold: fontkit.create(bold as never), subset, name, head };
}
export function metricsOf(f: Fonts): Metrics {
  return {
    adv(ch, bold, hd) {
      const src = hd && f.head ? f.head : f;
      const fk = bold ? src.fkBold : src.fkRegular;
      const g = fk.glyphForCodePoint(ch.codePointAt(0)!);
      return (g?.advanceWidth ?? fk.unitsPerEm * 0.5) / fk.unitsPerEm;
    },
  };
}

/** 글꼴에 없는 글자는 □ 로 바꾸고, 어떤 글자였는지 돌려준다. 제목은 본문 글꼴 · 제목 글꼴 모두에 있어야 한다(목차 · 머리글은 본문 글꼴로 쓰므로) */
export function replaceMissing(sections: Section[], f: Fonts): string[] {
  const missing = new Set<string>();
  const has = (fk: FK, c: string) => c === '\n' || c === ' ' || fk.hasGlyphForCodePoint(c.codePointAt(0)!);
  const mk = (...fks: FK[]) => (t: string) =>
    [...t]
      .map((c) => {
        if (fks.every((fk) => has(fk, c))) return c;
        missing.add(c);
        return '□';
      })
      .join('');
  const body = mk(f.fkRegular);
  const both = mk(f.fkRegular, (f.head ?? f).fkRegular);
  const head = mk((f.head ?? f).fkRegular);
  for (const s of sections) {
    s.title = both(s.title);
    for (const b of s.blocks) {
      if (b.t === 'p') for (const r of b.runs) (r.text = body(r.text)), r.note != null && (r.note = body(r.note));
      else if (b.t === 'h') b.text = head(b.text);
      else if (b.t === 'img') b.alt = body(b.alt);
    }
  }
  return [...missing];
}

export interface PrintReport {
  pages: number;
  /** 재단(완성) 크기 mm */
  trimMm: [number, number];
  /** PDF 쪽 크기 mm (도련이 있으면 사방 3mm 더 큼) */
  pageMm: [number, number];
  bleed: boolean;
  bodyPt: number;
  leadPt: number;
  fonts: { role: string; name: string }[];
  /** 본문 여백 mm */
  marginsMm: { top: number; bottom: number; inner: number; outer: number };
  images: { src: string; page: number; dpi: number }[];
  missing: string[];
  issues: Issue[];
}
export interface PrintResult {
  bytes: Uint8Array;
  pages: number;
  toc: TocEntry[];
  missing: string[];
  issues: Issue[];
  report: PrintReport;
}

type Img = { bytes: Uint8Array; mime: string; w: number; h: number };
type NodeIn = { id: string; kind: string; title: string; body: string };

/** 원고 → 글꼴에 맞춘 조판 구역 (제목 · 저자까지 □ 로 바꿔 둔다) */
function prepare(nodes: NodeIn[], o: PrintOptions, fonts: Fonts) {
  const sections = toSections(nodes, true, o.quotes);
  const missing = replaceMissing(sections, fonts);
  const hf = fonts.head ?? fonts;
  const miss = (t: string, ...fks: FK[]) => [...t].filter((c) => c !== ' ' && !fks.every((fk) => fk.hasGlyphForCodePoint(c.codePointAt(0)!)));
  missing.push(...miss(o.title, fonts.fkRegular, hf.fkRegular), ...miss(o.subtitle ?? '', fonts.fkRegular, hf.fkRegular), ...miss(o.author, fonts.fkRegular));
  const fix = (t: string, ...fks: FK[]) => [...t].map((c) => (c === ' ' || fks.every((fk) => fk.hasGlyphForCodePoint(c.codePointAt(0)!)) ? c : '□')).join('');
  const opts = { ...o, title: fix(o.title, fonts.fkRegular, hf.fkRegular), subtitle: o.subtitle ? fix(o.subtitle, fonts.fkRegular, hf.fkRegular) : '', author: fix(o.author, fonts.fkRegular) };
  return { sections, opts, missing: [...new Set(missing)] };
}

/** nodes: 앞붙이(plain 글) · 원고 칸들. 앞에 목차 칸(m-toc)이 있으면 목차 쪽을 만든다 */
export async function buildPrintPdf(nodes: NodeIn[], o: PrintOptions & { bleed: boolean }, fonts: Fonts, images: Map<string, Img> = new Map()): Promise<PrintResult> {
  const { sections, opts, missing } = prepare(nodes, o, fonts);
  const dims = new Map([...images].map(([k, v]) => [k, { w: v.w, h: v.h }]));
  const { pages, geo, toc, issues } = layoutBook(sections, metricsOf(fonts), opts, dims);
  const bytes = await renderPdf({ pages, geo, fonts, images, meta: { title: o.title, author: o.author }, bleed: o.bleed, tracking: o.tracking ?? 0 });
  const b = o.bleed ? 6 : 0;
  const mm = (v: number) => Math.round((v / MM) * 10) / 10;
  const imgs: PrintReport['images'] = [];
  for (const p of pages) for (const it of p.items) if (it.k === 'img') {
    const im = images.get(it.src);
    if (im) imgs.push({ src: it.src, page: p.n, dpi: Math.round(im.w / (it.w / 72)) });
  }
  const report: PrintReport = {
    pages: pages.length,
    trimMm: [mm(geo.W), mm(geo.H)],
    pageMm: [mm(geo.W) + b, mm(geo.H) + b],
    bleed: o.bleed,
    bodyPt: Math.round(geo.size * 10) / 10,
    leadPt: Math.round(geo.lead * 10) / 10,
    marginsMm: { top: mm(geo.top), bottom: mm(geo.bottom), inner: mm(geo.inner), outer: mm(geo.outer) },
    fonts: [{ role: '본문', name: fonts.name ?? '' }, ...(fonts.head ? [{ role: '제목', name: fonts.head.name ?? '' }] : [])],
    images: imgs,
    missing,
    issues,
  };
  return { bytes, pages: pages.length, toc, missing, issues, report };
}

export interface Suggestion {
  label: string;
  patch: Partial<PrintOptions>;
  issues: number;
  pages: number;
}
/** 쪽수만 셈하기 (집필실 목차 쪽수 · 전체 쪽수 · 인쇄 점검) — PDF 는 만들지 않는다 */
export function countPages(nodes: NodeIn[], o: PrintOptions, fonts: Fonts): { pages: number; toc: TocEntry[]; issues: Issue[]; suggestions: Suggestion[] } {
  const { sections, opts } = prepare(nodes, o, fonts);
  const m = metricsOf(fonts);
  const r = layoutBook(sections, m, opts);
  // 점검에 걸린 곳이 있으면, 줄 간격 · 자간 · 글자 크기를 조금 바꿔 풀리는지 미리 해 본다
  const suggestions: Suggestion[] = [];
  if (r.issues.length) {
    const lead = o.leading ?? 1.78;
    const variants: { label: string; patch: Partial<PrintOptions> }[] = [
      { label: `줄 간격을 ${(lead - 0.06).toFixed(2)} 로`, patch: { leading: Math.max(1.5, lead - 0.06) } },
      { label: `줄 간격을 ${(lead - 0.12).toFixed(2)} 로`, patch: { leading: Math.max(1.5, lead - 0.12) } },
      { label: '자간을 조금 좁게 (−0.01)', patch: { tracking: (o.tracking ?? 0) - 0.01 } },
      ...(o.font === 'large' ? [{ label: '글자 크기를 보통으로', patch: { font: 'normal' as const } }] : o.font === 'normal' ? [{ label: '글자 크기를 작게로', patch: { font: 'small' as const } }] : []),
    ];
    for (const v of variants) {
      if (v.patch.leading != null && v.patch.leading >= lead) continue;
      const t = layoutBook(sections, m, { ...opts, ...v.patch });
      if (t.issues.length < r.issues.length) suggestions.push({ ...v, issues: t.issues.length, pages: t.pages.length });
    }
    suggestions.sort((a, b) => a.issues - b.issues || a.pages - b.pages);
    suggestions.length = Math.min(suggestions.length, 2);
  }
  return { pages: r.pages.length, toc: r.toc, issues: r.issues, suggestions };
}

// ---------------------------------------------------------------- 화면에서: 글꼴 · 설정
const fontsP = new Map<FaceId, Promise<Fonts>>();
/** 인쇄용 글꼴을 글꼴마다 한 번만 받는다 (보통 · 굵게 두 파일, settings.ts FACES 의 크기) */
function loadOne(face: FaceId): Promise<Fonts> {
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

/** 본문 글꼴과(있으면) 제목 글꼴을 받아 하나로 묶는다 */
export async function loadPrintFonts(face: FaceId = 'gowun', headFace: FaceId | 'same' = 'same'): Promise<Fonts> {
  const body = await loadOne(face);
  if (headFace === 'same' || headFace === face) return body;
  return { ...body, head: await loadOne(headFace) };
}

export { DEFAULT_PRINT, FACES, printSettingsOf, type FaceId, type PrintSettings } from './settings';
