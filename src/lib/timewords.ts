// 시간 표현 모으기: 장마다 원고에 쓴 시간 표현(연도 · 날짜 · 「사흘 뒤」 · 「다음 날」 · 계절 · 요일)을 찾아 연표 사건 후보로 보여 준다.
export type TimeKind = 'date' | 'span' | 'day' | 'season' | 'weekday' | 'meta';
export interface TimeWord {
  kind: TimeKind;
  text: string;
  at: number;
}
export const TIME_KIND_LABEL: Record<TimeKind, string> = { meta: '장 정보', date: '날짜', span: '지난 시간', day: '며칠 사이', season: '계절', weekday: '요일' };

const RES: [TimeKind, RegExp][] = [
  ['date', /\d{1,5}\s*년(?:\s*\d{1,2}\s*월)?(?:\s*\d{1,2}\s*일)?|\d{1,2}\s*월\s*\d{1,2}\s*일/g],
  ['span', /(?:\d{1,3}|한|두|세|네|석|넉|다섯|여섯|일곱|열)\s*(?:일|주일|주|달|개월|해|년|날)\s*(?:뒤|후|전|만에|동안|이 지나)|(?:사흘|이틀|나흘|닷새|엿새|이레|열흘|보름|일주일)\s*(?:뒤|후|전|만에|동안)|이듬해|이듬달/g],
  ['day', /그다음 ?날|다음 ?날|이튿날|전날|어제|내일|모레|그 ?이튿날|며칠 ?(?:뒤|후|전)/g],
  ['season', /(?:이른 |늦은 |한 ?여름|한 ?겨울|초|늦|깊은 )?(?:봄|여름|가을|겨울)(?:이었|이다|에|날|밤|비|바람|철|이 )/g],
  ['weekday', /(?:월|화|수|목|금|토|일)요일/g],
];

export function findTimeWords(body: string): TimeWord[] {
  const text = body.replace(/%%[\s\S]*?%%/g, (m) => ' '.repeat(m.length));
  const out: TimeWord[] = [];
  for (const [kind, re] of RES)
    for (const m of text.matchAll(re)) {
      // 계절은 뒤에 붙은 글자를 떼고 계절 말만
      const t = kind === 'season' ? m[0].replace(/(이었|이다|에|날|밤|비|바람|철|이 )$/, '').trim() : m[0].trim();
      if (t) out.push({ kind, text: t, at: m.index! });
    }
  out.sort((a, b) => a.at - b.at);
  // 같은 자리를 둘이 잡으면 앞선 것만
  return out.filter((w, i) => !out.slice(0, i).some((p) => w.at < p.at + p.text.length));
}

export interface ChapterTimes {
  id: string;
  title: string;
  words: TimeWord[];
  /** 이 장 연도 (meta 「이야기 속 시간」 → 본문 첫 「…년」) */
  year: number | null;
}
export function chapterTimes(chapters: { id: string; title: string; body: string; time?: string }[]): ChapterTimes[] {
  return chapters.map((c) => {
    const words = findTimeWords(c.body);
    if (c.time?.trim()) words.unshift({ kind: 'meta', text: c.time.trim(), at: -1 });
    const y = [...(c.time ? [c.time] : []), ...words.filter((w) => w.kind === 'date').map((w) => w.text)].map((t) => t.match(/(\d{1,5})\s*년/)?.[1]).find(Boolean);
    return { id: c.id, title: c.title, words, year: y ? Number(y) : null };
  });
}

/** 연도가 앞 장보다 거꾸로 가는 곳 (회상이면 괜찮다) */
export function backwards(list: ChapterTimes[]): { from: ChapterTimes; to: ChapterTimes }[] {
  const out: { from: ChapterTimes; to: ChapterTimes }[] = [];
  let prev: ChapterTimes | null = null;
  for (const c of list) {
    if (c.year == null) continue;
    if (prev && c.year < (prev.year as number)) out.push({ from: prev, to: c });
    prev = c;
  }
  return out;
}
