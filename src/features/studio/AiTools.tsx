// 곁 패널 「AI 도움」: 설정 충돌 검사 · 이름 뽑기 · 퇴고 제안 · 막혔을 때 질문 · 대사 분석.
// AI 는 원고를 고쳐 쓰지 않는다. 퇴고 제안도 문장마다 작가가 받아들일지 정한다.
import { useEffect, useMemo, useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import { api } from '../../lib/api';
import { endingOverlap, locate, newNames, voiceStats, worldText, type Edit, type Issue, type NameHint, type SpokenLine } from '../../lib/aitools';
import type { BookNode } from '../../lib/types';
import { Icon, Spinner, toast } from '../../lib/ui';
import { entriesOf, KINDS, newItemId, type Entry, type EntryKind, type WItem } from '../../lib/world';
import type { EditorHandle } from './Editor';

type Tool = 'reader' | 'conflicts' | 'names' | 'polish' | 'questions' | 'dialogue';
const LIST: { id: Tool; label: string; desc: string }[] = [
  { id: 'reader', label: '첫 독자 메모', desc: '처음 읽는 독자처럼, 궁금한 곳 · 늘어진 곳 · 헷갈린 곳 · 마음이 움직인 곳' },
  { id: 'conflicts', label: '설정 충돌 검사', desc: '세계관 항목 · 앞 장과 어긋나는 눈 색, 나이, 날짜 같은 곳' },
  { id: 'names', label: '인물 · 장소 뽑기', desc: '세계관에 아직 없는 이름을 찾아 항목으로 추천' },
  { id: 'polish', label: '퇴고 제안', desc: '고른 문단의 리듬 · 반복 · 어색한 문장을 고치기 전 · 후로' },
  { id: 'questions', label: '막혔을 때 질문', desc: '글 대신, 스스로 답을 찾게 돕는 질문' },
  { id: 'dialogue', label: '대사 분석', desc: '누가 말했는지 짐작해 인물별 대사 비율 · 말버릇' },
];

interface Props {
  node: BookNode;
  body: string;
  items: WItem[];
  worldId: string | null;
  editor: React.RefObject<EditorHandle | null>;
  /** 서버가 저장된 원고를 읽으므로, 부르기 전에 못 보낸 글을 보낸다 */
  prepare: () => Promise<void>;
  onAddEntries: (e: Entry[]) => Promise<void>;
}

export function AiTools(props: Props) {
  const [tool, setTool] = useState<Tool | null>(null);
  if (!tool)
    return (
      <>
        <p className="muted small">AI 는 원고와 세계관에 있는 것만 근거로 짚어 줘요. 틀릴 수 있으니 실마리로만 써 주세요. 글을 고치거나 새로 쓰는 건 작가 몫이에요.</p>
        <div className="list">
          {LIST.map((t) => (
            <button key={t.id} className="list-item" onClick={() => setTool(t.id)} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span>{t.label}</span>
              <span className="faint tiny" style={{ whiteSpace: 'normal', textAlign: 'left' }}>
                {t.desc}
              </span>
            </button>
          ))}
        </div>
      </>
    );
  const label = LIST.find((t) => t.id === tool)!.label;
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <button className="ghost small" onClick={() => setTool(null)} aria-label="AI 도움 목록으로">
          <Icon name="back" size={14} />
        </button>
        <h4 style={{ margin: 0 }}>{label}</h4>
      </div>
      {tool === 'reader' && <FirstReader key={props.node.id} {...props} />}
      {tool === 'conflicts' && <Conflicts key={props.node.id} {...props} />}
      {tool === 'names' && <Names key={props.node.id} {...props} />}
      {tool === 'polish' && <Polish key={props.node.id} {...props} />}
      {tool === 'questions' && <Questions key={props.node.id} {...props} />}
      {tool === 'dialogue' && <Dialogue key={props.node.id} {...props} />}
    </>
  );
}

