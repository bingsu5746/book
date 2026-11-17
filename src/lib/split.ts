// 긴 글 → 부 · 장 나무로 나누기 (들이기 · 기본 책 가져오기)
export interface DraftNode {
  tmp: string;
  parent_tmp?: string;
  kind: 'part' | 'chapter' | 'scene';
  title: string;
  body: string;
  sort: number;
  synopsis?: string;
}
export interface SplitResult {
  title: string;
  nodes: DraftNode[];
}

const MAX = 1_400_000;
const CHAPTER_LINE = /^\s*(?:제\s*\d+\s*[장화편]|\d+\s*[장화](?:\s|$)|chapter\s+[\divxlc]+\b|프롤로그|에필로그|prologue|epilogue|序章|終章|序|막간)(?:[\s.:\-—]+.{0,40})?\s*$/i;

/** 너무 긴 글은 문단 경계에서 잘라 여러 덩어리로 */
export function chunk(body: string, max = MAX): string[] {
  if (body.length <= max) return [body];
  const out: string[] = [];
  let rest = body;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest.trim()) out.push(rest);
  return out;
}

/**
 * 마크다운 제목(#)으로 나눈다.
 * - 맨 처음 # 제목 하나가 다른 # 들보다 앞에 있으면 책 제목으로 쓴다.
 * - 남은 제목 단계가 둘 이상이면 가장 높은 단계 = 부, 다음 단계 = 장. 하나면 장.
 * - 제목이 없으면 「제1장」 「프롤로그」 같은 줄로 나누고, 그것도 없으면 한 장(너무 길면 여러 장).
 */
export function splitMarkdown(md: string, fallbackTitle = ''): SplitResult {
  const text = md.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const lines = text.split('\n');
  let inFence = false;
  const heads: { i: number; level: number; title: string }[] = [];
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    if (inFence) return;
    const m = l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) heads.push({ i, level: m[1].length, title: m[2].replace(/[*_`]/g, '').trim() });
  });
  let title = fallbackTitle;
  let startHeads = heads;
  let bodyStart = 0;
  if (heads.length && heads[0].level === 1) {
    const ones = heads.filter((h) => h.level === 1);
    const textBefore = lines.slice(0, heads[0].i).join('').trim();
    if (!textBefore && (ones.length === 1 ? heads.length > 1 : true)) {
      title = heads[0].title;
      startHeads = heads.slice(1);
      bodyStart = heads[0].i + 1;
    }
  }
  const nodes: DraftNode[] = [];
  let n = 0;
  const tmp = () => `t${n++}`;
  const pushChapter = (t: string, body: string, parent?: string) => {
    const parts = chunk(body.trim());
    parts.forEach((p, k) => nodes.push({ tmp: tmp(), parent_tmp: parent, kind: 'chapter', title: parts.length > 1 ? `${t} (${k + 1})` : t, body: p, sort: nodes.length }));
  };

  if (startHeads.length) {
    const levels = [...new Set(startHeads.map((h) => h.level))].sort((a, b) => a - b);
    const partLevel = levels.length >= 2 ? levels[0] : -1;
    const chapterLevel = levels.length >= 2 ? levels[1] : levels[0];
    const intro = lines.slice(bodyStart, startHeads[0].i).join('\n').trim();
    if (intro) pushChapter('들어가며', intro);
    let part: string | undefined;
    const cuts = startHeads.filter((h) => h.level === partLevel || h.level === chapterLevel);
    cuts.forEach((h, k) => {
      const end = k + 1 < cuts.length ? cuts[k + 1].i : lines.length;
      const body = lines.slice(h.i + 1, end).join('\n');
      if (h.level === partLevel) {
        part = tmp();
        nodes.push({ tmp: part, kind: 'part', title: h.title, body: body.trim(), sort: nodes.length });
      } else pushChapter(h.title, body, part);
    });
  } else {
    const body = lines.slice(bodyStart);
    const marks = body.map((l, i) => (CHAPTER_LINE.test(l) && l.trim().length <= 50 ? i : -1)).filter((i) => i >= 0);
    if (marks.length >= 2) {
      const intro = body.slice(0, marks[0]).join('\n').trim();
      if (intro) pushChapter('들어가며', intro);
      marks.forEach((m, k) => pushChapter(body[m].trim(), body.slice(m + 1, k + 1 < marks.length ? marks[k + 1] : body.length).join('\n')));
    } else pushChapter(title || '본문', body.join('\n'));
  }
  return { title: title || '제목 없는 책', nodes: nodes.filter((x) => x.kind === 'part' || x.body.trim() || x.title) };
}
