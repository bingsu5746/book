// Node 에서 실제 글꼴로 조판 · PDF 를 만들어 보는 시험 (tsconfig 에서는 빼 둠: node:fs 를 쓴다)
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildPrintPdf, countPages, openFonts } from './index';
import { breakLines, Measure, layoutBook } from './layout';
import { toSections, mdBlocks } from './blocks';
import { metricsOf } from './index';

const fonts = openFonts(new Uint8Array(readFileSync('public/fonts/GowunBatang-Regular.ttf')), new Uint8Array(readFileSync('public/fonts/GowunBatang-Bold.ttf')));
const ms = new Measure(metricsOf(fonts));
const para = '그날 아침 바람은 차가웠고, 홍설은 외투 깃을 세웠다. 길가의 은행나무가 노랗게 물들어 있었다. “어디 가?” 민우가 물었다. 그녀는 대답하지 않고 파빌리온 쪽으로 걸었다. ';
const opts = { size: 'sinkook' as const, font: 'normal' as const, rightStart: true, heads: true, noteStyle: 'star' as const, multipleOf4: true, title: '새벽을 건너는 꿈', author: '홍길동', bleed: false };

describe('줄 나누기', () => {
  it('줄 너비를 넘지 않고, 닫는 부호가 줄 앞에 오지 않는다', () => {
    const lines = breakLines([{ text: para.repeat(6) }], 300, 10, ms, { justify: true, indent: 10 });
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) {
      const last = l.segs[l.segs.length - 1];
      expect(last.x + ms.text(last.text, false, 10)).toBeLessThanOrEqual(300.5);
      expect(/^[.,!?…)」』”’]/.test(l.segs[0].text)).toBe(false);
    }
    // 양끝 맞춤: 마지막 줄이 아닌 줄은 오른쪽 끝에 닿는다
    const l = lines[1];
    const end = l.segs[l.segs.length - 1];
    expect(end.x + ms.text(end.text, false, 10)).toBeGreaterThan(295);
  });
  it('주석 표시 자리를 잡고, 줄 바꿈을 지킨다', () => {
    const b = mdBlocks('은열쇠[^1]를 쥐었다.\n다음 줄.\n\n[^1]: 할머니가 준 열쇠.', true);
    expect(b).toHaveLength(1);
    const lines = breakLines((b[0] as unknown as { runs: never }).runs, 300, 10, ms);
    expect(lines).toHaveLength(2);
    expect(lines[0].notes).toEqual(['할머니가 준 열쇠.']);
  });
});