/** 도구를 한 번 부르는 상태 (불러오는 중 · 오류 · 남은 횟수) */
function useCall<T>() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<T | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const run = async (prepare: () => Promise<void>, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await prepare();
      const r = await api<T & { left: number }>('ai/tool', { body });
      setLeft(r.left);
      setRes(r);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return { busy, res, left, run, setRes };
}
const Left = ({ n }: { n: number | null }) => (n == null ? null : <p className="faint tiny">오늘 AI 를 {n}번 더 쓸 수 있어요.</p>);

function Conflicts({ node, body, items, editor, prepare }: Props) {
  const entries = entriesOf(items);
  const c = useCall<{ issues: Issue[] }>();
  const found = useMemo(() => (c.res?.issues ?? []).map((i) => ({ ...i, loc: locate(body, i.quote) })), [c.res, body]);
  const shown = found.filter((i) => i.loc);
  const hidden = found.length - shown.length;
  return (
    <>
      <p className="muted small">이 장을 {entries.length ? `세계관 항목 ${entries.length}개와 ` : ''}앞 장들의 줄거리(없으면 앞부분)와 맞대어 봐요.{!entries.length && ' 세계관 항목이 없으면 앞 장과만 비교해요.'}</p>
      <button className="primary" disabled={c.busy} onClick={() => c.run(prepare, { tool: 'conflicts', node_id: node.id, world: worldText(entries, body) })}>
        {c.busy ? '살펴보는 중…' : c.res ? '다시 검사' : '검사하기'}
      </button>
      {c.busy && <Spinner label="AI 가 읽는 중" />}
      {c.res && !c.busy && (
        <>
          {!shown.length && <p className="small">어긋난 곳을 찾지 못했어요.</p>}
          <div className="stack" style={{ gap: 10 }}>
            {shown.map((i, k) => (
              <div key={k} className="ai-card">
                <button className="ghost small quote" onClick={() => editor.current?.select(i.loc!.at, i.loc!.at + i.loc!.len)}>
                  「{i.quote}」
                </button>
                <p className="small">{i.problem}</p>
                {(i.source || i.sourceQuote) && (
                  <p className="faint tiny">
                    근거: {i.source}
                    {i.sourceQuote && ` — 「${i.sourceQuote}」`}
                  </p>
                )}
              </div>
            ))}
          </div>
          {hidden > 0 && <p className="faint tiny">AI 가 짚은 {hidden}곳은 원고에서 그 문장을 찾지 못해 뺐어요.</p>}
          <Left n={c.left} />
        </>
      )}
    </>
  );
}

