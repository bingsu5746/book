// 열람실: 친구와 서로 공유한 책 · 새 소식(새 판 · 내 책에 달린 주석 · 평가)
import { useEffect, useState } from 'react';
import { local } from '../../lib/idb';
import { api } from '../../lib/api';
import { BookCard, charsLabel } from '../../lib/BookCard';
import { useSession } from '../../lib/session';
import { ago } from '../../lib/text';
import { Empty, Spinner, SubNav, useAsync } from '../../lib/ui';

interface Shared {
  id: string;
  owner: string;
  title: string;
  subtitle: string;
  author: string;
  color: string;
  owner_name: string;
  edition_id: string;
  edition: number;
  published: number;
  chars: number;
  note: string;
  stars: number | null;
  rating_count: number;
  note_count: number;
}
interface Feed {
  editions: { id: string; book_id: string; number: number; title: string; created: number; note: string; nickname: string }[];
  notes: { id: string; book_id: string; edition_id: string; node_id: string; quote: string; body: string; created: number; parent_id: string | null; nickname: string; title: string }[];
  ratings: { book_id: string; stars: number; text: string; updated: number; nickname: string; title: string }[];
}

export function Hall() {
  const { user } = useSession();
  const [tab, setTab] = useState<'books' | 'news'>('books');
  useEffect(() => {
    local.set('hallSeen', Date.now());
    dispatchEvent(new Event('hall-seen'));
  }, []);
  const { data, loading, error } = useAsync(async () => {
    const [c, f] = await Promise.all([api<{ books: Shared[] }>('community'), api<Feed>('feed')]);
    return { books: c.books, feed: f };
  }, []);
  if (loading && !data) return <Spinner />;
  if (error) return <div className="error-box">{error}</div>;
  const { books, feed } = data!;
  const friends = books.filter((b) => b.owner !== user.id);
  const mine = books.filter((b) => b.owner === user.id);
  const news = [
    ...feed.notes.map((n) => ({ at: n.created, key: `n${n.id}`, el: (
      <a className="list-item" href={`#/edition/${n.edition_id}/${n.node_id}?note=${n.parent_id ?? n.id}`}>
        <span className="grow">
          <b>{n.nickname}</b>
          <span className="muted"> 님이 「{n.title}」에 {n.parent_id ? '답글' : '주석'}을 달았어요</span>
          {n.quote && <span className="serif muted small" style={{ display: 'block', borderLeft: '2px solid var(--mark-strong)', paddingLeft: 8, margin: '4px 0' }}>{n.quote.slice(0, 80)}</span>}
          <span className="small" style={{ display: 'block' }}>{n.body.slice(0, 140)}</span>
        </span>
        <span className="faint tiny">{ago(n.created)}</span>
      </a>
    ) })),
    ...feed.ratings.map((r) => ({ at: r.updated, key: `r${r.book_id}${r.nickname}`, el: (
      <div className="list-item">
        <span className="grow">
          <b>{r.nickname}</b>
          <span className="muted"> 님이 「{r.title}」을 평가했어요 </span>
          <span style={{ color: '#c99a2e' }}>{'★'.repeat(r.stars)}</span>
          {r.text && <span className="small" style={{ display: 'block' }}>{r.text}</span>}
        </span>
        <span className="faint tiny">{ago(r.updated)}</span>
      </div>
    ) })),
    ...feed.editions.map((e) => ({ at: e.created, key: `e${e.id}`, el: (
      <a className="list-item" href={`#/edition/${e.id}`}>
        <span className="grow">
          <b>{e.nickname}</b>
          <span className="muted"> 님이 「{e.title}」 {e.number}판을 공유했어요</span>
          {e.note && <span className="small" style={{ display: 'block' }}>{e.note}</span>}
        </span>
        <span className="faint tiny">{ago(e.created)}</span>
      </a>
    ) })),
  ].sort((a, b) => b.at - a.at);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>열람실</h1>
          <p className="sub">친구와 서로 쓴 책을 읽고, 문장마다 주석을 달고, 평가를 남겨요.</p>
        </div>
      </div>
      <div className="with-sub">
        <SubNav
          value={tab}
          onChange={setTab}
          items={[
            { id: 'books', label: '공유된 책', icon: 'library', badge: friends.length },
            { id: 'news', label: '새 소식', icon: 'comment', badge: feed.notes.length },
          ]}
        />
        <div>
          {tab === 'books' && (
            <>
              <section className="section">
                <div className="section-head">
                  <h2>친구의 책</h2>
                  <span className="count">{friends.length}권</span>
                </div>
                {friends.length ? (
                  <div className="cards">
                    {friends.map((b) => (
                      <BookCard key={b.id} title={b.title} by={`${b.owner_name} · ${b.edition}판`} color={b.color} seed={b.id} href={`#/edition/${b.edition_id}`} meta={[charsLabel(b.chars), b.stars ? `★ ${b.stars.toFixed(1)} (${b.rating_count})` : '평가 없음', `주석 ${b.note_count}`, ago(b.published)]} />
                    ))}
                  </div>
                ) : (
                  <Empty title="아직 공유된 친구의 책이 없어요">친구가 집필실의 「책 설정 → 열람실에 공유」를 누르면 여기에 나타나요.</Empty>
                )}
              </section>
              <section className="section">
                <div className="section-head">
                  <h2>내가 공유한 책</h2>
                  <span className="count">{mine.length}권</span>
                </div>
                {mine.length ? (
                  <div className="cards">
                    {mine.map((b) => (
                      <BookCard key={b.id} title={b.title} by={`${b.edition}판 · ${ago(b.published)}`} color={b.color} seed={b.id} href={`#/edition/${b.edition_id}`} meta={[b.stars ? `★ ${b.stars.toFixed(1)} (${b.rating_count})` : '평가 없음', `주석 ${b.note_count}`]} />
                    ))}
                  </div>
                ) : (
                  <p className="muted small">집필실에서 책을 열고 「책 설정 → 열람실에 공유」를 누르면 친구에게 보여요.</p>
                )}
              </section>
            </>
          )}
          {tab === 'news' && (news.length ? <div className="list">{news.map((n) => <div key={n.key}>{n.el}</div>)}</div> : <Empty title="새 소식이 없어요" />)}
        </div>
      </div>
    </>
  );
}
