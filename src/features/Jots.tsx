// 아이디어 수첩: 떠오른 생각을 어디서나 빠르게 적어 두고(Ctrl/⌘ + J), 나중에 원고나 작가 노트로 옮긴다.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ago } from '../lib/text';
import type { Book } from '../lib/types';
import { confirmBox, Empty, Icon, Menu, Modal, Spinner, toast, useAsync } from '../lib/ui';
import { isSeedJot, SEED_KINDS, SEEDS, seedJotText, seedOfDay, splitSeedJot, type SeedKind } from '../lib/seeds';

export interface Jot {
  id: string;
  text: string;
  done: number;
  created: number;
  updated: number;
}

/** 어디서나 Ctrl/⌘ + J → 한 줄 적기 */
export function QuickJot() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen(true);
      }
    };
    const o = () => setOpen(true);
    addEventListener('keydown', k);
    addEventListener('quick-jot', o);
    return () => {
      removeEventListener('keydown', k);
      removeEventListener('quick-jot', o);
    };
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 20);
  }, [open]);
  if (!open) return null;
  const save = async () => {
    if (!text.trim()) return setOpen(false);
    try {
      await api('jots', { body: { text } });
      setText('');
      setOpen(false);
      dispatchEvent(new Event('jots-changed'));
      toast('수첩에 적었어요');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  return (
    <Modal
      title="수첩에 적기"
      onClose={() => setOpen(false)}
      foot={
        <>
          <span className="faint tiny grow">Ctrl/⌘ + Enter 로 적기</span>
          <button onClick={() => setOpen(false)}>닫기</button>
          <button className="primary" onClick={save}>
            적기
          </button>
        </>
      }
    >
      <textarea
        ref={ref}
        className="input serif"
        rows={5}
        placeholder="떠오른 장면, 대사, 이름, 고칠 것…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save();
        }}
      />
    </Modal>
  );
}

/** 집필실에서: 수첩의 메모를 골라 원고에 넣기 */
export function JotPicker({ onPick, onClose }: { onPick: (j: Jot) => void; onClose: () => void }) {
  const { data } = useAsync(() => api<{ jots: Jot[] }>('jots'), []);
  const list = (data?.jots ?? []).filter((j) => !j.done);
  return (
    <Modal title="수첩에서 꺼내 넣기" onClose={onClose}>
      {!data ? (
        <Spinner />
      ) : !list.length ? (
        <p className="muted small">아직 쓰지 않은 메모가 없어요. 어디서나 Ctrl/⌘ + J 로 적을 수 있어요.</p>
      ) : (
        <div className="list">
          {list.map((j) => (
            <button key={j.id} className="list-item" style={{ display: 'block' }} onClick={() => onPick(j)}>
              <span className="serif" style={{ whiteSpace: 'pre-wrap', display: 'block' }}>
                {j.text}
              </span>
              <span className="faint tiny">{ago(j.updated)}</span>
            </button>
          ))}
        </div>
      )}
      <p className="faint tiny">넣은 메모는 「다 씀」으로 표시돼요.</p>
    </Modal>
  );
}