function Names({ node, body, items, worldId, editor, prepare, onAddEntries }: Props) {
  const entries = entriesOf(items);
  const c = useCall<{ names: NameHint[] }>();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<Record<string, EntryKind>>({});
  const list = useMemo(() => newNames(c.res?.names ?? [], entries, body), [c.res, entries, body]);
  if (!worldId) return <p className="muted small">이 책에 연결된 세계관이 없어요. 책 설정에서 세계관을 연결하면 찾은 이름을 항목으로 넣을 수 있어요.</p>;
  const add = async (hs: typeof list) => {
    const es: Entry[] = hs.map((h) => ({ id: newItemId(), type: 'entry', kind: kinds[h.name] ?? h.kind, name: h.name, aliases: [], summary: h.summary, body: '', fields: {}, tags: [], color: '' }));
    try {
      await onAddEntries(es);
      setAdded((s) => new Set([...s, ...hs.map((h) => h.name)]));
      toast(`세계관에 ${es.length}개를 넣었어요.`);
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  const rest = list.filter((h) => !added.has(h.name));
  return (
    <>
      <p className="muted small">원고에 나오지만 세계관에 아직 없는 이름을 찾아요. 원고에서 실제로 찾은 이름만 보여 줘요.</p>
      <button className="primary" disabled={c.busy} onClick={() => c.run(prepare, { tool: 'names', node_id: node.id, known: entries.flatMap((e) => [e.name, ...e.aliases]) })}>
        {c.busy ? '찾는 중…' : c.res ? '다시 찾기' : '이름 찾기'}
      </button>
      {c.busy && <Spinner label="AI 가 읽는 중" />}
      {c.res && !c.busy && (
        <>
          {!list.length && <p className="small">세계관에 없는 새 이름을 찾지 못했어요.</p>}
          <div className="stack" style={{ gap: 10 }}>
            {list.map((h) => (
              <div key={h.name} className="ai-card">
                <div className="row" style={{ gap: 6 }}>
                  <button className="ghost small" style={{ padding: 0, fontWeight: 600 }} onClick={() => editor.current?.find(h.name)}>
                    {h.name}
                  </button>
                  <span className="faint tiny">{h.count}번</span>
                  <span className="grow" />
                  {added.has(h.name) ? (
                    <span className="faint tiny">넣음</span>
                  ) : (
                    <>
                      <select className="tiny-select" value={kinds[h.name] ?? h.kind} onChange={(e) => setKinds((k) => ({ ...k, [h.name]: e.target.value as EntryKind }))} aria-label={`${h.name} 종류`}>
                        {KINDS.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                      <button className="small" onClick={() => add([h])}>
                        넣기
                      </button>
                    </>
                  )}
                </div>
                {h.summary && <p className="small muted">{h.summary}</p>}
              </div>
            ))}
          </div>
          {rest.length > 1 && (
            <button className="small" onClick={() => add(rest)}>
              {rest.length}개 모두 넣기
            </button>
          )}
          <Left n={c.left} />
        </>
      )}
    </>
  );
}

/** 고른 글, 없으면 커서가 있는 문단 */
function pickRange(ed: EditorHandle | null): { from: number; to: number; text: string } | null {
  const v = ed?.view;
  if (!v) return null;
  const r = v.state.selection.main;
  const doc = v.state.doc.toString();
  if (!r.empty) return { from: r.from, to: r.to, text: doc.slice(r.from, r.to) };
  const a = doc.lastIndexOf('\n\n', r.head - 1);
  const z = doc.indexOf('\n\n', r.head);
  const from = a < 0 ? 0 : a + 2;
  const to = z < 0 ? doc.length : z;
  const text = doc.slice(from, to);
  return text.trim() ? { from, to, text } : null;
}

function Polish({ node, editor, prepare }: Props) {
  const [range, setRange] = useState<{ from: number; to: number; text: string } | null>(null);
  const c = useCall<{ edits: Edit[] }>();
  const [state, setState] = useState<Record<number, 'ok' | 'no' | 'lost'>>({});
  const edits = useMemo(() => (c.res?.edits ?? []).filter((e) => range && locate(range.text, e.before)), [c.res, range]);
  const missing = (c.res?.edits.length ?? 0) - edits.length;
  const start = () => {
    const r = pickRange(editor.current);
    if (!r) return toast('고칠 문단을 고르거나, 문단 안에 커서를 두세요.', 'err');
    if (r.text.length > 4000) return toast('한 번에 4000자까지 볼 수 있어요. 조금 줄여서 골라 주세요.', 'err');
    setRange(r);
    setState({});
    void c.run(prepare, { tool: 'polish', node_id: node.id, text: r.text });
  };
  const accept = (k: number) => {
    const v = editor.current?.view;
    const e = edits[k];
    if (!v || !range) return;
    // 고르고 나서 글이 바뀌었을 수 있으니 고른 곳 근처부터 다시 찾는다
    const doc = v.state.doc.toString();
    const loc = locate(doc, e.before, Math.max(0, range.from - 200)) ?? locate(doc, e.before);
    if (!loc) return setState((s) => ({ ...s, [k]: 'lost' }));
    v.dispatch({ changes: { from: loc.at, to: loc.at + loc.len, insert: e.after } });
    setState((s) => ({ ...s, [k]: 'ok' }));
  };
  const open = edits.map((_, k) => k).filter((k) => !state[k]);
  return (
    <>
      <p className="muted small">편집기에서 문단을 고르거나(여러 문단도 돼요) 문단 안에 커서를 두고 누르세요. 바꿀 문장만 고치기 전 · 후로 보여 주고, 받아들인 문장만 원고에 들어가요.</p>
      <button className="primary" disabled={c.busy} onMouseDown={(e) => e.preventDefault()} onClick={start}>
        {c.busy ? '살펴보는 중…' : '고른 문단 살펴보기'}
      </button>
      {c.busy && <Spinner label="AI 가 읽는 중" />}
      {c.res && !c.busy && (
        <>
          {!edits.length && <p className="small">고칠 만한 문장을 찾지 못했어요.</p>}
          <div className="stack" style={{ gap: 10 }}>
            {edits.map((e, k) => (
              <div key={k} className={`ai-card${state[k] ? ' dim' : ''}`}>
                <div className="diff small">
                  {diffWordsWithSpace(e.before, e.after).map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}
                </div>
                {e.why && <p className="faint tiny">{e.why}</p>}
                {!state[k] && (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="small" onClick={() => accept(k)}>
                      받아들이기
                    </button>
                    <button className="ghost small" onClick={() => setState((s) => ({ ...s, [k]: 'no' }))}>
                      그대로 두기
                    </button>
                  </div>
                )}
                {state[k] === 'ok' && <p className="faint tiny">원고에 넣었어요. 되돌리려면 Ctrl+Z.</p>}
                {state[k] === 'no' && <p className="faint tiny">그대로 뒀어요.</p>}
                {state[k] === 'lost' && <p className="faint tiny">그사이 원고가 바뀌어 이 문장을 찾지 못했어요.</p>}
              </div>
            ))}
          </div>
          {open.length > 1 && (
            <button className="small" onClick={() => open.forEach(accept)}>
              남은 {open.length}개 모두 받아들이기
            </button>
          )}
          {missing > 0 && <p className="faint tiny">AI 가 낸 {missing}개는 고른 글에서 원문을 찾지 못해 뺐어요.</p>}
          <Left n={c.left} />
        </>
      )}
    </>
  );
}

function Questions({ node, prepare }: Props) {
  const c = useCall<{ questions: { q: string; about: string }[] }>();
  return (
    <>
      <p className="muted small">지금 장의 줄거리 · 원고(뒤쪽, 막힌 곳)와 앞 장 줄거리를 읽고 질문만 던져요. 답은 작가가 찾아요.</p>
      <button className="primary" disabled={c.busy} onClick={() => c.run(prepare, { tool: 'questions', node_id: node.id })}>
        {c.busy ? '생각하는 중…' : c.res ? '다른 질문 받기' : '질문 받기'}
      </button>
      {c.busy && <Spinner label="AI 가 읽는 중" />}
      {c.res && !c.busy && (
        <>
          <ol className="ai-questions">
            {c.res.questions.map((q, i) => (
              <li key={i}>
                <span className="serif">{q.q}</span>
                {q.about && <span className="faint tiny"> · {q.about}</span>}
              </li>
            ))}
          </ol>
          {!c.res.questions.length && <p className="small">질문을 만들지 못했어요. 다시 해 주세요.</p>}
          <Left n={c.left} />
        </>
      )}
    </>
  );
}

function Dialogue({ node, items, editor, prepare }: Props) {
  const c = useCall<{ lines: SpokenLine[] }>();
  const people = entriesOf(items)
    .filter((e) => e.kind === 'character')
    .map((e) => e.name);
  const stats = useMemo(() => (c.res ? voiceStats(c.res.lines) : null), [c.res]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [c.res]);
  const close = useMemo(() => {
    if (!stats) return [];
    const out: [string, string][] = [];
    const v = stats.voices.filter((x) => x.lines >= 3);
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (endingOverlap(v[i], v[j]) >= 0.75) out.push([v[i].speaker, v[j].speaker]);
    return out;
  }, [stats]);
  return (
    <>
      <p className="muted small">따옴표(“ ” 「 」)로 묶인 대사마다 누가 말했는지 AI 가 짐작하고, 비율 · 끝맺음은 그 짐작을 바탕으로 세요. 짐작이 틀릴 수 있어요.</p>
      <button className="primary" disabled={c.busy} onClick={() => c.run(prepare, { tool: 'dialogue', node_id: node.id, people })}>
        {c.busy ? '나누는 중…' : c.res ? '다시 분석' : '대사 분석하기'}
      </button>
      {c.busy && <Spinner label="AI 가 읽는 중" />}
      {stats && !c.busy && (
        <>
          <p className="small">
            대사 {c.res!.lines.length}개{stats.unknown ? ` · 누군지 모름 ${stats.unknown}개` : ''}
          </p>
          <div className="stack" style={{ gap: 8 }}>
            {stats.voices.map((v) => (
              <div key={v.speaker} className="ai-card">
                <button className="ghost small" style={{ padding: 0, justifyContent: 'space-between', width: '100%' }} onClick={() => setOpen(open === v.speaker ? null : v.speaker)} aria-expanded={open === v.speaker}>
                  <b>{v.speaker}</b>
                  <span className="faint tiny num">
                    {v.lines}개 · {Math.round(v.share * 100)}% · 평균 {v.avgLen}자
                  </span>
                </button>
                <div className="bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(2, Math.round(v.share * 100))}%` }} />
                </div>
                {!!v.endings.length && <p className="faint tiny">자주 쓰는 끝맺음: {v.endings.map((e) => `…${e.e} ${e.n}`).join(', ')}</p>}
                {open === v.speaker && (
                  <div className="stack" style={{ gap: 4 }}>
                    {v.samples.map((l) => (
                      <button key={l.id} className="ghost small" style={{ whiteSpace: 'normal', textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => editor.current?.select(l.at, l.at + l.text.length)}>
                        <span className="serif">“{l.text.length > 80 ? `${l.text.slice(0, 80)}…` : l.text}”</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {!!close.length && (
            <p className="small muted">
              끝맺음이 많이 겹쳐요: {close.map(([a, b]) => `${a} · ${b}`).join(', ')}. 말투가 비슷하게 들리는지 한번 읽어 보세요.
            </p>
          )}
          <Left n={c.left} />
        </>
      )}
    </>
  );
}

const READER_LABEL: Record<string, string> = { curious: '궁금해짐', slow: '늘어짐', confused: '헷갈림', moved: '마음이 움직임' };
function FirstReader({ node, body, editor, prepare }: Props) {
  const c = useCall<{ notes: { kind: string; quote: string; note: string }[] }>();
  const found = useMemo(() => (c.res?.notes ?? []).map((n) => ({ ...n, loc: locate(body, n.quote) })), [c.res, body]);
  const shown = found.filter((n) => n.loc);
  return (
    <>
      <p className="muted small">앞 장 줄거리를 아는 독자가 이 장을 처음 읽으며 든 반응이에요. 고쳐 쓰지 않고 반응만 남겨요. 한 독자의 감상일 뿐이니 참고로만.</p>
      <button className="primary" disabled={c.busy} onClick={() => c.run(prepare, { tool: 'reader', node_id: node.id })}>
        {c.busy ? '읽는 중…' : c.res ? '다시 읽어 달라기' : '읽어 달라기'}
      </button>
      {c.busy && <Spinner label="AI 가 읽는 중" />}
      {c.res && !c.busy && (
        <>
          {!shown.length && <p className="small">남긴 반응이 없어요.</p>}
          <div className="stack" style={{ gap: 10 }}>
            {shown.map((n, k) => (
              <div key={k} className="ai-card">
                <span className="faint tiny">{READER_LABEL[n.kind] ?? n.kind}</span>
                <button className="ghost small quote" onClick={() => editor.current?.select(n.loc!.at, n.loc!.at + n.loc!.len)}>
                  「{n.quote}」
                </button>
                <p className="small">{n.note}</p>
              </div>
            ))}
          </div>
          {found.length > shown.length && <p className="faint tiny">원고에서 문장을 찾지 못한 {found.length - shown.length}곳은 뺐어요.</p>}
          <Left n={c.left} />
        </>
      )}
    </>
  );
}
