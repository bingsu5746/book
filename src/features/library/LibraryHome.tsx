import { useState } from 'react';
import { api } from '../../lib/api';
import { charsLabel, coverUrl } from '../../lib/BookCard';
import { Desk, Manuscript, Shelf, Spine } from './Bookcase';
import { groupBySeries, seriesOf } from '../../lib/series';
import type { CoverStyle } from '../../lib/cover';
import { useSession } from '../../lib/session';
import { splitMarkdown } from '../../lib/split';
import { cacheMyBooks, cachedBooks, cachedKeys, createBookFrom } from '../../lib/store';
import { useEffect } from 'react';
import { idb, local } from '../../lib/idb';
import { ago } from '../../lib/text';
import type { Book } from '../../lib/types';
import { confirmBox, Icon, Menu, Spinner, toast, useAsync } from '../../lib/ui';
import { ImportDialog } from './ImportDialog';
import { BookSheet, type SheetBook } from './BookSheet';
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
  cover_image?: number | null;
  cover_mode?: string | null;
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
  const [sheet, setSheet] = useState<{ book: SheetBook; from: HTMLElement | null } | null>(null);
  useEffect(() => {
    api<{ read: { day: string; secs: number }[] }>('stats')
      .then((r) => {
        const since = new Date(Date.now() - 6 * 86_400_000).toLocaleDateString('sv-SE');
        setWeekRead(r.read.filter((d) => d.day >= since).reduce((s, d) => s + d.secs, 0));
      })
      .catch(() => {});
  }, []);
  const [, setOnDevice] = useState<Set<string>>(new Set());
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
  const live = books.filter((b) => !b.deleted);
  const order = (list: Book[]) =>
    [...list].sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title, 'ko') : sort === 'read' ? (progress[`b:${b.id}`]?.at ?? 0) - (progress[`b:${a.id}`]?.at ?? 0) : b.updated - a.updated,
    );
  const mine = order(live.filter((b) => b.kind === 'write'));
  // 다 쓴 책(탈고 · 해설집)은 책장에, 아직 쓰는 원고는 책상에
  const isDone = (b: Book) => !!b.meta.finishedAt || !!b.meta.analysisOf;
  const finished = mine.filter(isDone);
  const drafts = mine.filter((b) => !isDone(b));
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
  const hasSeed = books.some((b) => b.meta?.template === 'seed-dawn');

  /** 책 카드를 누르면 바로 펼치지 않고 「꺼내 보기」 */
  const sheetFor = (href: string): SheetBook | null => {
    const m = href.match(/^#\/(read|edition)\/([a-z0-9]+)$/);
    if (!m) return null;
    if (m[1] === 'read') {
      const b = live.find((x) => x.id === m[2]);
      if (!b) return null;
      const p = prog(`b:${b.id}`);
      const base = { key: `b:${b.id}`, title: b.title, author: b.author, color: b.color, seed: b.id, style: b.meta?.coverStyle as CoverStyle | undefined, image: coverUrl(b.id, b.meta), href, progress: p ?? null, source: { kind: 'book' as const, id: b.id } };
      if (b.kind === 'write') {
        const blurb = String(b.meta.blurb ?? '').trim();
        const plot = String(b.meta.plot ?? '').trim();
        return { ...base, writeHref: `#/write/${b.id}`, blurb: blurb || plot, blurbLabel: blurb ? '소개' : '구상 줄거리 · 나만 보여요', facts: [seriesOf(b.meta) ? `${seriesOf(b.meta)!.name}${seriesOf(b.meta)!.no ? ` ${seriesOf(b.meta)!.no}권` : ''}` : '', charsLabel(b.total_chars), `${b.node_count ?? 0}장`, b.shared ? (b.last_edition ? `${b.last_edition}판 공유 중` : '공유 중') : '', `${ago(b.updated)} 고침`] };
      }
      const st = b.meta.readStatus === 'done' ? `다 읽음${b.meta.finishedAt ? ` ${b.meta.finishedAt}` : ''}` : b.meta.readStatus === 'want' ? '읽고 싶어요' : '';
      return {
        ...base,
        blurb: String(b.meta.blurb ?? '').trim(),
        facts: [st, b.meta.readStars ? '★'.repeat(b.meta.readStars) : '', charsLabel(b.total_chars)],
        actions: [
          {
            label: '집필실에서 고치기',
            onClick: async () => {
              await api(`books/${b.id}`, { method: 'PATCH', body: { kind: 'write' } });
              toast('내 원고로 옮겼어요. 집필실에서 고칠 수 있어요.');
              go(`write/${b.id}`);
            },
          },
          {
            label: '휴지통에 넣기',
            danger: true,
            onClick: async () => {
              if (!(await confirmBox(`「${b.title}」을(를) 휴지통에 넣을까요?`, { ok: '휴지통에 넣기', danger: true, detail: '30일 안에 되살릴 수 있어요.' }))) return;
              await api(`books/${b.id}`, { method: 'DELETE' });
              setSheet(null);
              reload();
            },
          },
        ],
      };
    }
    const sh = shared.find((x) => x.edition_id === m[2]);
    if (!sh) return null;
    return { key: `e:${sh.id}`, title: sh.title, author: sh.owner_name, color: sh.color, seed: sh.id, image: coverUrl(sh.id, { coverImage: sh.cover_image, coverMode: sh.cover_mode }), href, progress: prog(`e:${sh.id}`) ?? null, source: { kind: 'edition', id: sh.edition_id }, facts: [`${sh.edition}판`, charsLabel(sh.chars), sh.stars ? `★ ${sh.stars.toFixed(1)}` : '', `${ago(sh.published)} 공유`] };
  };
  const onCardClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.card, a.spine, a.ms');
    if (!a || a.classList.contains('ms-new')) return;
    const book = sheetFor(a.getAttribute('href') ?? '');
    if (!book) return;
    e.preventDefault();
    setSheet({ book, from: a.querySelector<HTMLElement>('.thumb') ?? a });
  };

  return (
    <div onClick={onCardClick}>
      <div className="page-head">
        <div>
          <h1>서재</h1>
          <p className="sub">
            {!!weekRead && <>최근 7일 {fmtMinutes(weekRead)} 읽음</>}
            {!!doneThisYear && <>{weekRead ? ' · ' : ''}올해 {doneThisYear}권 다 읽음</>}
          </p>
        </div>
        <div className="actions">
          {live.length > 1 && sortMenu}
          <Menu label="더하기 · 더 보기" icon="plus" btnClass="round-add">
            {(close) => (
              <>
                <button onClick={() => (close(), setImporting(true))}>
                  <Icon name="upload" size={16} />
                  파일로 책 들이기
                </button>
                <button onClick={() => (close(), go('discover'))}>
                  <Icon name="compass" size={16} />
                  자유 이용 책 찾기
                </button>
                <hr />
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
      <div className="bookcase">
        <Shelf
          title="다 쓴 책"
          count={finished.length}
          empty={<>「다 썼어요」(집필실 ⋯ 메뉴)를 누른 책이 여기 꽂혀요. 쓰는 중인 원고는 아래 책상에 있어요.</>}
        >
          {groupBySeries(finished, (b) => b.meta).map((g, k) => {
            const spines = g.items.map((b) => <Spine key={b.id} b={{ id: b.id, title: b.title, author: b.author, color: b.color, chars: b.total_chars, href: `#/read/${b.id}`, progress: prog(`b:${b.id}`)?.f ?? null, series: seriesOf(b.meta) }} />);
            return g.series && g.items.length > 1 ? (
              <div key={`s${k}`} className="spine-series" title={g.series}>
                {spines}
              </div>
            ) : (
              spines
            );
          })}
        </Shelf>
        <Shelf title="친구의 책" count={shared.length} empty={<>친구가 책을 공유하면 여기 꽂혀요.</>}>
          {shared.map((s) => (
            <Spine key={s.id} b={{ id: s.id, title: s.title, author: s.owner_name, color: s.color, chars: s.chars, href: `#/edition/${s.edition_id}`, progress: prog(`e:${s.id}`)?.f ?? null, note: `${s.edition}판` }} />
          ))}
        </Shelf>
        <Shelf
          title="들인 책"
          count={read.length}
          tools={
            readAll.length > 1 ? (
              <div className="seg shelf-seg">
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
            ) : undefined
          }
          empty={readAll.length ? <>이 표시에 맞는 책이 없어요.</> : <>가지고 있는 EPUB · TXT · PDF · Word 파일을 들이거나, 저작권이 끝난 책을 찾아 넣을 수 있어요.</>}
        >
          {read.map((b) => (
            <Spine key={b.id} b={{ id: b.id, title: b.title, author: b.author, color: b.color, chars: b.total_chars, href: `#/read/${b.id}`, progress: prog(`b:${b.id}`)?.f ?? null }} />
          ))}
          <button className="spine-add" onClick={() => setImporting(true)}>
            <span>+ 책 들이기</span>
          </button>
          <a className="spine-add" href="#/discover">
            <span>무료 책 찾기</span>
          </a>
        </Shelf>
      </div>

      <Desk count={drafts.length}>
        {drafts.map((b) => (
          <Manuscript key={b.id} b={{ id: b.id, title: b.title, author: b.author, chars: b.total_chars ?? 0, chapters: b.node_count ?? 0, updated: b.updated, href: `#/read/${b.id}`, series: seriesOf(b.meta) ? `${seriesOf(b.meta)!.name}${seriesOf(b.meta)!.no ? ` ${seriesOf(b.meta)!.no}권` : ''}` : '', shared: b.shared ? (b.last_edition ? `${b.last_edition}판 공유` : '공유 중') : '' }} />
        ))}
        <a className="ms ms-new" href="#/studio">
          <span className="ms-title">+ 새 원고</span>
          <span className="ms-meta">집필실에서 새 책 시작</span>
        </a>
        {!mine.length && !hasSeed && (
          <button
            className="ms ms-new"
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
            <span className="ms-title">{seeding ? '가져오는 중…' : '「새벽을 건너는 꿈」 가져오기'}</span>
            <span className="ms-meta">예시 원고</span>
          </button>
        )}
      </Desk>

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
      {sheet && <BookSheet book={sheet.book} from={sheet.from} onClose={() => setSheet(null)} />}
    </div>
  );
}
