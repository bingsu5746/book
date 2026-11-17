// 이름 표기 흔들림 검사 (AI 를 부르지 않는 규칙): 세계관 이름과 자모 하나 · 둘만 다른 낱말을 원고에서 찾는다.
// 예: 홍설 / 홍셜, 파빌리온 / 파빌리언. 다른 이름(별칭)으로 등록된 것과 다른 항목 이름은 뺀다.

const BASE = 0xac00;
const isSyl = (c: string) => c >= '가' && c <= '힣';

/** 한글 음절을 초성 · 중성 · 종성으로 (다른 글자는 그대로) */
export function jamo(s: string): string[] {
  const out: string[] = [];
  for (const c of s) {
    if (!isSyl(c)) {
      out.push(c);
      continue;
    }
    const i = c.charCodeAt(0) - BASE;
    out.push(`c${Math.floor(i / 588)}`, `v${Math.floor((i % 588) / 28)}`);
    if (i % 28) out.push(`t${i % 28}`);
  }
  return out;
}
/** 받침이 있는지 (조사 이/가 · 을/를 이 달라지는지 보려고) */
export const hasBatchim = (s: string) => {
  const c = s.slice(-1);
  return isSyl(c) && (c.charCodeAt(0) - BASE) % 28 !== 0;
};

export function distance(a: string[], b: string[], max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export interface NameIn {
  id: string;
  name: string;
  aliases: string[];
}
export interface Variant {
  /** 원고에 쓰인 다른 표기 */
  variant: string;
  /** 맞는 것 같은 세계관 이름 */
  name: string;
  entryId: string;
  count: number;
  /** 장 id → 나온 수 */
  where: Record<string, number>;
  /** 받침 유무가 달라 바꾸면 조사를 손봐야 할 수 있음 */
  josa: boolean;
}

const WORD = /[가-힣A-Za-z0-9]+/g;
const startsWord = (text: string, at: number) => at === 0 || !/[가-힣A-Za-z0-9]/.test(text[at - 1]);

export function findVariants(chapters: { id: string; body: string }[], entries: NameIn[], ignore: string[] = []): Variant[] {
  const known = new Set(entries.flatMap((e) => [e.name, ...e.aliases]).map((x) => x.trim()).filter(Boolean));
  const ign = new Set(ignore);
  const knownList = [...known];
  // 이름(다른 이름 포함) 모두를 기준으로, 한글 두 글자 이상만
  const targets = entries.flatMap((e) => [e.name, ...e.aliases].map((n) => ({ e, n: n.trim() }))).filter((t) => [...t.n].length >= 2 && /^[가-힣]+$/.test(t.n));
  const jt = targets.map((t) => ({ ...t, j: jamo(t.n), len: [...t.n].length }));
  // 낱말 → (장 → 수)
  const words = new Map<string, Map<string, number>>();
  for (const c of chapters) {
    const text = c.body.replace(/%%[\s\S]*?%%/g, (m) => ' '.repeat(m.length));
    for (const m of text.matchAll(WORD)) {
      const w = m[0];
      if (!/^[가-힣]/.test(w)) continue;
      if (!words.has(w)) words.set(w, new Map());
      const per = words.get(w)!;
      per.set(c.id, (per.get(c.id) ?? 0) + 1);
    }
  }
  const found = new Map<string, Variant>();
  for (const [w, per] of words) {
    const syl = [...w];
    // 이미 맞는 이름(다른 이름 포함)으로 시작하는 낱말(홍설이, 홍설은)은 건너뛴다
    if (knownList.some((k) => w.startsWith(k))) continue;
    for (const t of jt) {
      for (const L of [t.len - 1, t.len, t.len + 1]) {
        if (L < 2 || L > syl.length) continue;
        const cand = syl.slice(0, L).join('');
        if (known.has(cand) || ign.has(cand)) continue;
        // 첫 글자나 끝 글자는 같아야 (서진 / 서지 처럼 우연히 비슷한 말을 줄이려고)
        if (cand[0] !== t.n[0] && cand.slice(-1) !== t.n.slice(-1)) continue;
        const d = distance(jamo(cand), t.j, 2);
        if (d === 0 || d > (t.len >= 3 ? 2 : 1)) continue;
        const key = cand;
        const v = found.get(key) ?? { variant: cand, name: t.e.name, entryId: t.e.id, count: 0, where: {}, josa: hasBatchim(cand) !== hasBatchim(t.e.name) };
        for (const [id, n] of per) {
          v.where[id] = (v.where[id] ?? 0) + n;
          v.count += n;
        }
        found.set(key, v);
        break;
      }
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}

/** 낱말 머리에 쓰인 다른 표기를 이름으로 바꾼 글 */
export function replaceVariant(body: string, variant: string, name: string): string {
  let out = '';
  let last = 0;
  for (let i = body.indexOf(variant); i >= 0; i = body.indexOf(variant, i + variant.length)) {
    if (!startsWord(body, i)) continue;
    out += body.slice(last, i) + name;
    last = i + variant.length;
  }
  return out + body.slice(last);
}