describe('조판', () => {
  const nodes = [
    { id: 'm-dedication', kind: 'scene', title: '', body: '엄마에게' },
    { id: 'm-toc', kind: 'chapter', title: '목차', body: '' },
    { id: 'p1', kind: 'part', title: '1부 멈춘 아침', body: '' },
    { id: 'c1', kind: 'chapter', title: '1장 바람', body: (para.repeat(4) + '\n\n').repeat(8) + '은열쇠[^k]를 쥐었다.\n\n[^k]: 할머니가 남긴 열쇠. 이야기 내내 나온다.' },
    { id: 'c2', kind: 'chapter', title: '2장 정원', body: (para.repeat(3) + '\n\n').repeat(12) },
    { id: 's1', kind: 'scene', title: '', body: para.repeat(3) },
    { id: 'm-afterword', kind: 'chapter', title: '작가의 말', body: '읽어 주어 고마워요.' },
    { id: 'm-colophon', kind: 'scene', title: '', body: '새벽을 건너는 꿈\n\n지은이 홍길동\n\n1판 · 2026-11-27' },
  ];
  const sections = toSections(nodes, true);
  const r = layoutBook(sections, metricsOf(fonts), opts);
  it('장 · 부는 오른쪽(홀수) 쪽에서 시작하고, 목차 쪽수가 실제 쪽과 같다', () => {
    expect(r.toc.map((t) => t.title)).toEqual(['1부 멈춘 아침', '1장 바람', '2장 정원', '작가의 말']);
    for (const t of r.toc) {
      expect(t.page % 2).toBe(1);
      expect(r.pages[t.page - 1].kind === 'chapter' || r.pages[t.page - 1].kind === 'part').toBe(true);
    }
    const tocText = r.pages.filter((p) => p.kind === 'toc').flatMap((p) => p.items.map((i) => (i.k === 't' ? i.text : '')));
    for (const t of r.toc) expect(tocText).toContain(String(t.page));
  });
  it('판권면은 맨 뒤 짝수 쪽, 전체 쪽수는 4의 배수', () => {
    expect(r.pages.length % 4).toBe(0);
    expect(r.pages[r.pages.length - 1].kind).toBe('colophon');
    expect(r.pages.length % 2).toBe(0);
  });
  it('주석은 표시가 있는 쪽 아래에 붙는다', () => {
    const p = r.pages.find((pg) => pg.items.some((i) => i.k === 't' && i.text === '할머니가'));
    expect(p).toBeTruthy();
    // 본문 속 작은 표시와 주석 줄 앞 표시, 그리고 구분선
    expect(p!.items.filter((i) => i.k === 't' && i.text === '*').length).toBe(2);
    expect(p!.items.some((i) => i.k === 'rule')).toBe(true);
    const mark = p!.items.find((i) => i.k === 't' && i.text.startsWith('은열쇠')) as { y: number };
    const note = p!.items.find((i) => i.k === 't' && i.text === '할머니가') as { y: number };
    expect(note.y).toBeGreaterThan(mark.y);
  });
  it('글이 쪽 바깥으로 나가지 않는다', () => {
    for (const p of r.pages)
      for (const i of p.items) {
        expect(i.x).toBeGreaterThanOrEqual(0);
        if (i.k === 't') expect(i.y).toBeLessThanOrEqual(r.geo.H);
      }
  });
  it('PDF 를 만들고 쪽수 셈과 같다 (TYPESET_OUT 이 있으면 파일로)', async () => {
    const out = await buildPrintPdf(nodes, { ...opts, bleed: true }, fonts);
    expect(out.pages).toBe(countPages(nodes, opts, fonts).pages);
    expect(new TextDecoder().decode(out.bytes.slice(0, 5))).toBe('%PDF-');
    expect(out.bytes.length).toBeLessThan(6_000_000);
    if (process.env.TYPESET_OUT) writeFileSync(process.env.TYPESET_OUT, out.bytes);
  }, 30_000);
  it('글꼴에 없는 글자는 □ 로 바꾸고 알린다', async () => {
    const out = await buildPrintPdf([{ id: 'c', kind: 'chapter', title: '漢字', body: '가나다' }], { ...opts, multipleOf4: false }, fonts);
    expect(out.missing.sort()).toEqual(['字', '漢']);
  }, 30_000);
});

import { deflateSync } from 'node:zlib';
function png(w: number, h: number): Uint8Array {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 180)])));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
describe('사진', () => {
  it('사진을 글 너비 안에 넣고 설명을 아래에, PDF 에도 들어간다', async () => {
    const nodes = [{ id: 'c', kind: 'chapter', title: '1장', body: '앞 문단이다.\n\n![바다 사진](/api/bimg/abc "1600x900")\n\n뒤 문단이다.' }];
    const r = layoutBook(toSections(nodes, true), metricsOf(fonts), { ...opts, multipleOf4: false });
    const img = r.pages.flatMap((p) => p.items).find((i) => i.k === 'img') as { w: number; h: number; y: number };
    expect(img).toBeTruthy();
    expect(img.w).toBeLessThanOrEqual(r.geo.textW + 0.01);
    expect(Math.abs(img.w / img.h - 16 / 9)).toBeLessThan(0.01);
    const cap = r.pages.flatMap((p) => p.items).find((i) => i.k === 't' && i.text === '사진') as { y: number };
    expect(cap.y).toBeGreaterThan(img.y + img.h);
    const out = await buildPrintPdf(nodes, { ...opts, multipleOf4: false, bleed: false }, fonts, new Map([['/api/bimg/abc', { bytes: png(160, 90), mime: 'image/png', w: 1600, h: 900 }]]));
    expect(out.bytes.length).toBeGreaterThan(1000);
    if (process.env.TYPESET_OUT) writeFileSync(process.env.TYPESET_OUT.replace('.pdf', '-img.pdf'), out.bytes);
  }, 30_000);
});

