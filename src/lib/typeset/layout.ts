// 인쇄용 조판 2단계: 블록을 줄로 나누고(어절 단위, 양끝 맞춤, 금칙), 쪽에 앉힌다(안쪽/바깥 여백, 장은 오른쪽 쪽에서, 주석은 그 쪽 아래).
// 결과는 쪽마다 「어디에 무엇을 그릴지」 목록. 그리기(pdf)는 render.ts 가 한다. 단위는 pt (1mm = 72/25.4pt).
import { noteLabel, type NoteStyle } from '../footnotes';
import { splitChapterTitle } from '../bookStyle';
import type { Block, Run, Section } from './blocks';

export const MM = 72 / 25.4;
export type PageSize = 'A4' | 'A5' | 'sinkook' | 'B6';
/** 판형과 기본 여백(mm) · 본문 글자 크기(pt) */
export const SIZES: Record<PageSize, { label: string; w: number; h: number; top: number; bottom: number; inner: number; outer: number; pt: number }> = {
  sinkook: { label: '신국판 152×225mm (단행본에 흔함)', w: 152, h: 225, top: 21, bottom: 24, inner: 21, outer: 17, pt: 10 },
  A5: { label: 'A5 148×210mm', w: 148, h: 210, top: 20, bottom: 23, inner: 20, outer: 16, pt: 10 },
  B6: { label: 'B6 128×182mm (작은 책)', w: 128, h: 182, top: 17, bottom: 20, inner: 17, outer: 14, pt: 9.5 },
  A4: { label: 'A4 210×297mm', w: 210, h: 297, top: 25, bottom: 28, inner: 25, outer: 22, pt: 11 },
};
export const FONT_SCALE = { small: 0.92, normal: 1, large: 1.1 } as const;
export type FontSize = keyof typeof FONT_SCALE;

export interface PrintOptions {
  size: PageSize;
  font: FontSize;
  /** 장 · 부를 오른쪽(홀수) 쪽에서 시작 */
  rightStart: boolean;
  /** 머리글: 왼쪽 쪽에 책 제목, 오른쪽 쪽에 장 제목 */
  heads: boolean;
  noteStyle: NoteStyle;
  /** 전체 쪽수를 4의 배수로 (제본에 맞춰 빈 쪽을 판권면 앞에) */
  multipleOf4: boolean;
  /** 장 제목 서식 (없으면 가운데 · 글에 쓴 그대로 · 첫 문단 들여쓰기) */
  chapterAlign?: 'center' | 'left';
  /** low: 제목을 쪽 위에서 더 아래(약 3분의 1 지점)에서 시작 */
  chapterDrop?: 'normal' | 'low';
  /** 「1장 바람」 같은 제목에서 번호를 떼어 윗줄에 따로: plain = 1, je = 제1장 */
  chapterNumber?: 'asis' | 'plain' | 'je';
  firstIndent?: boolean;
  /** 줄 간격 (글자 크기의 몇 배, 기본 1.78) */
  leading?: number;
  /** 자간 (글자 크기의 몇 분의 일, 기본 0). 마이너스면 좁게 */
  tracking?: number;
  /** 따옴표 모양 통일 (기본: 쓴 그대로) */
  quotes?: 'keep' | 'curly' | 'corner';
  /** 대사(따옴표로 시작하는 문단): flush 는 들여쓰기 없이 시작 */
  dialogue?: 'indent' | 'flush';
  /** 쪽 번호 위치 · 모양 (기본: 바깥 아래, 숫자만) */
  pageNo?: 'outer' | 'center' | 'none';
  pageFmt?: 'plain' | 'dash' | 'dot';
  /** 앞붙이(목차 등)는 로마 숫자, 본문 첫 장부터 1 쪽 */
  romanFront?: boolean;
  title: string;
  subtitle?: string;
  author: string;
}

export { splitChapterTitle };

/** 글자 너비 (글자 크기 1 기준) */
export interface Metrics {
  /** hd: 제목 글꼴로 잴 때 */
  adv(ch: string, bold: boolean, hd?: boolean): number;
}

