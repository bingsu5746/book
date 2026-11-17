// AI 도구를 쓰는 쪽 계산: 보낼 자료 만들기, 답을 원고에 맞춰 보기(못 찾은 인용은 걸러 냄), 대사 통계.
import type { Entry } from './world';

export interface Issue {
  quote: string;
  problem: string;
  source: string;
  sourceQuote: string;
}
export interface NameHint {
  name: string;
  kind: Entry['kind'];
  summary: string;
}
export interface Edit {
  before: string;
  after: string;
  why: string;
}
export interface SpokenLine {
  id: number;
  at: number;
  text: string;
  speaker: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 원고에서 인용이 있는 곳. 띄어쓰기 · 줄바꿈 차이는 봐준다. 없으면 null */
export function locate(body: string, quote: string, from = 0): { at: number; len: number } | null {
  const q = quote.trim();
  if (!q) return null;
  const i = body.indexOf(q, from);
  if (i >= 0) return { at: i, len: q.length };
  const words = q.split(/\s+/).filter(Boolean).map(esc);
  if (!words.length) return null;
  const re = new RegExp(words.join('\\s+'), 'g');
  re.lastIndex = from;
  const m = re.exec(body);
  return m ? { at: m.index, len: m[0].length } : null;
}

/** 세계관 자료를 글로: 이 장에 나오는 항목을 먼저, 너무 길면 자른다 */
export function worldText(entries: Entry[], body: string, max = 8000): string {
  const hits = (e: Entry) => [e.name, ...e.aliases].some((w) => w.trim() && body.includes(w.trim()));
  const sorted = [...entries].sort((a, b) => Number(hits(b)) - Number(hits(a)));
  const out: string[] = [];
  let used = 0;
  for (const e of sorted) {
    const fields = Object.entries(e.fields ?? {})
      .filter(([, v]) => v && v.trim())
      .map(([k, v]) => `${k}: ${v.replace(/\s+/g, ' ').trim()}`);
    const line = [`- ${e.name}${e.aliases.length ? ` (다른 이름: ${e.aliases.join(', ')})` : ''}`, e.summary.trim(), ...fields, e.body.trim().slice(0, 400)].filter(Boolean).join(' / ');
    if (used + line.length > max) break;
    out.push(line);
    used += line.length + 1;
  }
  return out.join('\n');
}

/** AI 가 찾은 이름 가운데: 원고에 정말 나오고, 세계관에 아직 없는 것만 */
export function newNames(hints: NameHint[], entries: Entry[], body: string): (NameHint & { count: number })[] {
  const known = new Set(entries.flatMap((e) => [e.name, ...e.aliases].map((x) => x.trim())).filter(Boolean));
  const text = body.replace(/%%[\s\S]*?%%/g, '');
  return hints
    .filter((h) => h.name.length >= 2 && !known.has(h.name))
    .map((h) => {
      let count = 0;
      for (let i = text.indexOf(h.name); i >= 0; i = text.indexOf(h.name, i + h.name.length)) count++;
      return { ...h, count };
    })
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** 문장 끝 두 글자 (마침표 · 물음표 · 말줄임 앞) */
function endings(text: string): string[] {
  return text
    .split(/(?<=[.!?…~])\s+|\n/)
    .map((s) => s.replace(/[.!?…~\s"'”」]+$/g, ''))
    .map((s) => s.split(/\s+/).pop() ?? '')
    .filter((w) => /[가-힣]$/.test(w))
    .map((w) => w.slice(-2));
}

export interface VoiceStat {
  speaker: string;
  lines: number;
  share: number;
  chars: number;
  avgLen: number;
  endings: { e: string; n: number }[];
  samples: SpokenLine[];
}

/** 인물별 대사 통계. speaker 가 빈 글이면 「누군지 모름」으로 모은다 */
export function voiceStats(lines: SpokenLine[]): { voices: VoiceStat[]; unknown: number } {
  const by = new Map<string, SpokenLine[]>();
  let unknown = 0;
  for (const l of lines) {
    if (!l.speaker) {
      unknown++;
      continue;
    }
    if (!by.has(l.speaker)) by.set(l.speaker, []);
    by.get(l.speaker)!.push(l);
  }
  const total = lines.length || 1;
  const voices = [...by.entries()].map(([speaker, ls]) => {
    const chars = ls.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0);
    const count = new Map<string, number>();
    for (const l of ls) for (const e of endings(l.text)) count.set(e, (count.get(e) ?? 0) + 1);
    const ends = [...count.entries()]
      .map(([e, n]) => ({ e, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 4);
    // 말버릇 예시: 가장 자주 쓴 끝맺음이 든 대사를 먼저, 그다음 긴 대사
    const top = ends[0]?.e;
    const samples = [...ls].sort((a, b) => Number(!!top && endings(b.text).includes(top)) - Number(!!top && endings(a.text).includes(top)) || b.text.length - a.text.length).slice(0, 3);
    return { speaker, lines: ls.length, share: ls.length / total, chars, avgLen: Math.round(chars / ls.length), endings: ends, samples };
  });
  voices.sort((a, b) => b.lines - a.lines);
  return { voices, unknown };
}

/** 두 인물의 끝맺음이 얼마나 겹치는지 (0~1). 높으면 말투가 비슷하게 들릴 수 있다 */
export function endingOverlap(a: VoiceStat, b: VoiceStat): number {
  const ea = new Set(a.endings.map((x) => x.e));
  const eb = new Set(b.endings.map((x) => x.e));
  if (!ea.size || !eb.size) return 0;
  let both = 0;
  for (const e of ea) if (eb.has(e)) both++;
  return both / Math.min(ea.size, eb.size);
}

// ---------------------------------------------------------------- 지난 이야기
export interface ReadBlock {
  n: string;
  o: number;
  text: string;
  head?: boolean;
}

/**
 * 읽은 데까지의 글만 모은다. 읽던 장(spot.n)에서는 spot.o 앞까지, 그 뒤 장은 넣지 않는다.
 * 길면 앞 장들은 장마다 앞 · 뒤를 조금씩 남기고, 읽던 장은 끝(멈춘 곳 바로 앞)을 넉넉히 남긴다.
 */
export function recapMaterial(blocks: ReadBlock[], order: string[], spot: { n: string; o: number }, max = 16000): string {
  const stop = order.indexOf(spot.n);
  if (stop < 0) return '';
  const chapters: { title: string; text: string }[] = [];
  let cur: { n: string; title: string; parts: string[] } | null = null;
  for (const b of blocks) {
    const k = order.indexOf(b.n);
    if (k < 0 || k > stop) continue;
    if (k === stop && !b.head && b.o >= spot.o) continue;
    if (!cur || cur.n !== b.n) {
      if (cur) chapters.push({ title: cur.title, text: cur.parts.join('\n') });
      cur = { n: b.n, title: '', parts: [] };
    }
    if (b.head) cur.title = cur.title ? `${cur.title} · ${b.text}` : b.text;
    else cur.parts.push(b.text);
  }
  if (cur) chapters.push({ title: cur.title, text: cur.parts.join('\n') });
  const live = chapters.filter((c) => c.text.trim());
  if (!live.length) return '';
  const fmt = (c: { title: string; text: string }) => (c.title ? `## ${c.title}\n${c.text}` : c.text);
  const all = live.map(fmt).join('\n\n');
  if (all.length <= max) return all;
  const last = live[live.length - 1];
  const lastBudget = Math.min(last.text.length, Math.floor(max * 0.35));
  const lastText = last.text.length > lastBudget ? `(…앞부분 생략…)\n${last.text.slice(last.text.length - lastBudget)}` : last.text;
  const before = live.slice(0, -1);
  const each = before.length ? Math.max(200, Math.floor((max - lastBudget - 200) / before.length)) : 0;
  const cut = (t: string) => (t.length <= each ? t : `${t.slice(0, Math.ceil(each * 0.6))}\n(…)\n${t.slice(t.length - Math.floor(each * 0.4))}`);
  return [...before.map((c) => fmt({ title: c.title, text: cut(c.text) })), fmt({ title: last.title, text: lastText })].join('\n\n').slice(-max);
}