import fontkit from '@pdf-lib/fontkit';
import { subsetterFrom } from './subset';
import { FACES, faceFiles, type FaceId } from './settings';
describe('글꼴', () => {
  const subP = subsetterFrom(readFileSync('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'));
  const load = (id: FaceId) => faceFiles(id).map((u) => new Uint8Array(readFileSync(`public${u}`)));
  it('글꼴마다 보통 · 굵게 파일 · 미리 보기 · 라이선스가 있고 한글 11,172자를 다 갖췄다', () => {
    for (const [id, f] of Object.entries(FACES) as [FaceId, (typeof FACES)[FaceId]][]) {
      for (const b of load(id)) {
        const fk = fontkit.create(b as never);
        let n = 0;
        for (let c = 0xac00; c <= 0xd7a3; c++) if (fk.hasGlyphForCodePoint(c)) n++;
        expect(n, f.name).toBe(11172);
        expect(fk.hasGlyphForCodePoint(0x6f22), `${f.name} 한자`).toBe(f.hanja);
      }
      expect(readFileSync(`public/fonts/preview/${f.file}.ttf`).length).toBeGreaterThan(1000);
      expect(readFileSync(`public/fonts/OFL-${f.file}.txt`, 'utf8')).toContain('Open Font License');
    }
  });
  it('쓴 글자만 남겨도 그 글자들은 다 있고, 파일이 아주 작아진다', async () => {
    const sub = await subP;
    const text = '그날 아침 바람은 차가웠다. “Hello” 123 「책」';
    const small = sub(fonts.regular, { text });
    const fk = fontkit.create(small as never);
    for (const c of text) expect(fk.hasGlyphForCodePoint(c.codePointAt(0)!), c).toBe(true);
    expect(fk.hasGlyphForCodePoint('펭'.codePointAt(0)!)).toBe(false);
    expect(small.length).toBeLessThan(40_000);
  });
  it('글꼴을 줄여 넣은 PDF 는 작고, 쪽수는 같다', async () => {
    const f = openFonts(fonts.regular, fonts.bold, await subP, 'GowunBatang');
    const out = await buildPrintPdf(nodes2(), { ...opts, bleed: false }, f);
    const full = await buildPrintPdf(nodes2(), { ...opts, bleed: false }, fonts);
    expect(out.pages).toBe(full.pages);
    expect(out.bytes.length).toBeLessThan(full.bytes.length / 10);
    if (process.env.TYPESET_OUT) writeFileSync(process.env.TYPESET_OUT.replace('.pdf', '-subset.pdf'), out.bytes);
  }, 60_000);
  it('본명조는 한자를 그대로 싣는다', async () => {
    const [r, b] = load('noto');
    const f = openFonts(r, b, await subP, 'NotoSerifKR');
    const out = await buildPrintPdf([{ id: 'c', kind: 'chapter', title: '漢字의 길', body: '그는 「春秋」를 읽었다.' }], { ...opts, multipleOf4: false }, f);
    expect(out.missing).toEqual([]);
    expect(out.bytes.length).toBeLessThan(400_000);
    if (process.env.TYPESET_OUT) writeFileSync(process.env.TYPESET_OUT.replace('.pdf', '-noto.pdf'), out.bytes);
  }, 60_000);
});
function nodes2() {
  return [
    { id: 'c1', kind: 'chapter', title: '1장 바람', body: (para + '\n\n').repeat(12) + '은열쇠[^1]를 쥐었다.\n\n[^1]: 할머니가 준 열쇠.' },
    { id: 'c2', kind: 'chapter', title: '2장 **정원**', body: para.repeat(10) },
  ];
}

