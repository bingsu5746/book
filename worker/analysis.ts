// 분석집(작품 해설) 만들기: 장마다 AI 가 읽고 메모(JSON)를 남긴 뒤, 그 메모를 모아 여러 부분을 쓰고 책 한 권으로 엮는다.
// 원칙: 원고에 쓰인 것만 근거로 쓴다. 지어내지 않는다. 해석은 「해설」 부분에서만, 원고를 근거로.
import { clip } from './ai';

export interface ChapterNote {
  summary: string;
  characters: { name: string; doing: string; traits: string[] }[];
  events: { what: string; why: string }[];
  objects: { name: string; meaning: string }[];
  places: { name: string; meaning: string }[];
  motifs: string[];
  lines: string[];
}

export const SECTIONS = [
  { key: 'overview', title: '작품 개요와 줄거리' },
  { key: 'characters', title: '인물 분석' },
  { key: 'events', title: '사건의 흐름' },
  { key: 'things', title: '중요한 물건과 장소' },
  { key: 'themes', title: '주제와 모티프' },
  { key: 'afterword', title: '해설' },
] as const;
export type SectionKey = (typeof SECTIONS)[number]['key'];

const BASE =
  '너는 소설 원고를 꼼꼼히 읽고 해설을 쓰는 한국어 편집자다. 원고와 주어진 자료에 실제로 있는 내용만 근거로 쓴다. 원고에 없는 사실, 인물, 사건을 지어내지 않는다. 확실하지 않은 것은 「원고에서는 드러나지 않는다」고 쓴다.';

/** 한 장을 읽고 메모를 JSON 으로 */
export function chapterMessages(bookTitle: string, chapterTitle: string, body: string) {
  return [
    {
      role: 'system',
      content: `${BASE} 지금은 한 장을 읽고 나중에 해설을 쓰기 위한 메모를 남긴다. 반드시 JSON 하나만 출력한다. 모양: {"summary": "이 장의 줄거리 3~6문장", "characters": [{"name": "이름", "doing": "이 장에서 한 일", "traits": ["이 장에서 드러난 성격 · 특징"]}], "events": [{"what": "일어난 일", "why": "이야기에서 그 일이 가지는 무게"}], "objects": [{"name": "물건", "meaning": "어떻게 쓰이고 무엇을 뜻하는지"}], "places": [{"name": "장소", "meaning": "어떤 곳이고 무엇을 뜻하는지"}], "motifs": ["되풀이되는 이미지 · 말"], "lines": ["원고에서 그대로 옮긴 인상적인 문장 1~3개"]}`,
    },
    { role: 'user', content: `책: ${bookTitle}\n장: ${chapterTitle || '(제목 없음)'}\n\n원고:\n${clip(body, 12000).text}` },
  ];
}

