// 인쇄용 조판 1단계: 원고(마크다운)를 문단 · 소제목 · 장면 나눔 · 그림 블록으로. 주석 표시는 그 자리에 붙인다.
import { extractNotes, NOTE_REF } from '../footnotes';
import { convertQuotes } from '../bookStyle';

export { convertQuotes };

export interface Run {
  text: string;
  bold?: boolean;
  /** 주석: 이 자리에 표시를 달고, 설명은 쪽 아래에 */
  note?: string;
  /** 줄 바꿈 (내가 쓴 책은 한 번 친 엔터도 줄을 바꾼다) */
  br?: boolean;
}
export type Block =
  | { t: 'p'; runs: Run[]; indent: boolean; quote?: boolean; center?: boolean; small?: boolean; dialogue?: boolean }
  | { t: 'h'; text: string }
  | { t: 'scene' }
  | { t: 'img'; src: string; alt: string; w: number; h: number };

export type SectionKind = 'title' | 'dedication' | 'toc' | 'part' | 'chapter' | 'colophon';
export interface Section {
  kind: SectionKind;
  id: string;
  title: string;
  blocks: Block[];
}

const IMG = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"(\d+)x(\d+)")?\)$/;

/** 문단 안 꾸밈: **굵게** · __굵게__ · *기울임*(인쇄에서는 보통 글자) · `코드` · 주석 표시 */
export function inlineRuns(text: string, notes: Map<string, string>, breaks: boolean): Run[] {
  const runs: Run[] = [];
  const push = (t: string, bold = false) => {
    if (!t) return;
    const parts = t.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) runs.push(breaks ? { text: '', br: true } : { text: ' ' });
      if (p) runs.push(bold ? { text: p, bold } : { text: p });
    });
  };
  const re = new RegExp(`\\*\\*([^*]+)\\*\\*|__([^_]+)__|${NOTE_REF.source}|\\*([^*\\s][^*]*)\\*|\`([^\`]+)\``, 'g');
  let last = 0;
  for (const m of text.matchAll(re)) {
    push(text.slice(last, m.index));
    if (m[1] ?? m[2]) push((m[1] ?? m[2])!, true);
    else if (m[3]) {
      const n = notes.get(m[3]);
      if (n) runs.push({ text: '', note: n });
      else push(m[0]);
    } else push((m[4] ?? m[5])!);
    last = m.index! + m[0].length;
  }
  push(text.slice(last));
  return runs;
}

export function mdBlocks(md: string, breaks: boolean): Block[] {
  const clean = md
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, '$2')
    .replace(/\[\[([^\]\n]+)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '');
  const { body, notes } = extractNotes(clean);
  const out: Block[] = [];
  let indent = true;
  for (const raw of body.split(/\n\s*\n/)) {
    const para = raw.replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
    if (!para.trim()) continue;
    const t = para.trim();
    if (/^([*\-_]\s*){3,}$/.test(t)) {
      out.push({ t: 'scene' });
      indent = false;
      continue;
    }
    const img = t.match(IMG);
    if (img) {
      out.push({ t: 'img', alt: img[1], src: img[2], w: Number(img[3] ?? 0), h: Number(img[4] ?? 0) });
      indent = false;
      continue;
    }
    const h = t.match(/^#{1,6}\s+(.+)$/);
    if (h && !t.includes('\n')) {
      out.push({ t: 'h', text: h[1].replace(/[*_`]/g, '') });
      indent = false;
      continue;
    }
    if (/^>\s?/.test(t)) {
      out.push({ t: 'p', runs: inlineRuns(t.replace(/^>\s?/gm, ''), notes, breaks), indent: false, quote: true });
      indent = false;
      continue;
    }
    const list = t.split('\n').every((l) => /^\s*([-*+]|\d+[.)])\s+/.test(l));
    if (list) {
      for (const l of t.split('\n')) out.push({ t: 'p', runs: inlineRuns(l.replace(/^\s*([-*+])\s+/, '· '), notes, false), indent: false });
      indent = true;
      continue;
    }
    const runs = inlineRuns(t, notes, breaks);
    out.push({ t: 'p', runs, indent, dialogue: /^[“"「『‘]/.test(runs.find((r) => r.text)?.text ?? '') });
    indent = true;
  }
  return out;
}

/** 칸(장 · 부 · 앞붙이)을 인쇄용 묶음으로. 앞붙이는 plain 글(헌사 · 판권면)을 받는다 */
export function toSections(nodes0: { id: string; kind: string; title: string; body: string }[], breaks: boolean, quotes?: 'keep' | 'curly' | 'corner'): Section[] {
  const nodes = quotes && quotes !== 'keep' ? nodes0.map((n) => ({ ...n, body: convertQuotes(n.body, quotes) })) : nodes0;
  const out: Section[] = [];
  let cur: Section | null = null;
  const lines = (s: string) =>
    s
      .split(/\n\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean);
  for (const n of nodes) {
    if (n.id === 'm-dedication') {
      out.push({ kind: 'dedication', id: n.id, title: '', blocks: lines(n.body).map((p) => ({ t: 'p', runs: inlineRuns(p, new Map(), true), indent: false, center: true })) });
      cur = null;
    } else if (n.id === 'm-toc') {
      out.push({ kind: 'toc', id: n.id, title: n.title || '목차', blocks: [] });
      cur = null;
    } else if (n.id === 'm-colophon') {
      out.push({ kind: 'colophon', id: n.id, title: '', blocks: lines(n.body).map((p) => ({ t: 'p', runs: inlineRuns(p, new Map(), true), indent: false, small: true })) });
      cur = null;
    } else if (n.kind === 'part') {
      out.push({ kind: 'part', id: n.id, title: n.title, blocks: mdBlocks(n.body, breaks) });
      cur = null;
    } else if (n.kind === 'chapter' || !cur) {
      cur = { kind: 'chapter', id: n.id, title: n.title, blocks: mdBlocks(n.body, breaks) };
      out.push(cur);
    } else {
      // 장면: 앞 장에 이어 붙이고 장면 나눔
      const b = mdBlocks(n.body, breaks);
      if (b.length) {
        if (cur.blocks.length) cur.blocks.push({ t: 'scene' });
        cur.blocks.push(...b);
      }
    }
  }
  return out;
}
