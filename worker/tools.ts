// 집필 · 읽기를 돕는 AI 도구들: 설정 충돌 검사 · 이름 뽑기 · 지난 이야기 · 퇴고 제안 · 막혔을 때 질문 · 대사 화자 가리기.
// 원칙: 원고와 주어진 자료에 있는 것만 근거로 한다. 글을 새로 써 주지 않는다 (퇴고 제안은 고칠 문장만, 질문은 질문만).
// 모델 답은 JSON 으로 받고, 원고에서 찾을 수 없는 인용은 쓰는 쪽에서 걸러 낸다.
import { clip } from './ai';

export type ToolName = 'conflicts' | 'names' | 'polish' | 'questions' | 'dialogue' | 'clues';
export const TOOLS: ToolName[] = ['conflicts', 'names', 'polish', 'questions', 'dialogue', 'clues'];

/** 가짜 답(개발용)을 고르는 표시: 시스템 지시에 들어 있다 */
export const MARK = {
  conflicts: '설정 충돌을 찾는 교정자',
  names: '새 이름을 찾는 편집자',
  recap: '지난 이야기를 정리하는 편집자',
  polish: '퇴고를 돕는 교정자',
  questions: '질문을 던지는 편집자',
  dialogue: '대사의 화자를 가리는 편집자',
  clues: '복선을 찾는 편집자',
} as const;

const BASE = '원고와 주어진 자료에 실제로 쓰인 것만 근거로 한다. 없는 사실을 지어내지 않는다. 확실하지 않으면 뺀다.';
const JSON_ONLY = '반드시 JSON 하나만 출력한다. 다른 글은 쓰지 않는다.';

/** 앞 장들: 가까운 장부터 담고, 순서는 앞에서 뒤로 */
export function previousDigest(units: { title: string; synopsis: string; body: string }[], max = 7000): string {
  const out: string[] = [];
  let used = 0;
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    const what = u.synopsis.trim() ? `줄거리: ${u.synopsis.trim()}` : `원고 앞부분: ${clip(u.body, 700).text.slice(0, 700)}`;
    const line = `[${i + 1}] ${u.title || '제목 없음'}\n${what}`;
    if (used + line.length > max) break;
    out.unshift(line);
    used += line.length + 2;
  }
  return out.join('\n\n');
}

export function conflictMessages(title: string, body: string, world: string, previous: string) {
  return [
    {
      role: 'system',
      content:
        `너는 소설 원고의 ${MARK.conflicts}다. ${BASE} 지금 장의 원고를 세계관 자료 · 앞 장 자료와 맞대어, 서로 어긋나는 사실만 찾는다: 눈 색 · 머리색 · 나이 · 키 같은 외모, 날짜 · 요일 · 계절 · 시간 순서, 이름 · 호칭, 관계, 장소의 생김새 · 거리, 앞에서 일어난 일과 맞지 않는 서술. ` +
        '문체 · 재미 · 개연성 평가는 하지 않는다. 자료가 말하지 않는 것은 어긋남이 아니다. 어긋남이 없으면 빈 목록을 낸다. ' +
        `${JSON_ONLY} 모양: {"issues": [{"quote": "지금 장 원고에서 그대로 옮긴 문장 일부 (한 글자도 바꾸지 않음)", "problem": "무엇이 무엇과 어긋나는지 한 문장", "source": "근거가 된 곳: 세계관 항목 이름 또는 [앞 장 번호]", "sourceQuote": "근거 자료에서 그대로 옮긴 말"}]}`,
    },
    {
      role: 'user',
      content: `세계관 자료:\n${world.trim() || '(없음)'}\n\n앞 장 자료:\n${previous.trim() || '(없음)'}\n\n지금 장: ${title || '(제목 없음)'}\n원고:\n${clip(body).text}`,
    },
  ];
}

export function namesMessages(body: string, known: string[]) {
  return [
    {
      role: 'system',
      content:
        `너는 소설 원고에서 ${MARK.names}다. ${BASE} 원고에 나오는 인물 · 장소 · 세력 · 사물 · 사건의 고유한 이름 가운데 「이미 있는 항목」에 없는 것만 찾는다. 일반 명사(엄마, 학교, 칼 같은 말)는 빼고, 이야기에서 이름으로 쓰인 것만 넣는다. ` +
        `요약은 원고에 드러난 것만 한 문장으로 쓴다. ${JSON_ONLY} 모양: {"names": [{"name": "원고에 쓰인 그대로의 이름", "kind": "character | place | faction | item | event | concept | species | other 가운데 하나", "summary": "원고에 드러난 것만 한 문장"}]}`,
    },
    { role: 'user', content: `이미 있는 항목: ${known.length ? known.slice(0, 300).join(', ') : '(없음)'}\n\n원고:\n${clip(body).text}` },
  ];
}