export type Item =
  | { k: 't'; x: number; y: number; text: string; size: number; bold?: boolean; hd?: boolean }
  | { k: 'img'; x: number; y: number; w: number; h: number; src: string }
  | { k: 'rule'; x: number; y: number; w: number; t: number };
export type PageKind = 'blank' | 'title' | 'front' | 'toc' | 'part' | 'chapter' | 'body' | 'colophon';
export interface Page {
  n: number;
  kind: PageKind;
  items: Item[];
  /** 머리글 글 (없으면 머리글 없음) */
  head?: string;
  folio: boolean;
  /** 이 쪽이 속한 장 · 부 */
  sec?: string;
  /** 글이 찬 정도 0~1 (주석 포함), 글이 쓴 줄 수 */
  fill?: number;
  lines?: number;
}
/** 인쇄 전에 살펴볼 곳 */
export interface Issue {
  type: 'short-end' | 'gap';
  id: string;
  title: string;
  page: number;
  /** short-end: 마지막 쪽에 남은 줄 수 · gap: 찬 비율(%) */
  value: number;
}
export interface Geo {
  W: number;
  H: number;
  top: number;
  bottom: number;
  inner: number;
  outer: number;
  textW: number;
  textH: number;
  size: number;
  lead: number;
  noteSize: number;
  noteLead: number;
}
export interface TocEntry {
  id: string;
  title: string;
  level: number;
  page: number;
}

export function geometry(o: Pick<PrintOptions, 'size' | 'font' | 'leading'>): Geo {
  const s = SIZES[o.size];
  const size = s.pt * FONT_SCALE[o.font];
  const g = { W: s.w * MM, H: s.h * MM, top: s.top * MM, bottom: s.bottom * MM, inner: s.inner * MM, outer: s.outer * MM, size, lead: size * (o.leading ?? 1.78), noteSize: size * 0.8, noteLead: size * 0.8 * 1.6 };
  return { ...g, textW: g.W - g.inner - g.outer, textH: g.H - g.top - g.bottom };
}

// ---------------------------------------------------------------- 줄 나누기
const CLOSERS = new Set([...'.,!?…)]}」』”’:;·~%〉》']);
const OPENERS = new Set([...'([{「『“‘〈《']);
const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;

interface Ch {
  c: string;
  bold: boolean;
  /** 이 글자 뒤에 붙는 주석들 */
  notes: string[];
}
interface Atom {
  chars: Ch[];
  br?: boolean;
  /** 맨 앞에 붙는 주석(드묾) */
  lead?: string[];
}
export interface Seg {
  x: number;
  text: string;
  bold: boolean;
  /** 주석 표시 자리 (표시 글자는 쪽에 앉힐 때 정한다) */
  note?: string;
}
export interface Line {
  segs: Seg[];
  notes: string[];
}

export class Measure {
  private cache = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  /** ls: 자간 (글자 크기 기준) — 모든 글자 너비에 더해진다 */
  constructor(private m: Metrics, private ls = 0) {}
  ch(c: string, bold: boolean, hd = false): number {
    const map = this.cache[(bold ? 1 : 0) + (hd ? 2 : 0)];
    let v = map.get(c);
    if (v == null) map.set(c, (v = this.m.adv(c, bold, hd) + this.ls));
    return v;
  }
  text(t: string, bold: boolean, size: number, hd = false): number {
    let w = 0;
    for (const c of t) w += this.ch(c, bold, hd);
    return w * size;
  }
}

function atomize(runs: Run[]): Atom[] {
  const out: Atom[] = [];
  let cur: Atom = { chars: [] };
  const flush = () => {
    if (cur.chars.length || cur.lead?.length) out.push(cur);
    cur = { chars: [] };
  };
  for (const r of runs) {
    if (r.br) {
      flush();
      out.push({ chars: [], br: true });
      continue;
    }
    if (r.note != null) {
      const last = cur.chars[cur.chars.length - 1];
      if (last) last.notes.push(r.note);
      else (cur.lead ??= []).push(r.note);
      continue;
    }
    for (const part of r.text.split(/( +)/)) {
      if (!part) continue;
      if (/^ +$/.test(part)) flush();
      else for (const c of part) cur.chars.push({ c, bold: !!r.bold, notes: [] });
    }
  }
  flush();
  return out;
}

