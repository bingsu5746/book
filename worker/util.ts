// 서버 도우미 (Cloudflare 없이 시험할 수 있게 따로 둔다: worker/util.test.ts)
/** 글 안에서 q 를 찾아 앞뒤를 잘라 보여 줄 조각들 (대소문자 무시) */
export function snippets(text: string, q: string, max = 3, around = 40): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  const low = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = low.indexOf(needle);
  while (i >= 0 && out.length < max) {
    const a = Math.max(0, i - around);
    const b = Math.min(text.length, i + needle.length + around);
    out.push({ at: i, text: (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : '') });
    i = low.indexOf(needle, i + needle.length);
  }
  return out;
}

/** 나무(부 → 장 → 장면)를 위에서부터 차례로 펼친다 */
export function flattenTree<T extends { id: string; parent_id: string | null; sort: number }>(nodes: T[]): (T & { depth: number })[] {
  const kids = new Map<string | null, T[]>();
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    const p = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(n);
  }
  for (const l of kids.values()) l.sort((a, b) => a.sort - b.sort);
  const out: (T & { depth: number })[] = [];
  const walk = (p: string | null, depth: number) => {
    for (const n of kids.get(p) ?? []) {
      out.push({ ...n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

