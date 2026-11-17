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
import type { EntryRef } from '../studio/Editor';

export interface ReaderPrefs {
  fs: number;
  lh: number;
  font: 'serif' | 'sans';
  theme: 'paper' | 'sepia' | 'dark';
  mode: 'page' | 'scroll';
  spread: 'auto' | 'one';
  /** 쪽 넘김 효과: 종이처럼 넘기기 · 밀기 · 없음 */
  turn: 'curl' | 'slide' | 'none';
  /** 가만히 두면 위아래 막대 숨기기 */
  autoHide: boolean;
  /** 쪽 여백 */
  margin: 'narrow' | 'normal' | 'wide';
  /** 세계관 이름에 점선 · 누르면 요약 */
  links: boolean;
}
const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULT: ReaderPrefs = { fs: 17, lh: 1.85, font: 'serif', theme: 'paper', mode: 'page', spread: 'auto', turn: reduced ? 'none' : 'curl', autoHide: true, margin: 'normal', links: true };

export interface ReaderAction {
  label: string;
  icon: string;
  onClick?: () => void;
  href?: string;
}
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
  actions = [],
  entries,
  onFinish,
  forceMode,
  initialFind,
}: {
  title: string;
  nodes: ReadNode[];
  progressKey: string | null;
  start?: Spot | null;
  onExit: () => void;
  extraButtons?: React.ReactNode;
  /** ⋯ 메뉴에 더할 일 */
  actions?: ReaderAction[];
  /** 이 책의 세계관 항목 (있으면 이름을 누를 수 있다) */
  entries?: EntryRef[];
  /** 끝까지 읽었을 때 */
  onFinish?: () => void;
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
  const [pop, setPop] = useState<'' | 'toc' | 'set' | 'marks' | 'find' | 'more'>(initialFind ? 'find' : '');
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
  const showLinks = prefs.links && !!entries?.length;
  const blocks = useMemo(() => buildBlocks(nodes, { links: showLinks, names: showLinks ? entries!.flatMap((e) => [e.name, ...e.aliases]) : [] }), [nodes, showLinks, entries]);
  const [wl, setWl] = useState<{ x: number; y: number; e: EntryRef | null; name: string } | null>(null);
  const openLink = (t: HTMLElement) => {
    const el = t.closest<HTMLElement>('.wl');
    if (!el) return false;
    const name = el.dataset.entry ?? '';
    const r = el.getBoundingClientRect();
    setWl({ x: r.left + r.width / 2, y: r.bottom, name, e: entries?.find((x) => x.name === name || x.aliases.includes(name)) ?? null });
    return true;
  };
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
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const remember = useCallback(
    (s: Spot, done = false) => {
      spot.current = s;
      if (!progressKey) return;
      const total = order.length;
      const frac = done ? 1 : Math.max(0, order.indexOf(s.n)) / Math.max(1, total);
      const data = { n: s.n, o: s.o, f: Math.round(frac * 1000) / 1000 };
      if (done) onFinishRef.current?.();
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
  }, [mode, ready, layout, prefs.fs, prefs.lh, prefs.font, prefs.margin]);
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

  // ---------- 넘김 효과 ----------
  // flip: 넘어가는 중인 장(종이처럼 넘기기). p = 0(시작) ~ 1(다 넘김)
  const [flip, setFlip] = useState<{ dir: 1 | -1; to: number; p: number } | null>(null);
  const [slide, setSlide] = useState<0 | 1 | -1>(0);
  const anim = useRef(0);
  const animateFlip = useCallback((f: { dir: 1 | -1; to: number; p: number }, target: 0 | 1) => {
    cancelAnimationFrame(anim.current);
    const start = performance.now();
    const from = f.p;
    const dur = Math.max(160, 620 * Math.abs(target - from));
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const p = from + (target - from) * ease(t);
      if (t < 1) {
        setFlip({ ...f, p });
        anim.current = requestAnimationFrame(step);
      } else {
        if (target === 1) setIdx(f.to);
        setFlip(null);
      }
    };
    anim.current = requestAnimationFrame(step);
  }, []);
  const goPage = useCallback(
    (d: number) => {
      const base = flip && flip.p > 0 ? flip.to : idx;
      if (flip) {
        cancelAnimationFrame(anim.current);
        setFlip(null);
        if (flip.p > 0) setIdx(flip.to);
      }
      const t = base + d * n2;
      if (t < 0 || t >= pages.length) return;
      if (mode !== 'page' || prefs.turn === 'none') return setIdx(t);
      if (prefs.turn === 'slide') {
        setSlide(d > 0 ? 1 : -1);
        return setIdx(t);
      }
      const f = { dir: (d > 0 ? 1 : -1) as 1 | -1, to: t, p: 0 };
      setFlip(f);
      animateFlip(f, 1);
    },
    [n2, pages.length, idx, flip, prefs.turn, mode, animateFlip],
  );
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  // 끌어서 넘기기 (손가락 · 마우스): 가로로 끌면 장이 손을 따라 넘어간다
  const drag = useRef<{ x: number; y: number; id: number; started: boolean; dir: 1 | -1; t: number; w: number } | null>(null);
  const dragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== 'page' || prefs.turn !== 'curl' || e.button > 0) return;
    const book = (e.currentTarget as HTMLElement).querySelector('.book')?.getBoundingClientRect();
    if (!book) return;
    // 마우스는 책 가장자리에서만 (가운데는 글 고르기)
    const edge = Math.min(e.clientX - book.left, book.right - e.clientX);
    if (e.pointerType === 'mouse' && edge > book.width * 0.16) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, started: false, dir: 1, t: performance.now(), w: book.width };
    dragged.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.started) {
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return;
      const dir = dx < 0 ? 1 : -1;
      const t = idx + dir * n2;
      if (t < 0 || t >= pages.length) return (drag.current = null);
      d.started = true;
      d.dir = dir;
      dragged.current = true;
      getSelection()?.removeAllRanges();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const p = Math.max(0, Math.min(1, (d.dir === 1 ? -dx : dx) / (d.w * (n2 === 2 ? 0.55 : 0.85))));
    cancelAnimationFrame(anim.current);
    setFlip({ dir: d.dir, to: idx + d.dir * n2, p });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.started || !flip) return;
    const fast = Math.abs(e.clientX - d.x) / (performance.now() - d.t) > 0.5;
    animateFlip(flip, flip.p > 0.3 || fast ? 1 : 0);
  };

  // 가만히 두면 위아래 막대를 숨긴다 (쪽 넘김에서)
  const idle = useRef(0);
  const poke = useCallback(() => {
    clearTimeout(idle.current);
    if (!prefs.autoHide || mode !== 'page') return;
    idle.current = window.setTimeout(() => setChrome(false), 3500);
  }, [prefs.autoHide, mode]);
  useEffect(() => {
    if (pop) {
      clearTimeout(idle.current);
      setChrome(true);
    } else poke();
    return () => clearTimeout(idle.current);
  }, [pop, poke]);

  // 읽은 시간: 30초마다, 화면이 보이고 3분 안에 넘기거나 움직였으면 30초를 더한다 (2분마다 서버로)
  const lastAct = useRef(Date.now());
  useEffect(() => {
    lastAct.current = Date.now();
  }, [idx, pop]);
  useEffect(() => {
    let buf = 0;
    const act = () => (lastAct.current = Date.now());
    const flushRead = () => {
      if (!buf) return;
      const secs = buf;
      buf = 0;
      void api('stats/read', { body: { day: new Date().toLocaleDateString('sv-SE'), secs } }).catch(() => {});
    };
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastAct.current < 180_000) buf += 30;
    }, 30_000);
    const flush = setInterval(flushRead, 120_000);
    addEventListener('keydown', act);
    addEventListener('pointerdown', act);
    addEventListener('wheel', act, { passive: true });
    return () => {
      clearInterval(tick);
      clearInterval(flush);
      removeEventListener('keydown', act);
      removeEventListener('pointerdown', act);
      removeEventListener('wheel', act);
      flushRead();
    };
  }, []);

  // 읽는 동안 화면이 꺼지지 않게 (지원하는 기기에서)
  useEffect(() => {
    type Lock = { release: () => Promise<void> };
    let lock: Lock | null = null;
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<Lock> } }).wakeLock;
    const get = () => {
      if (wl && document.visibilityState === 'visible') wl.request('screen').then((l) => (lock = l)).catch(() => {});
    };
    get();
    document.addEventListener('visibilitychange', get);
    return () => {
      document.removeEventListener('visibilitychange', get);
      void lock?.release().catch(() => {});
    };
  }, []);

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
    if (flip) return;
    paintLines(mode === 'page' ? stageRef.current : scrollRef.current);
  }); // 쪽이 바뀔 때마다 (React 가 쪽 내용을 새로 넣은 뒤)

  const face = (i: number, side: 'L' | 'R' | 'S', key?: string) => {
    const p = pages[i];
    return (
      <div key={key} className={`r-page ${side}${p ? ' ' + p.cls : ' blank'}`}>
        <div className="run">{p ? (n2 === 2 && side === 'L' ? title : p.sec || title) : ''}</div>
        <div className={`r-body prose${p?.cls.includes('chapter') ? ' chapter' : ''}`} dangerouslySetInnerHTML={{ __html: p?.html ?? '' }} />
        <div className="folio">{p ? i + 1 : ''}</div>
      </div>
    );
  };
  const onPageClick = (e: React.MouseEvent, j: number) => {
    if (dragged.current) return (dragged.current = false);
    if (openLink(e.target as HTMLElement)) return;
    if (wl) return setWl(null);
    if (String(getSelection()).length || (e.target as HTMLElement).closest('a')) return;
    if (pop) return setPop('');
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (n2 === 2) {
      if ((j === 0 && x < 0.3) || (j === 1 && x > 0.7)) goPage(j === 0 ? -1 : 1);
      else setChrome((c) => !c);
    } else if (x < 0.3) goPage(-1);
    else if (x > 0.7) goPage(1);
    else setChrome((c) => !c);
  };
  const speakNow = () => {
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
  };

  const pct = mode === 'page' && pages.length ? Math.round(((idx + n2) / pages.length) * 100) : null;

  return (
    <div
      ref={rootRef}
      className={`reader t-${prefs.theme}${prefs.font === 'sans' ? ' f-sans' : ''}${chrome ? '' : ' chrome-off'} m-${prefs.margin}`}
      style={{ ['--fs' as string]: `${prefs.fs}px`, ['--lh' as string]: String(prefs.lh) }}
    >
      <div className="r-bar" onPointerMove={poke}>
        <button className="icon-btn" onClick={onExit} aria-label="닫기">
          <Icon name="back" />
        </button>
        <div className="name">{title}</div>
        {speaking && (
          <button className="icon-btn" aria-label="읽기 멈추기" aria-pressed onClick={speakNow}>
            <Icon name="sound" />
          </button>
        )}
        {extraButtons}
        {!!toc.length && (
          <button className="icon-btn" aria-label="목차" aria-pressed={pop === 'toc'} onClick={() => setPop(pop === 'toc' ? '' : 'toc')}>
            <Icon name="list" />
          </button>
        )}
        <button className="icon-btn" aria-label="보기 설정" aria-pressed={pop === 'set'} onClick={() => setPop(pop === 'set' ? '' : 'set')}>
          <Icon name="type" />
        </button>
        <button className="icon-btn" aria-label="더 보기" aria-pressed={pop === 'more'} onClick={() => setPop(pop === 'more' ? '' : 'more')}>
          <Icon name="more" />
        </button>
      </div>

      {pop === 'more' && (
        <div className="r-pop" role="menu" aria-label="더 보기" style={{ width: 'min(260px, calc(100% - 24px))' }}>
          <button className="toc-item" role="menuitem" onClick={() => setPop('find')}>
            <span className="row">
              <Icon name="search" size={16} />책 안에서 찾기
            </span>
          </button>
          {progressKey && (
            <button className="toc-item" role="menuitem" onClick={() => setPop('marks')}>
              <span className="row">
                <Icon name="bookmark" size={16} />책갈피 · 밑줄 {marks.length ? <span style={{ color: 'var(--rmuted)' }}>{marks.length}</span> : null}
              </span>
            </button>
          )}
          {progressKey && (
            <button className="toc-item" role="menuitem" onClick={() => (setPop(''), void addMark())}>
              <span className="row">
                <Icon name="plus" size={16} />
                지금 자리에 책갈피
              </span>
            </button>
          )}
          {speakSupported() && (
            <button className="toc-item" role="menuitem" onClick={() => (setPop(''), speakNow())}>
              <span className="row">
                <Icon name="sound" size={16} />
                {speaking ? '읽기 멈추기' : '소리 내어 읽기'}
              </span>
            </button>
          )}
          {actions.map((a) =>
            a.href ? (
              <a key={a.label} className="toc-item" role="menuitem" href={a.href} style={{ textDecoration: 'none' }}>
                <span className="row">
                  <Icon name={a.icon} size={16} />
                  {a.label}
                </span>
              </a>
            ) : (
              <button key={a.label} className="toc-item" role="menuitem" onClick={() => (setPop(''), a.onClick?.())}>
                <span className="row">
                  <Icon name={a.icon} size={16} />
                  {a.label}
                </span>
              </button>
            ),
          )}
        </div>
      )}
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
          {!!entries?.length && (
            <div className="opt">
              세계관 이름
              <div className="seg">
                <button className={prefs.links ? 'on' : ''} onClick={() => setPrefs({ links: true })}>
                  누르면 요약
                </button>
                <button className={!prefs.links ? 'on' : ''} onClick={() => setPrefs({ links: false })}>
                  그냥 글
                </button>
              </div>
            </div>
          )}
          <div className="opt">
            여백
            <div className="seg">
              {(
                [
                  ['narrow', '좁게'],
                  ['normal', '보통'],
                  ['wide', '넓게'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={prefs.margin === k ? 'on' : ''} onClick={() => setPrefs({ margin: k })}>
                  {l}
                </button>
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
              넘김 효과
              <div className="seg">
                {(
                  [
                    ['curl', '종이처럼'],
                    ['slide', '밀기'],
                    ['none', '없음'],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} className={prefs.turn === k ? 'on' : ''} onClick={() => setPrefs({ turn: k })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mode === 'page' && (
            <div className="opt">
              막대 숨기기
              <div className="seg">
                <button className={prefs.autoHide ? 'on' : ''} onClick={() => setPrefs({ autoHide: true })}>
                  저절로
                </button>
                <button className={!prefs.autoHide ? 'on' : ''} onClick={() => setPrefs({ autoHide: false })}>
                  늘 보이기
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

      {wl && (
        <div className="wl-pop" style={{ left: Math.min(Math.max(wl.x, 150), innerWidth - 150), top: wl.y + 8 }} role="dialog" aria-label={wl.name}>
          <b>{wl.e?.name ?? wl.name}</b>
          {wl.e ? (
            <>
              <span className="tiny" style={{ color: 'var(--rmuted)' }}>{wl.e.type}</span>
              {wl.e.summary && <p>{wl.e.summary}</p>}
            </>
          ) : (
            <p className="tiny">세계관에 아직 없는 이름이에요.</p>
          )}
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
            onTouchEnd={() => !dragged.current && readSelection()}
            onPointerDown={onPointerDown}
            onPointerMove={(e) => {
              onPointerMove(e);
              if (e.pointerType === 'mouse') {
                const h = (e.currentTarget as HTMLElement).getBoundingClientRect();
                if (e.clientY - h.top < 40 || h.bottom - e.clientY < 40) setChrome(true);
                poke();
              }
            }}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {!flip ? (
              <div className={`book ${n2 === 2 ? 'two' : 'one'}${slide ? ` slide-${slide > 0 ? 'next' : 'prev'}` : ''}`} key={prefs.turn === 'slide' ? idx : 'book'} onAnimationEnd={() => setSlide(0)}>
                {Array.from({ length: n2 }, (_, j) => (
                  <div key={j} className="page-hit" onClick={(e) => onPageClick(e, j)}>
                    {face(idx + j, n2 === 2 ? (j === 0 ? 'L' : 'R') : 'S')}
                  </div>
                ))}
              </div>
            ) : (
              (() => {
                const { dir, to, p } = flip;
                const shade = Math.sin(p * Math.PI);
                const two = n2 === 2;
                // 아래에 깔린 쪽 (넘어가는 장 밑으로 보이는 것)
                const base = two ? (dir === 1 ? [face(idx, 'L', 'b0'), face(to + 1, 'R', 'b1')] : [face(to, 'L', 'b0'), face(idx + 1, 'R', 'b1')]) : [face(dir === 1 ? to : idx, 'S', 'b0')];
                // 넘어가는 장: 앞면 · 뒷면
                const front = two ? (dir === 1 ? face(idx + 1, 'R') : face(idx, 'L')) : dir === 1 ? face(idx, 'S') : face(to, 'S');
                const back = two ? (dir === 1 ? face(to, 'L') : face(to + 1, 'R')) : <div className="r-page S blank" />;
                const angle = two ? (dir === 1 ? -180 * p : 180 * p) : dir === 1 ? -115 * p : -115 * (1 - p);
                const side = two ? (dir === 1 ? 'right' : 'left') : 'single';
                return (
                  <div className={`book ${two ? 'two' : 'one'} flipping`} style={{ ['--shade' as string]: String(shade) }}>
                    {base}
                    <div className={`turn-shadow ${side}`} style={{ opacity: two ? shade * 0.9 : (dir === 1 ? p : 1 - p) * 0.6 }} />
                    <div className={`leaf ${side}`} style={{ transform: `rotateY(${angle}deg)` }}>
                      <div className="face front">{front}</div>
                      <div className="face back">{back}</div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
          <div className="r-foot" onPointerMove={poke}>
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
        <div className="r-scroll" ref={scrollRef} onClick={(e) => (openLink(e.target as HTMLElement) ? undefined : (setPop(''), setWl(null)))} onMouseUp={readSelection} onTouchEnd={readSelection}>
          <div className="col prose" />
        </div>
      )}
    </div>
  );
}
