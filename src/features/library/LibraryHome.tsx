import { useState } from 'react';
import { api } from '../../lib/api';
import { BookCard, charsLabel, Cover } from '../../lib/BookCard';
import { useSession } from '../../lib/session';
import { splitMarkdown } from '../../lib/split';
import { createBookFrom } from '../../lib/store';
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

export function LibraryHome() {
  const { user } = useSession();
  const [importing, setImporting] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const [b, p, c] = await Promise.all([
      api<{ books: Book[] }>('books'),
      api<{ progress: Record<string, { n: string; o: number; f?: number; at: number }> }>('progress').catch(() => ({ progress: {} as Record<string, { n: string; o: number; f?: number; at: number }> })),
      api<{ books: Shared[] }>('community').catch(() => ({ books: [] as Shared[] })),
    ]);
    return { books: b.books, progress: p.progress, shared: c.books.filter((x) => x.owner !== user.id) };
  }, []);

  if (loading && !data) return <Spinner />;
  if (error) return <div className="error-box">{error}</div>;
  const { books, progress, shared } = data!;
  const live = books.filter((b) => !b.deleted);
  const mine = live.filter((b) => b.kind === 'write');
  const read = live.filter((b) => b.kind === 'read');
  const trash = books.filter((b) => b.deleted);
  const prog = (key: string) => progress[key];
  // 이어 읽기: 가장 최근에 읽은 것
  const recent = [
    ...live.map((b) => ({ key: `b:${b.id}`, title: b.title, author: b.author, color: b.color, seed: b.id, href: `#/read/${b.id}` })),
    ...shared.map((s) => ({ key: `e:${s.id}`, title: s.title, author: s.owner_name, color: s.color, seed: s.id, href: `#/edition/${s.edition_id}` })),
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
          <p className="sub">내가 쓴 책, 들인 책, 친구가 공유한 책을 한곳에서 읽어요.</p>
        </div>
        <div className="actions">
          <a className="btn" href="#/discover">
            <Icon name="compass" size={16} />
            자유 이용 책 찾기
          </a>
          <button className="primary" onClick={() => setImporting(true)}>
            <Icon name="upload" size={16} />
            파일로 들이기
          </button>
        </div>
      </div>

      {cont && (
        <a className="hero" href={cont.href} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Cover title={cont.title} color={cont.color} seed={cont.seed} />
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
          <span className="count">{mine.length}권</span>
          <a className="more small" href="#/studio">
            집필실로 →
          </a>
        </div>
        {mine.length ? (
          <div className="cards">
            {mine.map((b) => (
              <BookCard key={b.id} title={b.title} by={b.author} color={b.color} seed={b.id} href={`#/read/${b.id}`} progress={prog(`b:${b.id}`)?.f ?? null} meta={[charsLabel(b.total_chars), `${b.node_count ?? 0}장`, b.shared ? `${b.last_edition}판 공유 중` : '']} />
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
              <BookCard key={s.id} title={s.title} by={s.owner_name} color={s.color} seed={s.id} href={`#/edition/${s.edition_id}`} progress={prog(`e:${s.id}`)?.f ?? null} meta={[`${s.edition}판`, charsLabel(s.chars), s.stars ? `★ ${s.stars.toFixed(1)}` : '']} />
            ))}
          </div>
        ) : (
          <p className="muted small">친구가 책을 공유하면 여기에 보여요.</p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>들인 책</h2>
          <span className="count">{read.length}권</span>
        </div>
        {read.length ? (
          <div className="cards">
            {read.map((b) => (
              <div key={b.id} style={{ position: 'relative' }}>
                <BookCard title={b.title} by={b.author} color={b.color} seed={b.id} href={`#/read/${b.id}`} progress={prog(`b:${b.id}`)?.f ?? null} meta={[charsLabel(b.total_chars), String(b.meta?.source ?? '').toUpperCase()]} />
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