const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const s = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** 모델 답에서 JSON 을 꺼내 메모 모양으로. JSON 이 아니면 글 전체를 줄거리로 */
export function parseChapterNote(raw: string): ChapterNote {
  const empty: ChapterNote = { summary: '', characters: [], events: [], objects: [], places: [], motifs: [], lines: [] };
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { ...empty, summary: s(raw, 1500) };
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    return {
      summary: s(o.summary, 1500),
      characters: arr(o.characters)
        .slice(0, 20)
        .map((c) => ({ name: s((c as Record<string, unknown>).name, 40), doing: s((c as Record<string, unknown>).doing, 300), traits: arr((c as Record<string, unknown>).traits).map((t) => s(t, 80)).filter(Boolean).slice(0, 6) }))
        .filter((c) => c.name),
      events: arr(o.events)
        .slice(0, 12)
        .map((e) => ({ what: s((e as Record<string, unknown>).what, 300), why: s((e as Record<string, unknown>).why, 300) }))
        .filter((e) => e.what),
      objects: arr(o.objects)
        .slice(0, 12)
        .map((e) => ({ name: s((e as Record<string, unknown>).name, 40), meaning: s((e as Record<string, unknown>).meaning, 300) }))
        .filter((e) => e.name),
      places: arr(o.places)
        .slice(0, 12)
        .map((e) => ({ name: s((e as Record<string, unknown>).name, 40), meaning: s((e as Record<string, unknown>).meaning, 300) }))
        .filter((e) => e.name),
      motifs: arr(o.motifs).map((m) => s(m, 120)).filter(Boolean).slice(0, 10),
      lines: arr(o.lines).map((m) => s(m, 300)).filter(Boolean).slice(0, 3),
    };
  } catch {
    return { ...empty, summary: s(raw.replace(/[{}"]/g, ''), 1500) };
  }
}

/** 장 메모들을 한 덩어리 자료로 (부분마다 필요한 것만, 너무 길면 자른다) */
export function digest(chapters: { title: string; part: string; note: ChapterNote }[], section: SectionKey, max = 24000): string {
  const out: string[] = [];
  chapters.forEach((c, i) => {
    const head = `[${i + 1}] ${c.part ? c.part + ' · ' : ''}${c.title}`;
    const n = c.note;
    const lines = [head, `줄거리: ${n.summary}`];
    if (section === 'characters' || section === 'afterword' || section === 'overview')
      for (const ch of n.characters) lines.push(`인물 ${ch.name}: ${ch.doing}${ch.traits.length ? ` (${ch.traits.join(', ')})` : ''}`);
    if (section === 'events' || section === 'afterword') for (const e of n.events) lines.push(`사건: ${e.what}${e.why ? ` — ${e.why}` : ''}`);
    if (section === 'things' || section === 'themes' || section === 'afterword') {
      for (const o of n.objects) lines.push(`물건 ${o.name}: ${o.meaning}`);
      for (const p of n.places) lines.push(`장소 ${p.name}: ${p.meaning}`);
    }
    if (section === 'themes' || section === 'afterword') {
      if (n.motifs.length) lines.push(`모티프: ${n.motifs.join(', ')}`);
      for (const l of n.lines) lines.push(`문장: 「${l}」`);
    }
    out.push(lines.join('\n'));
  });
  let text = out.join('\n\n');
  if (text.length > max) text = text.slice(0, max) + '\n…(자료가 길어 뒤를 줄임)';
  return text;
}

const ASK: Record<SectionKey, string> = {
  overview:
    '「작품 개요와 줄거리」를 쓴다. 마크다운으로, ### 작품 정보(분량 · 시점 · 배경 · 구성을 자료에 드러난 만큼), ### 한 문단 줄거리, ### 전체 줄거리(부 · 장의 흐름을 따라 여러 문단, 결말까지 빠짐없이) 순서로 쓴다.',
  characters:
    '「인물 분석」을 쓴다. 마크다운으로, 비중이 큰 인물부터 인물마다 ### 이름 아래에 — 이야기 속 자리, 성격과 특징(근거가 된 장면을 [장 번호]로), 바라는 것과 두려워하는 것, 처음과 끝에서 달라진 점, 다른 인물과의 관계 — 를 자세히 쓴다. 비중이 작은 인물은 마지막에 ### 그 밖의 인물 에 한두 줄씩 모은다.',
  events:
    '「사건의 흐름」을 쓴다. 마크다운으로, 이야기의 주요 사건을 일어난 순서대로 번호 목록으로 정리하고, 사건마다 무엇이 일어났는지, 왜 일어났는지, 그 뒤에 무엇이 달라졌는지를 쓰고 [장 번호]를 붙인다. 끝에 ### 이야기의 전환점 으로 가장 큰 고비 두세 개를 짚는다.',
  things:
    '「중요한 물건과 장소」를 쓴다. 마크다운으로, ### 물건 과 ### 장소 로 나누고, 항목마다 **이름** — 무엇인지, 어디에 처음 나오고 어떻게 다시 나오는지([장 번호]), 이야기에서 어떤 뜻을 갖는지 를 자세히 쓴다.',
  themes:
    '「주제와 모티프」를 쓴다. 마크다운으로, ### 주제(작품이 붙들고 있는 물음 두세 개), ### 되풀이되는 이미지와 말(모티프마다 나오는 장과 쓰임), ### 구성과 문체(시간 구조 · 시점 · 문장의 특징) 를 원고의 근거와 함께 쓴다.',
  afterword:
    '「해설」을 쓴다. 외국 소설을 옮긴 번역가가 책 끝에 붙이는 긴 해설 글처럼, 이 작품을 막 다 읽은 독자에게 건네는 에세이를 여러 문단(1500자 이상)으로 쓴다. 작품이 어떤 이야기이고 무엇이 인상적인지, 인물과 장면이 어떻게 맞물리는지, 다시 읽을 때 눈여겨볼 곳은 어디인지를 원고의 장면과 문장을 근거로 이야기한다. 칭찬이나 평가 대신 읽기를 돕는 글로 쓴다. 제목 없이 본문만 쓴다.',
};

export function sectionMessages(bookTitle: string, section: SectionKey, material: string, worldNotes: string) {
  return [
    { role: 'system', content: `${BASE} 지금은 책 한 권의 해설집 가운데 한 부분을 쓴다. 자료는 장마다 남긴 메모다. 장을 가리킬 때는 자료의 [번호]를 쓴다. 부분 제목(# 이나 ##)은 쓰지 않는다.` },
    { role: 'user', content: `책: 《${bookTitle}》\n\n할 일: ${ASK[section]}\n\n${worldNotes ? `작가가 정리한 세계관 자료(참고):\n${worldNotes}\n\n` : ''}장별 자료:\n${material}` },
  ];
}

/** 부분 글 다듬기: 맨 앞의 큰 제목은 걷어 낸다 (장 제목이 따로 붙으므로) */
export function cleanSection(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^\s*#{1,2}\s+.*\n+/, '')
    .trim();
}

/** 장별 줄거리 부분은 메모를 그대로 엮는다 (AI 를 다시 부르지 않음) */
export function chapterSummaries(chapters: { title: string; part: string; note: ChapterNote }[]): string {
  const out: string[] = [];
  let part = '';
  chapters.forEach((c, i) => {
    if (c.part && c.part !== part) {
      part = c.part;
      out.push(`### ${part}`);
    }
    out.push(`**[${i + 1}] ${c.title || '제목 없음'}**  \n${c.note.summary || '(요약 없음)'}`);
  });
  return out.join('\n\n');
}
