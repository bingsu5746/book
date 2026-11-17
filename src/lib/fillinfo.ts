// 장 정보 AI 채우기: 비어 있는 칸만 채운다 (사람이 쓴 칸은 건드리지 않는다).
import { charsNoSpace } from './text';
import type { BookNode } from './types';

export interface ChapterInfo {
  synopsis: string;
  pov: string;
  place: string;
  time: string;
  tags: string[];
}

const changed = (now: number, was: number) => !!was && Math.abs(now - was) / was > 0.15;

/** AI 가 쓴 줄거리인데 그 뒤로 원고가 15% 넘게 바뀌었으면 낡은 것 */
export function synopsisStale(n: BookNode): boolean {
  return !!n.meta.synopsisAi && changed(charsNoSpace(n.body ?? ''), Number(n.meta.synopsisChars ?? 0));
}

/** 비어 있는 장 정보 칸 */
export function infoGaps(n: BookNode): (keyof ChapterInfo)[] {
  const g: (keyof ChapterInfo)[] = [];
  if (!n.synopsis.trim() || synopsisStale(n)) g.push('synopsis');
  if (!String(n.meta.pov ?? '').trim()) g.push('pov');
  if (!String(n.meta.place ?? '').trim()) g.push('place');
  if (!String(n.meta.time ?? '').trim()) g.push('time');
  if (!(n.meta.tags ?? []).length) g.push('tags');
  return g;
}

/** 채울 만한 장인가: 글이 있고, 빈 칸이 있고, 같은 원고로 이미 해 본 적이 없을 때 */
export function shouldAutoFill(n: BookNode, minChars = 200): boolean {
  if (n.kind === 'part' || n.kind === 'note') return false;
  const chars = charsNoSpace((n.body ?? '').replace(/%%[\s\S]*?%%/g, ''));
  if (chars < minChars) return false;
  const gaps = infoGaps(n);
  if (!gaps.length) return false;
  if (gaps.includes('synopsis')) return true;
  const tried = Number(n.meta.infoAiChars ?? 0);
  return !tried || changed(chars, tried);
}

/** AI 답을 빈 칸에만 넣은 패치. 바뀐 것이 없어도 「해 봤음」은 남긴다 */
export function mergeInfo(n: BookNode, info: ChapterInfo): { patch: Partial<BookNode>; filled: string[] } {
  const gaps = infoGaps(n);
  const chars = charsNoSpace((n.body ?? '').replace(/%%[\s\S]*?%%/g, ''));
  const meta: BookNode['meta'] = { ...n.meta, infoAiChars: chars };
  const patch: Partial<BookNode> = {};
  const filled: string[] = [];
  if (gaps.includes('synopsis') && info.synopsis) {
    patch.synopsis = info.synopsis;
    meta.synopsisAi = true;
    meta.synopsisChars = charsNoSpace(n.body ?? '');
    filled.push('줄거리');
  }
  if (gaps.includes('pov') && info.pov) (meta.pov = info.pov), filled.push('시점');
  if (gaps.includes('place') && info.place) (meta.place = info.place), filled.push('장소');
  if (gaps.includes('time') && info.time) (meta.time = info.time), filled.push('시간');
  if (gaps.includes('tags') && info.tags.length) (meta.tags = info.tags), filled.push('꼬리표');
  const ai = new Set<string>((n.meta.infoAi as string[] | undefined) ?? []);
  for (const k of ['pov', 'place', 'time', 'tags'] as const) if (gaps.includes(k) && (k === 'tags' ? info.tags.length : info[k])) ai.add(k);
  meta.infoAi = [...ai];
  patch.meta = meta;
  return { patch, filled };
}
