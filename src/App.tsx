import { useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './lib/api';
import { go, useRoute } from './lib/router';
import { SessionCtx } from './lib/session';
import { onSaveState } from './lib/store';
import type { User } from './lib/types';
import { Icon, Spinner, Toaster } from './lib/ui';
import { local } from './lib/idb';
import { AuthScreen } from './features/auth/AuthScreen';
import { LibraryHome } from './features/library/LibraryHome';
import { BookReader } from './features/library/BookReader';
import { SearchPage } from './features/library/SearchPage';
import { Discover } from './features/library/Discover';
import { StudioHome } from './features/studio/StudioHome';
import { Workspace } from './features/studio/Workspace';
import { WorldsHome } from './features/world/WorldsHome';
import { WorldView } from './features/world/WorldView';
import { Hall } from './features/community/Hall';
import { EditionReader } from './features/community/EditionReader';
import { Account } from './features/account/Account';
import { LinesPage } from './features/library/LinesPage';
import { QuickJump } from './features/QuickJump';
import { JotsPage, QuickJot } from './features/Jots';

const NAV = [
  { id: 'library', label: '서재', icon: 'library' },
  { id: 'studio', label: '집필실', icon: 'pen' },
  { id: 'worlds', label: '세계관', icon: 'globe' },
  { id: 'hall', label: '열람실', icon: 'people' },
];

function SaveBadge() {
  const [s, setS] = useState({ pending: 0, error: null as string | null });
  useEffect(() => onSaveState(setS), []);
  if (s.error) return <div className="save-state err">저장 대기 중 · {s.error}</div>;
  if (s.pending) return <div className="save-state">저장하는 중…</div>;
  return null;
}

function UpdateBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(true);
    addEventListener('app-update', on);
    return () => removeEventListener('app-update', on);
  }, []);
  if (!show) return null;
  return (
    <div className="update-banner" role="status">
      새 버전이 나왔어요.
      <button
        className="small primary"
        onClick={async () => {
          const { flushDrafts } = await import('./lib/store');
          await flushDrafts().catch(() => {});
          location.reload();
        }}
      >
        새로고침
      </button>
      <button className="small ghost" onClick={() => setShow(false)}>
        나중에
      </button>
    </div>
  );
}

/** 열람실 새 소식 수 (마지막으로 열람실을 연 뒤 다른 사람이 남긴 것) */
function useHallBadge(user: User | null | undefined) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!user) return;
    if (!local.get<number>('hallSeen', 0)) local.set('hallSeen', Date.now());
    const load = () =>
      api<{ editions: { created: number; nickname: string }[]; notes: { created: number }[]; ratings: { updated: number }[] }>('feed')
        .then((f) => {
          const seen = local.get<number>('hallSeen', Date.now());
          setN(f.notes.filter((x) => x.created > seen).length + f.ratings.filter((x) => x.updated > seen).length + f.editions.filter((x) => x.created > seen && x.nickname !== user.nickname).length);
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, 5 * 60_000);
    const seen = () => setN(0);
    addEventListener('hall-seen', seen);
    return () => {
      clearInterval(t);
      removeEventListener('hall-seen', seen);
    };
  }, [user]);
  return n;
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [invite, setInvite] = useState(true);
  const { parts, query } = useRoute();
  const hallBadge = useHallBadge(user);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api<{ user: User | null; invite: boolean }>('auth/status')
      .then((r) => {
        setUser(r.user);
        setInvite(r.invite);
        if (r.user) local.set('lastUser', r.user);
      })
      .catch(() => {
        // 인터넷이 없으면 지난번 로그인한 사람으로 (기기에 받아 둔 책을 읽을 수 있게)
        setUser(local.get<User | null>('lastUser', null));
      });
  }, []);

  if (user === undefined)
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <Spinner />
      </div>
    );
  if (!user)
    return (
      <>
        <AuthScreen
          inviteOpen={invite}
          onDone={(u) => {
            local.set('lastUser', u);
            setUser(u);
          }}
        />
        <Toaster />
      </>
    );

  const [top = 'library', a, b] = parts;
  let full: React.ReactNode = null;
  if (top === 'read' && a) full = <BookReader bookId={a} nodeId={b} at={query.get('at')} find={query.get('find')} />;
  if (top === 'write' && a) full = <Workspace key={a} bookId={a} nodeId={b} />;
  if (top === 'edition' && a) full = <EditionReader editionId={a} nodeId={b} noteId={query.get('note')} />;

  let page: React.ReactNode;
  if (top === 'studio') page = <StudioHome />;
  else if (top === 'worlds' && a) page = <WorldView worldId={a} tab={b} entryId={parts[3]} />;
  else if (top === 'worlds') page = <WorldsHome />;
  else if (top === 'hall') page = <Hall />;
  else if (top === 'search') page = <SearchPage q={query.get('q') ?? ''} />;
  else if (top === 'discover') page = <Discover />;
  else if (top === 'account') page = <Account />;
  else if (top === 'lines') page = <LinesPage />;
  else if (top === 'jots') page = <JotsPage />;
  else page = <LibraryHome />;
  const navOn = top === 'discover' || top === 'lines' || top === 'search' ? 'library' : top === 'jots' ? 'studio' : top;

  return (
    <SessionCtx.Provider value={{ user, setUser }}>
      {full ?? (
        <div className="app">
          <aside className="sidebar">
            <a className="brand" href="#/library">
              <img src="/icon.svg" alt="" />
              서재
            </a>
            <button className="find-btn" onClick={() => dispatchEvent(new Event('quick-jump'))}>
              <Icon name="search" size={16} />
              찾기 · 이동
              <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
            {NAV.map((n) => (
              <a key={n.id} className={`nav-item${navOn === n.id ? ' on' : ''}`} href={`#/${n.id}`}>
                <Icon name={n.icon} />
                {n.label}
                {n.id === 'hall' && hallBadge > 0 && (
                  <em className="badge" style={{ marginLeft: 'auto' }}>
                    {hallBadge}
                  </em>
                )}
              </a>
            ))}
            <div className="bottom">
              <SaveBadge />
              <a className={`nav-item${top === 'account' ? ' on' : ''}`} href="#/account">
                <Icon name="user" />
                {user.nickname}
              </a>
            </div>
          </aside>
          <main className="main">
            {page}
            <div className="tabbar-spacer" />
          </main>
          <nav className="tabbar" aria-label="메뉴">
            {NAV.slice(0, 4).map((n) => (
              <a key={n.id} className={navOn === n.id ? 'on' : ''} href={`#/${n.id}`}>
                <span style={{ position: 'relative' }}>
                  <Icon name={n.icon} size={20} />
                  {n.id === 'hall' && hallBadge > 0 && <i className="tab-dot" aria-label={`새 소식 ${hallBadge}`} />}
                </span>
                {n.label}
              </a>
            ))}
            <a className={top === 'account' || top === 'search' ? 'on' : ''} href="#/account">
              <Icon name="user" size={20} />
              계정
            </a>
          </nav>
        </div>
      )}
      <QuickJump />
      <QuickJot />
      <UpdateBanner />
      <Toaster />
    </SessionCtx.Provider>
  );
}
export const openSearch = () => go('search');
