// 목표 분량: 흔한 길이 기준과, 책 목표를 장마다 나누기.
import { parseBeats } from './beats';
import { charsNoSpace, charsWithSpace, plain } from './text';
import type { BookNode } from './types';

/**
 * 원고지 1매(200자, 공백 포함)를 공백 뺀 글자로 바꾼 어림값.
 * 이 서재에 있는 「새벽을 건너는 꿈」 원고(public/seed/dawn.md)를 이 앱의 원고지 어림(공백 포함 ÷ 200)으로 재어 얻은 값(약 149.5).
 * 책에 글이 충분히 있으면 그 책의 비율을 쓴다.
 */
export const SEED_PER_PAGE = 150;

export function perPage(nodes: Pick<BookNode, 'body' | 'kind'>[]): { v: number; own: boolean } {
  const text = nodes
    .filter((n) => n.kind !== 'note')
    .map((n) => plain(n.body ?? ''))
    .join('\n');
  const ns = charsNoSpace(text);
  const ws = charsWithSpace(text);
  if (ns < 3000 || !ws) return { v: SEED_PER_PAGE, own: false };
  return { v: Math.round((ns / ws) * 200), own: true };
}

export interface LengthPreset {
  id: string;
  name: string;
  pages: number;
  range: string;
  source: string;
}

/** 공모 요강에 나온 분량의 예 (요강은 해마다 · 곳마다 다르다) */
export const LENGTH_PRESETS: LengthPreset[] = [
  { id: 'short', name: '단편소설', pages: 80, range: '200자 원고지 80매 안팎', source: '신문사 신춘문예 단편소설 요강의 예 (세계일보 2024)' },
  { id: 'mid', name: '중 · 단편', pages: 200, range: '200자 원고지 80~200매 (여기서는 200매)', source: '문학동네 · 자음과모음 신인상 요강의 예 (한 편)' },
  { id: 'long500', name: '장편 (짧게)', pages: 500, range: '200자 원고지 500매 이상', source: '한국경제 아르떼 문학상 요강의 예' },
  { id: 'long', name: '장편소설', pages: 1000, range: '200자 원고지 1,000매 안팎', source: '세계문학상 · 현대경제신문 신춘문예 요강의 예' },
];

const round = (n: number) => (n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10);
export const pagesToChars = (pages: number, per = SEED_PER_PAGE) => round(pages * per);

/** 목표를 나눠 받을 칸: 부 · 메모가 아니고, 장면을 거느린 장이면 그 장면들 */
export function goalLeaves(nodes: BookNode[]): BookNode[] {
  const live = nodes.filter((n) => !n.deleted);
  const hasKids = new Set(live.filter((n) => n.kind === 'scene' && n.parent_id).map((n) => n.parent_id));
  return live.filter((n) => (n.kind === 'chapter' || n.kind === 'scene') && !(n.kind === 'chapter' && hasKids.has(n.id)));
}

/**
 * 책 목표를 칸마다 나눈다. 쪽 줄거리가 있으면 그 수만큼 무게를 둔다(없는 칸은 1).
 * keep 이면 이미 목표가 있는 칸은 두고, 남은 분량을 나머지 칸에 나눈다.
 */
export function distributeGoal(leaves: Pick<BookNode, 'id' | 'body' | 'meta'>[], goal: number, keep = false): Map<string, number> {
  const out = new Map<string, number>();
  if (!leaves.length || goal <= 0) return out;
  let pool = leaves;
  let left = goal;
  if (keep) {
    const fixed = leaves.filter((n) => Number(n.meta.target) > 0);
    const rest = leaves.filter((n) => !(Number(n.meta.target) > 0));
    if (rest.length) {
      pool = rest;
      left = Math.max(0, goal - fixed.reduce((s, n) => s + Number(n.meta.target), 0));
    }
  }
  const beats = pool.map((n) => parseBeats(n.body ?? '').beats.length);
  const anyBeats = beats.some((b) => b > 0);
  const w = beats.map((b) => (anyBeats ? Math.max(1, b) : 1));
  const sum = w.reduce((a, b) => a + b, 0);
  pool.forEach((n, i) => out.set(n.id, round((left * w[i]) / sum)));
  return out;
}
