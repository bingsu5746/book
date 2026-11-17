import { useState } from 'react';
import { api } from '../../lib/api';
import { BookCard, charsLabel, Cover } from '../../lib/BookCard';
import type { CoverStyle } from '../../lib/cover';
import { useSession } from '../../lib/session';
import { splitMarkdown } from '../../lib/split';
import { cacheMyBooks, cachedBooks, cachedKeys, createBookFrom } from '../../lib/store';
import { useEffect } from 'react';
import { idb, local } from '../../lib/idb';
import { ago } from '../../lib/text';
import type { Book } from '../../lib/types';
import { confirmBox, Empty, Icon, Menu, Spinner, toast, useAsync } from '../../lib/ui';
import { ImportDialog } from './ImportDialog';
import { go } from '../../lib/router';

interface Shared {
  id: string;
  owner: string;
  title: string;
  author: string;
  color: string;
  owner_name: string;
  edition_id: string;
  edition: number;
  published: number;
  chars: number;
  stars: number | null;
}

export async function importSeed(nickname: string) {
  const [dawn, notes] = await Promise.all([fetch('/seed/dawn.md').then((r) => r.text()), fetch('/seed/notes.md').then((r) => r.text())]);
  const s = splitMarkdown(dawn);
  return createBookFrom({ title: s.title, author: nickname, kind: 'write', nodes: s.nodes, notes, color: '#1f2c4a', meta: { template: 'seed-dawn' } });
}

export const fmtMinutes = (secs: number) => {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
};

