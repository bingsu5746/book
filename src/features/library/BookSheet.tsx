// 서재에서 책을 누르면: 꽂힌 자리에서 표지가 빠져나와 크게 보이고, 아래에 소개 · 첫 문장 · 차례.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Cover } from '../../lib/BookCard';
import type { CoverStyle } from '../../lib/cover';
import { idb } from '../../lib/idb';
import { api } from '../../lib/api';
import { flatten, type FullBook } from '../../lib/store';
import { plain, fmtNum, ago } from '../../lib/text';
import { Icon } from '../../lib/ui';

export interface SheetBook {
  key: string;
  title: string;
  author: string;
  color?: string;
  seed: string;
  style?: CoverStyle;
  href: string;
  writeHref?: string;
  blurb?: string;
  blurbLabel?: string;
  facts: string[];
  progress?: { f?: number; at: number } | null;
  /** 첫 문장 · 차례를 찾을 곳: 내 책(b:id) 또는 친구 판(e:editionId) */
  source: { kind: 'book'; id: string } | { kind: 'edition'; id: string };
}

interface Peek {
  first: string;
  toc: { t: string; part: boolean }[];
  blurb?: string;
}

const reduce = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function firstSentence(bodies: string[]): string {
  for (const b of bodies) {
    const t = plain(b)
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 8);
    if (t) {
      const m = t.match(/^.{8,}?[.!?。…”"’]+(?=\s|$)/);
      return (m ? m[0] : t).slice(0, 220);
    }
  }
  return '';
}

async function peek(src: SheetBook['source']): Promise<Peek> {
  type N = { kind: string; title: string; body?: string; deleted?: number | null; sort?: number; depth?: number; parent_id?: string | null };
  let nodes: N[] = [];
  let blurb: string | undefined;
  if (src.kind === 'book') {
    const c = await idb.get<FullBook>('books', src.id);
    nodes = c ? flatten(c.nodes.filter((n) => !n.deleted)) : [];
  } else {
    let e = await idb.get<{ nodes: N[]; book?: { blurb?: string } }>('books', `e:${src.id}`);
    if (!e) e = await api<{ nodes: N[]; book?: { blurb?: string } }>(`editions/${src.id}`).catch(() => undefined);
    nodes = e?.nodes ?? [];
    blurb = e?.book?.blurb;
  }
  const text = nodes.filter((n) => n.kind !== 'note' && n.kind !== 'part');
  return { first: firstSentence(text.map((n) => n.body ?? '')), toc: nodes.filter((n) => (n.kind === 'chapter' || n.kind === 'part') && n.title).map((n) => ({ t: n.title, part: n.kind === 'part' })), blurb };
}

export function BookSheet({ book, from, onClose }: { book: SheetBook; from: HTMLElement | null; onClose: () => void }) {
  const coverRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLAnchorElement>(null);
  const [info, setInfo] = useState<Peek | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let live = true;
    void peek(book.source)
      .then((p) => live && setInfo(p))
      .catch(() => live && setInfo({ first: '', toc: [] }));
    return () => {
      live = false;
    };
  }, [book.source.kind, book.source.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 표지가 꽂힌 자리에서 살짝 들렸다가 가운데로 나온다
  const flyFrom = () => {
    const el = coverRef.current;
    const r0 = from?.getBoundingClientRect();
    if (!el || !r0 || !r0.width) return null;
    const r1 = el.getBoundingClientRect();
    const sx = r0.width / r1.width;
    const sy = r0.height / r1.height;
    const dx = r0.left - r1.left;
    const dy = r0.top - r1.top;
    return { start: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, lift: `translate(${dx}px, ${dy - 14}px) scale(${sx * 1.04}, ${sy * 1.04}) rotate(-2deg)` };
  };
  useLayoutEffect(() => {
    from?.classList.add('taken');
    const f = flyFrom();
    const el = coverRef.current;
    if (f && el && !reduce()) {
      el.style.transformOrigin = 'top left';
      el.animate(
        [
          { transform: f.start, boxShadow: '0 2px 6px rgba(0,0,0,.15)' },
          { transform: f.lift, boxShadow: '0 18px 30px rgba(0,0,0,.25)', offset: 0.28 },
          { transform: 'none', boxShadow: '0 30px 60px -20px rgba(0,0,0,.35)' },
        ],
        { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)' },
      );
      bodyRef.current?.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 260, easing: 'ease-out', fill: 'backwards' });
    }
    openRef.current?.focus({ preventScroll: true });
    return () => from?.classList.remove('taken');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (closing) return;
    setClosing(true);
    const f = flyFrom();
    const el = coverRef.current;
    if (!f || !el || reduce()) return onClose();
    bodyRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    el.animate([{ transform: 'none' }, { transform: f.lift, offset: 0.7 }, { transform: f.start }], { duration: 420, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).onfinish = onClose;
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  const f = book.progress?.f ?? 0;
  const reading = !!book.progress && f > 0 && f < 0.999;
  const blurb = book.blurb || info?.blurb;
  return (
    <div className={`sheet-back${closing ? ' closing' : ''}`} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`「${book.title}」`}>
        <button className="icon-btn sheet-x" aria-label="닫기" onClick={close}>
          <Icon name="close" size={18} />
        </button>
        <div className="sheet-cover" ref={coverRef}>
          <Cover title={book.title} color={book.color} seed={book.seed} author={book.author} style={book.style} />
        </div>
        <div className="sheet-body" ref={bodyRef}>
          <h2 className="serif">{book.title}</h2>
          <p className="muted">{book.author}</p>
          {!!book.facts.filter(Boolean).length && <p className="faint small sheet-facts">{book.facts.filter(Boolean).join(' · ')}</p>}
          {book.progress && (
            <div className="sheet-prog">
              <div className="meter">
                <i style={{ width: `${Math.min(100, f * 100)}%` }} />
              </div>
              <span className="faint tiny">
                {f >= 0.999 ? '다 읽음' : `${Math.round(f * 100)}% 읽음`} · {ago(book.progress.at)}
              </span>
            </div>
          )}
          <div className="sheet-actions">
            <a className="btn primary" href={book.href} ref={openRef}>
              <Icon name="book" size={16} />
              {reading ? '이어 읽기' : '펼치기'}
            </a>
            {book.writeHref && (
              <a className="btn ghost" href={book.writeHref}>
                <Icon name="pen" size={16} />
                집필실에서
              </a>
            )}
          </div>
          {blurb && (
            <section>
              <h3>{book.blurbLabel ?? '소개'}</h3>
              <p className="sheet-text">{blurb}</p>
            </section>
          )}
          {info?.first && (
            <section>
              <h3>첫 문장</h3>
              <blockquote className="serif">{info.first}</blockquote>
            </section>
          )}
          {!!info?.toc.length && (
            <section>
              <h3>차례 {info.toc.length > 1 && <span className="faint">· 장 {fmtNum(info.toc.filter((x) => !x.part).length)}</span>}</h3>
              <ul className="sheet-toc">
                {info.toc.slice(0, 14).map((x, i) => (
                  <li key={i} className={x.part ? 'part' : ''}>
                    {x.t}
                  </li>
                ))}
                {info.toc.length > 14 && <li className="faint">… 그리고 {info.toc.length - 14}개 더</li>}
              </ul>
            </section>
          )}
          {!info && <p className="faint small">책을 펼쳐 보는 중…</p>}
        </div>
      </div>
    </div>
  );
}