export function JotsPage() {
  const [text, setText] = useState('');
  const [show, setShow] = useState<'open' | 'done'>('open');
  const [edit, setEdit] = useState<Jot | null>(null);
  const { data, loading, reload, setData } = useAsync(async () => {
    const [j, b] = await Promise.all([api<{ jots: Jot[] }>('jots'), api<{ books: Book[] }>('books')]);
    return { jots: j.jots, books: b.books.filter((x) => !x.deleted && x.kind === 'write') };
  }, []);
  useEffect(() => {
    addEventListener('jots-changed', reload);
    return () => removeEventListener('jots-changed', reload);
  }, [reload]);
  const add = async () => {
    if (!text.trim()) return;
    const r = await api<{ jot: Jot }>('jots', { body: { text } });
    setText('');
    if (data) setData({ ...data, jots: [r.jot, ...data.jots] });
  };
  const patch = async (j: Jot, p: Partial<Jot>) => {
    await api(`jots/${j.id}`, { method: 'PATCH', body: p });
    if (data) setData({ ...data, jots: data.jots.map((x) => (x.id === j.id ? { ...x, ...p, updated: Date.now() } : x)) });
  };
  if (loading && !data) return <Spinner />;
  const jots = (data?.jots ?? []).filter((j) => (show === 'done' ? j.done : !j.done));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>아이디어 수첩</h1>
          <p className="sub">떠오른 장면 · 대사 · 이름을 적어 두는 곳. 어디서나 Ctrl/⌘ + J 로 바로 적을 수 있어요.</p>
        </div>
      </div>
      <SeedCard recent={(data?.jots ?? []).filter((j) => isSeedJot(j.text)).slice(0, 6)} onSaved={reload} />
      <div className="panel stack" style={{ marginBottom: 24 }}>
        <textarea className="input serif" rows={3} placeholder="무엇이 떠올랐나요?" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && void add()} />
        <div className="row">
          <span className="faint tiny grow">Ctrl/⌘ + Enter 로 적기</span>
          <button className="primary" disabled={!text.trim()} onClick={add}>
            적기
          </button>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="seg">
          <button className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>
            쓸 것 {(data?.jots ?? []).filter((j) => !j.done).length}
          </button>
          <button className={show === 'done' ? 'on' : ''} onClick={() => setShow('done')}>
            다 쓴 것 {(data?.jots ?? []).filter((j) => j.done).length}
          </button>
        </div>
      </div>
      {!jots.length ? (
        <Empty title={show === 'open' ? '비어 있어요' : '다 쓴 메모가 없어요'} />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {jots.map((j) => (
            <div key={j.id} className="panel row" style={{ alignItems: 'flex-start', padding: '14px 16px' }}>
              <div className="grow">
                {isSeedJot(j.text) ? (
                  <>
                    <p className="small seed-q">{splitSeedJot(j.text).q}</p>
                    <p className="serif" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>
                      {splitSeedJot(j.text).a}
                    </p>
                  </>
                ) : (
                  <p className="serif" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>
                    {j.text}
                  </p>
                )}
                <p className="faint tiny" style={{ marginTop: 6 }}>
                  {ago(j.updated)}
                </p>
              </div>
              <button className="icon-btn" aria-label={j.done ? '쓸 것으로 되돌리기' : '다 씀'} title={j.done ? '쓸 것으로 되돌리기' : '다 씀'} onClick={() => patch(j, { done: j.done ? 0 : 1 })}>
                <Icon name={j.done ? 'history' : 'check'} />
              </button>
              <Menu label="메모 메뉴">
                {(close) => (
                  <>
                    <button onClick={() => (close(), setEdit(j))}>고치기</button>
                    {(data?.books ?? []).map((b) => (
                      <button
                        key={b.id}
                        onClick={async () => {
                          close();
                          await api(`books/${b.id}`, { method: 'PATCH', body: { notes: `${b.notes ? b.notes.replace(/\s+$/, '') + '\n\n' : ''}${j.text}` } });
                          await patch(j, { done: 1 });
                          toast(`「${b.title}」 작가 노트에 넣었어요`);
                        }}
                      >
                        「{b.title}」 작가 노트로
                      </button>
                    ))}
                    <hr />
                    <button
                      className="danger"
                      onClick={async () => {
                        close();
                        if (!(await confirmBox('이 메모를 지울까요?', { danger: true, ok: '지우기' }))) return;
                        await api(`jots/${j.id}`, { method: 'DELETE' });
                        if (data) setData({ ...data, jots: data.jots.filter((x) => x.id !== j.id) });
                      }}
                    >
                      지우기
                    </button>
                  </>
                )}
              </Menu>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal
          title="메모 고치기"
          onClose={() => setEdit(null)}
          foot={
            <>
              <button onClick={() => setEdit(null)}>그만두기</button>
              <button
                className="primary"
                onClick={async () => {
                  await patch(edit, { text: edit.text });
                  setEdit(null);
                }}
              >
                저장
              </button>
            </>
          }
        >
          <textarea className="input serif" rows={6} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
        </Modal>
      )}
    </>
  );
}

/** 오늘의 글감 질문: 새 이야기 · 세계를 세워 가는 질문 하나. 답을 적으면 수첩에 남고, 원하면 AI 가 답을 보고 더 깊이 묻는다 */
function SeedCard({ recent, onSaved }: { recent: Jot[]; onSaved: () => void }) {
  const [kind, setKind] = useState<SeedKind | ''>('');
  const [skip, setSkip] = useState(0);
  const [q, setQ] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [follow, setFollow] = useState<{ q: string; about: string }[]>([]);
  const [open, setOpen] = useState(() => localStorage.getItem('seedOpen') !== '0');
  const text = q ?? SEEDS[seedOfDay(Date.now(), kind, skip)].q;
  const label = SEED_KINDS.find((k) => k.id === SEEDS.find((s) => s.q === text)?.kind)?.label;
  const next = (k: SeedKind | '' = kind) => {
    setKind(k);
    setSkip((n) => n + 1);
    setQ(null);
    setAnswer('');
    setFollow([]);
  };
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem('seedOpen', open ? '0' : '1');
    } catch {
      /* 저장 못 해도 괜찮음 */
    }
  };
  const save = async (then?: () => void) => {
    if (!answer.trim()) return;
    setBusy(true);
    try {
      await api('jots', { body: { text: seedJotText(text, answer) } });
      toast('수첩에 적었어요');
      onSaved();
      then?.();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const ask = async () => {
    setBusy(true);
    try {
      const r = await api<{ questions: { q: string; about: string }[] }>('ai/worldq', { body: { current: { q: text, a: answer }, answered: recent.map((j) => splitSeedJot(j.text)) } });
      setFollow(r.questions);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel stack seed-card" style={{ marginBottom: 20 }}>
      <div className="row">
        <h2 className="grow" style={{ fontSize: 13, letterSpacing: '.06em' }}>
          오늘의 질문 <span className="faint tiny">{label}</span>
        </h2>
        <button className="ghost small" onClick={toggle} aria-expanded={open}>
          {open ? '접기' : '펼치기'}
        </button>
      </div>
      {open && (
        <>
          <p className="serif seed-text">{text}</p>
          <textarea className="input serif" rows={4} placeholder="떠오르는 대로, 틀려도 괜찮아요. 한두 줄이면 돼요." value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="primary" disabled={!answer.trim() || busy} onClick={() => save(() => next())}>
              수첩에 적고 다음 질문
            </button>
            <button disabled={answer.replace(/\s/g, '').length < 10 || busy} onClick={ask}>
              {busy ? '생각하는 중…' : '답을 보고 더 묻기 (AI)'}
            </button>
            <span className="grow" />
            <button className="ghost small" onClick={() => next()}>
              다른 질문
            </button>
          </div>
          <div className="row wrap" style={{ gap: 4 }}>
            {SEED_KINDS.map((k) => (
              <button key={k.id} className={`chip${kind === k.id ? ' on' : ''}`} onClick={() => next(kind === k.id ? '' : k.id)}>
                {k.label}
              </button>
            ))}
          </div>
          {!!follow.length && (
            <div className="stack" style={{ gap: 8 }}>
              <h3 className="small" style={{ margin: 0 }}>
                답을 보고 떠오른 질문 <span className="faint tiny">· 질문만 드려요. 답은 작가가 정해요.</span>
              </h3>
              {follow.map((f, i) => (
                <div key={i} className="ai-card">
                  <p className="serif" style={{ margin: 0 }}>
                    {f.q}
                  </p>
                  <div className="row" style={{ gap: 6 }}>
                    {f.about && <span className="faint tiny grow">· {f.about}</span>}
                    <button
                      className="small"
                      onClick={() => {
                        // 이 질문을 지금 질문으로 삼아 이어서 답한다 (먼저 쓴 답은 수첩에)
                        const go = () => {
                          setQ(f.q);
                          setAnswer('');
                          setFollow([]);
                        };
                        if (answer.trim()) void save(go);
                        else go();
                      }}
                    >
                      이 질문에 답하기
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