export function recapMessages(title: string, material: string) {
  return [
    {
      role: 'system',
      content:
        `너는 오랜만에 책을 다시 펴는 독자를 위해 ${MARK.recap}다. ${BASE} 주어진 글은 독자가 지금까지 읽은 데까지만이다. 그 안에 쓰인 일만, 일어난 순서대로, 한국어 평서문(-다)으로 정리한다. ` +
        '앞으로 일어날 일, 결말, 추측, 평가는 쓰지 않는다. 마지막 문단은 「바로 앞에서는」으로 시작해 독자가 멈춘 곳 바로 앞의 장면을 짚는다. 두세 문단, 600자 안팎. 제목 · 목록 기호 없이 문단만 쓴다.',
    },
    { role: 'user', content: `책: 《${title}》\n\n지금까지 읽은 글:\n${material}` },
  ];
}

export function polishMessages(text: string) {
  return [
    {
      role: 'system',
      content:
        `너는 소설 원고의 ${MARK.polish}다. 주어진 문단에서 리듬이 걸리는 문장, 가까이 되풀이한 말, 어색하거나 문법이 어긋난 문장만 골라 고친다. ` +
        '작가의 문체와 말투, 시제, 시점을 그대로 둔다. 뜻 · 사건 · 정보를 더하거나 빼지 않는다. 새 문장을 지어 넣지 않는다. 고칠 필요가 없는 문장은 내지 않는다. 한 문장을 두 문장으로 나누거나 두 문장을 합치는 것은 괜찮다. ' +
        `${JSON_ONLY} 모양: {"edits": [{"before": "원문에서 그대로 옮긴 문장 (한 글자도 바꾸지 않음)", "after": "고친 문장", "why": "리듬 · 반복 · 어색함 · 문법 가운데 무엇 때문인지 짧게"}]}`,
    },
    { role: 'user', content: `문단:\n${text.slice(0, 4000)}` },
  ];
}

export function questionMessages(title: string, synopsis: string, previous: string, body: string) {
  const t = clip(body, 6000).text;
  return [
    {
      role: 'system',
      content:
        `너는 글이 막힌 작가에게 ${MARK.questions}다. ${BASE} 원고를 대신 쓰지 않는다: 문장, 대사, 장면 묘사, 다음 줄거리를 제안하지 않는다. ` +
        '대신 작가가 스스로 답을 찾게 돕는 짧은 질문 5개를 한국어로 던진다. 예: 「이 인물은 여기서 무엇을 원하지?」 「이 장면이 끝날 때 무엇이 달라져야 하지?」. 질문마다 원고 · 자료에 나온 인물 이름이나 사건을 짚어 구체적으로 묻는다. ' +
        `${JSON_ONLY} 모양: {"questions": [{"q": "질문", "about": "질문이 짚는 인물 · 사건 (원고에 나온 말)"}]}`,
    },
    {
      role: 'user',
      content: `앞 장 자료:\n${previous.trim() || '(없음)'}\n\n지금 장: ${title || '(제목 없음)'}\n${synopsis.trim() ? `작가가 적어 둔 줄거리: ${synopsis.trim()}\n` : ''}\n지금까지 쓴 원고 (뒤쪽이 막힌 곳):\n${t || '(아직 비어 있음)'}`,
    },
  ];
}

