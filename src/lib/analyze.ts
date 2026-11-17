// 퇴고 도우미: 자주 쓴 말 · 가까이 되풀이한 말 · 긴 문장 · 대사 비율 · 문장 끝맺음.
// 한국어 형태소 분석기 없이 어림으로 센다 (낱말 끝의 흔한 조사를 떼어 내는 정도). 화면에도 「어림」이라고 알린다.

const JOSA = ['에서부터', '으로부터', '로부터', '에게서', '한테서', '에서는', '에서도', '으로는', '으로도', '이라도', '이라고', '이라는', '께서는', '까지는', '부터는', '처럼', '보다', '에서', '에게', '한테', '께서', '까지', '부터', '으로', '이나', '이랑', '하고', '마저', '조차', '밖에', '만큼', '대로', '은', '는', '이', '가', '을', '를', '에', '의', '도', '로', '와', '과', '만', '나', '랑', '야', '여'];
const STOP = new Set(['그', '이', '저', '것', '수', '등', '때', '더', '안', '못', '잘', '또', '그리고', '하지만', '그러나', '그래서', '그런데', '있다', '없다', '했다', '한다', '하는', '있는', '없는', '있었다', '없었다', '것이다', '같은', '같았다', '그녀', '그는', '나는', '내가', '우리', '너무', '정말', '다시', '아직', '이미', '조금', '모두', '다', '좀', '한', '두', '그것', '이것', '저것', '무엇', '어떤', '이런', '그런', '저런', '하고', '했다고', '말했다']);

export function stem(word: string): string {
  const w = word.replace(/[^\p{L}\p{N}]/gu, '');
  if (!/[가-힣]/.test(w)) return w.toLowerCase();
  for (const j of JOSA) if (w.length > j.length + 1 && w.endsWith(j)) return w.slice(0, -j.length);
  return w;
}

export interface Sentence {
  text: string;
  at: number;
  len: number;
}

export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.?!…\n]+(?:[.?!…]+["'”’」』)]*|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t.replace(/[#*>\-\s]/g, '').length >= 2) out.push({ text: t, at: m.index + lead, len: t.replace(/\s/g, '').length });
  }
  return out;
}

export interface Analysis {
  chars: number;
  paragraphs: number;
  sentenceCount: number;
  avgSentence: number;
  longSentences: Sentence[];
  dialogueShare: number;
  topWords: { w: string; n: number }[];
  nearRepeats: { w: string; at: number; at2: number }[];
  endings: { e: string; n: number }[];
  sameStarts: { w: string; at: number; count: number }[];
}

export function analyze(md: string, opts: { longAt?: number; window?: number } = {}): Analysis {
  const text = md.replace(/%%[\s\S]*?%%/g, (m) => ' '.repeat(m.length));
  const longAt = opts.longAt ?? 80;
  const win = opts.window ?? 150;
  const ss = sentences(text);
  const chars = text.replace(/\s/g, '').length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
  // 대사: “…” "…" 「…」 『…』 안의 글자
  let dia = 0;
  for (const m of text.matchAll(/“[^”]*”|"[^"\n]*"|「[^」]*」|『[^』]*』/g)) dia += m[0].replace(/\s/g, '').length;
  // 낱말
  const counts = new Map<string, number>();
  const last = new Map<string, number>();
  const near: Analysis['nearRepeats'] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const s = stem(m[0]);
    if (s.length < 2 || STOP.has(s) || STOP.has(m[0])) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
    const prev = last.get(s);
    if (prev != null && m.index! - prev < win && near.length < 300) near.push({ w: s, at: prev, at2: m.index! });
    last.set(s, m.index!);
  }
  const topWords = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w, n]) => ({ w, n }));
  // 끝맺음 (마지막 두 글자)
  const ends = new Map<string, number>();
  for (const s of ss) {
    const core = s.text.replace(/[.?!…"'”’」』)\s]+$/, '');
    if (core.length < 2) continue;
    const e = core.slice(-2);
    ends.set(e, (ends.get(e) ?? 0) + 1);
  }
  const endings = [...ends].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([e, n]) => ({ e, n }));
  // 같은 말로 시작하는 문장이 3번 넘게 이어짐
  const sameStarts: Analysis['sameStarts'] = [];
  let run = 1;
  for (let i = 1; i <= ss.length; i++) {
    const w = (x?: Sentence) => (x ? stem(x.text.replace(/^["“「『'‘\s]+/, '').split(/\s+/)[0] ?? '') : '');
    if (i < ss.length && w(ss[i]) && w(ss[i]) === w(ss[i - 1])) run++;
    else {
      if (run >= 3) sameStarts.push({ w: w(ss[i - 1]), at: ss[i - run].at, count: run });
      run = 1;
    }
  }
  return {
    chars,
    paragraphs,
    sentenceCount: ss.length,
    avgSentence: ss.length ? Math.round(ss.reduce((a, s) => a + s.len, 0) / ss.length) : 0,
    longSentences: ss.filter((s) => s.len >= longAt).sort((a, b) => b.len - a.len).slice(0, 30),
    dialogueShare: chars ? dia / chars : 0,
    topWords,
    nearRepeats: near,
    endings,
    sameStarts,
  };
}
