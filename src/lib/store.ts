// 책 자료 다루기: 서버 + 기기 사본(IndexedDB) + 아직 못 보낸 원고(drafts)
import { api } from './api';
import { idb } from './idb';
import type { DraftNode } from './split';
import type { Book, BookNode, ReadNode } from './types';
import { today } from './text';

export interface FullBook {
  book: Book;
  nodes: BookNode[];
  at: number;
}

/** 나무를 위에서부터 차례로 (부 → 장 → 장면) */
export function flatten<T extends { id: string; parent_id: string | null; sort: number }>(nodes: T[]): (T & { depth: number })[] {
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map<string | null, T[]>();
  for (const n of nodes) {
    const p = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(n);
  }
  for (const l of kids.values()) l.sort((a, b) => a.sort - b.sort);
  const out: (T & { depth: number })[] = [];
  const walk = (p: string | null, d: number) => {
    for (const n of kids.get(p) ?? []) {
      out.push({ ...n, depth: d });
      walk(n.id, d + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function toReadNodes(nodes: BookNode[]): ReadNode[] {
  return flatten(nodes.filter((n) => !n.deleted && n.kind !== 'note')).map((n) => ({ id: n.id, kind: n.kind, depth: n.depth, title: n.title, body: n.body ?? '' }));
}

/** 책 전체(본문 포함). 서버에서 받으면 기기에도 넣어 두고, 안 되면 기기 사본 */
export async function loadFull(id: string): Promise<{ data: FullBook; offline: boolean }> {
  try {
    const r = await api<{ book: Book; nodes: BookNode[] }>(`books/${id}/full`);
    const data = { ...r, at: Date.now() };
    // 아직 못 보낸 원고가 있으면 그걸 보여 준다
    for (const n of data.nodes) {
      const d = await idb.get<Draft>('drafts', n.id);
      if (d?.dirty) n.body = d.body;
    }
    void idb.set('books', id, data);
    return { data, offline: false };
  } catch (e) {
    const cached = await idb.get<FullBook>('books', id);
    if (cached) return { data: cached, offline: true };
    throw e;
  }
}

export interface Draft {
  id: string;
  book_id: string;
  body: string;
  base_rev: number;
  dirty: boolean;
  at: number;
}

type SaveListener = (s: { pending: number; error: string | null }) => void;
const listeners = new Set<SaveListener>();
let pending = 0;
let lastError: string | null = null;
const emit = () => listeners.forEach((l) => l({ pending, error: lastError }));
export const onSaveState = (fn: SaveListener) => {
  listeners.add(fn);
  fn({ pending, error: lastError });
  return () => {
    listeners.delete(fn);
  };
};

const inflight = new Map<string, Promise<unknown>>();

/** 원고 저장: 기기에 먼저, 그다음 서버. 서버가 「다른 기기에서 고친 글」을 기록으로 남겼으면 conflict=true */
export async function saveBody(nodeId: string, bookId: string, body: string, baseRev: number): Promise<{ rev: number; conflict: boolean } | null> {
  await idb.set('drafts', nodeId, { id: nodeId, book_id: bookId, body, base_rev: baseRev, dirty: true, at: Date.now() } satisfies Draft);
  return pushDraft(nodeId);
}

export async function pushDraft(nodeId: string): Promise<{ rev: number; conflict: boolean } | null> {
  const prev = inflight.get(nodeId);
  if (prev) await prev.catch(() => {});
  const d = await idb.get<Draft>('drafts', nodeId);
  if (!d?.dirty) return null;
  pending++;
  emit();
  const p = api<{ rev: number; conflict: boolean }>(`nodes/${nodeId}`, { method: 'PATCH', body: { body: d.body, base_rev: d.base_rev, day: today() } });
  inflight.set(nodeId, p);
  try {
    const r = await p;
    const now = await idb.get<Draft>('drafts', nodeId);
    // 보내는 동안 더 쓴 글이 없으면 지운다
    if (now && now.at === d.at) await idb.del('drafts', nodeId);
    else if (now) await idb.set('drafts', nodeId, { ...now, base_rev: r.rev });
    lastError = null;
    return r;
  } catch (e) {
    lastError = (e as Error).message;
    return null;
  } finally {
    inflight.delete(nodeId);
    pending--;
    emit();
  }
}

/** 못 보낸 원고 모두 다시 보내기 (인터넷이 돌아왔을 때) */
export async function flushDrafts() {
  for (const k of await idb.keys('drafts')) await pushDraft(k);
}
if (typeof window !== 'undefined') {
  addEventListener('online', () => void flushDrafts());
  setInterval(() => void flushDrafts(), 60_000);
}
export async function hasUnsaved(): Promise<number> {
  let n = 0;
  for (const k of await idb.keys('drafts')) if ((await idb.get<Draft>('drafts', k))?.dirty) n++;
  return n;
}

/** 나눈 글(DraftNode) 을 책으로 올린다. 한 번에 너무 크지 않게 나눠 보낸다 */
export async function uploadNodes(bookId: string, nodes: DraftNode[], onProgress?: (done: number, total: number) => void) {
  const map: Record<string, string> = {};
  let batch: DraftNode[] = [];
  let size = 0;
  let done = 0;
  const send = async () => {
    if (!batch.length) return;
    const items = batch.map((n) => ({ ...n, parent_id: n.parent_tmp ? map[n.parent_tmp] : undefined, parent_tmp: n.parent_tmp && !map[n.parent_tmp] ? n.parent_tmp : undefined }));
    const r = await api<{ map: Record<string, string> }>(`books/${bookId}/nodes`, { body: { items } });
    Object.assign(map, r.map);
    done += batch.length;
    onProgress?.(done, nodes.length);
    batch = [];
    size = 0;
  };
  for (const n of nodes) {
    if (size + n.body.length > 1_500_000 || batch.length >= 200) await send();
    batch.push(n);
    size += n.body.length;
  }
  await send();
  return map;
}

export async function createBookFrom(input: { title: string; author?: string; kind: 'write' | 'read'; nodes: DraftNode[]; notes?: string; meta?: Record<string, unknown>; color?: string }, onProgress?: (d: number, t: number) => void): Promise<Book> {
  const { book } = await api<{ book: Book }>('books', { body: { title: input.title, author: input.author ?? '', kind: input.kind, notes: input.notes ?? '', meta: input.meta ?? {}, color: input.color ?? '' } });
  await uploadNodes(book.id, input.nodes, onProgress);
  return book;
}
