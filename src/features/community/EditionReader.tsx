// 공유된 판 읽기 + 주석: 글을 고르면 「주석 달기」. 형광 표시를 누르면 그 주석으로. 장 끝마다 「좋아요」, 책마다 별점 · 한 줄 평.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { findAnchor, highlightRange, makeAnchor, rangeOffsets, type Anchor } from '../../lib/anchor';
import { local } from '../../lib/idb';
import { renderMd } from '../../lib/md';
import { go } from '../../lib/router';
import { useSession } from '../../lib/session';
import { ago, fmtDate } from '../../lib/text';
import type { ReadNode } from '../../lib/types';
import { confirmBox, Icon, Modal, Spinner, toast } from '../../lib/ui';
import { loadPrefs, Reader } from '../library/Reader';

interface Anno {
  id: string;
  edition_id: string;
  node_id: string;
  quote: string;
  prefix: string;
  suffix: string;
  pos: number;
  body: string;
  author: string;
  parent_id: string | null;
  resolved: number;
  created: number;
  updated: number;
  nickname: string | null;
  edition: number;
}
interface EditionData {
  edition: { id: string; number: number; note: string; created: number; title: string; author: string; book_id: string };
  book: { id: string; title: string; owner: string; owner_name: string; world_id: string | null; mine: boolean };
  nodes: (ReadNode & { sort: number })[];
  editions: { id: string; number: number; note: string; created: number }[];
  likes: { node_id: string; n: number; mine: number }[];
  ratings: { stars: number; text: string; updated: number; user_id: string; nickname: string }[];
  annotations: Anno[];
}

