// 인쇄 사양서: 만든 PDF 와 함께 인쇄소에 보낼 수 있는 A4 한 장 (판형 · 쪽수 · 글꼴 · 여백 · 사진 해상도 · 점검 결과)
import { PDFDocument, grayscale } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Fonts } from './index';
import type { PrintReport } from './index';
import { SIZES } from './layout';
import { FACES, type PrintSettings } from './settings';

export interface SpecInfo {
  title: string;
  author: string;
  date: string;
  report: PrintReport;
  settings: PrintSettings;
}

/** 사양서에 적을 줄들 (이름 · 값). 화면에서도 같은 내용을 보여 준다 */
export function specRows(i: SpecInfo): [string, string][] {
  const r = i.report;
  const s = i.settings;
  const face = (id: string) => (id in FACES ? FACES[id as keyof typeof FACES].name : id);
  const low = r.images.filter((m) => m.dpi < 150);
  const rows: [string, string][] = [
    ['책', `${i.title || '제목 없음'}${i.author ? ` · ${i.author}` : ''}`],
    ['만든 날', i.date],
    ['완성(재단) 크기', `${r.trimMm[0]} × ${r.trimMm[1]} mm (${SIZES[s.size].label.split(' (')[0]})`],
    ['PDF 쪽 크기', r.bleed ? `${r.pageMm[0]} × ${r.pageMm[1]} mm — 사방 3mm 도련 포함, TrimBox · BleedBox 지정` : `${r.pageMm[0]} × ${r.pageMm[1]} mm — 도련 없음(재단 크기와 같음)`],
    ['전체 쪽수', `${r.pages}쪽${r.pages % 4 === 0 ? ' (4의 배수)' : ''}`],
    ['본문 글꼴', `${face(s.face)} — 오픈 라이선스(SIL OFL), 쓴 글자만 PDF 안에 포함`],
    ...(s.headFace !== 'same' ? [['제목 글꼴', `${face(s.headFace)} — 오픈 라이선스(SIL OFL), 쓴 글자만 PDF 안에 포함`] as [string, string]] : []),
    ['글자 크기 · 줄 간격', `본문 ${r.bodyPt}pt · 줄 간격 ${r.leadPt}pt (${Math.round((r.leadPt / r.bodyPt) * 100)}%)${s.tracking ? ` · 자간 ${s.tracking > 0 ? '+' : ''}${s.tracking}em` : ''}`],
    ['여백', `위 ${r.marginsMm.top} · 아래 ${r.marginsMm.bottom} · 안쪽 ${r.marginsMm.inner} · 바깥 ${r.marginsMm.outer} mm (홀수 · 짝수 쪽 좌우 대칭)`],
    ['장 시작', s.rightStart ? '오른쪽(홀수) 쪽에서 시작' : '바로 다음 쪽에서 시작'],
    ['쪽 번호', s.pageNo === 'none' ? '넣지 않음' : `${s.pageNo === 'center' ? '아래 가운데' : '바깥쪽 아래'} · ${s.pageFmt === 'dash' ? '- 12 -' : s.pageFmt === 'dot' ? '· 12 ·' : '12'} 모양${s.romanFront ? ' · 앞붙이는 로마 숫자' : ''}`],
    ['색', '본문 흑백(회색조 검정) · 사진은 올린 그대로(RGB)'],
    ['사진', r.images.length ? `${r.images.length}장 · 가장 낮은 해상도 ${Math.min(...r.images.map((m) => m.dpi))}dpi${low.length ? ` (150dpi 아래 ${low.length}장 — 흐리게 찍힐 수 있어요)` : ''}` : '없음'],
    ['글꼴에 없는 글자', r.missing.length ? `${r.missing.join(' ')} — □ 로 바뀜` : '없음'],
    ['인쇄 전 점검', r.issues.length ? `${r.issues.length}곳 — ${r.issues.slice(0, 6).map((m) => `${m.page}쪽(${m.type === 'short-end' ? `장 끝 ${m.value}줄` : `${m.value}%만 참`})`).join(', ')}${r.issues.length > 6 ? ' …' : ''}` : '걸린 곳 없음'],
    ['따로 준비할 것', '표지(책등 두께는 종이 · 쪽수에 따라 인쇄소가 알려 줘요). 도련 · 색 방식 등은 인쇄소마다 달라 보내기 전에 그곳 안내를 확인하세요.'],
  ];
  return rows;
}

export async function makeSpecSheet(i: SpecInfo, fonts: Fonts): Promise<Uint8Array> {
  const rows = specRows(i);
  const heading = '인쇄 사양서';
  const text = heading + rows.map(([a, b]) => a + b).join('') + ' ';
  const has = (c: string) => c === ' ' || fonts.fkRegular.hasGlyphForCodePoint(c.codePointAt(0)!);
  const clean = (t: string) => [...t].map((c) => (has(c) ? c : '□')).join('');
  const W = 595.28;
  const H = 841.89;
  const m = 56;
  const labelW = 110;
  const size = 9.5;
  const lead = size * 1.6;
  const adv = (t: string, bold: boolean, sz: number) => {
    const fk = bold ? fonts.fkBold : fonts.fkRegular;
    let w = 0;
    for (const c of t) w += (fk.glyphForCodePoint(c.codePointAt(0)!)?.advanceWidth ?? fk.unitsPerEm * 0.5) / fk.unitsPerEm;
    return w * sz;
  };
  const wrap = (t: string, width: number) => {
    const out: string[] = [];
    let cur = '';
    for (const c of clean(t)) {
      if (adv(cur + c, false, size) > width && cur) {
        out.push(cur);
        cur = c === ' ' ? '' : c;
      } else cur += c;
    }
    if (cur) out.push(cur);
    return out;
  };
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const cut = (b: Uint8Array) => {
    if (!fonts.subset) return b;
    try {
      return fonts.subset(b, { text: clean(text) });
    } catch {
      return b;
    }
  };
  const reg = await doc.embedFont(cut(fonts.regular), { subset: false });
  const bold = await doc.embedFont(cut(fonts.bold), { subset: false });
  const page = doc.addPage([W, H]);
  const ink = grayscale(0);
  let y = H - m - 18;
  page.drawText(heading, { x: m, y, size: 18, font: bold, color: ink });
  y -= 14;
  page.drawLine({ start: { x: m, y }, end: { x: W - m, y }, thickness: 0.6, color: ink });
  y -= 22;
  for (const [a, b] of rows) {
    const lines = wrap(b, W - 2 * m - labelW);
    page.drawText(clean(a), { x: m, y, size, font: bold, color: ink });
    for (const l of lines) {
      page.drawText(l, { x: m + labelW, y, size, font: reg, color: ink });
      y -= lead;
    }
    y -= lead * 0.45;
    page.drawLine({ start: { x: m, y: y + lead * 0.55 }, end: { x: W - m, y: y + lead * 0.55 }, thickness: 0.25, color: grayscale(0.7) });
  }
  doc.setTitle(`${i.title} 인쇄 사양서`);
  doc.setLanguage('ko-KR');
  doc.setProducer('서재 (pdf-lib)');
  return doc.save({ useObjectStreams: false });
}
