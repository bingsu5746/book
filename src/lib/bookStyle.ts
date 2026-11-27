// 책 서식(인쇄용 PDF 설정 중 장 시작 · 대사 · 따옴표 · 글꼴): 리더 · 전자책이 인쇄용 PDF 와 같은 모양으로 보이게 하는 데 쓴다.
// 이 파일은 가볍게 유지한다(pdf-lib 등을 끌어오지 않음) — 인쇄 조판(typeset)도 여기 있는 함수를 그대로 쓴다.
import { printSettingsOf, type FaceId, type PrintSettings } from './typeset/settings';

export interface BookStyle {
  face: FaceId;
  headFace: FaceId | 'same';
  chapterAlign: PrintSettings['chapterAlign'];
  chapterDrop: PrintSettings['chapterDrop'];
  chapterNumber: PrintSettings['chapterNumber'];
  firstIndent: boolean;
  dialogue: PrintSettings['dialogue'];
  quotes: PrintSettings['quotes'];
  tracking: number;
}

/** 책 meta 에 인쇄 설정이 있으면 그 서식을, 없으면 undefined (기존 모양 그대로) */
export function bookStyleOf(meta: unknown): BookStyle | undefined {
  const m = meta as { print?: unknown } | null | undefined;
  if (!m?.print || typeof m.print !== 'object') return undefined;
  const p = printSettingsOf(m as Record<string, unknown>);
  return { face: p.face, headFace: p.headFace, chapterAlign: p.chapterAlign, chapterDrop: p.chapterDrop, chapterNumber: p.chapterNumber, firstIndent: p.firstIndent, dialogue: p.dialogue, quotes: p.quotes, tracking: p.tracking };
}

/** 「1장 바람」 · 「제1장 바람」 · 「3. 바람」 에서 번호와 이름을 가른다 (그런 모양이 아니면 null) */
export function splitChapterTitle(t: string): { n: number; unit: string; name: string } | null {
  const a = t.match(/^\s*(?:제\s*)?(\d{1,3})\s*(장|화)\s*[.:·\-–—]?\s*(.*)$/);
  if (a) return { n: Number(a[1]), unit: a[2], name: a[3].trim() };
  const b = t.match(/^\s*(\d{1,3})\s*[.)]\s+(.*)$/);
  if (b) return { n: Number(b[1]), unit: '장', name: b[2].trim() };
  return null;
}

/** 장 제목을 서식대로 나눈다: num 은 윗줄에 작게 쓸 번호(없으면 한 줄) */
export function chapterHeading(title: string, mode: BookStyle['chapterNumber'] | undefined): { num?: string; name: string } {
  const sp = mode && mode !== 'asis' ? splitChapterTitle(title) : null;
  if (!sp) return { name: title };
  return { num: mode === 'je' ? `제${sp.n}${sp.unit}` : String(sp.n), name: sp.name };
}

/** 따옴표 모양을 한 가지로 통일: curly = “ ” ‘ ’, corner = 「 」 『 』. 쌍이 맞지 않는 곳(어포스트로피 등)은 건드리지 않는다. 글자 수는 그대로다 */
export function convertQuotes(md: string, style: 'keep' | 'curly' | 'corner' | undefined): string {
  if (!style || style === 'keep') return md;
  const [o1, c1, o2, c2] = style === 'corner' ? ['「', '」', '『', '』'] : ['“', '”', '‘', '’'];
  return md
    .split(/(\n\s*\n)/)
    .map((para) => {
      if (/^\s*$/.test(para) || /(^|\n)\s*!\[/.test(para) || para.includes('](')) return para;
      let t = para.replace(/[“「]/g, o1).replace(/[”」]/g, c1).replace(/[『]/g, o2).replace(/[』]/g, c2);
      // 곧은 큰따옴표: 짝수 개일 때만 열고 닫기를 번갈아
      if ((t.match(/"/g) ?? []).length % 2 === 0) {
        let open = true;
        t = t.replace(/"/g, () => ((open = !open), open ? c1 : o1));
      }
      // 굽은 작은따옴표 ‘ ’ → 『 』 (열고 닫는 수가 같을 때만)
      if (style === 'corner' && (t.match(/‘/g) ?? []).length === (t.match(/’/g) ?? []).length) t = t.replace(/‘/g, o2).replace(/’/g, c2);
      return t;
    })
    .join('');
}
