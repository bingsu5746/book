export interface User {
  id: string;
  username: string;
  nickname: string;
}
export type NodeKind = 'part' | 'chapter' | 'scene' | 'note';
export type Status = '' | 'idea' | 'draft' | 'revise' | 'done';
export interface BookMeta {
  source?: string;
  sourceUrl?: string;
  importedAt?: number;
  dailyGoal?: number;
  template?: string;
  coverStyle?: string;
  readStatus?: 'want' | 'reading' | 'done';
  readStars?: number;
  readNote?: string;
  finishedAt?: string;
  [k: string]: unknown;
}
export interface Book {
  id: string;
  owner: string;
  kind: 'write' | 'read';
  title: string;
  subtitle: string;
  author: string;
  color: string;
  world_id: string | null;
  goal_chars: number;
  deadline: string | null;
  notes: string;
  meta: BookMeta;
  shared: number;
  share_world: number;
  created: number;
  updated: number;
  deleted: number | null;
  total_chars?: number;
  node_count?: number;
  last_edition?: number | null;
}
export interface NodeMeta {
  pov?: string;
  place?: string;
  time?: string;
  tags?: string[];
  notes?: string;
  [k: string]: unknown;
}
export interface BookNode {
  id: string;
  book_id: string;
  parent_id: string | null;
  kind: NodeKind;
  sort: number;
  title: string;
  body?: string;
  synopsis: string;
  status: Status;
  label: string;
  meta: NodeMeta;
  chars: number;
  rev: number;
  updated: number;
  deleted: number | null;
}
/** 리더에 넣는 한 장 */
export interface ReadNode {
  id: string;
  kind: NodeKind;
  depth: number;
  title: string;
  body: string;
}
export const STATUS_LABEL: Record<Status, string> = { '': '정하지 않음', idea: '구상', draft: '초안', revise: '수정 중', done: '완성' };
export const KIND_LABEL: Record<NodeKind, string> = { part: '부', chapter: '장', scene: '장면', note: '메모' };
