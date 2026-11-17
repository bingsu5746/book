import { useEffect, useMemo, useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import { api } from '../../lib/api';
import { local } from '../../lib/idb';
import { checkSpelling, type SpellIssue, type SpellKind } from '../../lib/spell';
import { analyze } from '../../lib/analyze';
import { ago, fmtDate, fmtNum } from '../../lib/text';
import { STATUS_LABEL, type BookNode, type Status } from '../../lib/types';
import { confirmBox, Icon, Modal, promptBox, Spinner, toast } from '../../lib/ui';
import { entriesOf, fieldsFor, kindLabel, mentionedIn, type Entry, type WEvent, type WItem } from '../../lib/world';
import type { EditorHandle } from './Editor';
import { infoGaps } from '../../lib/fillinfo';
import { AiTools } from './AiTools';
import { agesInChapter, birthYear, yearIn } from '../../lib/ages';
import { Alts } from './Alts';
import { Traces } from './Traces';

export type SideTab = 'info' | 'world' | 'spell' | 'history' | 'revise' | 'ai' | 'notes';
const LABELS = ['', '#c26b4a', '#d9a441', '#3f8a6c', '#4f6fa8', '#8a5ca8', '#77736b'];

export function SidePanel({
  tab,
  setTab,
  node,
  body,
  worldId,
  items,
  editor,
  onPatch,
  onRestore,
  bookId,
  onOpenWorld,
  summarize,
  fillInfo,
  prepareAi,
  onAddEntries,
}: {
  tab: SideTab;
  setTab: (t: SideTab) => void;
  node: BookNode | null;
  body: string;
  worldId: string | null;
  items: WItem[];
  editor: React.RefObject<EditorHandle | null>;
  onPatch: (p: Partial<BookNode>) => void;
  onRestore: (body: string) => void;
  bookId: string;
  onOpenWorld: () => void;
  summarize: (n: BookNode) => Promise<string>;
  fillInfo: (n: BookNode) => Promise<string[]>;
  prepareAi: () => Promise<void>;
  onAddEntries: (e: Entry[]) => Promise<void>;
}) {
  return (
    <aside className="side" aria-label="곁 패널">
      <div className="side-tabs" role="tablist">
        {(
          [
            ['info', '장 정보'],
            ['world', '세계관'],
            ['spell', '맞춤법'],
            ['history', '기록 · 안'],
            ['revise', '퇴고'],
            ['ai', 'AI 도움'],
            ['notes', '친구 주석'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="side-body">
        {!node && <p className="muted small">왼쪽에서 장을 골라 주세요.</p>}
        {node && tab === 'info' && <Info node={node} items={items} onPatch={onPatch} summarize={summarize} fillInfo={fillInfo} />}
        {node && tab === 'world' && <WorldTab worldId={worldId} items={items} body={body} editor={editor} onOpenWorld={onOpenWorld} nodeId={node.id} />}
        {node && tab === 'spell' && <SpellPanel key={node.id} bookId={bookId} body={body} editor={editor} />}
        {node && tab === 'history' && (
          <>
            <Alts node={node} body={body} onPatch={onPatch} onRestore={onRestore} flush={prepareAi} />
            <hr className="side-hr" />
            <History node={node} body={body} onRestore={onRestore} />
          </>
        )}
        {node && tab === 'revise' && <Revise key={node.id} nodeId={node.id} prepare={prepareAi} body={body} editor={editor} />}
        {node && tab === 'ai' && <AiTools node={node} body={body} items={items} worldId={worldId} editor={editor} prepare={prepareAi} onAddEntries={onAddEntries} />}
        {node && tab === 'notes' && <FriendNotes bookId={bookId} node={node} body={body} editor={editor} />}
      </div>
    </aside>
  );
}

function Info({ node, items, onPatch, summarize, fillInfo }: { node: BookNode; items: WItem[]; onPatch: (p: Partial<BookNode>) => void; summarize: (n: BookNode) => Promise<string>; fillInfo: (n: BookNode) => Promise<string[]> }) {
  const [syn, setSyn] = useState(node.synopsis);
  const [aiBusy, setAiBusy] = useState(false);
  const [memo, setMemo] = useState(node.meta.notes ?? '');
  useEffect(() => {
    setSyn(node.synopsis);
    setMemo(node.meta.notes ?? '');
  }, [node.id]);
  useEffect(() => setSyn(node.synopsis), [node.synopsis]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = entriesOf(items).filter((e) => e.kind === 'character');
  const places = entriesOf(items).filter((e) => e.kind === 'place');
  const aiSet = new Set<string>((node.meta.infoAi as string[] | undefined) ?? []);
  // 사람이 고친 칸은 더 이상 「AI 가 씀」이 아니다
  const meta = (k: string, v: unknown) => onPatch({ meta: { ...node.meta, [k]: v, infoAi: [...aiSet].filter((x) => x !== k) } });
  const ai = (k: string) => (aiSet.has(k) ? <span className="faint"> · AI</span> : null);
  const gaps = infoGaps(node).length;
  const [fillBusy, setFillBusy] = useState(false);
  return (
    <>
      <div className="field reveal-wrap">
        <div className="row">
          <span className="grow">줄거리 요약{node.meta.synopsisAi ? <span className="faint"> · AI 가 씀</span> : ''}</span>
          <button
            className="quiet-btn reveal"
            disabled={aiBusy}
            onClick={async () => {
              setAiBusy(true);
              try {
                const r = await summarize(node);
                setSyn(r);
              } catch (e) {
                toast((e as Error).message, 'err');
              } finally {
                setAiBusy(false);
              }
            }}
          >
            {aiBusy ? '요약하는 중…' : syn ? 'AI 로 다시 요약' : 'AI 로 요약'}
          </button>
        </div>
        <textarea className="input" rows={5} value={syn} placeholder="비워 두면 이 장을 떠날 때 AI 가 원고를 읽고 채워요" onChange={(e) => setSyn(e.target.value)} onBlur={() => syn !== node.synopsis && onPatch({ synopsis: syn, meta: { ...node.meta, synopsisAi: false } })} />
      </div>
      <label className="field">
        상태
        <select className="input" value={node.status} onChange={(e) => onPatch({ status: e.target.value as Status })}>
          {Object.entries(STATUS_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <details className="more">
        <summary>세부 정보 · 색 · 목표 · 시점 · 장소 · 메모</summary>
        {gaps > 0 && (
          <button
            className="small"
            disabled={fillBusy}
            onClick={async () => {
              setFillBusy(true);
              try {
                const f = await fillInfo(node);
                toast(f.length ? `${f.join(' · ')}을(를) 채웠어요.` : '원고에서 더 채울 만한 것을 찾지 못했어요.');
              } catch (e) {
                toast((e as Error).message, 'err');
              } finally {
                setFillBusy(false);
              }
            }}
          >
            {fillBusy ? 'AI 가 원고를 읽는 중…' : '빈 칸 AI 로 채우기'}
          </button>
        )}
      <div className="field">
        색 표시
        <div className="row">
          {LABELS.map((c) => (
            <button key={c || 'none'} className={`swatch${node.label === c ? ' on' : ''}`} style={{ background: c || 'var(--soft)', width: 22, height: 22 }} aria-label={c ? `색 ${c}` : '색 없음'} onClick={() => onPatch({ label: c })} />
          ))}
        </div>
      </div>
      <label className="field">
        이 칸 목표 글자 (공백 제외)
        <input className="input" type="number" min={0} step={500} defaultValue={Number(node.meta.target) || ''} key={`tg2${node.id}:${Number(node.meta.target) || 0}`} onBlur={(e) => +e.target.value !== (Number(node.meta.target) || 0) && meta('target', +e.target.value || 0)} />
      </label>
      <label className="field">
        <span>시점 인물{ai('pov')}</span>
        <input className="input" list="dl-people" defaultValue={node.meta.pov ?? ''} key={`pov${node.id}:${node.meta.pov ?? ''}`} onBlur={(e) => e.target.value !== (node.meta.pov ?? '') && meta('pov', e.target.value)} />
      </label>
      <label className="field">
        <span>장소{ai('place')}</span>
        <input className="input" list="dl-places" defaultValue={node.meta.place ?? ''} key={`pl${node.id}:${node.meta.place ?? ''}`} onBlur={(e) => e.target.value !== (node.meta.place ?? '') && meta('place', e.target.value)} />
      </label>
      <label className="field">
        <span>이야기 속 시간{ai('time')}</span>
        <input className="input" placeholder="예: 꿈속 오전 8시 / 현실 2년 차 봄" defaultValue={node.meta.time ?? ''} key={`tm${node.id}:${node.meta.time ?? ''}`} onBlur={(e) => e.target.value !== (node.meta.time ?? '') && meta('time', e.target.value)} />
      </label>
      <label className="field">
        <span>꼬리표 (쉼표로 나눔){ai('tags')}</span>
        <input
          className="input"
          defaultValue={(node.meta.tags ?? []).join(', ')}
          key={`tg${node.id}:${(node.meta.tags ?? []).join()}`}
          onBlur={(e) => {
            const tags = e.target.value
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean);
            if (tags.join() !== (node.meta.tags ?? []).join()) meta('tags', tags);
          }}
        />
      </label>
      <label className="field">
        장 메모 (나만 보는 곳)
        <textarea className="input" rows={6} value={memo} onChange={(e) => setMemo(e.target.value)} onBlur={() => memo !== (node.meta.notes ?? '') && meta('notes', memo)} />
      </label>
      </details>
      <datalist id="dl-people">
        {people.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <datalist id="dl-places">
        {places.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <Ages node={node} items={items} />
      <p className="faint tiny">마지막 저장 {fmtDate(node.updated, true)}</p>
    </>
  );
}

/** 이 장에서의 인물 나이 (태어난 해 + 이 장의 연도) */
function Ages({ node, items }: { node: BookNode; items: WItem[] }) {
  const body = node.body ?? '';
  const events = items.filter((i): i is WEvent => i.type === 'event' && i.nodes.includes(node.id));
  const fromTime = yearIn(String(node.meta.time ?? ''));
  const fromEvent = events.map((e) => yearIn(e.when)).find((y) => y != null) ?? null;
  const year = fromTime ?? fromEvent;
  const here = useMemo(() => mentionedIn(body, entriesOf(items).filter((e) => e.kind === 'character')), [body, items]);
  const people = here.map((h) => h.entry);
  const withBirth = people.filter((p) => birthYear(p.fields) != null);
  if (!people.length) return null;
  const rows = year != null ? agesInChapter(year, withBirth, body) : [];
  return (
    <details className="ages" open={rows.some((r) => r.mismatch.length)}>
      <summary className="small">
        이 장의 인물 나이{year != null ? ` · ${year}년` : ''}
        {rows.some((r) => r.mismatch.length) && <span className="ages-warn"> · 원고와 다른 곳</span>}
      </summary>
      {year == null ? (
        <p className="faint tiny">장 정보 「이야기 속 시간」이나 이 장과 이은 연표 사건에 「1998년」처럼 연도를 적으면, 인물의 「태어난 해」로 나이를 셈해 줘요.</p>
      ) : !withBirth.length ? (
        <p className="faint tiny">이 장에 나오는 인물의 세계관 항목에 「태어난 해」(예: 1981)를 적으면 나이를 셈해 줘요.</p>
      ) : (
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          {rows.map((r) => (
            <div key={r.name} className="small">
              <b>{r.name}</b> 만 {r.age}살 <span className="faint tiny">(세는 나이 {r.age + 1}살 · {r.born}년생)</span>
              {r.mismatch.map((m, i) => (
                <p key={i} className="tiny ages-warn" style={{ margin: '2px 0 0' }}>
                  원고에는 {m.age}살: 「{m.text}」
                </p>
              ))}
            </div>
          ))}
          <p className="faint tiny">연도: {fromTime != null ? '이 장의 「이야기 속 시간」' : '이 장과 이은 연표 사건'}. 생일 전후로 한 살 차이는 봐줘요.</p>
        </div>
      )}
    </details>
  );
}

function WorldTab({ worldId, items, body, editor, onOpenWorld, nodeId }: { worldId: string | null; items: WItem[]; body: string; editor: React.RefObject<EditorHandle | null>; onOpenWorld: () => void; nodeId: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Entry | null>(null);
  const entries = entriesOf(items);
  const here = useMemo(() => mentionedIn(body, entries), [body, entries]);
  const events = items.filter((i): i is WEvent => i.type === 'event' && i.nodes.includes(nodeId));
  if (!worldId)
    return (
      <div className="stack">
        <p className="muted small">이 책에 연결된 세계관이 없어요. 세계관을 연결하면 원고 속 이름이 항목과 이어지고, 이 장에 누가 나오는지 자동으로 모아 줘요.</p>
        <button className="primary" onClick={onOpenWorld}>
          세계관 연결하기
        </button>
      </div>
    );
  const list = q ? entries.filter((e) => [e.name, ...e.aliases, e.summary].some((x) => x.includes(q))) : entries;
  if (open) {
    const fields = fieldsFor(items, open.kind);
    return (
      <div className="stack">
        <button className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(null)}>
          <Icon name="back" size={14} />
          목록
        </button>
        <div>
          <p className="type-tag">{kindLabel(open.kind)}</p>
          <h3 className="serif" style={{ fontSize: 19 }}>
            {open.name}
          </h3>
          {!!open.aliases.length && <p className="muted small">다른 이름: {open.aliases.join(', ')}</p>}
        </div>
        {open.summary && <p className="small">{open.summary}</p>}
        <dl className="kv" style={{ gridTemplateColumns: 'auto 1fr' }}>
          {fields
            .filter((f) => open.fields[f])
            .map((f) => (
              <div key={f} style={{ display: 'contents' }}>
                <dt>{f}</dt>
                <dd style={{ textAlign: 'left', whiteSpace: 'pre-wrap' }}>{open.fields[f]}</dd>
              </div>
            ))}
        </dl>
        {open.body && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{open.body}</p>}
        <div className="row wrap">
          <button className="small" onClick={() => editor.current?.wrap(`[[${open.name}]]`, '')}>
            본문에 [[{open.name}]] 넣기
          </button>
          <a className="btn small" href={`#/worlds/${worldId}/entries/${open.id}`}>
            세계관에서 열기
          </a>
        </div>
      </div>
    );
  }
  return (
    <>
      <input className="input" placeholder="항목 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
      {!q && !!events.length && (
        <div>
          <h4>이 장의 사건 (연표)</h4>
          <div className="stack" style={{ gap: 4, marginTop: 6 }}>
            {events.map((v) => (
              <a key={v.id} className="small" href={`#/worlds/${worldId}/timeline`}>
                {v.when ? `${v.when} · ` : ''}
                {v.title}
              </a>
            ))}
          </div>
        </div>
      )}
      {!q && (
        <div>
          <h4>이 장에 나오는 항목</h4>
          {!here.length && <p className="faint small">아직 없어요. 항목 이름이나 다른 이름이 본문에 나오면 여기에 모여요.</p>}
          <div className="row wrap" style={{ marginTop: 6 }}>
            {here.map(({ entry, count }) => (
              <button key={entry.id} className="chip" onClick={() => setOpen(entry)}>
                {entry.name} <span className="faint">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <h4>{q ? '찾은 항목' : '모든 항목'}</h4>
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          {list.map((e) => (
            <button key={e.id} className="entry-card" style={{ padding: '9px 11px' }} onClick={() => setOpen(e)}>
              <span className="n" style={{ fontSize: 14 }}>
                <span className="swatch-dot" style={{ ['--c' as string]: e.color || undefined }} />
                {e.name}
                <span className="type-tag">{kindLabel(e.kind)}</span>
              </span>
              {e.summary && <span className="s">{e.summary}</span>}
            </button>
          ))}
          {!entries.length && <p className="faint small">세계관에 항목이 없어요.</p>}
        </div>
      </div>
      <a className="btn small" href={`#/worlds/${worldId}`}>
        세계관 열기
      </a>
    </>
  );
}

interface Snap {
  id: string;
  label: string;
  auto: number;
  chars: number;
  at: number;
}
function History({ node, body, onRestore }: { node: BookNode; body: string; onRestore: (b: string) => void }) {
  const [snaps, setSnaps] = useState<Snap[] | null>(null);
  const [view, setView] = useState<{ snap: Snap; body: string } | null>(null);
  const load = () =>
    api<{ snapshots: Snap[] }>(`nodes/${node.id}/snapshots`)
      .then((r) => setSnaps(r.snapshots.filter((s) => s.auto !== 2)))
      .catch(() => setSnaps([]));
  useEffect(() => {
    setSnaps(null);
    void load();
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const take = async () => {
    const label = await promptBox('이 기록의 이름', `${fmtDate(Date.now(), true)} 기록`);
    if (label == null) return;
    try {
      await api(`nodes/${node.id}/snapshots`, { body: { label } });
      toast('지금 글을 기록으로 남겼어요');
      void load();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  const open = async (s: Snap) => {
    const r = await api<{ snapshot: { body: string } }>(`snapshots/${s.id}`);
    setView({ snap: s, body: r.snapshot.body });
  };
  const parts = useMemo(() => (view ? diffWordsWithSpace(view.body, body) : []), [view, body]);
  return (
    <>
      <p className="muted small">쓰는 동안 10분마다 자동으로 남고, 원할 때 직접 남길 수도 있어요. 다른 기기에서 고친 글과 엇갈리면 그 글도 여기에 남아요.</p>
      <button className="primary" onClick={take}>
        <Icon name="history" size={16} />
        지금 상태 기록하기
      </button>
      {!snaps && <Spinner />}
      {snaps && !snaps.length && <p className="faint small">아직 기록이 없어요.</p>}
      <div className="list">
        {snaps?.map((s) => (
          <button key={s.id} className="list-item" onClick={() => open(s)}>
            <span className="grow">
              <span className="small" style={{ fontWeight: s.auto ? 400 : 600 }}>
                {s.label || '자동 기록'}
              </span>
              <br />
              <span className="faint tiny">
                {ago(s.at)} · {fmtNum(s.chars)}자
              </span>
            </span>
          </button>
        ))}
      </div>
      {view && (
        <Modal
          wide
          title={view.snap.label || `${fmtDate(view.snap.at, true)} 자동 기록`}
          onClose={() => setView(null)}
          foot={
            <>
              <button
                className="danger"
                onClick={async () => {
                  await api(`snapshots/${view.snap.id}`, { method: 'DELETE' });
                  setView(null);
                  void load();
                }}
              >
                기록 지우기
              </button>
              <span className="grow" />
              <button onClick={() => setView(null)}>닫기</button>
              <button
                className="primary"
                onClick={async () => {
                  if (!(await confirmBox('이 기록으로 되돌릴까요?', { ok: '되돌리기', detail: '지금 글은 「되돌리기 전」 기록으로 남겨 둬요.' }))) return;
                  await api(`nodes/${node.id}/snapshots`, { body: { label: '되돌리기 전' } }).catch(() => {});
                  onRestore(view.body);
                  setView(null);
                  void load();
                }}
              >
                이 기록으로 되돌리기
              </button>
            </>
          }
        >
          <p className="muted small">
            <ins style={{ background: 'color-mix(in srgb,#3f8a6c 22%,transparent)', textDecoration: 'none' }}>초록</ins>은 기록 뒤에 더한 글, <del>빨강</del>은 기록 뒤에 지운 글이에요.
          </p>
          <div className="diff">{parts.map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}</div>
        </Modal>
      )}
    </>
  );
}

function Revise({ body, editor, nodeId, prepare }: { body: string; editor: React.RefObject<EditorHandle | null>; nodeId: string; prepare: () => Promise<void> }) {
  return (
    <>
      <Traces body={body} editor={editor} />
      <hr className="side-hr" />
      <ReviseStats body={body} editor={editor} nodeId={nodeId} prepare={prepare} />
    </>
  );
}
function ReviseStats({ body, editor, nodeId, prepare }: { body: string; editor: React.RefObject<EditorHandle | null>; nodeId: string; prepare: () => Promise<void> }) {
  const [word, setWord] = useState<string | null>(null);
  const [alts, setAlts] = useState<{ word: string; options: { word: string; note: string }[] } | null>(null);
  const [altBusy, setAltBusy] = useState(false);
  const askAlts = async (w: string) => {
    setAltBusy(true);
    try {
      await prepare();
      const r = await api<{ options: { word: string; note: string }[] }>('ai/tool', { body: { tool: 'synonyms', node_id: nodeId, word: w } });
      setAlts({ word: w, options: r.options });
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setAltBusy(false);
    }
  };
  const [longAt, setLongAt] = useState(80);
  const [show, setShow] = useState<'' | 'repeat' | 'long'>('');
  const a = useMemo(() => analyze(body, { longAt }), [body, longAt]);
  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    if (show === 'repeat')
      ed.setMarks(
        a.nearRepeats.flatMap((r) => [
          { from: r.at, to: r.at + r.w.length, cls: 'cm-repeat' },
          { from: r.at2, to: r.at2 + r.w.length, cls: 'cm-repeat' },
        ]),
      );
    else if (show === 'long') ed.setMarks(a.longSentences.map((s) => ({ from: s.at, to: s.at + s.text.length, cls: 'cm-repeat' })));
    else ed.setMarks([]);
  }, [show, a, editor]);
  useEffect(() => () => editor.current?.setMarks([]), [editor]);
  return (
    <>
      <p className="muted small">한국어 형태소 분석 없이 어림으로 세요. 고칠 곳을 찾는 실마리로만 써 주세요.</p>
      <dl className="kv">
        <dt>문단</dt>
        <dd>{fmtNum(a.paragraphs)}</dd>
        <dt>문장</dt>
        <dd>{fmtNum(a.sentenceCount)}</dd>
        <dt>문장 평균 길이</dt>
        <dd>{a.avgSentence}자</dd>
        <dt>대사 비율</dt>
        <dd>{Math.round(a.dialogueShare * 100)}%</dd>
      </dl>
      <div className="seg">
        <button className={show === '' ? 'on' : ''} onClick={() => setShow('')}>
          표시 끄기
        </button>
        <button className={show === 'repeat' ? 'on' : ''} onClick={() => setShow('repeat')}>
          가까운 반복
        </button>
        <button className={show === 'long' ? 'on' : ''} onClick={() => setShow('long')}>
          긴 문장
        </button>
      </div>
      <div>
        <h4>가까이 되풀이한 말 ({a.nearRepeats.length})</h4>
        <p className="faint tiny">150자 안에 같은 말이 다시 나온 곳</p>
        <div className="row wrap" style={{ marginTop: 6 }}>
          {a.nearRepeats.slice(0, 60).map((r, i) => (
            <button key={i} className="chip" onClick={() => editor.current?.select(r.at, r.at2 + r.w.length)}>
              {r.w}
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4>
          긴 문장 ({a.longSentences.length}) ·{' '}
          <select value={longAt} onChange={(e) => setLongAt(+e.target.value)} style={{ font: 'inherit', fontSize: 12, border: 0, background: 'none', color: 'var(--muted)' }} aria-label="긴 문장 기준">
            {[60, 80, 100, 120].map((v) => (
              <option key={v} value={v}>
                {v}자 넘게
              </option>
            ))}
          </select>
        </h4>
        <div className="stack" style={{ gap: 4, marginTop: 6 }}>
          {a.longSentences.slice(0, 15).map((s, i) => (
            <button key={i} className="ghost small" style={{ whiteSpace: 'normal', textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => editor.current?.select(s.at, s.at + s.text.length)}>
              <span className="faint num">{s.len}자</span> {s.text.slice(0, 50)}…
            </button>
          ))}
        </div>
      </div>
      <div>
        <h4>자주 쓴 말</h4>
        <div className="row wrap" style={{ marginTop: 6 }}>
          {a.topWords.slice(0, 30).map((w) => (
            <button key={w.w} className={`chip${word === w.w ? ' on' : ''}`} onClick={() => (editor.current?.find(w.w), setWord(w.w))}>
              {w.w} <span className="faint">{w.n}</span>
            </button>
          ))}
        </div>
        {word && (
          <div className="ai-card" style={{ marginTop: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="small grow">
                「{word}」 — 편집기 찾기 창에서 하나씩 넘겨 볼 수 있어요.
              </span>
              <button className="small" disabled={altBusy} onClick={() => askAlts(word)}>
                {altBusy ? '찾는 중…' : '바꿔 쓸 말 (AI)'}
              </button>
            </div>
            {alts?.word === word && (
              <>
                {!alts.options.length && <p className="faint small">알맞은 말을 찾지 못했어요.</p>}
                <div className="stack" style={{ gap: 4 }}>
                  {alts.options.map((o) => (
                    <p key={o.word} className="small" style={{ margin: 0 }}>
                      <b>{o.word}</b> {o.note && <span className="faint tiny">· {o.note}</span>}
                    </p>
                  ))}
                </div>
                <p className="faint tiny">문장 맥락을 보고 고른 후보예요. 어느 자리를 바꿀지는 직접 정해 주세요.</p>
              </>
            )}
          </div>
        )}
      </div>
      <div>
        <h4>문장 끝맺음</h4>
        <p className="faint tiny">같은 끝맺음이 너무 많으면 글이 단조롭게 들릴 수 있어요.</p>
        <div className="row wrap" style={{ marginTop: 6 }}>
          {a.endings.map((e) => (
            <span key={e.e} className="chip">
              …{e.e} <span className="faint">{e.n}</span>
            </span>
          ))}
        </div>
      </div>
      {!!a.sameStarts.length && (
        <div>
          <h4>같은 말로 이어 시작한 문장</h4>
          <div className="stack" style={{ gap: 4, marginTop: 6 }}>
            {a.sameStarts.map((s, i) => (
              <button key={i} className="ghost small" style={{ justifyContent: 'flex-start' }} onClick={() => editor.current?.select(s.at, s.at + s.w.length)}>
                「{s.w}」로 {s.count}문장 연속
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

interface Anno {
  id: string;
  node_id: string;
  quote: string;
  body: string;
  nickname: string;
  author: string;
  parent_id: string | null;
  resolved: number;
  created: number;
  edition: number;
}
function FriendNotes({ bookId, node, body, editor }: { bookId: string; node: BookNode; body: string; editor: React.RefObject<EditorHandle | null> }) {
  const [list, setList] = useState<Anno[] | null>(null);
  const [all, setAll] = useState(false);
  const load = () =>
    api<{ annotations: Anno[] }>(`books/${bookId}/annotations`)
      .then((r) => setList(r.annotations))
      .catch(() => setList([]));
  useEffect(() => {
    void load();
  }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps
  const roots = (list ?? []).filter((a) => !a.parent_id && (all || a.node_id === node.id));
  useEffect(() => {
    const ed = editor.current;
    if (!ed || !list) return;
    const marks: { from: number; to: number; cls: string }[] = [];
    for (const a of list.filter((x) => !x.parent_id && x.node_id === node.id && !x.resolved && x.quote)) {
      const i = body.indexOf(a.quote);
      if (i >= 0) marks.push({ from: i, to: i + a.quote.length, cls: 'cm-anno' });
    }
    ed.setMarks(marks);
    return () => ed.setMarks([]);
  }, [list, node.id, body, editor]);
  if (!list) return <Spinner />;
  return (
    <>
      <div className="seg">
        <button className={!all ? 'on' : ''} onClick={() => setAll(false)}>
          이 장
        </button>
        <button className={all ? 'on' : ''} onClick={() => setAll(true)}>
          책 전체
        </button>
      </div>
      {!roots.length && <p className="faint small">친구가 단 주석이 없어요. 열람실에 책을 공유하면 친구가 문장마다 주석을 달 수 있어요.</p>}
      {roots.map((a) => {
        const replies = list.filter((r) => r.parent_id === a.id);
        const found = a.node_id === node.id && a.quote ? body.indexOf(a.quote) : -1;
        return (
          <div key={a.id} className="note" style={{ opacity: a.resolved ? 0.6 : 1 }}>
            {a.quote && (
              <button className="quote ghost" style={{ display: 'block', whiteSpace: 'normal', textAlign: 'left', padding: '0 0 0 8px', border: 0, borderLeft: '2px solid var(--mark-strong)', borderRadius: 0 }} onClick={() => found >= 0 && editor.current?.select(found, found + a.quote.length)} disabled={found < 0}>
                {a.quote}
              </button>
            )}
            {a.node_id === node.id && a.quote && found < 0 && <p className="faint tiny">원고가 바뀌어 이 문장을 찾지 못했어요.</p>}
            <div className="who">
              <b>{a.nickname}</b> · {ago(a.created)} · {a.edition}판{a.resolved ? ' · 반영함' : ''}
            </div>
            <div className="text">{a.body}</div>
            {!!replies.length && (
              <div className="replies">
                {replies.map((r) => (
                  <div key={r.id}>
                    <div className="who">
                      <b>{r.nickname}</b> · {ago(r.created)}
                    </div>
                    <div className="text">{r.body}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="small"
                onClick={async () => {
                  await api(`annotations/${a.id}`, { method: 'PATCH', body: { resolved: !a.resolved } });
                  void load();
                }}
              >
                <Icon name="check" size={14} />
                {a.resolved ? '반영 취소' : '반영함'}
              </button>
              <a className="btn small ghost" href={`#/hall`}>
                열람실
              </a>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- 맞춤법
function SpellPanel({ bookId, body, editor }: { bookId: string; body: string; editor: React.RefObject<EditorHandle | null> }) {
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set(local.get<string[]>(`spellIgnore:${bookId}`, [])));
  const issues = useMemo(() => checkSpelling(body, ignored), [body, ignored]);
  const [kind, setKind] = useState<'' | SpellKind>('');
  useEffect(() => {
    editor.current?.setMarks(issues.map((i) => ({ from: i.from, to: i.to, cls: i.kind === '확인' ? 'cm-spell-check' : 'cm-spell' })));
  }, [issues, editor]);
  useEffect(() => () => editor.current?.setMarks([]), [editor]);
  const fix = (i: SpellIssue) => {
    const v = editor.current?.view;
    if (!v || v.state.sliceDoc(i.from, i.to) !== i.text) return;
    v.dispatch({ changes: { from: i.from, to: i.to, insert: i.fix } });
  };
  const ignore = (i: SpellIssue) => {
    const key = i.rule === 'quote' ? `quote|${i.text}|${i.from}` : `${i.rule}|${i.text}`;
    const next = new Set(ignored).add(key);
    setIgnored(next);
    local.set(`spellIgnore:${bookId}`, [...next]);
  };
  const shown = issues.filter((i) => !kind || i.kind === kind);
  const counts = issues.reduce<Record<string, number>>((m, i) => ((m[i.kind] = (m[i.kind] ?? 0) + 1), m), {});
  return (
    <>
      <p className="muted small">자주 틀리는 맞춤법 · 띄어쓰기 · 문장 부호를 기본 규칙으로 찾아요. 모든 틀린 곳을 찾지는 못하고, 「확인」은 문맥에 따라 맞을 수도 있어요.</p>
      {!issues.length ? (
        <p className="note-box">이 장에서 찾은 곳이 없어요.</p>
      ) : (
        <>
          <div className="row wrap">
            <button className={`chip${!kind ? ' on' : ''}`} onClick={() => setKind('')}>
              전체 {issues.length}
            </button>
            {(['맞춤법', '띄어쓰기', '문장 부호', '확인'] as SpellKind[]).map((k) =>
              counts[k] ? (
                <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
                  {k} {counts[k]}
                </button>
              ) : null,
            )}
          </div>
          <button
            className="small"
            onClick={() => {
              // 하나 고칠 때마다 다시 검사한다 (겹쳐 있던 다른 틀린 곳이 드러날 수 있어서)
              const v = editor.current?.view;
              if (!v) return;
              for (let k = 0; k < 500; k++) {
                const next = checkSpelling(v.state.doc.toString(), ignored).find((x) => x.kind !== '확인' && (!kind || x.kind === kind) && x.fix !== x.text);
                if (!next) break;
                fix(next);
              }
            }}
          >
            「확인」 빼고 모두 고치기
          </button>
          <div className="stack" style={{ gap: 8 }}>
            {shown.map((i) => (
              <div key={`${i.from}:${i.rule}`} className="note" style={{ cursor: 'pointer' }} onClick={() => editor.current?.select(i.from, i.to)}>
                <div className="who">
                  <span className="chip" style={{ padding: '0 6px' }}>
                    {i.kind}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--serif)', margin: '4px 0' }}>
                  <del style={{ color: 'var(--bad)' }}>{i.text}</del> → <b>{i.fix}</b>
                </div>
                <div className="tiny muted">{i.why}</div>
                <div className="row" style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                  {i.fix !== i.text && (
                    <button className="small primary" onClick={() => fix(i)}>
                      고치기
                    </button>
                  )}
                  <button className="small ghost" onClick={() => ignore(i)}>
                    넘어가기
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {!!ignored.size && (
        <button
          className="ghost small"
          onClick={() => {
            setIgnored(new Set());
            local.set(`spellIgnore:${bookId}`, []);
          }}
        >
          넘어간 것 {ignored.size}개 다시 보기
        </button>
      )}
    </>
  );
}