// ---------------------------------------------------------------- 복선
export function clueMessages(title: string, body: string, known: string[], previous: string) {
  return [
    {
      role: 'system',
      content:
        `너는 소설 원고에서 ${MARK.clues}다. ${BASE} 지금 장에서 (1) 뒤에서 다시 쓰일 것처럼 일부러 깔아 둔 물건 · 말 · 행동 · 수수께끼(복선)와, (2) 앞에서 깔린 복선을 거두는 대목을 찾는다. ` +
        '「이미 표시한 복선」 목록에 있는 것을 거두면 그 이름을 그대로 쓴다. 분명하지 않은 것은 넣지 않는다. 많아야 각각 6개. ' +
        `${JSON_ONLY} 모양: {"plants": [{"name": "복선을 부를 짧은 이름 (예: 은열쇠)", "quote": "원고에서 그대로 옮긴 문장 일부 (한 글자도 바꾸지 않음)", "why": "왜 복선으로 보이는지 한 문장"}], "payoffs": [{"name": "거둔 복선 이름", "quote": "원고에서 그대로 옮긴 문장 일부", "why": "무엇을 거두는지 한 문장"}]}`,
    },
    { role: 'user', content: `이미 표시한 복선: ${known.length ? known.slice(0, 100).join(', ') : '(없음)'}\n\n앞 장 자료:\n${previous.trim() || '(없음)'}\n\n지금 장: ${title || '(제목 없음)'}\n원고:\n${clip(body).text}` },
  ];
}
export interface ClueHint {
  name: string;
  quote: string;
  why: string;
}
export function parseClues(o: Record<string, unknown>): { plants: ClueHint[]; payoffs: ClueHint[] } {
  const one = (v: unknown) =>
    arr(v)
      .map((x) => ({ name: s(x.name, 30), quote: s(x.quote, 300), why: s(x.why, 200) }))
      .filter((x) => x.name && x.quote)
      .slice(0, 8);
  return { plants: one(o.plants), payoffs: one(o.payoffs) };
}

// ---------------------------------------------------------------- 대사
export interface Line {
  id: number;
  at: number;
  text: string;
}
const QUOTE = /“([^”\n]{1,600})”|"([^"\n]{1,600})"|「([^」\n]{1,600})」/g;

/** 원고에서 대사(“…” · "…" · 「…」)를 찾는다. 주석(%% %%) 안은 뺀다. at 은 원고 안 위치 (따옴표 다음 글자) */
export function findDialogue(body: string, max = 400): Line[] {
  const skip: [number, number][] = [];
  for (const m of body.matchAll(/%%[\s\S]*?%%/g)) skip.push([m.index!, m.index! + m[0].length]);
  const out: Line[] = [];
  for (const m of body.matchAll(QUOTE)) {
    const at = m.index! + 1;
    if (skip.some(([a, b]) => at >= a && at < b)) continue;
    const text = (m[1] ?? m[2] ?? m[3]).trim();
    if (!text) continue;
    out.push({ id: out.length + 1, at, text });
    if (out.length >= max) break;
  }
  return out;
}

/** 대사 앞에 ⟦번호⟧ 를 붙인 원고 (모델이 번호로 답하게) */
export function markDialogue(body: string, lines: Line[]): string {
  let s = '';
  let last = 0;
  for (const l of lines) {
    s += body.slice(last, l.at - 1) + `⟦${l.id}⟧`;
    last = l.at - 1;
  }
  return s + body.slice(last);
}

export function dialogueMessages(marked: string, people: string[]) {
  return [
    {
      role: 'system',
      content:
        `너는 소설 원고에서 ${MARK.dialogue}다. ${BASE} 원고의 대사 앞에는 ⟦번호⟧ 가 붙어 있다. 대사마다 앞뒤 서술(「~가 말했다」, 부르는 이름, 주고받는 차례)을 근거로 누가 말했는지 가린다. ` +
        `근거가 약하면 이름 대신 "?" 를 쓴다. 이름은 원고나 인물 목록에 나온 그대로 쓴다. ${JSON_ONLY} 모양: {"speakers": {"1": "이름", "2": "?"}}`,
    },
    { role: 'user', content: `인물 목록: ${people.length ? people.slice(0, 80).join(', ') : '(없음)'}\n\n원고:\n${clip(marked, 12000).text}` },
  ];
}

// ---------------------------------------------------------------- 답 읽기
const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

