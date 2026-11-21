// 시리즈 묶기: 책 meta.series(이름) · meta.seriesNo(권수). 서재 책장에서 같은 시리즈를 한 덩어리로, 권 순서대로.
export interface SeriesInfo {
  name: string;
  no: number | null;
}
export function seriesOf(meta: Record<string, unknown> | undefined | null): SeriesInfo | null {
  const name = typeof meta?.series === 'string' ? meta.series.trim() : '';
  if (!name) return null;
  const n = Number(meta?.seriesNo);
  return { name, no: Number.isFinite(n) && n > 0 ? n : null };
}

/** 같은 시리즈를 처음 나온 자리로 모으고(권 순서대로), 나머지 순서는 그대로 */
export function groupBySeries<T>(list: T[], metaOf: (t: T) => Record<string, unknown> | undefined | null): { series: string | null; items: T[] }[] {
  const out: { series: string | null; items: T[] }[] = [];
  const at = new Map<string, number>();
  for (const t of list) {
    const s = seriesOf(metaOf(t));
    if (!s) {
      out.push({ series: null, items: [t] });
      continue;
    }
    if (!at.has(s.name)) {
      at.set(s.name, out.length);
      out.push({ series: s.name, items: [] });
    }
    out[at.get(s.name)!].items.push(t);
  }
  for (const g of out)
    if (g.series)
      g.items.sort((a, b) => (seriesOf(metaOf(a))?.no ?? 1e9) - (seriesOf(metaOf(b))?.no ?? 1e9));
  return out;
}
