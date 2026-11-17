// 리더: 쪽 넘김(넓으면 두 쪽 펼침) 또는 세로 스크롤. 글자 크기 · 줄 간격 · 글꼴 · 바탕은 기기마다 기억한다.
// 읽던 자리는 (장 id, 장 안 글자 위치)로 저장해서 화면 크기가 달라도 같은 곳이 열린다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { local } from '../../lib/idb';
import { buildBlocks, pageOf, paginate, type Page, type TocEntry } from '../../lib/paginate';
import type { ReadNode } from '../../lib/types';
import { Icon, promptBox, toast } from '../../lib/ui';
import { highlightRange, rangeOffsets } from '../../lib/anchor';
import { speak, speakSupported, stopSpeaking } from '../studio/StudioTools';

export interface ReaderPrefs {
  fs: number;
  lh: number;
  font: 'serif' | 'sans';
  theme: 'paper' | 'sepia' | 'dark';
  mode: 'page' | 'scroll';
  spread: 'auto' | 'one';
}
const DEFAULT: ReaderPrefs = { fs: 17, lh: 1.85, font: 'serif', theme: 'paper', mode: 'page', spread: 'auto' };
export const loadPrefs = (): ReaderPrefs => ({ ...DEFAULT, ...local.get<Partial<ReaderPrefs>>('reader', {}) });

interface Bookmark {
  id: string;
  key: string;
  node_id: string;
  pos: number;
  quote: string;
  note: string;
  at: number;
  kind?: 'mark' | 'line';
}

export interface Spot {
  n: string;
  o: number;
}

