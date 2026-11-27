// 주석(각주): 원고에 「낱말[^1]」처럼 표시하고, 아무 줄에나 「[^1]: 설명」을 적는다 (마크다운 각주 문법).
// 리더 · 내보내기에서는 낱말 옆에 * 를 달고, 설명은 장 끝(리더 · 전자책 · 글) 또는 그 쪽 아래(인쇄용 PDF)에 붙인다.

export type NoteStyle = 'star' | 'number';
const DEF = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm;
export const NOTE_REF = /\[\^([^\]\s]+)\](?!:)/g;

/** 원고에서 주석 설명 줄을 떼어 낸다. 설명이 있는 표시만 주석으로 본다 */
export function extractNotes(md: string): { body: string; notes: Map<string, string> } {
  const notes = new Map<string, string>();
  const body = md.replace(DEF, (_, id: string, text: string) => {
    notes.set(id, text.trim());
    return '';
  });
  return { body: body.replace(/\n{3,}/g, '\n\n'), notes };
}

/** n 번째(1부터) 주석 표시: 별표는 *, **, ***, 그다음부터 *4 */
export function noteLabel(n: number, style: NoteStyle = 'star'): string {
  if (style === 'number') return String(n);
  return n <= 3 ? '*'.repeat(n) : `*${n}`;
}

/** 다음에 쓸 주석 번호 (이 장에서 쓰인 숫자 다음) */
export function nextNoteId(md: string): string {
  let max = 0;
  for (const m of md.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, Number(m[1]));
  return String(max + 1);
}

/** 글(txt · docx)용: 표시를 * 로 바꾸고 설명을 끝에 붙인 글 */
export function notesToPlain(md: string, style: NoteStyle = 'star'): string {
  const { body, notes } = extractNotes(md);
  const used: string[] = [];
  const out = body.replace(NOTE_REF, (m, id: string) => {
    if (!notes.has(id)) return m;
    let i = used.indexOf(id);
    if (i < 0) i = used.push(id) - 1;
    return noteLabel(i + 1, style);
  });
  if (!used.length) return out;
  return `${out.trimEnd()}\n\n${used.map((id, i) => `${noteLabel(i + 1, style)} ${notes.get(id)}`).join('\n\n')}\n`;
}
