// 아이디어 → 간단한 줄거리 · 인물 · 세계 · 장 구성 초안. 작가가 던진 아이디어를 뼈대로 삼고, 비어 있는 곳만 채운다.
// 결과는 초안일 뿐이다: 화면에서 작가가 고르고 고쳐서 책으로 만든다.
import { clip } from './ai';

export const OUTLINE_MARK = '이야기의 뼈대를 짜는 편집자';

export interface Outline {
  title: string;
  logline: string;
  synopsis: string;
  acts: { name: string; summary: string }[];
  characters: { name: string; role: string; want: string; secret: string }[];
  world: { name: string; kind: string; note: string }[];
  chapters: { title: string; summary: string }[];
  questions: string[];
}

export function outlineMessages(idea: string, opts: { tone: string; chapters: number; feedback: string; prev: string }) {
  const { text } = clip(idea, 3000);
  return [
    {
      role: 'system',
      content:
        `너는 소설 작가를 돕는 ${OUTLINE_MARK}다. 작가가 적은 대략의 아이디어를 바탕으로 간단한 초안을 짠다. ` +
        '작가가 아이디어에 적은 이름 · 규칙 · 사건 · 분위기는 그대로 살리고 바꾸지 않는다. 아이디어에 없는 부분만 자연스럽게 채우되, 흔한 설정을 그대로 끌어오기보다 이 아이디어만의 결을 살린다. ' +
        '줄거리는 사건이 원인과 결과로 이어지게 쓰고, 「운명」 · 「각성」 같은 막연한 말로 때우지 않는다. 인물마다 원하는 것과 그것을 가로막는 것이 달라야 한다. ' +
        `장 구성은 ${opts.chapters}개 안팎으로, 장마다 그 장에서 실제로 일어나는 일을 한 문장으로 쓴다. 문장은 한국어 평서문(-다). ` +
        `작가가 더 정해야 할 것은 questions 에 질문(3~5개)으로 남긴다. ${'반드시 JSON 하나만 출력한다. 다른 글은 쓰지 않는다.'} ` +
        '모양: {"title": "가제", "logline": "한 문장 줄거리", "synopsis": "4~6문장 줄거리, 결말까지", "acts": [{"name": "시작", "summary": "…"}, {"name": "전개", "summary": "…"}, {"name": "위기", "summary": "…"}, {"name": "끝", "summary": "…"}], ' +
        '"characters": [{"name": "이름", "role": "이야기 속 자리", "want": "원하는 것", "secret": "숨기거나 두려운 것"}], ' +
        '"world": [{"name": "이름", "kind": "place | faction | item | concept | event | species 가운데 하나", "note": "한두 문장"}], ' +
        '"chapters": [{"title": "장 제목", "summary": "그 장에서 일어나는 일 한 문장"}], "questions": ["작가가 더 정해야 할 것을 묻는 질문"]}',
    },
    {
      role: 'user',
      content:
        `아이디어:\n${text}` +
        (opts.tone ? `\n\n분위기 · 장르: ${opts.tone}` : '') +
        (opts.prev ? `\n\n지난 초안의 줄거리:\n${opts.prev}` : '') +
        (opts.feedback ? `\n\n작가의 요청(이번 초안에 반영): ${opts.feedback}` : ''),
    },
  ];
}

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const KINDS = ['place', 'faction', 'item', 'concept', 'event', 'species'];

export function parseOutline(o: Record<string, unknown>): Outline | null {
  const out: Outline = {
    title: s(o.title, 60),
    logline: s(o.logline, 300),
    synopsis: s(o.synopsis, 1500),
    acts: arr(o.acts).map((x) => ({ name: s(x.name, 20), summary: s(x.summary, 500) })).filter((x) => x.summary).slice(0, 6),
    characters: arr(o.characters).map((x) => ({ name: s(x.name, 30), role: s(x.role, 80), want: s(x.want, 160), secret: s(x.secret, 160) })).filter((x) => x.name).slice(0, 10),
    world: arr(o.world).map((x) => ({ name: s(x.name, 30), kind: KINDS.includes(s(x.kind, 12)) ? s(x.kind, 12) : 'concept', note: s(x.note, 240) })).filter((x) => x.name).slice(0, 12),
    chapters: arr(o.chapters).map((x) => ({ title: s(x.title, 60), summary: s(x.summary, 300) })).filter((x) => x.title || x.summary).slice(0, 30),
    questions: (Array.isArray(o.questions) ? o.questions : []).map((x) => s(x, 200)).filter(Boolean).slice(0, 6),
  };
  // 줄거리가 비면 쓸 수 없는 답
  return out.synopsis || out.logline ? out : null;
}

export function fakeOutline(sys: string): string | null {
  if (!sys.includes(OUTLINE_MARK)) return null;
  return JSON.stringify({
    title: '가짜 가제',
    logline: '가짜 한 줄: 소금 사원을 지키던 사제가 쫓겨나 비밀 의식을 이어 간다.',
    synopsis: '가짜 줄거리: 사원이 창고가 되자 사제들이 쫓겨난다. 사제는 변두리에서 의식을 이어 가다 발각된다. 의식의 진짜 목적이 드러나며 마을이 갈라진다. 사제는 마지막 선택을 한다.',
    acts: [{ name: '시작', summary: '사원이 창고가 된다.' }, { name: '전개', summary: '사제가 변두리로 간다.' }, { name: '위기', summary: '의식이 발각된다.' }, { name: '끝', summary: '사제가 선택한다.' }],
    characters: [{ name: '가짜 사제', role: '주인공', want: '사원을 되찾는다', secret: '의식의 진짜 목적을 안다' }],
    world: [{ name: '소금 사원', kind: 'place', note: '가장 오래된 건물' }, { name: '창고 조합', kind: 'faction', note: '사원을 사들인 세력' }],
    chapters: [{ title: '쫓겨난 날', summary: '사제들이 사원에서 쫓겨난다.' }, { title: '변두리', summary: '사제가 마을에 숨어든다.' }, { title: '발각', summary: '의식이 들통난다.' }],
    questions: ['가짜 질문: 의식은 무엇을 위한 것인가?', '가짜 질문: 조합은 왜 사원을 샀는가?'],
  });
}