describe('장 시작 서식', () => {
  const ch = [{ id: 'c1', kind: 'chapter', title: '3장 바람이 불다', body: '첫 문단입니다.\n\n둘째 문단입니다.' }];
  const heading = (o: object) => {
    const sections = toSections(ch, true);
    const r = layoutBook(sections, metricsOf(fonts), { ...opts, multipleOf4: false, ...o });
    const pg = r.pages.find((p) => p.kind === 'chapter')!;
    return { pg, texts: pg.items.filter((i) => i.k === 't').map((i) => (i as { text: string }).text) };
  };
  it('번호를 떼어 윗줄에 따로 쓴다', async () => {
    const { splitChapterTitle } = await import('./layout');
    expect(splitChapterTitle('1장 바람')).toEqual({ n: 1, unit: '장', name: '바람' });
    expect(splitChapterTitle('제12장 - 숲')).toEqual({ n: 12, unit: '장', name: '숲' });
    expect(splitChapterTitle('3. 정원')).toEqual({ n: 3, unit: '장', name: '정원' });
    expect(splitChapterTitle('바람')).toBeNull();
    expect(heading({ chapterNumber: 'plain' }).texts.slice(0, 3)).toEqual(['3', '바람이', '불다']);
    expect(heading({ chapterNumber: 'je' }).texts.slice(0, 3)).toEqual(['제3장', '바람이', '불다']);
    expect(heading({}).texts.slice(0, 3)).toEqual(['3장', '바람이', '불다']);
  });
  it('왼쪽 정렬은 짧은 선이 붙고, 낮추면 더 아래에서 시작한다', () => {
    const left = heading({ chapterAlign: 'left' });
    expect(left.pg.items.some((i) => i.k === 'rule')).toBe(true);
    const y = (h: ReturnType<typeof heading>) => (h.pg.items.find((i) => i.k === 't') as { y: number }).y;
    expect(y(heading({ chapterDrop: 'low' }))).toBeGreaterThan(y(heading({})));
  });
  it('첫 문단 들여쓰기를 끌 수 있다', () => {
    const x = (o: object) => {
      const items = heading(o).pg.items.filter((i) => i.k === 't') as { x: number; text: string }[];
      return items.find((i) => i.text.startsWith('첫'))!.x;
    };
    expect(x({ firstIndent: false })).toBeLessThan(x({}));
  });
});