export function Reader({
  title,
  nodes,
  progressKey,
  start,
  onExit,
  extraButtons,
  forceMode,
  initialFind,
}: {
  title: string;
  nodes: ReadNode[];
  progressKey: string | null;
  start?: Spot | null;
  onExit: () => void;
  extraButtons?: React.ReactNode;
  forceMode?: 'page' | 'scroll';
  initialFind?: string;
}) {
  const [prefs, setPrefsState] = useState<ReaderPrefs>(loadPrefs);
  const setPrefs = (p: Partial<ReaderPrefs>) =>
    setPrefsState((old) => {
      const v = { ...old, ...p };
      local.set('reader', v);
      return v;
    });
  const mode = forceMode ?? prefs.mode;
  const [pop, setPop] = useState<'' | 'toc' | 'set' | 'marks' | 'find'>(initialFind ? 'find' : '');
  const [chrome, setChrome] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [idx, setIdx] = useState(0);
  const [n2, setN2] = useState(2);
  const spot = useRef<Spot | null>(start ?? null);
  const order = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const blocks = useMemo(() => buildBlocks(nodes), [nodes]);
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [find, setFind] = useState(initialFind ?? '');
  const [markTab, setMarkTab] = useState<'mark' | 'line'>('mark');
  const [selPop, setSelPop] = useState<{ x: number; y: number; n: string; pos: number; quote: string } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => stopSpeaking(), []);
  const lines = marks.filter((m) => m.kind === 'line');

  /** 고른 글 → (장 id, 장 안 위치, 글) */
  const readSelection = () => {
    setTimeout(() => {
      const s = getSelection();
      if (!s || s.isCollapsed || !s.rangeCount || !progressKey) return setSelPop(null);
      const r = s.getRangeAt(0);
      const start = (r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement)?.closest<HTMLElement>('[data-n]');
      if (!start) return setSelPop(null);
      const sub = document.createRange();
      sub.setStart(r.startContainer, r.startOffset);
      sub.setEnd(start.contains(r.endContainer) ? r.endContainer : start, start.contains(r.endContainer) ? r.endOffset : start.childNodes.length);
      const off = rangeOffsets(start, sub);
      const quote = String(s).trim();
      if (!off || !quote) return setSelPop(null);
      const rect = r.getBoundingClientRect();
      setSelPop({ x: rect.left + rect.width / 2, y: rect.top, n: start.dataset.n!, pos: Number(start.dataset.o ?? 0) + off.start, quote: quote.slice(0, 1000) });
    }, 10);
  };
  const addLine = async (withNote: boolean) => {
    if (!selPop || !progressKey) return;
    const note = withNote ? await promptBox('밑줄에 남길 메모', '', { multiline: true, ok: '남기기' }) : '';
    if (note == null) return;
    try {
      const r = await api<{ id: string }>('bookmarks', { body: { key: progressKey, node_id: selPop.n, pos: selPop.pos, quote: selPop.quote, note, kind: 'line' } });
      setMarks((m) => [{ id: r.id, key: progressKey, node_id: selPop.n, pos: selPop.pos, quote: selPop.quote, note, at: Date.now(), kind: 'line' }, ...m]);
      getSelection()?.removeAllRanges();
      setSelPop(null);
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  /** 화면에 보이는 덩어리 안에 밑줄 그리기 */
  const paintLines = (root: HTMLElement | null) => {
    if (!root) return;
    root.querySelectorAll('mark.line').forEach((m) => m.replaceWith(...m.childNodes));
    root.normalize();
    for (const l of lines) {
      for (const el of root.querySelectorAll<HTMLElement>(`[data-n="${l.node_id}"]`)) {
        const o = Number(el.dataset.o ?? 0);
        const len = (el.textContent ?? '').length;
        const a = l.pos - o;
        const b = a + l.quote.length;
        if (b <= 0 || a >= len) continue;
        highlightRange(el, Math.max(0, a), Math.min(len, b), { class: 'line', title: l.note || '밑줄' });
      }
    }
  };

  // 저장된 읽던 자리 (서버 → 없으면 기기)
  const [ready, setReady] = useState(!!start || !progressKey);
  useEffect(() => {
    if (start || !progressKey) return;
    const localSpot = local.get<(Spot & { at: number }) | null>(`prog:${progressKey}`, null);
    api<{ progress: Record<string, { n: string; o: number; at: number }> }>('progress')
      .then((r) => {
        const s = r.progress[progressKey];
        spot.current = s && (!localSpot || s.at >= localSpot.at) ? s : localSpot;
      })
      .catch(() => (spot.current = localSpot))
      .finally(() => setReady(true));
    api<{ bookmarks: Bookmark[] }>('bookmarks')
      .then((r) => setMarks(r.bookmarks.filter((b) => b.key === progressKey)))
      .catch(() => {});
  }, [progressKey, start]);

  const saveTimer = useRef<number>(0);
  const remember = useCallback(
    (s: Spot, done = false) => {
      spot.current = s;
      if (!progressKey) return;
      const total = order.length;
      const frac = done ? 1 : Math.max(0, order.indexOf(s.n)) / Math.max(1, total);
      const data = { n: s.n, o: s.o, f: Math.round(frac * 1000) / 1000 };
      const at = Date.now();
      local.set(`prog:${progressKey}`, { ...data, at });
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void api(`progress/${progressKey}`, { method: 'PUT', body: { data, at } }).catch(() => {}), 1500);
    },
    [progressKey, order],
  );

  // ---------- 쪽 넘김 ----------
  const layout = useCallback(() => {
    const st = stageRef.current;
    const meas = measureRef.current;
    if (!st || !meas) return;
    const availW = st.clientWidth - 24;
    const availH = st.clientHeight - 12;
    const n = prefs.spread === 'one' || availW < 760 ? 1 : 2;
    const ratio = 0.69;
    const w = Math.floor(Math.min(availW / n, availH * ratio, 560));
    const h = Math.floor(Math.min(w / ratio, availH));
    const root = rootRef.current!;
    root.style.setProperty('--pw', `${w}px`);
    root.style.setProperty('--ph', `${h}px`);
    meas.innerHTML = '<div class="r-page"><div class="run"></div><div class="r-body prose"></div><div class="folio"></div></div>';
    const body = meas.querySelector<HTMLElement>('.r-body')!;
    const r = paginate(body, blocks, { partPage: true, chapterBreak: true });
    meas.innerHTML = '';
    setN2(n);
    setPages(r.pages);
    setToc(r.toc);
    const s = spot.current;
    let i = s ? pageOf(r.pages, order, s.n, s.o) : 0;
    i -= i % n;
    setIdx(i);
  }, [blocks, order, prefs.spread]);

  useLayoutEffect(() => {
    if (mode !== 'page' || !ready) return;
    layout();
  }, [mode, ready, layout, prefs.fs, prefs.lh, prefs.font]);
  useEffect(() => {
    if (mode !== 'page') return;
    let t = 0;
    const on = () => {
      clearTimeout(t);
      t = window.setTimeout(layout, 160);
    };
    addEventListener('resize', on);
    document.fonts?.addEventListener?.('loadingdone', on);
    return () => {
      removeEventListener('resize', on);
      document.fonts?.removeEventListener?.('loadingdone', on);
    };
  }, [mode, layout]);
  useEffect(() => {
    if (mode !== 'page' || !pages.length) return;
    const p = pages[idx];
    if (p?.n) remember({ n: p.n, o: p.o }, idx + n2 >= pages.length);
  }, [idx, pages, mode, n2, remember]);

  const goPage = useCallback(
    (d: number) => {
      setIdx((i) => {
        const t = i + d * n2;
        if (t < 0 || t >= pages.length) return i;
        return t;
      });
    },
    [n2, pages.length],
  );

  // ---------- 세로 스크롤 ----------
  useLayoutEffect(() => {
    if (mode !== 'scroll' || !ready) return;
    const col = scrollRef.current?.querySelector<HTMLElement>('.col');
    if (!col) return;
    col.innerHTML = '';
    const tocs: TocEntry[] = [];
    let section: HTMLElement | null = null;
    for (const b of blocks) {
      if (b.dataset.toc != null || !section) {
        section = document.createElement('section');
        col.appendChild(section);
      }
      const c = b.cloneNode(true) as HTMLElement;
      if (b.dataset.toc != null) tocs.push({ t: b.textContent ?? '', lv: b.tagName === 'H1' ? 1 : 2, p: 0, n: b.dataset.n ?? '' });
      section.appendChild(c);
    }
    setToc(tocs);
    const s = spot.current;
    if (s) requestAnimationFrame(() => scrollToSpot(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ready, blocks]);

  const scrollToSpot = (s: Spot, flash = false) => {
    const sc = scrollRef.current;
    if (!sc) return;
    const els = [...sc.querySelectorAll<HTMLElement>(`[data-n="${s.n}"]`)];
    let target = els[0];
    for (const e of els) if (Number(e.dataset.o) <= s.o) target = e;
    if (target) {
      sc.scrollTop = target.offsetTop - 40;
      if (flash) {
        target.classList.add('fade-in');
        setTimeout(() => target.classList.remove('fade-in'), 600);
      }
    }
  };
  useEffect(() => {
    if (mode !== 'scroll') return;
    const sc = scrollRef.current;
    if (!sc) return;
    let t = 0;
    const on = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        const top = sc.scrollTop + 50;
        let best: HTMLElement | null = null;
        for (const e of sc.querySelectorAll<HTMLElement>('[data-n]')) {
          if (e.offsetTop > top) break;
          best = e;
        }
        if (best) remember({ n: best.dataset.n!, o: Number(best.dataset.o ?? 0) }, sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4);
      }, 300);
    };
    sc.addEventListener('scroll', on, { passive: true });
    return () => sc.removeEventListener('scroll', on);
  }, [mode, remember]);

  // ---------- 키 · 손가락 ----------
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,textarea')) return;
      if (e.key === 'Escape') {
        if (pop) setPop('');
        else onExit();
        return;
      }
      if (mode !== 'page') return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        goPage(1);
      }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        goPage(-1);
      }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [mode, goPage, pop, onExit]);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const jump = (s: Spot) => {
    spot.current = s;
    setPop('');
    if (mode === 'page') {
      let i = pageOf(pages, order, s.n, s.o);
      i -= i % n2;
      setIdx(i);
    } else scrollToSpot(s, true);
  };

  const here = (): Spot | null => spot.current;
  const addMark = async () => {
    const s = here();
    if (!s || !progressKey) return;
    const el = (mode === 'page' ? stageRef.current : scrollRef.current)?.querySelector<HTMLElement>(`[data-n="${s.n}"]`);
    const quote = (el?.textContent ?? '').slice(0, 80);
    try {
      const r = await api<{ id: string }>('bookmarks', { body: { key: progressKey, node_id: s.n, pos: s.o, quote, note: '' } });
      setMarks((m) => [{ id: r.id, key: progressKey, node_id: s.n, pos: s.o, quote, note: '', at: Date.now() }, ...m]);
      toast('책갈피를 꽂았어요');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  const findHits = useMemo(() => {
    const q = find.trim();
    if (q.length < 1) return [];
    const out: { s: Spot; text: string }[] = [];
    for (const b of blocks) {
      const t = b.textContent ?? '';
      for (let i = t.indexOf(q); i >= 0 && out.length < 200; i = t.indexOf(q, i + q.length)) {
        const a = Math.max(0, i - 24);
        out.push({ s: { n: b.dataset.n!, o: Number(b.dataset.o ?? 0) + i }, text: (a ? '…' : '') + t.slice(a, i + q.length + 30) });
      }
    }
    return out;
  }, [find, blocks]);

  const curToc = (() => {
    const s = spot.current;
    if (!s) return -1;
    let k = -1;
    toc.forEach((e, i) => {
      if (order.indexOf(e.n) <= order.indexOf(s.n)) k = i;
    });
    return k;
  })();

  useEffect(() => {
    paintLines(mode === 'page' ? stageRef.current : scrollRef.current);
  }); // 쪽이 바뀔 때마다 (React 가 쪽 내용을 새로 넣은 뒤)

  const pct = mode === 'page' && pages.length ? Math.round(((idx + n2) / pages.length) * 100) : null;

  return (
    <div
      ref={rootRef}
      className={`reader t-${prefs.theme}${prefs.font === 'sans' ? ' f-sans' : ''}${chrome ? '' : ' chrome-off'}`}
      style={{ ['--fs' as string]: `${prefs.fs}px`, ['--lh' as string]: String(prefs.lh) }}
    >
      <div className="r-bar">
        <button className="icon-btn" onClick={onExit} aria-label="닫기">
          <Icon name="back" />
        </button>
        <div className="name">{title}</div>
        {extraButtons}
        {speakSupported() && (
          <button
            className="icon-btn"
            aria-label={speaking ? '읽기 멈추기' : '소리 내어 읽기 (지금 자리부터 이 장 끝까지)'}
            title={speaking ? '읽기 멈추기' : '소리 내어 읽기'}
            aria-pressed={speaking}
            onClick={() => {
              if (speaking) {
                stopSpeaking();
                return setSpeaking(false);
              }
              const s = spot.current ?? { n: order[0], o: 0 };
              const text = blocks
                .filter((b) => b.dataset.n === s.n && Number(b.dataset.o ?? 0) + (b.textContent ?? '').length > s.o)
                .map((b) => b.textContent ?? '')
                .join('\n\n');
              setSpeaking(true);
              speak(text, () => setSpeaking(false));
            }}
          >
            <Icon name={speaking ? 'close' : 'sound'} />
          </button>
        )}
        <button className="icon-btn" aria-label="책 안에서 찾기" aria-pressed={pop === 'find'} onClick={() => setPop(pop === 'find' ? '' : 'find')}>
          <Icon name="search" />
        </button>
        {progressKey && (
          <button className="icon-btn" aria-label="책갈피" aria-pressed={pop === 'marks'} onClick={() => setPop(pop === 'marks' ? '' : 'marks')}>
            <Icon name="bookmark" />
          </button>
        )}
        {!!toc.length && (
          <button className="icon-btn" aria-label="목차" aria-pressed={pop === 'toc'} onClick={() => setPop(pop === 'toc' ? '' : 'toc')}>
            <Icon name="list" />
          </button>
        )}
        <button className="icon-btn" aria-label="보기 설정" aria-pressed={pop === 'set'} onClick={() => setPop(pop === 'set' ? '' : 'set')}>
          <Icon name="type" />
        </button>
      </div>

      {pop === 'toc' && (
        <div className="r-pop" role="dialog" aria-label="목차">
          {toc.map((e, k) => (
            <button key={k} className={`toc-item lv${e.lv}${k === curToc ? ' here' : ''}`} onClick={() => jump({ n: e.n, o: 0 })}>
              <span>{e.t}</span>
              {mode === 'page' && <span>{e.p + 1}</span>}
            </button>
          ))}
        </div>
      )}
      {pop === 'set' && (
        <div className="r-pop" role="dialog" aria-label="보기 설정">
          <div className="opt">
            글자 크기
            <div className="row">
              <button className="small" onClick={() => setPrefs({ fs: Math.max(12, prefs.fs - 1) })} aria-label="작게">
                가−
              </button>
              <span className="num" style={{ minWidth: 28, textAlign: 'center' }}>
                {prefs.fs}
              </span>
              <button className="small" onClick={() => setPrefs({ fs: Math.min(30, prefs.fs + 1) })} aria-label="크게">
                가+
              </button>
            </div>
          </div>
          <div className="opt">
            줄 간격
            <div className="seg">
              {[1.6, 1.85, 2.1].map((v) => (
                <button key={v} className={prefs.lh === v ? 'on' : ''} onClick={() => setPrefs({ lh: v })}>
                  {v === 1.6 ? '좁게' : v === 1.85 ? '보통' : '넓게'}
                </button>
              ))}
            </div>
          </div>
          <div className="opt">
            글꼴
            <div className="seg">
              <button className={prefs.font === 'serif' ? 'on' : ''} onClick={() => setPrefs({ font: 'serif' })}>
                명조
              </button>
              <button className={prefs.font === 'sans' ? 'on' : ''} onClick={() => setPrefs({ font: 'sans' })}>
                고딕
              </button>
            </div>
          </div>
          <div className="opt">
            바탕
            <div className="row">
              {(
                [
                  ['paper', '#fdfcf8', '흰 종이'],
                  ['sepia', '#f6efdf', '미색'],
                  ['dark', '#1f1e1b', '어둡게'],
                ] as const
              ).map(([k, c, l]) => (
                <button key={k} className={`swatch${prefs.theme === k ? ' on' : ''}`} style={{ background: c }} aria-label={l} title={l} onClick={() => setPrefs({ theme: k })} />
              ))}
            </div>
          </div>
          {!forceMode && (
            <div className="opt">
              넘기기
              <div className="seg">
                <button className={prefs.mode === 'page' ? 'on' : ''} onClick={() => setPrefs({ mode: 'page' })}>
                  쪽 넘김
                </button>
                <button className={prefs.mode === 'scroll' ? 'on' : ''} onClick={() => setPrefs({ mode: 'scroll' })}>
                  스크롤
                </button>
              </div>
            </div>
          )}
          {mode === 'page' && (
            <div className="opt">
              펼침
              <div className="seg">
                <button className={prefs.spread === 'auto' ? 'on' : ''} onClick={() => setPrefs({ spread: 'auto' })}>
                  넓으면 두 쪽
                </button>
                <button className={prefs.spread === 'one' ? 'on' : ''} onClick={() => setPrefs({ spread: 'one' })}>
                  한 쪽
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {pop === 'marks' && (
        <div className="r-pop" role="dialog" aria-label="책갈피 · 밑줄">
          <div className="pad row">
            <div className="seg">
              <button className={markTab === 'mark' ? 'on' : ''} onClick={() => setMarkTab('mark')}>
                책갈피
              </button>
              <button className={markTab === 'line' ? 'on' : ''} onClick={() => setMarkTab('line')}>
                밑줄 {lines.length || ''}
              </button>
            </div>
            {markTab === 'mark' && (
              <button className="small" onClick={addMark}>
                <Icon name="plus" size={14} />
                지금 자리
              </button>
            )}
          </div>
          {markTab === 'line' && !lines.length && <p className="pad tiny" style={{ color: 'var(--rmuted)' }}>글을 고르면 「밑줄」을 그을 수 있어요.</p>}
          {markTab === 'mark' && !marks.some((m) => m.kind !== 'line') && <p className="pad tiny" style={{ color: 'var(--rmuted)' }}>꽂은 책갈피가 없어요.</p>}
          {marks.filter((m) => (m.kind === 'line') === (markTab === 'line')).map((m) => (
            <div key={m.id} className="row" style={{ paddingRight: 8 }}>
              <button className="toc-item" onClick={() => jump({ n: m.node_id, o: m.pos })}>
                <span>
                  {m.kind === 'line' ? <span style={{ fontFamily: 'var(--serif)', fontSize: 13, borderLeft: '2px solid var(--mark-strong)', paddingLeft: 6, display: 'block' }}>{m.quote}</span> : m.quote || '책갈피'}
                  {m.note && <span style={{ display: 'block', fontSize: 12.5, marginTop: 4 }}>{m.note}</span>}
                </span>
              </button>
              {m.kind === 'line' && (
                <button
                  className="icon-btn"
                  aria-label="메모 고치기"
                  onClick={async () => {
                    const note = await promptBox('밑줄 메모', m.note, { multiline: true });
                    if (note == null) return;
                    await api(`bookmarks/${m.id}`, { method: 'PATCH', body: { note } }).catch(() => {});
                    setMarks((x) => x.map((y) => (y.id === m.id ? { ...y, note } : y)));
                  }}
                >
                  <Icon name="pen" size={14} />
                </button>
              )}
              <button
                className="icon-btn"
                aria-label="책갈피 빼기"
                onClick={async () => {
                  await api(`bookmarks/${m.id}`, { method: 'DELETE' }).catch(() => {});
                  setMarks((x) => x.filter((y) => y.id !== m.id));
                }}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {pop === 'find' && (
        <div className="r-pop" role="dialog" aria-label="책 안에서 찾기">
          <div className="pad">
            <input className="input" autoFocus placeholder="찾을 말" value={find} onChange={(e) => setFind(e.target.value)} />
          </div>
          {find && <p className="pad tiny" style={{ color: 'var(--rmuted)' }}>{findHits.length >= 200 ? '200곳 넘게' : `${findHits.length}곳`}</p>}
          {findHits.map((h, i) => (
            <button key={i} className="toc-item" onClick={() => jump(h.s)}>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 13 }}>{h.text}</span>
            </button>
          ))}
        </div>
      )}

      {selPop && (
        <div className="sel-pop" style={{ left: selPop.x, top: selPop.y }}>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => addLine(false)}>
            밑줄
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => addLine(true)}>
            메모와 함께
          </button>
        </div>
      )}
      {mode === 'page' ? (
        <>
          <div
            className="r-stage"
            ref={stageRef}
            onMouseUp={readSelection}
            onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
            onTouchEnd={(e) => {
              const t = touch.current;
              touch.current = null;
              if (!t) return;
              const dx = e.changedTouches[0].clientX - t.x;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.changedTouches[0].clientY - t.y)) goPage(dx < 0 ? 1 : -1);
              else readSelection();
            }}
          >
            <div className={`book ${n2 === 2 ? 'two' : 'one'} fade-in`} key={idx}>
              {Array.from({ length: n2 }, (_, j) => {
                const i = idx + j;
                const p = pages[i];
                return (
                  <div
                    key={j}
                    className={`r-page${p ? ' ' + p.cls : ' blank'}`}
                    onClick={(e) => {
                      if (String(getSelection()).length || (e.target as HTMLElement).closest('a')) return;
                      setPop('');
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const x = (e.clientX - r.left) / r.width;
                      if (n2 === 2) {
                        if ((j === 0 && x < 0.3) || (j === 1 && x > 0.7)) goPage(j === 0 ? -1 : 1);
                        else setChrome((c) => !c);
                      } else if (x < 0.3) goPage(-1);
                      else if (x > 0.7) goPage(1);
                      else setChrome((c) => !c);
                    }}
                  >
                    <div className="run">{p ? (n2 === 2 && j === 0 ? title : p.sec || title) : ''}</div>
                    <div className={`r-body prose${p?.cls.includes('chapter') ? ' chapter' : ''}`} dangerouslySetInnerHTML={{ __html: p?.html ?? '' }} />
                    <div className="folio">{p ? i + 1 : ''}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="r-foot">
            <button className="r-nav" onClick={() => goPage(-1)} disabled={idx === 0} aria-label="앞 쪽">
              ‹
            </button>
            <input type="range" min={0} max={Math.max(0, pages.length - 1)} step={n2} value={idx} onChange={(e) => setIdx(+e.target.value - (+e.target.value % n2))} aria-label="쪽 옮기기" />
            <button className="r-nav" onClick={() => goPage(1)} disabled={idx + n2 >= pages.length} aria-label="다음 쪽">
              ›
            </button>
            <span className="count">
              {pages.length ? `${idx + 1}${n2 > 1 && idx + 1 < pages.length ? `–${Math.min(idx + n2, pages.length)}` : ''} / ${pages.length}` : ''}
              {pct != null && ` · ${Math.min(100, pct)}%`}
            </span>
          </div>
          <div className="r-measure prose" ref={measureRef} aria-hidden="true" />
        </>
      ) : (
        <div className="r-scroll" ref={scrollRef} onClick={() => setPop('')} onMouseUp={readSelection} onTouchEnd={readSelection}>
          <div className="col prose" />
        </div>
      )}
    </div>
  );
}
