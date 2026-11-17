// AI 말투 흔적 찾기 (AI 를 부르지 않는 규칙): 다른 곳에서 AI 와 쓰다 옮겨 온 글에 남은 대화체 · 마크다운 기호 · 곧은 따옴표 같은 것.
// 찾기만 하고, 기호처럼 기계적으로 고칠 수 있는 것만 「고치기」를 준다. 문장은 작가가 고친다.

export type TraceKind = 'chat' | 'md' | 'quote' | 'emoji' | 'english' | 'bracket' | 'dash';
export const TRACE_LABEL: Record<TraceKind, string> = {
  chat: 'AI 대화체',
  md: '마크다운 기호',
  quote: '곧은 따옴표 "',
  emoji: '이모지',
  english: '영어 문장',
  bracket: '[ ] 안내 글',
  dash: '긴 줄표 —',
};
export const TRACE_HINT: Record<TraceKind, string> = {
  chat: 'AI 가 대화할 때 쓰는 말이 원고에 남았을 수 있어요.',
  md: '굵게(**) · 목록(-, 1.) · 제목(#) 기호가 글자로 남았을 수 있어요.',
  quote: '원고의 다른 대사는 둥근 따옴표(“ ”)인데 곧은 따옴표가 섞였어요.',
  emoji: '소설 원고에는 드문 글자예요.',
  english: 'AI 의 영어 답이 섞였을 수 있어요.',
  bracket: '[장면 전환] 같은 안내 글이 남았을 수 있어요. [[링크]]는 빼고 찾아요.',
  dash: 'AI 글에 자주 나오는 줄표예요. 한국어 원고라면 쉼표나 말줄임으로 바꿀 수도 있어요.',
};

export interface Trace {
  kind: TraceKind;
  at: number;
  len: number;
  text: string;
  /** 기계적으로 고칠 수 있으면 바꿀 글 */
  fix?: string;
}

const CHAT =
  /물론(이죠|입니다|이에요)|좋은 질문|도움이 되(었|셨|었으|셨으)?(으면|길|기를)|궁금한 (점|것)이 있(으면|으시면)|원하시면|말씀하신|요청하신|다음은 [^.\n]{0,24}(입니다|이에요|예요)|아래(는|와 같이|처럼) [^.\n]{0,20}(입니다|이에요|정리)|요약하(면|자면)|결론적으로|(써|작성해|만들어|바꿔|고쳐) ?드릴(게요|까요)|(수정|개선|다듬은|고친) (버전|초안)|초안입니다|버전 ?[0-9A-Z]\b|[A-Z]안:|이 (장면|이야기|글|문단)(에서는|은|는) [^.\n]{0,20}(보여 줍니다|드러냅니다|표현합니다|강조합니다)/g;
const EMOJI = /\p{Extended_Pictographic}/gu;
const ENGLISH = /[A-Za-z][A-Za-z']{2,}(?:[ ,]+[A-Za-z][A-Za-z']*){3,}[.!?]?/g;
const BRACKET = /(?<!\[)\[[^[\]\n]{1,30}\](?!\])(?!\()/g;

/** 메모(%% %%) · 링크([[ ]]) 자리는 건너뛴다 */
function skipped(body: string): (i: number) => boolean {
  const r: [number, number][] = [];
  for (const m of body.matchAll(/%%[\s\S]*?%%|\[\[[^\]\n]*\]\]/g)) r.push([m.index!, m.index! + m[0].length]);
  return (i) => r.some(([a, b]) => i >= a && i < b);
}

export function findTraces(body: string): Trace[] {
  const skip = skipped(body);
  const out: Trace[] = [];
  const add = (t: Trace) => !skip(t.at) && out.push(t);
  for (const m of body.matchAll(CHAT)) add({ kind: 'chat', at: m.index!, len: m[0].length, text: m[0] });
  for (const m of body.matchAll(EMOJI)) add({ kind: 'emoji', at: m.index!, len: m[0].length, text: m[0], fix: '' });
  for (const m of body.matchAll(ENGLISH)) add({ kind: 'english', at: m.index!, len: m[0].length, text: m[0] });
  for (const m of body.matchAll(BRACKET)) add({ kind: 'bracket', at: m.index!, len: m[0].length, text: m[0] });
  for (const m of body.matchAll(/—/g)) add({ kind: 'dash', at: m.index!, len: 1, text: '—' });
  // 마크다운: 굵게 · 밑줄 굵게 · 코드, 줄 머리의 목록 · 제목 기호
  for (const m of body.matchAll(/\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`/g)) add({ kind: 'md', at: m.index!, len: m[0].length, text: m[0], fix: m[1] ?? m[2] ?? m[3] });
  for (const m of body.matchAll(/^([ \t]*(?:[-*•]|\d+[.)])[ \t]+)(?=\S)/gm)) {
    // 장면 나눔(* * *)은 빼고
    const line = body.slice(m.index!, body.indexOf('\n', m.index!) < 0 ? undefined : body.indexOf('\n', m.index!));
    if (/^\s*([*\-_]\s*){3,}$/.test(line)) continue;
    add({ kind: 'md', at: m.index!, len: m[1].length, text: m[1].trim(), fix: '' });
  }
  for (const m of body.matchAll(/^#{1,6}[ \t]+/gm)) add({ kind: 'md', at: m.index!, len: m[0].length, text: m[0].trim(), fix: '' });
  // 곧은 따옴표: 문단마다 여는 · 닫는 차례로 “ ” 를 준다
  let open = true;
  for (const m of body.matchAll(/"|\n\s*\n/g)) {
    if (m[0] !== '"') {
      open = true;
      continue;
    }
    const p = m.index!;
    if (skip(p)) continue;
    out.push({ kind: 'quote', at: p, len: 1, text: '"', fix: open ? '“' : '”' });
    open = !open;
  }
  return out.sort((a, b) => a.at - b.at);
}

/** 고칠 수 있는 흔적을 한 번에 고친 글 (뒤에서부터 바꿔 자리가 밀리지 않게) */
export function applyFixes(body: string, traces: Trace[]): string {
  let s = body;
  for (const t of [...traces].filter((t) => t.fix !== undefined).sort((a, b) => b.at - a.at)) s = s.slice(0, t.at) + t.fix + s.slice(t.at + t.len);
  return s;
}
