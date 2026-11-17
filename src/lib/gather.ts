// 인물별로 모아 읽기: 이름(다른 이름 포함)이 나오는 문단만, 장 제목 아래로 모은다.
export interface GBlock {
  n: string;
  o: number;
  text: string;
  head?: boolean;
}
export interface Gathered {
  title: string;
  n: string;
  paras: { o: number; text: string }[];
}

const has = (t: string, names: string[]) => names.some((w) => w && t.includes(w));

export function gather(blocks: GBlock[], names: string[]): Gathered[] {
  const ns = names.map((x) => x.trim()).filter((x) => x.length >= 1);
  const out: Gathered[] = [];
  let title = '';
  for (const b of blocks) {
    if (b.head) {
      title = b.text;
      continue;
    }
    if (!has(b.text, ns)) continue;
    let g = out[out.length - 1];
    if (!g || g.n !== b.n) out.push((g = { title, n: b.n, paras: [] }));
    g.paras.push({ o: b.o, text: b.text });
  }
  return out;
}

/** 이 책에 나오는 항목과 나오는 문단 수 (많은 순) */
export function whoAppears<E extends { name: string; aliases: string[] }>(blocks: GBlock[], entries: E[]): { e: E; n: number }[] {
  const text = blocks.filter((b) => !b.head).map((b) => b.text);
  return entries
    .map((e) => {
      const ns = [e.name, ...e.aliases].map((x) => x.trim()).filter(Boolean);
      return { e, n: text.filter((t) => has(t, ns)).length };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
}