/** 문단 하나를 줄로. 어절 단위로 나누고, 빈칸이 너무 벌어지면 어절 안(한글)에서 나눈다. 닫는 부호는 줄 앞에, 여는 부호는 줄 끝에 오지 않게 */
export function breakLines(runs: Run[], width: number, size: number, ms: Measure, opts: { indent?: number; justify?: boolean; center?: boolean; hd?: boolean } = {}): Line[] {
  const markW = ms.text('*', false, size * 0.6) + size * 0.04;
  const hd = !!opts.hd;
  const sp = ms.text(' ', false, size, hd);
  const cw = (ch: Ch) => ms.ch(ch.c, ch.bold, hd) * size + ch.notes.length * markW;
  const aw = (a: Atom) => a.chars.reduce((s, c) => s + cw(c), 0) + (a.lead?.length ?? 0) * markW;
  const lines: { atoms: Atom[]; w: number; avail: number; indent: number; justify: boolean }[] = [];
  const atoms = atomize(runs);
  let indent = opts.indent ?? 0;
  let cur = { atoms: [] as Atom[], w: 0, avail: width - indent, indent, justify: false };
  const push = (justify: boolean) => {
    lines.push({ ...cur, justify: justify && !!opts.justify });
    indent = 0;
    cur = { atoms: [], w: 0, avail: width, indent: 0, justify: false };
  };
  /** 앞에서 k 글자가 들어갈 수 있는 가장 큰 k (금칙 지킴). 없으면 0 */
  const fit = (a: Atom, room: number, force: boolean) => {
    let w = (a.lead?.length ?? 0) * markW;
    let best = 0;
    for (let i = 0; i < a.chars.length - 1; i++) {
      w += cw(a.chars[i]);
      if (w > room) break;
      const next = a.chars[i + 1].c;
      if (force || (!CLOSERS.has(next) && !OPENERS.has(a.chars[i].c))) best = i + 1;
    }
    return best;
  };
  const split = (a: Atom, k: number): [Atom, Atom] => [{ chars: a.chars.slice(0, k), lead: a.lead }, { chars: a.chars.slice(k) }];
  const queue = [...atoms];
  while (queue.length) {
    const a = queue.shift()!;
    if (a.br) {
      push(false);
      continue;
    }
    const w = aw(a);
    const gapBefore = cur.atoms.length ? sp : 0;
    if (cur.w + gapBefore + w <= cur.avail + 0.01) {
      cur.atoms.push(a);
      cur.w += gapBefore + w;
      continue;
    }
    const room = cur.avail - cur.w - gapBefore;
    const hangul = a.chars.length >= 2 && a.chars.some((c) => HANGUL.test(c.c));
    if (hangul && (cur.atoms.length === 0 || room / cur.avail > 0.1)) {
      const k = fit(a, room, false);
      if (k > 0) {
        const [p, r] = split(a, k);
        cur.atoms.push(p);
        cur.w += gapBefore + aw(p);
        push(true);
        queue.unshift(r);
        continue;
      }
    }
    if (!cur.atoms.length) {
      // 한 줄보다 긴 낱말: 어디서든 나눈다
      const k = Math.max(1, fit(a, room, true));
      if (k >= a.chars.length) {
        cur.atoms.push(a);
        cur.w += w;
        push(true);
        continue;
      }
      const [p, r] = split(a, k);
      cur.atoms.push(p);
      cur.w += aw(p);
      push(true);
      queue.unshift(r);
      continue;
    }
    push(true);
    queue.unshift(a);
  }
  if (cur.atoms.length) push(false);

  // 줄마다 글자 자리 정하기
  return lines.map((l) => {
    const natural = l.w;
    let gap = sp;
    let letter = 0;
    let x = l.indent;
    if (opts.center) x = (width - natural) / 2;
    else if (l.justify) {
      const extra = l.avail - natural;
      if (l.atoms.length > 1 && extra / (l.atoms.length - 1) < size * 2) gap = sp + extra / (l.atoms.length - 1);
      else if (l.atoms.length === 1) {
        const n = l.atoms[0].chars.length;
        if (n > 1 && extra / (n - 1) < size * 0.4) letter = extra / (n - 1);
      }
    }
    const segs: Seg[] = [];
    const notes: string[] = [];
    l.atoms.forEach((a, ai) => {
      if (ai > 0) x += gap;
      for (const n of a.lead ?? []) {
        segs.push({ x, text: '', bold: false, note: n });
        notes.push(n);
        x += markW;
      }
      let buf = '';
      let bx = x;
      let bb = a.chars[0]?.bold ?? false;
      const flushBuf = () => {
        if (buf) segs.push({ x: bx, text: buf, bold: bb });
        buf = '';
      };
      a.chars.forEach((c, ci) => {
        if (letter || c.bold !== bb) {
          flushBuf();
          bx = x;
          bb = c.bold;
        }
        if (!buf) bx = x;
        buf += c.c;
        x += ms.ch(c.c, c.bold, hd) * size;
        if (c.notes.length) {
          flushBuf();
          for (const n of c.notes) {
            segs.push({ x, text: '', bold: false, note: n });
            notes.push(n);
            x += markW;
          }
        }
        if (letter && ci < a.chars.length - 1) {
          flushBuf();
          x += letter;
        }
      });
      flushBuf();
    });
    return { segs, notes };
  });
}