export function readJson(raw: string): Record<string, unknown> | null {
  const t = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = t.indexOf('{');
  const z = t.lastIndexOf('}');
  if (a < 0 || z <= a) return null;
  try {
    const o = JSON.parse(t.slice(a, z + 1));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

export interface Issue {
  quote: string;
  problem: string;
  source: string;
  sourceQuote: string;
}
export function parseIssues(o: Record<string, unknown>): Issue[] {
  return arr(o.issues)
    .map((x) => ({ quote: s(x.quote, 300), problem: s(x.problem, 300), source: s(x.source, 80), sourceQuote: s(x.sourceQuote, 300) }))
    .filter((x) => x.problem)
    .slice(0, 20);
}

const KINDS = ['character', 'place', 'faction', 'item', 'event', 'concept', 'species', 'other'];
export interface NameHint {
  name: string;
  kind: string;
  summary: string;
}
export function parseNames(o: Record<string, unknown>): NameHint[] {
  const seen = new Set<string>();
  return arr(o.names)
    .map((x) => ({ name: s(x.name, 40), kind: KINDS.includes(s(x.kind, 20)) ? s(x.kind, 20) : 'other', summary: s(x.summary, 200) }))
    .filter((x) => x.name && !seen.has(x.name) && (seen.add(x.name), true))
    .slice(0, 30);
}

export interface Edit {
  before: string;
  after: string;
  why: string;
}
export function parseEdits(o: Record<string, unknown>): Edit[] {
  return arr(o.edits)
    .map((x) => ({ before: typeof x.before === 'string' ? x.before.trim().slice(0, 1000) : '', after: typeof x.after === 'string' ? x.after.trim().slice(0, 1200) : '', why: s(x.why, 120) }))
    .filter((x) => x.before && x.after && x.before !== x.after)
    .slice(0, 30);
}

export function parseQuestions(o: Record<string, unknown>): { q: string; about: string }[] {
  const raw = Array.isArray(o.questions) ? o.questions : [];
  return raw
    .map((x) => (typeof x === 'string' ? { q: s(x, 200), about: '' } : x && typeof x === 'object' ? { q: s((x as Record<string, unknown>).q, 200), about: s((x as Record<string, unknown>).about, 60) } : { q: '', about: '' }))
    .filter((x) => x.q)
    .slice(0, 8);
}

export function parseSpeakers(o: Record<string, unknown>, lines: Line[]): (Line & { speaker: string })[] {
  const sp = o.speakers && typeof o.speakers === 'object' && !Array.isArray(o.speakers) ? (o.speakers as Record<string, unknown>) : {};
  return lines.map((l) => {
    const v = s(sp[String(l.id)], 40);
    return { ...l, speaker: v && v !== '?' && v !== '모름' ? v : '' };
  });
}

/** 지난 이야기 다듬기 */
export function cleanRecap(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^\s*#+\s.*\n+/, '')
    .replace(/^\s*(지난 이야기|요약)\s*[:：]\s*/, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\s*([-*•·]|\d+[.)])\s+/gm, '').replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2000);
}

/** 개발용 가짜 답 (FAKE_AI=1) */
export function fakeTool(sys: string, user: string): string | null {
  if (sys.includes(MARK.conflicts)) {
    const q = user.split('원고:\n')[1]?.split(/[.!?。\n]/).find((x) => x.trim().length > 4)?.trim() ?? '';
    return JSON.stringify({ issues: q ? [{ quote: q.slice(0, 30), problem: '가짜 검사: 세계관에는 눈이 회색이라고 되어 있는데 여기서는 갈색이라고 한다.', source: '홍설', sourceQuote: '눈: 회색' }] : [] });
  }
  if (sys.includes(MARK.names)) {
    const w = user.split('원고:\n')[1]?.match(/[가-힣]{2,4}(?=[은는이가을를의에])/)?.[0] ?? '';
    return JSON.stringify({ names: w ? [{ name: w, kind: 'character', summary: '가짜 요약: 원고에 나온 이름.' }] : [] });
  }
  if (sys.includes(MARK.recap)) return '가짜 지난 이야기: 지금까지 읽은 곳에서 일이 일어났다.\n\n바로 앞에서는 인물이 문을 열었다.';
  if (sys.includes(MARK.polish)) {
    const first = user.replace(/^문단:\n/, '').split(/(?<=[.!?。])\s+/)[0]?.trim() ?? '';
    return JSON.stringify({ edits: first ? [{ before: first, after: first.replace(/\s+/g, ' ') + ' (가짜 퇴고)', why: '가짜: 리듬' }] : [] });
  }
  if (sys.includes(MARK.clues)) {
    const q = user.split('원고:\n')[1]?.split(/[.!?\n]/).find((x) => x.trim().length > 4)?.trim() ?? '';
    return JSON.stringify({ plants: q ? [{ name: '가짜 복선', quote: q.slice(0, 20), why: '가짜: 뒤에서 다시 나올 것 같다.' }] : [], payoffs: [] });
  }
  if (sys.includes(MARK.questions)) return JSON.stringify({ questions: [{ q: '이 인물은 여기서 무엇을 원하지?', about: '주인공' }, { q: '이 장면이 끝날 때 무엇이 달라져야 하지?', about: '' }] });
  if (sys.includes(MARK.dialogue)) {
    const ids = [...user.matchAll(/⟦(\d+)⟧/g)].map((m) => m[1]);
    return JSON.stringify({ speakers: Object.fromEntries(ids.map((id, i) => [id, i % 3 === 2 ? '?' : i % 2 ? '민우' : '홍설'])) });
  }
  return null;
}