import { convertQuotes } from './blocks';
describe('서식 더하기', () => {
  const longBody = (para + '\n\n').repeat(14);
  const nodesN = [
    { id: 'm-toc', kind: 'chapter', title: '목차', body: '' },
    { id: 'c1', kind: 'chapter', title: '1장 바람', body: longBody },
    { id: 'c2', kind: 'chapter', title: '2장 정원', body: longBody },
  ];
  const run = (o: object, nn = nodesN) => countPages(nn, { ...opts, multipleOf4: false, ...o }, fonts);
  it('따옴표 모양을 통일하고, 쌍이 안 맞으면 건드리지 않는다', () => {
    expect(convertQuotes('"안녕" 하고 “반가워” 했다.', 'corner')).toBe('「안녕」 하고 「반가워」 했다.');
    expect(convertQuotes('"안녕" 그리고 「반가워」', 'curly')).toBe('“안녕” 그리고 “반가워”');
    expect(convertQuotes('그가 말했다. "짝이 안 맞는', 'corner')).toBe('그가 말했다. "짝이 안 맞는');
    expect(convertQuotes('![설명](/api/bimg/a "10x10")', 'corner')).toBe('![설명](/api/bimg/a "10x10")');
    expect(convertQuotes('“그는 ‘응’ 했다”', 'corner')).toBe('「그는 『응』 했다」');
    expect(convertQuotes('"a"', 'keep')).toBe('"a"');
  });
  it('대사 문단만 들여쓰기를 끈다', () => {
    const nn = [{ id: 'c1', kind: 'chapter', title: '장', body: '평범한 문단입니다.\n\n“대사입니다.” 그가 말했다.\n\n또 평범한 문단.' }];
    const xs = (o: object) => {
      const r = layoutBook(toSections(nn, true), metricsOf(fonts), { ...opts, multipleOf4: false, ...o });
      const items = r.pages.find((p) => p.kind === 'chapter')!.items.filter((i) => i.k === 't') as { x: number; text: string }[];
      return ['평범한', '“대사입니다.”', '또'].map((t) => items.find((i) => i.text === t || i.text.startsWith(t))!.x);
    };
    const a = xs({});
    const b = xs({ dialogue: 'flush' });
    expect(a[1]).toBeGreaterThan(b[1]);
    expect(b[0]).toBe(a[0]);
    expect(b[2]).toBe(a[2]);
  });
  it('줄 간격 · 자간이 쪽수와 글 너비에 반영된다', () => {
    expect(run({ leading: 1.5 }).pages).toBeLessThanOrEqual(run({ leading: 1.95 }).pages);
    const ms0 = new Measure(metricsOf(fonts), 0);
    const ms1 = new Measure(metricsOf(fonts), 0.05);
    expect(ms1.text('가나다', false, 10)).toBeCloseTo(ms0.text('가나다', false, 10) + 1.5, 5);
  });
  it('쪽 번호 위치 · 모양 · 앞붙이 로마 숫자', () => {
    const folios = (o: object) => {
      const r = layoutBook(toSections(nodesN, true), metricsOf(fonts), { ...opts, multipleOf4: false, ...o });
      return r.pages.map((p) => ({ n: p.n, kind: p.kind, t: (p.items.filter((i) => i.k === 't' && i.y > r.geo.H - r.geo.bottom + 5) as { text: string; x: number }[])[0] }));
    };
    const plain = folios({});
    const chapterPage = plain.find((p) => p.kind === 'chapter')!;
    expect(chapterPage.t.text).toBe(String(chapterPage.n));
    expect(folios({ pageFmt: 'dash' }).find((p) => p.kind === 'chapter')!.t.text).toBe(`- ${chapterPage.n} -`);
    expect(folios({ pageNo: 'none' }).every((p) => !p.t)).toBe(true);
    const c = folios({ pageNo: 'center' }).find((p) => p.kind === 'chapter')!.t.x;
    expect(c).not.toBe(chapterPage.t.x);
    const rm = folios({ romanFront: true });
    expect(rm.find((p) => p.kind === 'toc')!.t.text).toMatch(/^[ivx]+$/);
    expect(rm.find((p) => p.kind === 'chapter')!.t.text).toBe('1');
    const toc = run({ romanFront: true }).toc;
    expect(toc[0].page).toBe(1);
  });
  it('장 끝에 몇 줄만 남은 쪽을 찾고, 줄 간격으로 풀리는지 제안한다', () => {
    // 한 쪽 가득 + 두 줄: 줄 간격을 줄이면 한 쪽으로 들어간다
    const geo = layoutBook(toSections([{ id: 'x', kind: 'chapter', title: '장', body: '가' }], true), metricsOf(fonts), { ...opts, multipleOf4: false }).geo;
    const per = Math.floor((geo.textH - geo.lead * 1.6 - geo.textH * 0.18) / geo.lead);
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}번째 줄입니다.`).join('\n');
    let found = false;
    for (let n = per + 1; n < per + 6 && !found; n++) {
      const nn = [{ id: 'c1', kind: 'chapter', title: '장', body: lines(n) }];
      const r = countPages(nn, { ...opts, multipleOf4: false }, fonts);
      if (r.issues.some((i) => i.type === 'short-end')) {
        found = true;
        expect(r.issues[0].value).toBeLessThanOrEqual(3);
        expect(r.suggestions.length).toBeGreaterThan(0);
        expect(r.suggestions[0].issues).toBeLessThan(r.issues.length);
      }
    }
    expect(found).toBe(true);
  });
  it('제목 글꼴을 따로 쓰면 PDF 에 글꼴이 둘 들어가고, 점검 보고서가 채워진다', async () => {
    const head = openFonts(new Uint8Array(readFileSync('public/fonts/NanumGothic-Regular.ttf')), new Uint8Array(readFileSync('public/fonts/NanumGothic-Bold.ttf')), await subsetterFrom(readFileSync('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm')), 'NanumGothic');
    const f = openFonts(fonts.regular, fonts.bold, head.subset, 'GowunBatang', head);
    const out = await buildPrintPdf(nodes2(), { ...opts, multipleOf4: false, bleed: true }, f, new Map([['/api/bimg/abc', { bytes: png(160, 90), mime: 'image/png', w: 1600, h: 900 }]]));
    const txt = Buffer.from(out.bytes).toString('latin1');
    expect(txt).toMatch(/NanumGothic-Bold/);
    expect(txt).toMatch(/GowunBatang-Regular/);
    expect(out.report.fonts.map((x) => x.role)).toEqual(['본문', '제목']);
    expect(out.report.pageMm[0]).toBeCloseTo(out.report.trimMm[0] + 6, 1);
    expect(out.report.pages).toBe(out.pages);
  }, 60_000);
  it('이미지 해상도(dpi)를 알린다', async () => {
    const nn = [{ id: 'c1', kind: 'chapter', title: '장', body: '글\n\n![그림](/api/bimg/abc "1600x900")\n\n글' }];
    const out = await buildPrintPdf(nn, { ...opts, multipleOf4: false }, fonts, new Map([['/api/bimg/abc', { bytes: png(160, 90), mime: 'image/png', w: 160, h: 90 }]]));
    expect(out.report.images).toHaveLength(1);
    expect(out.report.images[0].dpi).toBeGreaterThan(50);
  }, 30_000);
});

import { makeSpecSheet, specRows } from './spec';
import { DEFAULT_PRINT } from './settings';
describe('인쇄 사양서', () => {
  it('A4 한 장 PDF 로 판형 · 글꼴 · 사진 해상도를 적는다', async () => {
    const f = openFonts(fonts.regular, fonts.bold, await subsetterFrom(readFileSync('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm')), 'GowunBatang');
    const nn = [{ id: 'c1', kind: 'chapter', title: '장', body: '글\n\n![그림](/api/bimg/abc "160x90")\n\n글' }];
    const out = await buildPrintPdf(nn, { ...opts, bleed: true }, f, new Map([['/api/bimg/abc', { bytes: png(160, 90), mime: 'image/png', w: 160, h: 90 }]]));
    const info = { title: '시험 책', author: '시험', date: '2026-11-27', report: out.report, settings: { ...DEFAULT_PRINT, bleed: true } };
    const rows = specRows(info);
    expect(rows.find(([a]) => a === '완성(재단) 크기')![1]).toContain('152');
    expect(rows.find(([a]) => a === 'PDF 쪽 크기')![1]).toContain('도련');
    expect(rows.find(([a]) => a === '사진')![1]).toContain('dpi');
    const bytes = await makeSpecSheet(info, f);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeLessThan(200_000);
    if (process.env.TYPESET_OUT) writeFileSync(process.env.TYPESET_OUT.replace('.pdf', '-spec.pdf'), bytes);
  }, 30_000);
});

describe('목차 단계', () => {
  it('부가 없으면 장은 모두 같은 단, 부가 나오면 그 뒤 장은 한 단 들여 쓴다', () => {
    const lv = (nn: { id: string; kind: string; title: string; body: string }[]) => countPages(nn, { ...opts, multipleOf4: false }, fonts).toc.map((e) => e.level);
    const ch = (id: string) => ({ id, kind: 'chapter', title: id, body: '글' });
    expect(lv([{ id: 'm-toc', kind: 'chapter', title: '목차', body: '' }, ch('a'), ch('b'), ch('c')])).toEqual([0, 0, 0]);
    expect(lv([{ id: 'm-toc', kind: 'chapter', title: '목차', body: '' }, { id: 'p', kind: 'part', title: '1부', body: '' }, ch('a'), ch('b')])).toEqual([0, 1, 1]);
  });
});
