// 백업(.json, 계정 → 전부 내려받기)에서 되살리기: 책 · 원고 · 세계관을 새 사본으로 다시 만든다.
// 세계관 항목 id 는 새로 만들고, 관계 · 사건 · 지도 핀이 가리키는 id 도 함께 바꾼다.
// 그림(초상 · 지도)은 백업 파일에 들어가지 않아서 되살리지 못한다.
import { api } from './api';
import type { DraftNode } from './split';
import { flatten, uploadNodes } from './store';
import { newItemId, saveItems, type WItem } from './world';

type Row = Record<string, unknown>;
const parse = (v: unknown) => {
  if (typeof v !== 'string') return v ?? {};
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};

export interface RestoreResult {
  books: number;
  worlds: number;
  skippedImages: number;
}

export async function restoreBackup(raw: unknown, onStep: (s: string) => void): Promise<RestoreResult> {
  const b = raw as { books?: Row[]; nodes?: Row[]; worlds?: Row[]; witems?: Row[] };
  if (!b || !Array.isArray(b.books) || !Array.isArray(b.nodes)) throw new Error('서재 백업 파일이 아니에요.');
  const worlds = (b.worlds ?? []).filter((w) => !w.deleted);
  const witems = (b.witems ?? []).filter((i) => !i.deleted);
  const worldMap: Record<string, string> = {};
  const itemsByWorld: Record<string, WItem[]> = {};
  let skippedImages = 0;
  for (const w of worlds) {
    onStep(`세계 「${w.title}」 되살리는 중…`);
    const mine = witems.filter((i) => i.world_id === w.id && i.type !== 'map');
    skippedImages += witems.filter((i) => i.world_id === w.id && i.type === 'map').length;
    const idMap = new Map(mine.map((i) => [String(i.id), newItemId()]));
    const items = mine.map((i) => {
      let text = typeof i.data === 'string' ? i.data : JSON.stringify(i.data ?? {});
      for (const [o, n] of idMap) text = text.split(o).join(n);
      const data = parse(text) as Row;
      if (data.image) {
        delete data.image;
        skippedImages++;
      }
      return { id: idMap.get(String(i.id))!, type: String(i.type), data };
    });
    const r = await api<{ world: { id: string } }>('worlds', { body: { title: w.title, summary: w.summary ?? '', color: w.color ?? '', meta: parse(w.meta), items } });
    worldMap[String(w.id)] = r.world.id;
    itemsByWorld[r.world.id] = items.map((i) => ({ id: i.id, type: i.type, ...(i.data as object) }) as WItem);
  }
  const nodeMap: Record<string, string> = {};
  const books = b.books.filter((x) => !x.deleted);
  for (const book of books) {
    onStep(`책 「${book.title}」 되살리는 중…`);
    const r = await api<{ book: { id: string } }>('books', {
      body: { title: book.title, subtitle: book.subtitle ?? '', author: book.author ?? '', color: book.color ?? '', kind: book.kind, notes: book.notes ?? '', meta: parse(book.meta), goal_chars: book.goal_chars ?? 0, deadline: book.deadline ?? null, world_id: book.world_id ? worldMap[String(book.world_id)] : null },
    });
    const nodes = b.nodes.filter((n) => n.book_id === book.id && !n.deleted) as unknown as { id: string; parent_id: string | null; sort: number; [k: string]: unknown }[];
    const drafts: DraftNode[] = flatten(nodes).map((n, i) => ({
      tmp: n.id,
      parent_tmp: n.parent_id ?? undefined,
      kind: n.kind as DraftNode['kind'],
      title: String(n.title ?? ''),
      body: String(n.body ?? ''),
      sort: i,
      synopsis: String(n.synopsis ?? ''),
      ...({ status: n.status ?? '', label: n.label ?? '', meta: parse(n.meta) } as object),
    }));
    Object.assign(nodeMap, await uploadNodes(r.book.id, drafts));
  }
  // 연표 사건이 가리키던 장을 새 장으로
  for (const [wid, items] of Object.entries(itemsByWorld)) {
    const events = items.filter((i) => i.type === 'event' && i.nodes?.length);
    if (!events.length) continue;
    await saveItems(
      wid,
      events.map((e) => ({ ...e, nodes: (e.type === 'event' ? e.nodes : []).map((n) => nodeMap[n]).filter(Boolean) }) as WItem),
    );
  }
  return { books: books.length, worlds: worlds.length, skippedImages };
}
