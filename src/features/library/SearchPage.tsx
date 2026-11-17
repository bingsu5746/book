// 서재 전체 찾기: 책 제목 · 지은이, 그리고 모든 책의 본문(내 책 · 들인 책 · 친구가 공유한 책)
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { go } from '../../lib/router';
import { Empty, Icon, Spinner } from '../../lib/ui';

interface Hit {
  where: 'mine' | 'shared';
  book_id: string;
  book_title: string;
  book_kind?: string;
  edition_id?: string;
  node_id: string;
  node_title: string;
  count: number;
  snippets: { at: number; text: string }[];
}

function Snip({ text, q }: { text: string; q: string }) {
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}
    </>
  );
}

export function SearchPage({ q: initial }: { q: string }) {
  const [q, setQ] = useState(initial);
  const [scope, setScope] = useState<'all' | 'write' | 'read'>('all');
  const [res, setRes] = useState<{ books: { id: string; title: string; author: string; kind: string }[]; hits: Hit[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (text = q) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setRes(await api(`search?q=${encodeURIComponent(text.trim())}&scope=${scope}`));
      history.replaceState(null, '', `#/search?q=${encodeURIComponent(text.trim())}`);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (initial) void run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  const groups = new Map<string, Hit[]>();
  for (const h of res?.hits ?? []) groups.set(h.book_id, [...(groups.get(h.book_id) ?? []), h]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>찾기</h1>
          <p className="sub">모든 책의 제목과 본문에서 찾아요. 들인 책, 내 원고, 친구가 공유한 책까지.</p>
        </div>
      </div>
      <form
        className="row wrap"
        style={{ marginBottom: 20 }}
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input className="input grow" style={{ minWidth: 220 }} autoFocus placeholder="찾을 말 (예: 꽃밭, 홍설)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {(
            [
              ['all', '전체'],
              ['write', '내 원고'],
              ['read', '들인 책'],
            ] as const
          ).map(([k, l]) => (
            <button type="button" key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>
              {l}
            </button>
          ))}
        </div>
        <button className="primary">
          <Icon name="search" size={16} />
          찾기
        </button>
      </form>
      {busy && <Spinner label="찾는 중" />}
      {res && !busy && !res.books.length && !res.hits.length && <Empty title="찾은 곳이 없어요" />}
      {!!res?.books.length && (
        <section className="section">
          <div className="section-head">
            <h2>책 제목 · 지은이</h2>
          </div>
          <div className="list">
            {res.books.map((b) => (
              <a key={b.id} className="list-item" href={`#/read/${b.id}`}>
                <Icon name="book" />
                <span className="grow serif">{b.title}</span>
                <span className="muted small">{b.author}</span>
              </a>
            ))}
          </div>
        </section>
      )}
      {[...groups].map(([bookId, hits]) => (
        <section key={bookId} className="section">
          <div className="section-head">
            <h2 style={{ textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--serif)', fontSize: 16, color: 'var(--text)' }}>{hits[0].book_title}</h2>
            <span className="count">
              {hits[0].where === 'shared' ? '친구의 책 · ' : hits[0].book_kind === 'read' ? '들인 책 · ' : '내 원고 · '}
              {hits.reduce((s, h) => s + h.count, 0)}곳
            </span>
          </div>
          <div className="list">
            {hits.map((h) => (
              <button
                key={h.node_id}
                className="list-item search-hit"
                style={{ display: 'block' }}
                onClick={() => {
                  if (h.where === 'shared') go(`edition/${h.edition_id}/${h.node_id}`);
                  else go(`read/${h.book_id}/${h.node_id}`);
                }}
              >
                <div className="row">
                  <b className="grow">{h.node_title || '제목 없는 장'}</b>
                  <span className="faint tiny">{h.count}곳</span>
                  {h.where === 'mine' && h.book_kind === 'write' && (
                    <span
                      className="chip"
                      role="link"
                      onClick={(e) => {
                        e.stopPropagation();
                        go(`write/${h.book_id}/${h.node_id}?find=${encodeURIComponent(q)}`);
                      }}
                    >
                      집필실에서
                    </span>
                  )}
                </div>
                {h.snippets.map((s, i) => (
                  <p key={i} className="snip">
                    <Snip text={s.text} q={q} />
                  </p>
                ))}
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