// ---------------------------------------------------------------- 쪽에 앉히기
interface Cur {
  page: Page;
  x0: number;
  y: number;
  notes: { label: string; text: string }[];
  notesH: number;
  starCount: number;
}

export function layoutBook(sections: Section[], metrics: Metrics, o: PrintOptions, images: Map<string, { w: number; h: number }> = new Map()): { pages: Page[]; geo: Geo; toc: TocEntry[]; issues: Issue[] } {
  const g = geometry(o);
  const ms = new Measure(metrics, o.tracking ?? 0);
  const pages: Page[] = [];
  const toc: TocEntry[] = [];
  let cur: Cur | null = null;
  let head = '';
  let chapterNotes = 0;
  let secId = '';
  /** 부가 나온 뒤의 장은 목차에서 한 단 들여 쓴다 */
  let partSeen = false;
  /** 본문 첫 쪽(로마 숫자 앞붙이가 끝나는 곳) */
  let arabicFrom = 0;
  const baseline = (y: number, lead: number, size: number) => g.top + y + (lead + size * 0.72) / 2;

  const finishNotes = () => {
    if (cur) {
      cur.page.fill = Math.min(1, (cur.y + cur.notesH) / g.textH);
      cur.page.lines = Math.round(cur.y / g.lead);
    }
    if (!cur || !cur.notes.length) return;
    const c = cur;
    let y = g.textH - c.notesH;
    c.page.items.push({ k: 'rule', x: c.x0, y: g.top + y + g.noteLead * 0.3, w: g.textW * 0.28, t: 0.4 });
    y += g.noteLead * 0.9;
    for (const n of c.notes) {
      for (const l of noteLines(n.label, n.text)) {
        for (const s of l.segs) if (s.text) c.page.items.push({ k: 't', x: c.x0 + s.x, y: baseline(y, g.noteLead, g.noteSize), text: s.text, size: g.noteSize, bold: s.bold });
        y += g.noteLead;
      }
    }
    c.notes = [];
  };
  const newPage = (kind: PageKind, withHead = false): Cur => {
    finishNotes();
    const n = pages.length + 1;
    const recto = n % 2 === 1;
    const page: Page = { n, kind, sec: secId || undefined, items: [], folio: kind === 'body' || kind === 'chapter', head: withHead && o.heads ? (recto ? head : o.title) : undefined };
    pages.push(page);
    cur = { page, x0: recto ? g.inner : g.outer, y: 0, notes: [], notesH: 0, starCount: 0 };
    return cur;
  };
  /** 다음 쪽이 오른쪽(홀수) 쪽이 되게 빈 쪽을 넣는다 */
  const toRecto = () => {
    if (pages.length % 2 === 1) newPage('blank');
  };
  const noteLines = (label: string, text: string) => breakLines([{ text: `${label} ${text}` }], g.textW, g.noteSize, ms, { justify: true });
  const noteHeight = (label: string, text: string) => noteLines(label, text).length * g.noteLead;

  /** 이 줄을 이 쪽에 앉히면 늘어나는 주석 높이 (표시 글자까지) */
  const pendingNotes = (c: Cur, line: Line) => {
    let star = c.starCount;
    let num = chapterNotes;
    let h = 0;
    const labels: string[] = [];
    for (const n of line.notes) {
      const label = o.noteStyle === 'number' ? noteLabel(++num, 'number') : noteLabel(++star, 'star');
      labels.push(label);
      h += noteHeight(label, n);
    }
    if (line.notes.length && !c.notes.length) h += g.noteLead * 0.9;
    return { h, labels };
  };
  const room = (c: Cur) => g.textH - c.notesH;

  const drawLine = (c: Cur, line: Line, size: number, lead: number, bold = false, labels: string[] = [], hd = false) => {
    const by = baseline(c.y, lead, size);
    let li = 0;
    // 표시 자리는 별표 하나 너비로 잡아 두었다: 표시가 더 길면(**, 2 …) 뒤 글자를 그만큼 민다
    let shift = 0;
    const one = ms.text('*', false, size * 0.6);
    for (const s of line.segs) {
      if (s.note != null) {
        const label = labels[li++] ?? '*';
        c.page.items.push({ k: 't', x: c.x0 + s.x + shift, y: by - size * 0.38, text: label, size: size * 0.6 });
        shift += Math.max(0, ms.text(label, false, size * 0.6) - one);
        continue;
      }
      c.page.items.push({ k: 't', x: c.x0 + s.x + shift, y: by, text: s.text, size, bold: bold || s.bold, hd: hd || undefined });
    }
    line.notes.forEach((n, i) => {
      c.notes.push({ label: labels[i], text: n });
      if (o.noteStyle === 'number') chapterNotes++;
      else c.starCount++;
    });
    c.y += lead;
  };
  const bodyPage = () => newPage('body', true);

  /** 본문 줄들을 앉힌다: 쪽이 차면 새 쪽. 문단 첫 줄 하나만 쪽 끝에 남거나 마지막 줄 하나만 다음 쪽으로 넘어가지 않게 */
  const placeLines = (lines: Line[], size: number, lead: number) => {
    const n = lines.length;
    for (let i = 0; i < n; i++) {
      let c = cur ?? bodyPage();
      let p = pendingNotes(c, lines[i]);
      const fits = c.y + lead <= room(c) - p.h + 0.01;
      const nextFits = c.y + 2 * lead <= room(c) - p.h + 0.01;
      const orphan = i === 0 && n > 1 && fits && !nextFits && c.y > 0;
      const widow = i === n - 2 && n >= 3 && fits && !nextFits && c.y > 0;
      if (!fits || orphan || widow) {
        c = bodyPage();
        p = pendingNotes(c, lines[i]);
      }
      drawLine(c, lines[i], size, lead, false, p.labels);
      if (p.h) c.notesH += p.h;
    }
  };

  const centered = (c: Cur, text: string, size: number, bold: boolean, lead: number, hd = false) => {
    for (const l of breakLines([{ text, bold }], g.textW, size, ms, { center: true, hd })) drawLine(c, l, size, lead, bold, [], hd);
  };

  const placeBlocks = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.t === 'p') {
        const size = b.small ? g.size * 0.85 : g.size;
        const width = b.quote ? g.textW - g.size * 2 : g.textW;
        const lines = breakLines(b.runs, width, size, ms, { indent: b.indent && !(o.dialogue === 'flush' && b.dialogue) ? g.size : 0, justify: !b.center, center: b.center });
        if (b.quote) for (const l of lines) for (const s of l.segs) s.x += g.size * 2;
        placeLines(lines, size, b.small ? g.lead * 0.85 : g.lead);
      } else if (b.t === 'h') {
        let c = cur ?? bodyPage();
        if (c.y + g.lead * 3.5 > room(c)) c = bodyPage();
        if (c.y > 0) c.y += g.lead * 0.8;
        for (const l of breakLines([{ text: b.text, bold: true }], g.textW, g.size * 1.08, ms, { hd: true })) drawLine(c, l, g.size * 1.08, g.lead, true, [], true);
        c.y += g.lead * 0.4;
      } else if (b.t === 'scene') {
        let c = cur ?? bodyPage();
        if (c.y + g.lead * 2.5 > room(c)) c = bodyPage();
        c.y += g.lead * 0.4;
        const w = ms.text('◇', false, g.size * 0.8);
        c.page.items.push({ k: 't', x: c.x0 + (g.textW - w) / 2, y: baseline(c.y, g.lead, g.size), text: '◇', size: g.size * 0.8 });
        c.y += g.lead * 1.4;
      } else if (b.t === 'img') {
        const dim = images.get(b.src) ?? (b.w && b.h ? { w: b.w, h: b.h } : null);
        if (!dim) continue;
        // 인쇄에서 흐려지지 않게 200dpi 보다 크게 키우지 않는다
        let w = Math.min(g.textW, (dim.w / 200) * 72);
        let h = (w * dim.h) / dim.w;
        if (h > g.textH * 0.72) {
          h = g.textH * 0.72;
          w = (h * dim.w) / dim.h;
        }
        const capLines = b.alt ? breakLines([{ text: b.alt }], g.textW, g.noteSize, ms, { center: true }) : [];
        const need = h + capLines.length * g.noteLead + g.lead * 0.6;
        let c = cur ?? bodyPage();
        if (c.y + need > room(c)) c = bodyPage();
        if (c.y > 0) c.y += g.lead * 0.4;
        c.page.items.push({ k: 'img', x: c.x0 + (g.textW - w) / 2, y: g.top + c.y, w, h, src: b.src });
        c.y += h + g.noteLead * 0.4;
        for (const l of capLines) drawLine(c, l, g.noteSize, g.noteLead);
        c.y += g.lead * 0.4;
      }
    }
  };

  // ---- 표제지
  {
    const c = newPage('title');
    c.y = g.textH * 0.3;
    centered(c, o.title || '제목 없음', g.size * 2.1, true, g.size * 2.1 * 1.45, true);
    if (o.subtitle) {
      c.y += g.lead * 0.4;
      centered(c, o.subtitle, g.size * 1.1, false, g.lead, true);
    }
    if (o.author) {
      c.y = Math.max(c.y + g.lead * 2, g.textH * 0.62);
      centered(c, o.author, g.size * 1.1, false, g.lead);
    }
    newPage('blank');
  }

  const tocSlots: Page[] = [];
  const tocCount = sections.filter((s) => s.kind === 'part' || s.kind === 'chapter').length;
  for (const s of sections) {
    if (s.kind === 'title') continue;
    if (s.kind === 'dedication') {
      toRecto();
      const c = newPage('front');
      c.y = g.textH * 0.26;
      placeBlocks(s.blocks);
      cur = null;
      continue;
    }
    if (s.kind === 'toc') {
      if (!tocCount) continue;
      toRecto();
      const firstPer = Math.floor((g.textH * 0.86 - g.lead * 3) / (g.lead * 1.2));
      const per = Math.floor(g.textH / (g.lead * 1.2));
      const n = tocCount <= firstPer ? 1 : 1 + Math.ceil((tocCount - firstPer) / per);
      for (let i = 0; i < n; i++) tocSlots.push(newPage('toc').page);
      cur = null;
      continue;
    }
    if (s.kind === 'part') {
      if (o.rightStart || (o.romanFront && !arabicFrom)) toRecto();
      secId = s.id;
      partSeen = true;
      const c = newPage('part');
      if (!arabicFrom) arabicFrom = c.page.n;
      toc.push({ id: s.id, title: s.title, level: 0, page: c.page.n });
      c.y = g.textH * 0.36;
      centered(c, s.title, g.size * 1.6, true, g.size * 1.6 * 1.5, true);
      if (s.blocks.length) {
        c.y += g.lead;
        placeBlocks(s.blocks.map((b) => (b.t === 'p' ? { ...b, center: true, indent: false } : b)));
      }
      head = s.title;
      cur = null;
      continue;
    }
    if (s.kind === 'chapter') {
      if (o.rightStart || (o.romanFront && !arabicFrom)) toRecto();
      head = s.title;
      chapterNotes = 0;
      secId = s.id;
      const c = newPage('chapter');
      if (!arabicFrom) arabicFrom = c.page.n;
      const inPart = partSeen && !s.id.startsWith('m-');
      toc.push({ id: s.id, title: s.title || '제목 없음', level: inPart ? 1 : 0, page: c.page.n });
      c.y = g.textH * (o.chapterDrop === 'low' ? 0.3 : 0.18);
      if (s.title) {
        const left = o.chapterAlign === 'left';
        const line = (text: string, size: number, bold: boolean) => {
          for (const l of breakLines([{ text, bold }], g.textW, size, ms, { center: !left, hd: true })) drawLine(c, l, size, size * 1.5, bold, [], true);
        };
        const sp = o.chapterNumber && o.chapterNumber !== 'asis' ? splitChapterTitle(s.title) : null;
        if (sp) {
          line(o.chapterNumber === 'je' ? `제${sp.n}${sp.unit}` : String(sp.n), g.size * 1.15, false);
          if (sp.name) {
            c.y += g.lead * 0.3;
            line(sp.name, g.size * 1.45, true);
          }
        } else line(s.title, g.size * 1.45, true);
        if (left) {
          c.y += g.lead * 0.3;
          c.page.items.push({ k: 'rule', x: c.x0, y: g.top + c.y, w: g.size * 3, t: 0.5 });
        }
      }
      c.y += g.lead * 1.6;
      placeBlocks(o.firstIndent === false ? s.blocks.map((b, i) => (i === 0 && b.t === 'p' ? { ...b, indent: false } : b)) : s.blocks);
      continue;
    }
    if (s.kind === 'colophon') {
      // 판권면은 맨 뒤 왼쪽(짝수) 쪽. 4의 배수로 맞추면 빈 쪽을 그 앞에
      const total = pages.length + 1;
      const target = o.multipleOf4 ? Math.ceil(total / 4) * 4 : Math.ceil(total / 2) * 2;
      while (pages.length + 1 < target) newPage('blank');
      const c = newPage('colophon');
      c.y = g.textH * 0.6;
      c.page.items.push({ k: 'rule', x: c.x0, y: g.top + c.y, w: g.textW, t: 0.4 });
      c.y += g.lead * 0.6;
      placeBlocks(s.blocks);
      c.page.items.push({ k: 'rule', x: c.x0, y: g.top + c.y + g.lead * 0.2, w: g.textW, t: 0.4 });
      cur = null;
    }
  }
  finishNotes();
  if (o.multipleOf4 && !sections.some((s) => s.kind === 'colophon')) while (pages.length % 4) newPage('blank');
  finishNotes();

  // 쪽 번호로 보이는 값: 앞붙이를 로마 숫자로 따로 세면 본문 첫 쪽이 1
  const roman = (n: number) => {
    const t: [number, string][] = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let r = '';
    for (const [v, c] of t) while (n >= v) ((r += c), (n -= v));
    return r;
  };
  const shown = (n: number) => (o.romanFront && arabicFrom ? (n < arabicFrom ? roman(n) : String(n - arabicFrom + 1)) : String(n));
  for (const e of toc) e.page = o.romanFront && arabicFrom ? e.page - arabicFrom + 1 : e.page;

  // ---- 목차 채우기 (쪽수는 조판이 끝난 뒤에 알 수 있다)
  if (tocSlots.length) {
    let si = 0;
    let c: Cur = { page: tocSlots[0], x0: tocSlots[0].n % 2 ? g.inner : g.outer, y: g.textH * 0.06, notes: [], notesH: 0, starCount: 0 };
    centered(c, (sections.find((s) => s.kind === 'toc')?.title || '목차').trim(), g.size * 1.35, true, g.lead * 1.4);
    c.y += g.lead * 1.6;
    const dot = ms.text('· ', false, g.size);
    for (const e of toc) {
      if (c.y + g.lead * 1.2 > g.textH && si < tocSlots.length - 1) {
        si++;
        c = { page: tocSlots[si], x0: tocSlots[si].n % 2 ? g.inner : g.outer, y: 0, notes: [], notesH: 0, starCount: 0 };
      }
      const num = String(e.page);
      const numW = ms.text(num, false, g.size);
      const indent = e.level ? g.size * 1.5 : 0;
      const bold = e.level === 0 && toc.some((t) => t.level === 1);
      const maxW = g.textW - indent - numW - g.size * 3;
      let title = e.title;
      while (title.length > 1 && ms.text(title, bold, g.size) > maxW) title = title.slice(0, -2) + '…';
      const by = baseline(c.y, g.lead * 1.2, g.size);
      const tw = ms.text(title, bold, g.size);
      c.page.items.push({ k: 't', x: c.x0 + indent, y: by, text: title, size: g.size, bold });
      c.page.items.push({ k: 't', x: c.x0 + g.textW - numW, y: by, text: num, size: g.size });
      const from = indent + tw + g.size * 0.6;
      const to = g.textW - numW - g.size * 0.6;
      const count = Math.floor((to - from) / dot);
      if (count > 0) c.page.items.push({ k: 't', x: c.x0 + to - count * dot, y: by, text: '· '.repeat(count).trimEnd(), size: g.size });
      c.y += g.lead * 1.2;
    }
  }

  // ---- 머리글 · 쪽 번호
  const hs = g.size * 0.72;
  for (const p of pages) {
    const recto = p.n % 2 === 1;
    if (p.head) {
      const t = p.head.length > 40 ? p.head.slice(0, 39) + '…' : p.head;
      const w = ms.text(t, false, hs);
      p.items.push({ k: 't', x: recto ? g.W - g.outer - w : g.outer, y: g.top - 7.5 * MM, text: t, size: hs });
    }
    if ((p.folio || (o.romanFront && p.kind === 'toc')) && o.pageNo !== 'none') {
      const num = shown(p.n);
      const t = o.pageFmt === 'dash' ? `- ${num} -` : o.pageFmt === 'dot' ? `· ${num} ·` : num;
      const w = ms.text(t, false, hs);
      const x = o.pageNo === 'center' ? (recto ? g.inner : g.outer) + (g.textW - w) / 2 : recto ? g.W - g.outer - w : g.outer;
      p.items.push({ k: 't', x, y: g.H - g.bottom + 11 * MM, text: t, size: hs });
    }
  }

  // ---- 인쇄 전 점검: 장 끝에 몇 줄만 남은 쪽 · 글이 듬성한 쪽
  const issues: Issue[] = [];
  const titles = new Map(sections.map((x) => [x.id, x.title || '제목 없음']));
  const bySec = new Map<string, Page[]>();
  for (const p of pages) if (p.sec && (p.kind === 'chapter' || p.kind === 'body')) (bySec.get(p.sec) ?? bySec.set(p.sec, []).get(p.sec)!).push(p);
  for (const [id, ps] of bySec) {
    ps.forEach((p, i) => {
      const last = i === ps.length - 1;
      const shownNo = Number(shown(p.n)) || p.n;
      if (last && ps.length > 1 && (p.lines ?? 99) <= 3) issues.push({ type: 'short-end', id, title: titles.get(id) ?? '', page: shownNo, value: p.lines ?? 0 });
      else if (!last && (p.fill ?? 1) < 0.55) issues.push({ type: 'gap', id, title: titles.get(id) ?? '', page: shownNo, value: Math.round((p.fill ?? 0) * 100) });
    });
  }
  return { pages, geo: g, toc, issues };
}