export function LibraryHome() {
  const { user } = useSession();
  const [importing, setImporting] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [offline, setOffline] = useState(false);
  const [sort, setSort] = useState<'updated' | 'read' | 'title'>(() => local.get('libSort', 'updated'));
  const [weekRead, setWeekRead] = useState(0);
  const [backupHidden, setBackupHidden] = useState(false);
  const [readFilter, setReadFilter] = useState<'' | 'want' | 'reading' | 'done'>('');
  useEffect(() => {
    api<{ read: { day: string; secs: number }[] }>('stats')
      .then((r) => {
        const since = new Date(Date.now() - 6 * 86_400_000).toLocaleDateString('sv-SE');
        setWeekRead(r.read.filter((d) => d.day >= since).reduce((s, d) => s + d.secs, 0));
      })
      .catch(() => {});
  }, []);
  const [onDevice, setOnDevice] = useState<Set<string>>(new Set());
  const { data, loading, error, reload } = useAsync(async () => {
    try {
      await api('me');
    } catch (e) {
      if ((e as { status?: number }).status !== 0) throw e;
      // 인터넷이 없으면 기기에 받아 둔 책으로
      setOffline(true);
      const cached = await cachedBooks();
      return { books: cached.map((c) => ({ ...c.book, total_chars: c.nodes.reduce((s, n) => s + (n.deleted ? 0 : n.chars), 0), node_count: c.nodes.filter((n) => !n.deleted && n.kind !== 'part').length })), progress: {} as Record<string, { n: string; o: number; f?: number; at: number }>, shared: [] as Shared[] };
    }
    setOffline(false);
    const [b, p, c] = await Promise.all([
      api<{ books: Book[] }>('books'),
      api<{ progress: Record<string, { n: string; o: number; f?: number; at: number }> }>('progress').catch(() => ({ progress: {} as Record<string, { n: string; o: number; f?: number; at: number }> })),
      api<{ books: Shared[] }>('community').catch(() => ({ books: [] as Shared[] })),
    ]);
    return { books: b.books, progress: p.progress, shared: c.books.filter((x) => x.owner !== user.id) };
  }, []);

  useEffect(() => {
    if (!data || offline) {
      void cachedKeys().then(setOnDevice);
      return;
    }
    void (async () => {
      await cacheMyBooks(data.books);
      // 친구가 공유한 최신 판도 받아 둔다
      const have = await cachedKeys();
      for (const s of data.shared) if (!have.has(`e:${s.edition_id}`)) await api(`editions/${s.edition_id}`).then((r) => idb.set('books', `e:${s.edition_id}`, r)).catch(() => {});
      setOnDevice(await cachedKeys());
    })();
  }, [data, offline]);
  if (loading && !data) return <Spinner />;
  if (error) return <div className="error-box">{error}</div>;
  const { books, progress, shared } = data!;
  const dev = (id: string) => (onDevice.has(id) ? '기기에 있음' : '');
  const live = books.filter((b) => !b.deleted);
  const order = (list: Book[]) =>
    [...list].sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title, 'ko') : sort === 'read' ? (progress[`b:${b.id}`]?.at ?? 0) - (progress[`b:${a.id}`]?.at ?? 0) : b.updated - a.updated,
    );
  const mine = order(live.filter((b) => b.kind === 'write'));
  const readAll = order(live.filter((b) => b.kind === 'read'));
  const read = readAll.filter((b) => !readFilter || (b.meta.readStatus ?? 'reading') === readFilter);
  const doneThisYear = readAll.filter((b) => b.meta.readStatus === 'done' && (b.meta.finishedAt ?? '').startsWith(String(new Date().getFullYear()))).length;
  const SORTS = { updated: '최근 고친 순', read: '최근 읽은 순', title: '제목 순' } as const;
  const sortMenu = (
    <Menu label="정렬" text={SORTS[sort]}>
      {(close) => (
        <>
          {(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((k) => (
            <button key={k} className={sort === k ? 'on' : ''} onClick={() => (close(), setSort(k), local.set('libSort', k))}>
              {SORTS[k]}
            </button>
          ))}
        </>
      )}
    </Menu>
  );
  const trash = books.filter((b) => b.deleted);
  const prog = (key: string) => progress[key];
  // 이어 읽기: 가장 최근에 읽은 것
  const recent = [
    ...live.map((b) => ({ key: `b:${b.id}`, title: b.title, author: b.author, color: b.color, seed: b.id, href: `#/read/${b.id}`, style: b.meta?.coverStyle as CoverStyle | undefined })),
    ...shared.map((s) => ({ key: `e:${s.id}`, title: s.title, author: s.owner_name, color: s.color, seed: s.id, href: `#/edition/${s.edition_id}`, style: undefined as CoverStyle | undefined })),
  ]
    .filter((x) => prog(x.key) && (prog(x.key).f ?? 0) < 0.999)
    .sort((a, b) => prog(b.key).at - prog(a.key).at);
  const cont = recent[0];
  const hasSeed = books.some((b) => b.meta?.template === 'seed-dawn');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>서재</h1>
          <p className="sub">
            내가 쓴 책, 들인 책, 친구가 공유한 책을 한곳에서 읽어요.
            {!!weekRead && <> · 최근 7일 {fmtMinutes(weekRead)} 읽음</>}
            {!!doneThisYear && <> · 올해 {doneThisYear}권 다 읽음</>}
          </p>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => setImporting(true)}>
            <Icon name="plus" size={16} />
            책 들이기
          </button>
          <Menu label="더 보기">
            {(close) => (
              <>
                <button onClick={() => (close(), go('discover'))}>
                  <Icon name="compass" size={16} />
                  자유 이용 책 찾기
                </button>
                <button onClick={() => (close(), go('lines'))}>
                  <Icon name="bookmark" size={16} />
                  밑줄 모음
                </button>
                <button onClick={() => (close(), go('search'))}>
                  <Icon name="search" size={16} />
                  모든 책 본문 찾기
                </button>
              </>
            )}
          </Menu>
        </div>
      </div>

      {offline && <p className="note-box" style={{ marginBottom: 20 }}>인터넷에 연결되어 있지 않아 이 기기에 받아 둔 책만 보여요. 쓴 글은 기기에 저장했다가 연결되면 보내요.</p>}
      {cont && (
        <a className="hero" href={cont.href} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Cover title={cont.title} color={cont.color} seed={cont.seed} author={cont.author} style={cont.style} />
          <div className="grow">
            <p className="tiny muted" style={{ letterSpacing: '.1em' }}>
              이어 읽기
            </p>
            <h2 className="serif" style={{ fontSize: 22, margin: '4px 0' }}>
              {cont.title}
            </h2>
            <p className="muted small">
              {cont.author} · {Math.round((prog(cont.key).f ?? 0) * 100)}% · {ago(prog(cont.key).at)}
            </p>
            <div className="meter" style={{ maxWidth: 320 }}>
              <i style={{ width: `${(prog(cont.key).f ?? 0) * 100}%` }} />
            </div>
          </div>
          <span className="btn primary">
            <Icon name="book" size={16} />
            펼치기
          </span>
        </a>
      )}

      <section className="section">
        <div className="section-head">
          <h2>내가 쓴 책</h2>
          {mine.length > 1 && sortMenu}
          <span className="count">{mine.length}권</span>
          <a className="more small" href="#/studio">
            집필실로 →
          </a>
        </div>
        {mine.length ? (
          <div className="cards">
            {mine.map((b) => (
              <BookCard key={b.id} title={b.title} by={b.author} color={b.color} seed={b.id} coverStyle={b.meta?.coverStyle} href={`#/read/${b.id}`} progress={prog(`b:${b.id}`)?.f ?? null} meta={[charsLabel(b.total_chars), `${b.node_count ?? 0}장`, b.shared ? (b.last_edition ? `${b.last_edition}판 공유 중` : '공유 중') : '', dev(b.id)]} />
            ))}
          </div>
        ) : (
          <Empty
            title="아직 쓴 책이 없어요"
            action={
              <>
                <a className="btn primary" href="#/studio">
                  새 책 쓰기
                </a>
                {!hasSeed && (
                  <button
                    disabled={seeding}
                    onClick={async () => {
                      setSeeding(true);
                      try {
                        const b = await importSeed(user.nickname);
                        toast(`「${b.title}」을(를) 가져왔어요`);
                        reload();
                      } catch (e) {
                        toast((e as Error).message, 'err');
                      } finally {
                        setSeeding(false);
                      }
                    }}
                  >
                    {seeding ? '가져오는 중…' : '「새벽을 건너는 꿈」 가져오기'}
                  </button>
                )}
              </>
            }
          >
            집필실에서 새 책을 시작하거나, 아티팩트 서재에 있던 「새벽을 건너는 꿈」을 원고로 가져올 수 있어요.
          </Empty>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>친구의 책</h2>
          <span className="count">{shared.length}권</span>
          <a className="more small" href="#/hall">
            열람실로 →
          </a>
        </div>
        {shared.length ? (
          <div className="cards">
            {shared.map((s) => (
              <BookCard key={s.id} title={s.title} by={s.owner_name} color={s.color} seed={s.id} href={`#/edition/${s.edition_id}`} progress={prog(`e:${s.id}`)?.f ?? null} meta={[`${s.edition}판`, charsLabel(s.chars), s.stars ? `★ ${s.stars.toFixed(1)}` : '', dev(`e:${s.edition_id}`)]} />
            ))}
          </div>
        ) : (
          <p className="muted small">친구가 책을 공유하면 여기에 보여요.</p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>들인 책</h2>
          {readAll.length > 1 && sortMenu}
          {readAll.length > 1 && (
            <div className="seg" style={{ marginLeft: 'auto' }}>
              {(
                [
                  ['', '전체'],
                  ['reading', '읽는 중'],
                  ['done', '다 읽음'],
                  ['want', '읽고 싶어요'],
                ] as const
              ).map(([k, l]) => (
                <button key={k || 'all'} className={readFilter === k ? 'on' : ''} onClick={() => setReadFilter(k)}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <span className="count">{read.length}권</span>
        </div>
        {read.length ? (
          <div className="cards">
            {read.map((b) => (
              <div key={b.id} style={{ position: 'relative' }}>
                <BookCard title={b.title} by={b.author} color={b.color} seed={b.id} coverStyle={b.meta?.coverStyle} href={`#/read/${b.id}`} progress={prog(`b:${b.id}`)?.f ?? null} meta={[b.meta.readStatus === 'done' ? `다 읽음${b.meta.finishedAt ? ` ${b.meta.finishedAt.slice(5).replace('-', '.')}` : ''}` : b.meta.readStatus === 'want' ? '읽고 싶어요' : '', b.meta.readStars ? '★'.repeat(b.meta.readStars) : '', charsLabel(b.total_chars), dev(b.id)]} />
                <div style={{ position: 'absolute', top: 6, right: 6 }}>
                  <Menu label="책 메뉴">
                    {(close) => (
                      <>
                        <button
                          onClick={async () => {
                            close();
                            await api(`books/${b.id}`, { method: 'PATCH', body: { kind: 'write' } });
                            toast('내 원고로 옮겼어요. 집필실에서 고칠 수 있어요.');
                            go(`write/${b.id}`);
                          }}
                        >
                          집필실에서 고치기
                        </button>
                        <button
                          className="danger"
                          onClick={async () => {
                            close();
                            if (!(await confirmBox(`「${b.title}」을(를) 휴지통에 넣을까요?`, { ok: '휴지통에 넣기', danger: true, detail: '30일 안에 되살릴 수 있어요.' }))) return;
                            await api(`books/${b.id}`, { method: 'DELETE' });
                            reload();
                          }}
                        >
                          휴지통에 넣기
                        </button>
                      </>
                    )}
                  </Menu>
                </div>
              </div>
            ))}
          </div>
        ) : readAll.length ? (
          <p className="muted small">이 표시에 맞는 책이 없어요.</p>
        ) : live.length ? (
          <p className="muted small">
            가지고 있는 EPUB · TXT · PDF · Word 파일을 <button className="link-btn" onClick={() => setImporting(true)}>들이거나</button>, 저작권이 끝난 책을 <a href="#/discover">찾아</a> 넣을 수 있어요.
          </p>
        ) : (
          <Empty
            title="들인 책이 없어요"
            action={
              <>
                <button className="primary" onClick={() => setImporting(true)}>
                  파일로 들이기
                </button>
                <a className="btn" href="#/discover">
                  자유 이용 책 찾기
                </a>
              </>
            }
          >
            가지고 있는 EPUB · TXT · PDF · Word 파일을 들이거나, 저작권이 끝난 책을 찾아 넣을 수 있어요.
          </Empty>
        )}
      </section>

      {!!trash.length && (
        <section className="section">
          <div className="section-head">
            <h2>휴지통</h2>
            <span className="count">{trash.length}권 · 30일 지나면 지워져요</span>
          </div>
          <div className="list">
            {trash.map((b) => (
              <div key={b.id} className="list-item">
                <span className="grow">
                  <b className="serif">{b.title}</b> <span className="muted small">{ago(b.deleted!)} 지움</span>
                </span>
                <button
                  className="small"
                  onClick={async () => {
                    await api(`books/${b.id}/restore`, { body: {} });
                    reload();
                  }}
                >
                  되살리기
                </button>
                <button
                  className="small danger"
                  onClick={async () => {
                    if (!(await confirmBox(`「${b.title}」을(를) 완전히 지울까요?`, { ok: '완전히 지우기', danger: true, detail: '되돌릴 수 없어요.' }))) return;
                    await api(`books/${b.id}/purge`, { body: {} });
                    reload();
                  }}
                >
                  완전히 지우기
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {!offline && mine.length > 0 && Date.now() - local.get<number>('lastBackup', 0) > 14 * 86_400_000 && !backupHidden && (
        <p className="muted small" style={{ marginTop: 8 }}>
          {local.get<number>('lastBackup', 0) ? `마지막 백업이 ${Math.floor((Date.now() - local.get<number>('lastBackup', 0)) / 86_400_000)}일 전이에요.` : '아직 내 자료를 백업한 적이 없어요.'}{' '}
          <a href="#/account">계정 → 전부 내려받기</a> ·{' '}
          <button
            className="link-btn"
            onClick={() => {
              local.set('lastBackup', Date.now() - 7 * 86_400_000);
              setBackupHidden(true);
            }}
          >
            일주일 뒤에 다시
          </button>
        </p>
      )}
      {importing && (
        <ImportDialog
          onClose={() => {
            setImporting(false);
            reload();
          }}
        />
      )}
    </>
  );
}
