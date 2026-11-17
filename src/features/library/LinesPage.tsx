// 밑줄 모음: 모든 책에서 그은 밑줄 · 메모를 책별로
import { useState } from 'react';
import { api } from '../../lib/api';
import { download } from '../../lib/exporters';
import { ago, today } from '../../lib/text';
import type { Book } from '../../lib/types';
import { Empty, Icon, Spinner, useAsync } from '../../lib/ui';

interface Line {
  id: string;
  key: string;
  node_id: string;
  pos: number;
  quote: string;
  note: string;
  at: number;
  kind: string;
}

export function LinesPage() {
  const [q, setQ] = useState('');
  const { data, loading, error } = useAsync(async () => {
    const [m, b, c] = await Promise.all([api<{ bookmarks: Line[] }>('bookmarks'), api<{ books: Book[] }>('books'), api<{ books: { id: string; title: string; edition_id: string; owner_name: string }[] }>('community')]);
    const titles = new Map<string, { title: string; href: (l: Line) => string }>();
    for (const x of b.books) titles.set(`b:${x.id}`, { title: x.title, href: (l) => `#/read/${x.id}/${l.node_id}?at=${l.pos}` });
    for (const x of c.books) titles.set(`e:${x.id}`, { title: `${x.title} (${x.owner_name})`, href: (l) => `#/edition/${x.edition_id}/${l.node_id}` });
    return { lines: m.bookmarks.filter((x) => x.kind === 'line'), titles };
  }, []);
  if (loading && !data) return <Spinner />;
  if (error) return <div className="error-box">{error}</div>;
  const { lines, titles } = data!;
  const shown = lines.filter((l) => !q || l.quote.includes(q) || l.note.includes(q));
  const groups = new Map<string, Line[]>();
  for (const l of shown) groups.set(l.key, [...(groups.get(l.key) ?? []), l]);
  const exportMd = () => {
    const out = ['# 밑줄 모음', ''];
    for (const [k, ls] of groups) {
      out.push(`## ${titles.get(k)?.title ?? '지운 책'}`, '');
      for (const l of ls) out.push(`> ${l.quote.replace(/\n/g, '\n> ')}`, '', ...(l.note ? [l.note, ''] : []));
    }
    download(`밑줄 모음 ${today()}.md`, out.join('\n'), 'text/markdown;charset=utf-8');
  };
  return (
    <>
      <div className="page-head">
        <div>
          <p className="tiny muted">
            <a href="#/library">서재</a>
          </p>
          <h1>밑줄 모음</h1>
          <p className="sub">읽다가 그은 밑줄과 메모를 책별로 모았어요. 리더에서 글을 고르면 「밑줄」이 생겨요.</p>
        </div>
        <div className="actions">
          <button onClick={exportMd} disabled={!lines.length}>
            <Icon name="download" size={16} />
            마크다운으로 받기
          </button>
        </div>
      </div>
      {!lines.length ? (
        <Empty title="아직 밑줄이 없어요">책을 읽다가 마음에 드는 문장을 손가락이나 마우스로 고르고 「밑줄」을 눌러 보세요.</Empty>
      ) : (
        <>
          <input className="input" style={{ marginBottom: 20 }} placeholder="밑줄 · 메모에서 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          {[...groups].map(([k, ls]) => (
            <section key={k} className="section">
              <div className="section-head">
                <h2 style={{ textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--serif)', fontSize: 16, color: 'var(--text)' }}>{titles.get(k)?.title ?? '지운 책'}</h2>
                <span className="count">{ls.length}개</span>
              </div>
              <div className="list">
                {ls.map((l) => {
                  const t = titles.get(k);
                  const inner = (
                    <span className="grow">
                      <span className="serif" style={{ display: 'block', borderLeft: '2px solid var(--mark-strong)', paddingLeft: 10, lineHeight: 1.75 }}>
                        {l.quote}
                      </span>
                      {l.note && <span className="small" style={{ display: 'block', marginTop: 6 }}>{l.note}</span>}
                      <span className="faint tiny">{ago(l.at)}</span>
                    </span>
                  );
                  return t ? (
                    <a key={l.id} className="list-item" href={t.href(l)}>
                      {inner}
                    </a>
                  ) : (
                    <div key={l.id} className="list-item">
                      {inner}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  );
}
