// 세계관 자료 모양과 기본 서식
import { api } from './api';
import type { EntryRef } from '../features/studio/Editor';

export type EntryKind = 'character' | 'place' | 'faction' | 'item' | 'event' | 'concept' | 'species' | 'other';
export const KINDS: { id: EntryKind; label: string }[] = [
  { id: 'character', label: '인물' },
  { id: 'place', label: '장소' },
  { id: 'faction', label: '세력' },
  { id: 'item', label: '사물' },
  { id: 'event', label: '사건' },
  { id: 'concept', label: '개념 · 규칙' },
  { id: 'species', label: '종족' },
  { id: 'other', label: '기타' },
];
export const kindLabel = (k: string) => KINDS.find((x) => x.id === k)?.label ?? '기타';
export const DEFAULT_FIELDS: Record<EntryKind, string[]> = {
  character: ['나이', '외모', '성격', '말투', '바라는 것', '두려운 것', '비밀', '이야기 속 변화'],
  place: ['위치', '생김새', '분위기', '내력', '그곳의 규칙'],
  faction: ['목적', '우두머리', '구성원', '근거지', '다른 세력과의 관계'],
  item: ['생김새', '쓰임', '주인', '내력'],
  event: ['때', '곳', '관련 인물', '까닭', '결과'],
  concept: ['뜻', '규칙', '한계 · 대가', '예'],
  species: ['생김새', '수명', '사는 곳', '습성', '문화'],
  other: ['설명'],
};

export interface Entry {
  id: string;
  type: 'entry';
  kind: EntryKind;
  name: string;
  aliases: string[];
  summary: string;
  body: string;
  fields: Record<string, string>;
  tags: string[];
  color: string;
  /** 초상 · 대표 그림 (images 표의 id) */
  image?: string;
  updated?: number;
}
export interface Relation {
  id: string;
  type: 'relation';
  a: string;
  b: string;
  label: string;
  note: string;
  cat?: RelCat;
}
export type RelCat = 'family' | 'love' | 'friend' | 'enemy' | 'member' | 'other';
export const REL_CATS: { id: RelCat; label: string; color: string }[] = [
  { id: 'family', label: '가족', color: '#3f8a6c' },
  { id: 'love', label: '연인 · 애정', color: '#c2577a' },
  { id: 'friend', label: '친구 · 동료', color: '#4f6fa8' },
  { id: 'enemy', label: '적 · 갈등', color: '#c26b4a' },
  { id: 'member', label: '소속 · 위아래', color: '#8a5ca8' },
  { id: 'other', label: '기타', color: '#9a958a' },
];
export const relColor = (c?: string) => REL_CATS.find((x) => x.id === c)?.color ?? REL_CATS[5].color;
export interface Track {
  id: string;
  type: 'track';
  name: string;
  color: string;
  sort: number;
}
export interface WEvent {
  id: string;
  type: 'event';
  title: string;
  track: string;
  when: string;
  order: number;
  body: string;
  entries: string[];
  nodes: string[];
}
export interface Template {
  id: string;
  type: 'template';
  kind: EntryKind;
  fields: string[];
}
export interface MapPin {
  id: string;
  x: number;
  y: number;
  entry: string;
  label: string;
}
export interface MapItem {
  id: string;
  type: 'map';
  name: string;
  image: string;
  w: number;
  h: number;
  pins: MapPin[];
  note: string;
}
export type WItem = Entry | Relation | Track | WEvent | Template | MapItem;

export interface World {
  id: string;
  owner: string;
  title: string;
  summary: string;
  color: string;
  updated: number;
  deleted: number | null;
  entry_count?: number;
}
export interface WorldData {
  world: World;
  items: WItem[];
  books: { id: string; title: string }[];
  readonly: boolean;
}

export async function loadWorld(id: string): Promise<WorldData> {
  const r = await api<WorldData>(`worlds/${id}`);
  // 빈 칸 채우기 (예전 자료 · 손으로 만든 자료도 안전하게)
  r.items = r.items.map((i) => {
    const raw = i as unknown as Record<string, unknown>;
    if (i.type === 'entry') return { ...{ kind: 'other', name: '', aliases: [], summary: '', body: '', fields: {}, tags: [], color: '' }, ...raw } as unknown as Entry;
    if (i.type === 'map') return { ...{ name: '', image: '', w: 1, h: 1, pins: [], note: '' }, ...raw } as unknown as MapItem;
    if (i.type === 'event') return { ...{ title: '', track: '', when: '', order: 0, body: '', entries: [], nodes: [] }, ...raw } as unknown as WEvent;
    return i;
  });
  return r;
}

/** 저장: id 와 type 을 뺀 나머지가 data */
export async function saveItems(worldId: string, items: WItem[]) {
  return api<{ saved: string[] }>(`worlds/${worldId}/items`, { body: { items: items.map(({ id, type, ...data }) => ({ id, type, data })) } });
}
export async function deleteItems(worldId: string, ids: string[]) {
  return api(`worlds/${worldId}/items`, { body: { items: ids.map((id) => ({ id, deleted: true })) } });
}

export const entriesOf = (items: WItem[]) => items.filter((i): i is Entry => i.type === 'entry');
export const toRefs = (items: WItem[]): EntryRef[] => entriesOf(items).map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, type: kindLabel(e.kind), summary: e.summary, color: e.color }));
export function fieldsFor(items: WItem[], kind: EntryKind): string[] {
  const t = items.find((i): i is Template => i.type === 'template' && i.kind === kind);
  return t ? t.fields : DEFAULT_FIELDS[kind];
}
/** 글에 나오는 항목 (이름 · 다른 이름이 한 번이라도 나오면) */
export function mentionedIn(text: string, entries: Entry[]): { entry: Entry; count: number }[] {
  const out: { entry: Entry; count: number }[] = [];
  for (const e of entries) {
    let count = 0;
    for (const w of [e.name, ...e.aliases].map((x) => x.trim()).filter(Boolean)) for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + w.length)) count++;
    if (count) out.push({ entry: e, count });
  }
  return out.sort((a, b) => b.count - a.count);
}
export const newItemId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');
