import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { COVERS } from '../../lib/colors';
import { Cover } from '../../lib/BookCard';
import { COVER_STYLES, type CoverStyle } from '../../lib/cover';
import { go } from '../../lib/router';
import { flatten } from '../../lib/store';
import { ago, charsNoSpace, fmtDate, fmtNum, today } from '../../lib/text';
import { KIND_LABEL, STATUS_LABEL, type Book, type BookNode, type NodeKind, type Status } from '../../lib/types';
import { confirmBox, Icon, promptBox, Spinner, toast, useAsync } from '../../lib/ui';
import type { World } from '../../lib/world';
import { Editor, type EntryRef } from './Editor';
import { EditionDiff } from './EditionDiff';

const STATUS_COLOR: Record<string, string> = { '': 'var(--line-strong)', idea: '#b9b2a3', draft: '#d9a441', revise: '#c26b4a', done: '#3f8a6c' };

// ---------------------------------------------------------------- 코르크보드
export function Corkboard({ nodes, onOpen, onMove, onAdd }: { nodes: BookNode[]; onOpen: (id: string) => void; onMove: (id: string, parent: string | null, sort: number) => void; onAdd: (k: NodeKind, parent: string | null) => void }) {
  const flat = flatten(nodes.filter((n) => n.kind !== 'note'));
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pov, setPov] = useState('');
  const povs = [...new Set(nodes.map((n) => n.meta.pov).filter(Boolean))] as string[];
  const dropOn = (target: BookNode) => {
    if (!drag || drag === target.id) return;
    const sib = nodes.filter((n) => n.parent_id === target.parent_id && n.id !== drag).sort((a, b) => a.sort - b.sort);
    const i = sib.findIndex((x) => x.id === target.id);
    const prev = sib[i - 1];
    onMove(drag, target.parent_id, prev ? (prev.sort + target.sort) / 2 : target.sort - 1);
  };
  return (
    <div className="cork">
      <div style={{ gridColumn: '1/-1' }} className="row wrap">
        <p className="muted small grow">카드를 끌어 순서를 바꿔요. 카드를 누르면 원고가 열려요. 줄거리는 곁 패널 「장 정보」에서 써요.</p>
        {!!povs.length && (
          <select className="input" style={{ width: 'auto' }} value={pov} onChange={(e) => setPov(e.target.value)} aria-label="시점 인물로 거르기">
            <option value="">모든 시점</option>
            {povs.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        )}
        <button className="small" onClick={() => onAdd('chapter', null)}>
          <Icon name="plus" size={14} />새 장
        </button>
      </div>
      {flat.map((n) =>
        n.kind === 'part' ? (
          <div key={n.id} className="cork-part">
            {n.title}
          </div>
        ) : (
          <button
            key={n.id}
            className={`cork-card${over === n.id ? ' drop' : ''}`}
            style={{ ['--card-c' as string]: n.label || STATUS_COLOR[n.status], marginLeft: n.kind === 'scene' ? 14 : 0, opacity: pov && n.meta.pov !== pov ? 0.3 : 1 }}
            draggable
            onDragStart={() => setDrag(n.id)}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(n.id);
            }}
            onDragLeave={() => setOver((o) => (o === n.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              dropOn(n);
              setOver(null);
            }}
            onClick={() => onOpen(n.id)}
          >
            <span className="t">{n.title || `제목 없는 ${KIND_LABEL[n.kind]}`}</span>
            <span className="s">{n.synopsis || (n.body ?? '').replace(/[#*>%[\]]/g, '').slice(0, 160) || '아직 비어 있어요'}</span>
            <span className="f">
              <span>{KIND_LABEL[n.kind]}</span>
              {n.status && <span>· {STATUS_LABEL[n.status]}</span>}
              {n.meta.pov && <span>· {n.meta.pov}</span>}
              <span className="grow" />
              <span className="num">{fmtNum(n.chars)}자</span>
            </span>
          </button>
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 개요 (표)
export function Outline({ nodes, onOpen, onPatch }: { nodes: BookNode[]; onOpen: (id: string) => void; onPatch: (id: string, p: Partial<BookNode>) => void }) {
  const flat = flatten(nodes.filter((n) => n.kind !== 'note'));
  const meta = (n: BookNode, k: string, v: string) => v !== (n.meta[k] ?? '') && onPatch(n.id, { meta: { ...n.meta, [k]: v } });
  return (
    <div className="view-pad">
      <p className="muted small" style={{ marginBottom: 12 }}>
        책 전체를 표로 보고 바로 고쳐요. 시점 · 장소 · 시간을 채워 두면 엇갈림을 찾기 쉬워요.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="outline-table">
          <thead>
            <tr>
              <th style={{ minWidth: 160 }}>제목</th>
              <th style={{ minWidth: 260 }}>줄거리</th>
              <th style={{ width: 100 }}>상태</th>
              <th style={{ width: 110 }}>시점</th>
              <th style={{ width: 110 }}>장소</th>
              <th style={{ width: 130 }}>이야기 속 시간</th>
              <th style={{ width: 70, textAlign: 'right' }}>글자</th>
            </tr>
          </thead>
          <tbody>
            {flat.map((n) =>
              n.kind === 'part' ? (
                <tr key={n.id} className="part">
                  <td colSpan={7}>{n.title}</td>
                </tr>
              ) : (
                <tr key={n.id}>
                  <td style={{ paddingLeft: n.kind === 'scene' ? 20 : 6 }}>
                    <input defaultValue={n.title} onBlur={(e) => e.target.value !== n.title && onPatch(n.id, { title: e.target.value })} />
                    <button className="ghost small" onClick={() => onOpen(n.id)}>
                      열기
                    </button>
                  </td>
                  <td>
                    <textarea rows={2} defaultValue={n.synopsis} onBlur={(e) => e.target.value !== n.synopsis && onPatch(n.id, { synopsis: e.target.value })} />
                  </td>
                  <td>
                    <select value={n.status} onChange={(e) => onPatch(n.id, { status: e.target.value as Status })}>
                      {Object.entries(STATUS_LABEL).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input defaultValue={n.meta.pov ?? ''} onBlur={(e) => meta(n, 'pov', e.target.value)} />
                  </td>
                  <td>
                    <input defaultValue={n.meta.place ?? ''} onBlur={(e) => meta(n, 'place', e.target.value)} />
                  </td>
                  <td>
                    <input defaultValue={n.meta.time ?? ''} onBlur={(e) => meta(n, 'time', e.target.value)} />
                  </td>
                  <td className="num faint" style={{ textAlign: 'right' }}>
                    {fmtNum(n.chars)}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 통계 · 목표
export function streakOf(days: Map<string, number>, goal: number): number {
  let s = 0;
  const d = new Date();
  // 오늘 아직 안 썼으면 어제부터 센다
  if ((days.get(today(d)) ?? 0) < Math.max(1, goal)) d.setDate(d.getDate() - 1);
  while ((days.get(today(d)) ?? 0) >= Math.max(1, goal)) {
    s++;
    d.setDate(d.getDate() - 1);
  }
  return s;
}

export function Heatmap({ days, weeks = 26 }: { days: Map<string, number>; weeks?: number }) {
  const cells: { day: string; v: number }[] = [];
  const d = new Date();
  d.setDate(d.getDate() - (weeks * 7 - 1) - d.getDay());
  const end = new Date();
  while (d <= end) {
    cells.push({ day: today(d), v: days.get(today(d)) ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  const max = Math.max(1, ...cells.map((c) => c.v));
  return (
    <div className="heat" role="img" aria-label="날마다 쓴 글자 수">
      {cells.map((c) => (
        <i key={c.day} title={`${c.day} · ${fmtNum(c.v)}자`} className={c.v ? `l${Math.min(4, Math.ceil((c.v / max) * 4))}` : ''} />
      ))}
    </div>
  );
}

export function BookStats({ book, nodes, onPatchBook }: { book: Book; nodes: BookNode[]; onPatchBook: (p: Record<string, unknown>) => void }) {
  const { data } = useAsync(() => api<{ days: { day: string; chars: number }[] }>('stats'), []);
  const days = useMemo(() => new Map((data?.days ?? []).map((d) => [d.day, d.chars])), [data]);
  const text = nodes.filter((n) => n.kind !== 'note' && n.kind !== 'part');
  const total = text.reduce((s, n) => s + charsNoSpace(n.body ?? ''), 0);
  const dailyGoal = Number(book.meta.dailyGoal ?? 0);
  const left = Math.max(0, book.goal_chars - total);
  const daysLeft = book.deadline ? Math.max(1, Math.ceil((new Date(book.deadline + 'T23:59:59').getTime() - Date.now()) / 86_400_000)) : null;
  const flat = flatten(text);
  const max = Math.max(1, ...flat.map((n) => n.chars));
  const byStatus = Object.keys(STATUS_LABEL).map((k) => ({ k, n: text.filter((x) => x.status === k).length }));
  return (
    <div className="view-pad stack" style={{ gap: 24, maxWidth: 900 }}>
      <div className="stat-grid">
        <div className="stat">
          <div className="v">{fmtNum(total)}</div>
          <div className="k">책 전체 글자 (공백 제외)</div>
        </div>
        <div className="stat">
          <div className="v">{fmtNum(days.get(today()) ?? 0)}</div>
          <div className="k">오늘 쓴 글자 (모든 책){dailyGoal ? ` / 목표 ${fmtNum(dailyGoal)}` : ''}</div>
        </div>
        <div className="stat">
          <div className="v">{streakOf(days, dailyGoal)}일</div>
          <div className="k">{dailyGoal ? '목표를 채운 날 연속' : '쓴 날 연속'}</div>
        </div>
        {book.goal_chars > 0 && (
          <div className="stat">
            <div className="v">{Math.min(100, Math.round((total / book.goal_chars) * 100))}%</div>
            <div className="k">목표 {fmtNum(book.goal_chars)}자까지 {fmtNum(left)}자</div>
          </div>
        )}
        {daysLeft != null && left > 0 && (
          <div className="stat">
            <div className="v">{fmtNum(Math.ceil(left / daysLeft))}</div>
            <div className="k">
              마감({book.deadline})까지 {daysLeft}일 · 하루에 쓸 글자
            </div>
          </div>
        )}
      </div>
      <section className="panel stack">
        <h3 className="serif">목표</h3>
        <div className="row wrap" style={{ gap: 12 }}>
          <label className="field">
            책 목표 분량 (글자)
            <input className="input" type="number" min={0} step={1000} defaultValue={book.goal_chars || ''} onBlur={(e) => onPatchBook({ goal_chars: +e.target.value || 0 })} />
          </label>
          <label className="field">
            마감일
            <input className="input" type="date" defaultValue={book.deadline ?? ''} onBlur={(e) => onPatchBook({ deadline: e.target.value || null })} />
          </label>
          <label className="field">
            하루 목표 (글자)
            <input className="input" type="number" min={0} step={100} defaultValue={dailyGoal || ''} onBlur={(e) => onPatchBook({ meta: { ...book.meta, dailyGoal: +e.target.value || 0 } })} />
          </label>
        </div>
      </section>
      <section className="panel stack">
        <h3 className="serif">쓴 날 (최근 반년)</h3>
        <Heatmap days={days} />
        <p className="faint tiny">원고에 글자가 늘어난 만큼 세요. 지운 글자는 빼지 않아요.</p>
      </section>
      <section className="panel stack">
        <h3 className="serif">장별 분량</h3>
        <div className="bars" style={{ height: 120 }}>
          {flat.map((n) => (
            <i key={n.id} title={`${n.title} · ${fmtNum(n.chars)}자`} style={{ height: `${(n.chars / max) * 100}%`, background: n.label || STATUS_COLOR[n.status] || 'var(--accent)' }} />
          ))}
        </div>
        <div className="row wrap small muted">
          {byStatus
            .filter((s) => s.n)
            .map((s) => (
              <span key={s.k} className="row" style={{ gap: 4 }}>
                <span className="swatch-dot" style={{ ['--c' as string]: STATUS_COLOR[s.k] }} />
                {STATUS_LABEL[s.k as Status]} {s.n}
              </span>
            ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- 작가 노트
export function BookNotes({ book, entries, onSave }: { book: Book; entries: EntryRef[]; onSave: (notes: string) => void }) {
  const [t, setT] = useState<number>(0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ed-head">
        <p className="muted small">책 전체에 대한 메모 · 자료 · 수정 계획. 원고에는 들어가지 않아요.</p>
      </div>
      <Editor
        doc={book.notes}
        entries={entries}
        focusMode={false}
        typewriterMode={false}
        dialogueTint={false}
        onChange={(d) => {
          clearTimeout(t);
          setT(window.setTimeout(() => onSave(d), 1000));
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- 책 설정 · 공유
export function BookSettings({ book, nodes, onPatch, onWorldLinked }: { book: Book; nodes: BookNode[]; onPatch: (p: Record<string, unknown>) => void; onWorldLinked: (id: string | null) => void }) {
  const [cmp, setCmp] = useState<{ id: string; number: number } | null>(null);
  const readers = useAsync(() => api<{ readers: { nickname: string; at: number; f: number; node_title: string }[] }>(`books/${book.id}/readers`), [book.id]);
  const worlds = useAsync(() => api<{ worlds: World[] }>('worlds'), []);
  const [editions, setEditions] = useState<{ id: string; number: number; note: string; created: number; chars: number }[] | null>(null);
  const [shared, setShared] = useState(!!book.shared);
  const [shareWorld, setShareWorld] = useState(!!book.share_world);
  const loadEd = () =>
    api(`books/${book.id}/editions`)
      .then((r) => setEditions(r.editions))
      .catch(() => setEditions([]));
  useEffect(() => {
    void loadEd();
  }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const publish = async () => {
    const note = await promptBox('이번 판에 남길 말 (친구에게 보여요)', '', { placeholder: '예: 2부까지 고쳤어요. 4장 대사를 봐 주세요.', ok: '공유하기', multiline: true });
    if (note == null) return;
    try {
      const r = await api(`books/${book.id}/publish`, { body: { note, share_world: shareWorld } });
      setShared(true);
      toast(`${r.edition.number}판을 공유했어요`);
      void loadEd();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  return (
    <div className="view-pad stack" style={{ gap: 20, maxWidth: 720 }}>
      <section className="panel stack">
        <h3 className="serif">책 정보</h3>
        <label className="field">
          제목
          <input className="input" defaultValue={book.title} onBlur={(e) => e.target.value !== book.title && onPatch({ title: e.target.value })} />
        </label>
        <label className="field">
          부제
          <input className="input" defaultValue={book.subtitle} onBlur={(e) => e.target.value !== book.subtitle && onPatch({ subtitle: e.target.value })} />
        </label>
        <label className="field">
          지은이 (표지에 보이는 이름)
          <input className="input" defaultValue={book.author} onBlur={(e) => e.target.value !== book.author && onPatch({ author: e.target.value })} />
        </label>
        <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
          <div style={{ width: 120, flex: 'none' }}>
            <Cover title={book.title} author={book.author} color={book.color} seed={book.id} style={book.meta.coverStyle as CoverStyle | undefined} />
          </div>
          <div className="stack grow" style={{ gap: 10 }}>
            <div className="field">
              표지 모양
              <div className="seg">
                {COVER_STYLES.map((c) => (
                  <button key={c.id} className={(book.meta.coverStyle ?? 'classic') === c.id ? 'on' : ''} onClick={() => onPatch({ meta: { ...book.meta, coverStyle: c.id } })}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              표지 색
              <div className="row wrap">
                {COVERS.map(([bg]) => (
                  <button key={bg} className={`swatch${book.color === bg ? ' on' : ''}`} style={{ background: bg }} aria-label={`표지 색 ${bg}`} onClick={() => onPatch({ color: bg })} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="panel stack">
        <h3 className="serif">세계관</h3>
        {worlds.loading ? (
          <Spinner />
        ) : (
          <>
            <select
              className="input"
              value={book.world_id ?? ''}
              onChange={async (e) => {
                const v = e.target.value || null;
                await onPatch({ world_id: v });
                onWorldLinked(v);
              }}
            >
              <option value="">연결하지 않음</option>
              {worlds.data?.worlds
                .filter((w) => !w.deleted)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
            </select>
            <div className="row wrap">
              <button
                onClick={async () => {
                  const title = await promptBox('새 세계 이름', `${book.title}의 세계`);
                  if (!title) return;
                  const r = await api('worlds', { body: { title } });
                  await onPatch({ world_id: r.world.id });
                  onWorldLinked(r.world.id);
                  worlds.reload();
                  toast('새 세계를 만들어 연결했어요');
                }}
              >
                새 세계 만들어 연결
              </button>
              {book.world_id && (
                <a className="btn" href={`#/worlds/${book.world_id}`}>
                  세계관 열기
                </a>
              )}
            </div>
          </>
        )}
      </section>
      <section className="panel stack">
        <h3 className="serif">열람실에 공유</h3>
        <p className="muted small">공유하면 지금 원고를 「판」으로 찍어 친구에게 보여요. 계속 고쳐도 친구가 읽는 글은 그대로이고, 새 판을 찍으면 바뀌어요. 메모(바인더의 「메모」)와 %%작가 메모%%는 빠져요.</p>
        <label className="check">
          <input
            type="checkbox"
            checked={shareWorld}
            onChange={(e) => {
              setShareWorld(e.target.checked);
              onPatch({ share_world: e.target.checked });
            }}
            disabled={!book.world_id}
          />
          세계관도 함께 보여 주기 (읽기만)
        </label>
        <div className="row wrap">
          <button className="primary" onClick={publish}>
            <Icon name="share" size={16} />
            {editions?.length ? '새 판 공유하기' : '공유하기'}
          </button>
          {shared && !!editions?.length && (
            <>
              <a className="btn" href={`#/edition/${editions[0].id}`}>
                공유본 보기
              </a>
              <button
                onClick={async () => {
                  if (!(await confirmBox('공유를 멈출까요?', { ok: '공유 멈추기', detail: '친구가 더는 이 책을 볼 수 없어요. 달린 주석은 남아 있어요.' }))) return;
                  await api(`books/${book.id}/unshare`, { body: {} });
                  setShared(false);
                }}
              >
                공유 멈추기
              </button>
            </>
          )}
        </div>
        {!!editions?.length && (
          <div className="list">
            {editions.map((e) => (
              <div key={e.id} className="list-item">
                <a href={`#/edition/${e.id}`}>
                  <b>{e.number}판</b>
                </a>
                <span className="grow muted small">{e.note}</span>
                <span className="faint tiny">
                  {fmtDate(e.created)} · {fmtNum(e.chars)}자
                </span>
                <button className="small" onClick={() => setCmp({ id: e.id, number: e.number })}>
                  지금과 비교
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      {!!readers.data?.readers.length && (
        <section className="panel stack">
          <h3 className="serif">친구가 읽은 자리</h3>
          <div className="list">
            {readers.data.readers.map((r) => (
              <div key={r.nickname} className="list-item">
                <b>{r.nickname}</b>
                <span className="grow muted small">{r.f >= 0.999 ? '다 읽었어요' : r.node_title ? `「${r.node_title}」까지` : ''}</span>
                <span className="meter" style={{ width: 90, margin: 0 }}>
                  <i style={{ width: `${Math.round(r.f * 100)}%` }} />
                </span>
                <span className="faint tiny">{ago(r.at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {cmp && <EditionDiff editionId={cmp.id} number={cmp.number} nodes={nodes} onClose={() => setCmp(null)} />}
      <section className="panel stack">
        <h3 className="serif">책 종류</h3>
        <p className="muted small">지금: {book.kind === 'write' ? '내 원고' : '들인 책 (서재의 「들인 책」에 보이고 공유할 수 없어요)'}</p>
        <div>
          <button onClick={() => onPatch({ kind: book.kind === 'write' ? 'read' : 'write' })}>{book.kind === 'write' ? '들인 책으로 옮기기' : '내 원고로 옮기기'}</button>
        </div>
      </section>
      <section className="panel stack">
        <h3 className="serif">책 지우기</h3>
        <p className="muted small">휴지통에 30일 동안 있다가 지워져요. 서재 맨 아래 휴지통에서 되살릴 수 있어요.</p>
        <div>
          <button
            className="danger"
            onClick={async () => {
              if (!(await confirmBox(`「${book.title}」을(를) 휴지통에 넣을까요?`, { danger: true, ok: '휴지통에 넣기' }))) return;
              await api(`books/${book.id}`, { method: 'DELETE' });
              go('studio');
            }}
          >
            휴지통에 넣기
          </button>
        </div>
      </section>
    </div>
  );
}
