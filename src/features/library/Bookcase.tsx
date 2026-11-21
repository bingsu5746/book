// 서재: 나무 책장(칸마다 책등)과 그 아래 책상(아직 쓰는 중인 원고 더미).
// 책등 · 원고를 누르면 서재가 「꺼내 보기」(BookSheet)를 연다 (a.spine · a.ms 의 href 로).
import type { ReactNode } from 'react';
import { coverOf } from '../../lib/colors';
import { fmtNum, ago } from '../../lib/text';

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export interface SpineBook {
  id: string;
  title: string;
  author: string;
  color?: string;
  chars?: number;
  href: string;
  /** 읽는 중이면 0~1 (책갈피 끈) */
  progress?: number | null;
  note?: string;
  /** 시리즈 이름 · 권 */
  series?: { name: string; no: number | null } | null;
}

export function Spine({ b }: { b: SpineBook }) {
  const [bg, fg] = coverOf(b.color, b.id);
  const h = hash(b.id);
  const height = 168 + (h % 5) * 11;
  const width = Math.round(Math.min(60, Math.max(30, 12 + Math.log10((b.chars ?? 0) + 10) * 8)));
  const reading = b.progress != null && b.progress > 0 && b.progress < 0.999;
  // 제목이 책등 높이에 한 줄로 들어가게 글자를 줄인다 (작은 글씨는 11px 까지, 넘치면 … )
  const len = Math.max(1, [...(b.title || '제목 없음')].length);
  const room = height - 32 - 22 - (b.author ? 50 : 0);
  const fs = Math.max(11, Math.min(15, Math.floor(room / len / 1.08)));
  return (
    <a
      className="spine"
      href={b.href}
      style={{ ['--c' as string]: bg, ['--t' as string]: fg, height, width }}
      title={`${b.title}${b.author ? ` · ${b.author}` : ''}${b.note ? ` · ${b.note}` : ''}${b.series ? ` · ${b.series.name}${b.series.no ? ` ${b.series.no}권` : ''}` : ''}`}
      aria-label={`${b.title}${b.author ? `, ${b.author}` : ''}${reading ? `, ${Math.round(b.progress! * 100)}% 읽음` : ''}`}
    >
      {b.series?.no ? (
        <span className="spine-no" aria-hidden="true">
          {b.series.no}
        </span>
      ) : (
        <span className="spine-band" aria-hidden="true" />
      )}
      <span className="spine-title" style={{ fontSize: fs }}>
        {b.title || '제목 없음'}
      </span>
      {b.author && <span className="spine-by">{b.author}</span>}
      {reading && <i className="ribbon" aria-hidden="true" />}
    </a>
  );
}

export function Shelf({ title, count, tools, children, empty }: { title: string; count: number; tools?: ReactNode; children: ReactNode; empty?: ReactNode }) {
  return (
    <section className="shelf" aria-label={title}>
      <div className="shelf-head">
        <h2>{title}</h2>
        {tools}
        <span className="count">{count}권</span>
      </div>
      <div className="shelf-row">
        {children}
        {!count && empty && <div className="shelf-empty">{empty}</div>}
      </div>
      <div className="plank" aria-hidden="true" />
    </section>
  );
}

export interface DeskBook {
  id: string;
  title: string;
  author: string;
  chars: number;
  chapters: number;
  updated: number;
  href: string;
  shared?: string;
  series?: string;
}

/** 원고 더미: 글이 많을수록 종이가 두껍게 쌓인다 */
export function Manuscript({ b }: { b: DeskBook }) {
  const h = hash(b.id);
  const layers = 1 + Math.min(6, Math.floor(b.chars / 15000));
  const shadow = Array.from({ length: layers }, (_, i) => `${(i + 1) * 1.5}px ${(i + 1) * 2}px 0 -0.5px var(--paper-${i % 2 ? 'b' : 'a'}), ${(i + 1) * 1.5}px ${(i + 1) * 2}px 0 0 var(--paper-edge)`).join(', ');
  return (
    <a className="ms" href={b.href} style={{ ['--tilt' as string]: `${((h % 7) - 3) * 0.6}deg`, boxShadow: `${shadow}, 0 ${6 + layers * 2}px 14px -6px var(--desk-shadow)` }} aria-label={`쓰는 중인 원고 ${b.title}, ${fmtNum(b.chars)}자`}>
      <span className="ms-title">{b.title || '제목 없음'}</span>
      {b.author && <span className="ms-by">{b.author}</span>}
      <span className="ms-meta">
        {b.chars ? `${fmtNum(b.chars)}자` : '빈 원고'}
        {b.chapters ? ` · ${b.chapters}장` : ''}
        <br />
        {ago(b.updated)} 고침{b.shared ? ` · ${b.shared}` : ''}
        {b.series && (
          <>
            <br />
            {b.series}
          </>
        )}
      </span>
    </a>
  );
}

export function Desk({ count, children }: { count: number; children: ReactNode }) {
  return (
    <section className="desk" aria-label="책상: 쓰는 중인 원고">
      <div className="desk-head">
        <h2>책상 · 쓰는 중</h2>
        <span className="count">원고 {count}개</span>
      </div>
      <div className="desk-top">{children}</div>
      <div className="desk-edge" aria-hidden="true" />
    </section>
  );
}