export function EditionReader({ editionId, nodeId, noteId }: { editionId: string; nodeId?: string; noteId?: string | null }) {
  const { user } = useSession();
  const [d, setD] = useState<EditionData | null>(null);
  const [err, setErr] = useState('');
  const [pane, setPane] = useState(!!noteId);
  const [active, setActive] = useState<string | null>(noteId ?? null);
  const [draft, setDraft] = useState<{ node: string; anchor: Anchor } | null>(null);
  const [sel, setSel] = useState<{ x: number; y: number; node: string; anchor: Anchor } | null>(null);
  const [scope, setScope] = useState<'all' | 'open'>('open');
  const [rating, setRating] = useState(false);
  const [pageMode, setPageMode] = useState(false);
  const prefs = loadPrefs();
  const col = useRef<HTMLDivElement>(null);
  const sc = useRef<HTMLDivElement>(null);

  const load = useCallback(
    () =>
      api<EditionData>(`editions/${editionId}`)
        .then(setD)
        .catch((e) => setErr((e as Error).message)),
    [editionId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const roots = useMemo(() => (d?.annotations ?? []).filter((a) => !a.parent_id), [d]);
  const visible = roots.filter((a) => scope === 'all' || !a.resolved);

  // 본문 그리기 + 형광 표시
  useLayoutEffect(() => {
    const c = col.current;
    if (!c || !d || pageMode) return;
    c.innerHTML = '';
    let lastKind = '';
    for (const n of d.nodes) {
      const sec = document.createElement('section');
      if (n.kind === 'part') {
        const h = document.createElement('h1');
        h.textContent = n.title;
        sec.appendChild(h);
      } else if (n.kind === 'chapter') {
        const h = document.createElement('h2');
        h.textContent = n.title;
        sec.appendChild(h);
      } else if (n.kind === 'scene' && lastKind === 'scene') {
        const p = document.createElement('p');
        p.className = 'scene';
        p.textContent = '*   *   *';
        sec.appendChild(p);
      }
      lastKind = n.kind;
      const body = document.createElement('div');
      body.className = 'nbody';
      body.dataset.node = n.id;
      body.innerHTML = renderMd(n.body);
      sec.appendChild(body);
      const text = body.textContent ?? '';
      for (const a of visible.filter((x) => x.node_id === n.id && x.quote)) {
        const r = findAnchor(text, a);
        if (r) highlightRange(body, r.start, r.end, { 'data-note': a.id, class: `${a.resolved ? 'resolved' : ''}${active === a.id ? ' on' : ''}` });
      }
      if (n.kind !== 'part' && n.body.trim()) {
        const like = d.likes.find((l) => l.node_id === n.id);
        const foot = document.createElement('div');
        foot.style.cssText = 'display:flex;justify-content:center;gap:8px;padding:1.2em 0 0;font-family:var(--sans);font-size:13px';
        const b = document.createElement('button');
        b.className = 'small';
        b.style.cssText = 'background:transparent;color:var(--rmuted);border-color:var(--rline)';
        b.textContent = `${like?.mine ? '♥' : '♡'} ${like?.n ?? 0}`;
        b.setAttribute('aria-label', '이 장 좋아요');
        b.onclick = async () => {
          await api('likes', { body: { edition_id: d.edition.id, node_id: n.id } }).catch(() => {});
          void load();
        };
        foot.appendChild(b);
        sec.appendChild(foot);
      }
      c.appendChild(sec);
    }
  }, [d, visible.length, scope, active, pageMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // 처음 열 때: 장 · 주석 자리로
  const jumped = useRef(false);
  useEffect(() => {
    if (!d || jumped.current || pageMode) return;
    jumped.current = true;
    requestAnimationFrame(() => {
      const s = sc.current;
      if (!s) return;
      if (noteId) {
        const m = s.querySelector<HTMLElement>(`mark[data-note="${noteId}"]`);
        if (m) return void (s.scrollTop = m.offsetTop - 120);
      }
      if (nodeId) {
        const el = s.querySelector<HTMLElement>(`[data-node="${nodeId}"]`);
        if (el) return void (s.scrollTop = (el.parentElement?.offsetTop ?? el.offsetTop) - 20);
      }
      const saved = local.get<{ n: string; o: number } | null>(`prog:e:${d.book.id}`, null);
      const el = saved && s.querySelector<HTMLElement>(`[data-node="${saved.n}"]`);
      if (el) s.scrollTop = (el.parentElement?.offsetTop ?? 0) + saved!.o;
    });
  }, [d, nodeId, noteId, pageMode]);

  // 읽던 자리 (장 + 장 안 스크롤 위치)
  useEffect(() => {
    const s = sc.current;
    if (!s || !d || pageMode) return;
    let t = 0;
    const on = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        let best: HTMLElement | null = null;
        for (const el of s.querySelectorAll<HTMLElement>('.nbody')) {
          if ((el.parentElement?.offsetTop ?? 0) > s.scrollTop + 60) break;
          best = el;
        }
        if (!best) return;
        const o = Math.max(0, Math.round(s.scrollTop - (best.parentElement?.offsetTop ?? 0)));
        const idx = d.nodes.findIndex((x) => x.id === best!.dataset.node);
        const data = { n: best.dataset.node!, o: 0, f: s.scrollTop + s.clientHeight >= s.scrollHeight - 4 ? 1 : Math.round((idx / d.nodes.length) * 1000) / 1000 };
        const at = Date.now();
        local.set(`prog:e:${d.book.id}`, { ...data, o, at });
        void api(`progress/e:${d.book.id}`, { method: 'PUT', body: { data, at } }).catch(() => {});
      }, 800);
    };
    s.addEventListener('scroll', on, { passive: true });
    return () => s.removeEventListener('scroll', on);
  }, [d, pageMode]);

  const onPointerUp = () => {
    setTimeout(() => {
      const s = getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) return setSel(null);
      const r = s.getRangeAt(0);
      const body = (r.commonAncestorContainer.nodeType === 1 ? (r.commonAncestorContainer as Element) : r.commonAncestorContainer.parentElement)?.closest<HTMLElement>('.nbody');
      if (!body) return setSel(null);
      const off = rangeOffsets(body, r);
      if (!off || off.end - off.start < 1) return setSel(null);
      const rect = r.getBoundingClientRect();
      setSel({ x: rect.left + rect.width / 2, y: rect.top, node: body.dataset.node!, anchor: makeAnchor(body.textContent ?? '', off.start, off.end) });
    }, 10);
  };

  if (err)
    return (
      <div className="main">
        <div className="error-box">{err}</div>
        <p style={{ marginTop: 12 }}>
          <a href="#/hall">열람실로</a>
        </p>
      </div>
    );
  if (!d)
    return (
      <div className="reader">
        <div style={{ margin: 'auto' }}>
          <Spinner />
        </div>
      </div>
    );

  if (pageMode)
    return (
      <Reader
        title={d.book.title}
        nodes={d.nodes}
        progressKey={`e:${d.book.id}`}
        forceMode="page"
        onExit={() => setPageMode(false)}
        extraButtons={
          <button className="icon-btn" aria-label="주석 보며 읽기" title="주석 보며 읽기" onClick={() => setPageMode(false)}>
            <Icon name="comment" />
          </button>
        }
      />
    );

  const myRating = d.ratings.find((r) => r.user_id === user.id);
  const avg = d.ratings.length ? d.ratings.reduce((s, r) => s + r.stars, 0) / d.ratings.length : 0;
  const isLatest = d.editions[0]?.id === d.edition.id;

  return (
    <div className={`reader t-${prefs.theme}${prefs.font === 'sans' ? ' f-sans' : ''}`} style={{ ['--fs' as string]: `${prefs.fs}px`, ['--lh' as string]: String(prefs.lh) }}>
      <div className="r-bar">
        <button className="icon-btn" onClick={() => (history.length > 1 ? history.back() : go('hall'))} aria-label="닫기">
          <Icon name="back" />
        </button>
        <div className="name">
          {d.book.title} <span style={{ color: 'var(--rmuted)', fontWeight: 400 }}>· {d.book.owner_name} · {d.edition.number}판</span>
        </div>
        {d.editions.length > 1 && (
          <select
            value={d.edition.id}
            onChange={(e) => go(`edition/${e.target.value}`)}
            aria-label="판 고르기"
            style={{ font: 'inherit', fontSize: 13, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--rline)', borderRadius: 6, padding: '4px 6px' }}
          >
            {d.editions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.number}판 · {fmtDate(e.created)}
              </option>
            ))}
          </select>
        )}
        {d.book.world_id && (
          <a className="icon-btn" href={`#/worlds/${d.book.world_id}`} aria-label="세계관 보기" title="세계관 보기">
            <Icon name="globe" />
          </a>
        )}
        {!d.book.mine && (
          <button className="icon-btn" aria-label="평가하기" title="평가하기" onClick={() => setRating(true)}>
            <Icon name="star" />
          </button>
        )}
        <button className="icon-btn" aria-label="쪽 넘김으로 읽기" title="쪽 넘김으로 읽기" onClick={() => setPageMode(true)}>
          <Icon name="book" />
        </button>
        <button className="icon-btn" aria-label="주석" aria-pressed={pane} onClick={() => setPane(!pane)}>
          <Icon name="comment" />
          {!!roots.filter((a) => !a.resolved).length && <span className="badge">{roots.filter((a) => !a.resolved).length}</span>}
        </button>
      </div>
      {!isLatest && (
        <div style={{ textAlign: 'center', fontSize: 13, padding: '4px 12px', color: 'var(--rmuted)' }}>
          지난 판이에요.{' '}
          <a href={`#/edition/${d.editions[0].id}`} style={{ color: 'var(--accent)' }}>
            최신 {d.editions[0].number}판 읽기
          </a>
        </div>
      )}
      <div className="r-scroll" ref={sc} style={{ paddingRight: pane && innerWidth > 1100 ? 380 : undefined }} onMouseUp={onPointerUp} onTouchEnd={onPointerUp} onClick={(e) => {
        const m = (e.target as HTMLElement).closest<HTMLElement>('mark[data-note]');
        if (m) {
          setActive(m.dataset.note!);
          setPane(true);
          setTimeout(() => document.getElementById(`note-${m.dataset.note}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
        }
      }}>
        <div className="col prose">
          <div style={{ textAlign: 'center', padding: '3em 0 2em' }}>
            <h1 style={{ textAlign: 'center', padding: 0 }}>{d.book.title}</h1>
            <p style={{ textIndent: 0, textAlign: 'center', color: 'var(--rmuted)', fontFamily: 'var(--sans)', fontSize: 14 }}>
              {d.edition.author || d.book.owner_name} · {d.edition.number}판 · {fmtDate(d.edition.created)}
            </p>
            {d.edition.note && <p style={{ textIndent: 0, textAlign: 'center', color: 'var(--rmuted)', fontFamily: 'var(--sans)', fontSize: 13, marginTop: 12, whiteSpace: 'pre-wrap' }}>작가의 말: {d.edition.note}</p>}
            {!!d.ratings.length && (
              <p style={{ textIndent: 0, textAlign: 'center', fontFamily: 'var(--sans)', fontSize: 13, marginTop: 8 }}>
                ★ {avg.toFixed(1)} · 평가 {d.ratings.length}개
              </p>
            )}
          </div>
          <div ref={col} />
          <div style={{ textAlign: 'center', padding: '3em 0', fontFamily: 'var(--sans)' }}>
            <p style={{ textIndent: 0, textAlign: 'center', color: 'var(--rmuted)' }}>끝</p>
            {!d.book.mine && (
              <button style={{ marginTop: 14, background: 'transparent', color: 'var(--ink)', borderColor: 'var(--rline)' }} onClick={() => setRating(true)}>
                <Icon name="star" size={16} />
                {myRating ? '내 평가 고치기' : '이 책 평가하기'}
              </button>
            )}
          </div>
        </div>
      </div>
      {sel && (
        <div className="sel-pop" style={{ left: sel.x, top: sel.y }}>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setDraft({ node: sel.node, anchor: sel.anchor });
              setPane(true);
              setSel(null);
            }}
          >
            <Icon name="comment" size={14} /> 주석 달기
          </button>
        </div>
      )}
      {pane && (
        <NotesPane
          d={d}
          roots={visible}
          scope={scope}
          setScope={setScope}
          active={active}
          setActive={(id) => {
            setActive(id);
            const m = sc.current?.querySelector<HTMLElement>(`mark[data-note="${id}"]`);
            if (m && sc.current) sc.current.scrollTop = m.offsetTop - 120;
          }}
          draft={draft}
          clearDraft={() => setDraft(null)}
          reload={load}
          onClose={() => setPane(false)}
          me={user.id}
        />
      )}
      {rating && <RatingBox d={d} me={user.id} onClose={() => setRating(false)} onSaved={load} />}
    </div>
  );
}

function NotesPane({
  d,
  roots,
  scope,
  setScope,
  active,
  setActive,
  draft,
  clearDraft,
  reload,
  onClose,
  me,
}: {
  d: EditionData;
  roots: Anno[];
  scope: 'all' | 'open';
  setScope: (s: 'all' | 'open') => void;
  active: string | null;
  setActive: (id: string) => void;
  draft: { node: string; anchor: Anchor } | null;
  clearDraft: () => void;
  reload: () => Promise<void>;
  onClose: () => void;
  me: string;
}) {
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Record<string, string>>({});
  const order = new Map(d.nodes.map((n, i) => [n.id, i]));
  const sorted = [...roots].sort((a, b) => (order.get(a.node_id) ?? 999) - (order.get(b.node_id) ?? 999) || a.pos - b.pos);
  const nodeTitle = (id: string) => d.nodes.find((n) => n.id === id)?.title ?? '';
  const missing = (a: Anno) => {
    const n = d.nodes.find((x) => x.id === a.node_id);
    if (!n || !a.quote) return !n;
    const div = document.createElement('div');
    div.innerHTML = renderMd(n.body);
    return !findAnchor(div.textContent ?? '', a);
  };
  const send = async (body: string, extra: Record<string, unknown>) => {
    try {
      await api('annotations', { body: { edition_id: d.edition.id, body, ...extra } });
      await reload();
      return true;
    } catch (e) {
      toast((e as Error).message, 'err');
      return false;
    }
  };
  return (
    <aside className="notes-pane" aria-label="주석">
      <div className="head">
        <b className="grow">주석 {roots.length}</b>
        <div className="seg">
          <button className={scope === 'open' ? 'on' : ''} onClick={() => setScope('open')}>
            남은 것
          </button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            모두
          </button>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="주석 닫기">
          <Icon name="close" />
        </button>
      </div>
      <div className="body">
        {draft && (
          <div className="note on">
            <div className="quote">{draft.anchor.quote}</div>
            <textarea className="input" rows={4} autoFocus placeholder="이 부분에 대한 생각을 남겨요" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
              <button className="small" onClick={clearDraft}>
                그만두기
              </button>
              <button
                className="small primary"
                disabled={!text.trim()}
                onClick={async () => {
                  if (await send(text, { node_id: draft.node, ...draft.anchor })) {
                    setText('');
                    clearDraft();
                  }
                }}
              >
                남기기
              </button>
            </div>
          </div>
        )}
        {!draft && !roots.length && <p className="small" style={{ color: 'var(--rmuted)' }}>본문에서 글을 고르면 그 자리에 주석을 달 수 있어요.</p>}
        {sorted.map((a) => {
          const replies = d.annotations.filter((r) => r.parent_id === a.id);
          const gone = missing(a);
          return (
            <div key={a.id} id={`note-${a.id}`} className={`note${active === a.id ? ' on' : ''}`} onClick={() => !gone && setActive(a.id)}>
              <div className="who" style={{ marginBottom: 4 }}>
                {nodeTitle(a.node_id)} {a.edition !== d.edition.number && `· ${a.edition}판에 단 주석`}
              </div>
              {a.quote && <div className="quote">{a.quote}</div>}
              {gone && <p className="tiny" style={{ color: 'var(--rmuted)' }}>이 판에서는 문장이 바뀌어 자리를 찾지 못했어요.</p>}
              <div className="who">
                <b>{a.nickname ?? '(떠난 사람)'}</b> · {ago(a.created)}
                {a.resolved ? ' · 작가가 반영함' : ''}
              </div>
              <div className="text">{a.body}</div>
              {!!replies.length && (
                <div className="replies">
                  {replies.map((r) => (
                    <div key={r.id}>
                      <div className="who">
                        <b>{r.nickname}</b> · {ago(r.created)}
                        {(r.author === me || d.book.mine) && (
                          <button
                            className="icon-btn"
                            style={{ padding: 2, marginLeft: 'auto' }}
                            aria-label="답글 지우기"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (await confirmBox('답글을 지울까요?', { danger: true, ok: '지우기' })) {
                                await api(`annotations/${r.id}`, { method: 'DELETE' });
                                void reload();
                              }
                            }}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        )}
                      </div>
                      <div className="text">{r.body}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="row" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                <input className="input" style={{ fontSize: 13, padding: '6px 8px', background: 'transparent', color: 'var(--ink)', borderColor: 'var(--rline)' }} placeholder="답글" value={reply[a.id] ?? ''} onChange={(e) => setReply({ ...reply, [a.id]: e.target.value })} />
                <button
                  className="small"
                  disabled={!reply[a.id]?.trim()}
                  onClick={async () => {
                    if (await send(reply[a.id], { node_id: a.node_id, parent_id: a.id })) setReply({ ...reply, [a.id]: '' });
                  }}
                >
                  답
                </button>
              </div>
              <div className="row" style={{ marginTop: 6, gap: 4 }} onClick={(e) => e.stopPropagation()}>
                {d.book.mine && (
                  <button
                    className="small"
                    onClick={async () => {
                      await api(`annotations/${a.id}`, { method: 'PATCH', body: { resolved: !a.resolved } });
                      void reload();
                    }}
                  >
                    <Icon name="check" size={12} />
                    {a.resolved ? '반영 취소' : '반영함'}
                  </button>
                )}
                {d.book.mine && (
                  <a className="btn small ghost" href={`#/write/${d.book.id}/${a.node_id}?find=${encodeURIComponent(a.quote.slice(0, 40))}`}>
                    원고에서
                  </a>
                )}
                {(a.author === me || d.book.mine) && (
                  <button
                    className="small ghost"
                    onClick={async () => {
                      if (!(await confirmBox('주석을 지울까요?', { danger: true, ok: '지우기', detail: '답글도 함께 지워져요.' }))) return;
                      await api(`annotations/${a.id}`, { method: 'DELETE' });
                      void reload();
                    }}
                  >
                    지우기
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function RatingBox({ d, me, onClose, onSaved }: { d: EditionData; me: string; onClose: () => void; onSaved: () => void }) {
  const mine = d.ratings.find((r) => r.user_id === me);
  const [stars, setStars] = useState(mine?.stars ?? 0);
  const [text, setText] = useState(mine?.text ?? '');
  return (
    <Modal
      title={`「${d.book.title}」 평가`}
      onClose={onClose}
      foot={
        <>
          {mine && (
            <button
              className="danger"
              onClick={async () => {
                await api(`books/${d.book.id}/rating`, { method: 'PUT', body: { stars: 0 } });
                onSaved();
                onClose();
              }}
            >
              평가 지우기
            </button>
          )}
          <span className="grow" />
          <button onClick={onClose}>닫기</button>
          <button
            className="primary"
            disabled={!stars}
            onClick={async () => {
              try {
                await api(`books/${d.book.id}/rating`, { method: 'PUT', body: { stars, text } });
                toast('평가를 남겼어요');
                onSaved();
                onClose();
              } catch (e) {
                toast((e as Error).message, 'err');
              }
            }}
          >
            남기기
          </button>
        </>
      }
    >
      <div className="row" role="radiogroup" aria-label="별점">
        {[1, 2, 3, 4, 5].map((s) => (
          <button key={s} className="icon-btn" role="radio" aria-checked={stars === s} aria-label={`${s}점`} onClick={() => setStars(s)} style={{ color: s <= stars ? '#c99a2e' : 'var(--line-strong)', fontSize: 26, padding: 2 }}>
            ★
          </button>
        ))}
      </div>
      <textarea className="input" rows={3} placeholder="한 줄 평 (300자까지)" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
      {d.ratings.filter((r) => r.user_id !== me).length > 0 && (
        <div className="list">
          {d.ratings
            .filter((r) => r.user_id !== me)
            .map((r) => (
              <div key={r.user_id} className="list-item small">
                <span style={{ color: '#c99a2e' }}>{'★'.repeat(r.stars)}</span>
                <span className="grow">{r.text}</span>
                <span className="faint tiny">{r.nickname}</span>
              </div>
            ))}
        </div>
      )}
    </Modal>
  );
}
