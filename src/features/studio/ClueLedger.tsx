// 복선 장부: 원고 속 %%복선: 이름%% · %%회수: 이름%% 표시를 모아 보고, AI 에게 장마다 복선 후보를 찾아 달라고 한다.
import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { locate } from '../../lib/aitools';
import { clueMarker, collectClues, markerSpot } from '../../lib/clues';
import type { BookNode } from '../../lib/types';
import { Spinner, toast } from '../../lib/ui';

interface Hint {
  name: string;
  quote: string;
  why: string;
}

export function ClueLedger({ nodes, current, onOpen, onInsert, flush }: { nodes: BookNode[]; current: string | null; onOpen: (id: string, find: string) => void; onInsert: (id: string, at: number, text: string) => void; flush: (id: string) => Promise<void> }) {
  const text = useMemo(() => nodes.filter((n) => n.kind !== 'part' && n.kind !== 'note'), [nodes]);
  const clues = useMemo(() => collectClues(text.map((n) => ({ id: n.id, body: n.body ?? '' }))), [text]);
  const order = (id: string) => text.findIndex((n) => n.id === id);
  const title = (id: string) => {
    const i = order(id);
    return `${i + 1}. ${text[i]?.title || '제목 없음'}`;
  };
  const open = clues.filter((c) => !c.payoffs.length);
  const [pick, setPick] = useState(current && text.some((n) => n.id === current) ? current : (text[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ id: string; plants: Hint[]; payoffs: Hint[]; left: number } | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const ask = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await flush(pick);
      const r = await api<{ plants: Hint[]; payoffs: Hint[]; left: number }>('ai/tool', { body: { tool: 'clues', node_id: pick, known: clues.map((c) => c.name) } });
      setRes({ id: pick, ...r });
      setDone(new Set());
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const body = (id: string) => text.find((n) => n.id === id)?.body ?? '';
  const insert = (kind: 'plant' | 'payoff', h: Hint) => {
    if (!res) return;
    const b = body(res.id);
    const loc = locate(b, h.quote);
    if (!loc) return toast('원고에서 그 문장을 찾지 못했어요. 그사이 고쳤을 수 있어요.', 'err');
    onInsert(res.id, markerSpot(b, loc.at, loc.len), clueMarker(kind, h.name));
    setDone((s) => new Set([...s, `${kind}:${h.name}:${h.quote}`]));
    toast(`「${h.name}」을 ${kind === 'plant' ? '깐 곳' : '거둔 곳'}으로 표시했어요.`);
  };
  const hints = (kind: 'plant' | 'payoff', list: Hint[]) => {
    const b = res ? body(res.id) : '';
    const shown = list.filter((h) => locate(b, h.quote));
    return (
      <>
        {shown.map((h) => {
          const k = `${kind}:${h.name}:${h.quote}`;
          return (
            <div key={k} className="ai-card">
              <div className="row wrap" style={{ gap: 6 }}>
                <b>{h.name}</b>
                <span className="grow" />
                {done.has(k) ? (
                  <span className="faint tiny">표시함</span>
                ) : (
                  <button className="small" onClick={() => insert(kind, h)}>
                    {kind === 'plant' ? '깐 곳으로 표시' : '거둔 곳으로 표시'}
                  </button>
                )}
              </div>
              <button className="ghost small quote" onClick={() => res && onOpen(res.id, h.quote)}>
                「{h.quote}」
              </button>
              {h.why && <p className="faint tiny">{h.why}</p>}
            </div>
          );
        })}
        {list.length > shown.length && <p className="faint tiny">AI 가 짚은 {list.length - shown.length}곳은 원고에서 그 문장을 찾지 못해 뺐어요.</p>}
      </>
    );
  };

  return (
    <div className="view-pad stack" style={{ gap: 22, maxWidth: 860 }}>
      <section className="panel stack">
        <h3 className="serif">복선 장부</h3>
        <p className="muted small">
          원고에 <code>%%복선: 은열쇠%%</code> 처럼 적으면 깐 곳, <code>%%회수: 은열쇠%%</code> 는 거둔 곳이에요(「떡밥」 · 「거둠」도 돼요, 이름 뒤에 「 - 메모」). 작가 메모라 리더 · 공유본에는 보이지 않아요.
        </p>
        <p className="small">
          복선 {clues.length}개 · <b>아직 안 거둔 것 {open.length}개</b>
        </p>
        {!clues.length && <p className="faint small">아직 표시한 복선이 없어요. 아래 AI 로 장마다 찾아볼 수 있어요.</p>}
        <div className="list">
          {[...clues]
            .sort((a, b) => Number(!!a.payoffs.length) - Number(!!b.payoffs.length) || order(a.plants[0]?.nodeId ?? a.payoffs[0].nodeId) - order(b.plants[0]?.nodeId ?? b.payoffs[0].nodeId))
            .map((c) => (
              <div key={c.name} className="list-item clue-row">
                <span className="clue-name">
                  <b>{c.name}</b>
                  <span className={`clue-state${c.payoffs.length ? '' : ' open'}`}>{c.payoffs.length ? '거둠' : !c.plants.length ? '깐 곳 없음' : '아직'}</span>
                </span>
                <span className="clue-spots">
                  <span className="faint tiny">깐 곳</span>
                  {c.plants.map((s, i) => (
                    <button key={i} className="chip" onClick={() => onOpen(s.nodeId, c.name)} title={s.note}>
                      {title(s.nodeId)}
                    </button>
                  ))}
                  {!c.plants.length && <span className="faint tiny">—</span>}
                  <span className="faint tiny">→ 거둔 곳</span>
                  {c.payoffs.map((s, i) => (
                    <button key={i} className="chip" onClick={() => onOpen(s.nodeId, c.name)} title={s.note}>
                      {title(s.nodeId)}
                    </button>
                  ))}
                  {!c.payoffs.length && <span className="faint tiny">—</span>}
                </span>
                {[...c.plants, ...c.payoffs].some((s) => s.note) && <span className="faint tiny clue-note">{[...c.plants, ...c.payoffs].map((s) => s.note).filter(Boolean).join(' · ')}</span>}
              </div>
            ))}
        </div>
      </section>
      <section className="panel stack">
        <h3 className="serif">AI 로 복선 찾기</h3>
        <p className="muted small">고른 장과 앞 장 줄거리를 읽고, 깔아 둔 것 같은 것과 앞의 복선을 거두는 대목을 찾아요. 원고에서 문장을 찾을 수 있는 것만 보여 주고, 「표시」를 눌러야 원고에 들어가요.</p>
        <div className="row wrap">
          <select className="input" style={{ width: 'auto', maxWidth: '100%' }} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="찾을 장">
            {text.map((n, i) => (
              <option key={n.id} value={n.id}>
                {i + 1}. {n.title || '제목 없음'}
              </option>
            ))}
          </select>
          <button className="primary" disabled={busy || !pick} onClick={ask}>
            {busy ? '읽는 중…' : '이 장에서 찾기'}
          </button>
        </div>
        {busy && <Spinner label="AI 가 읽는 중" />}
        {res && !busy && (
          <>
            <h4>깔아 둔 것 같은 것</h4>
            {hints('plant', res.plants)}
            {!res.plants.length && <p className="faint small">찾지 못했어요.</p>}
            <h4>앞의 복선을 거두는 대목</h4>
            {hints('payoff', res.payoffs)}
            {!res.payoffs.length && <p className="faint small">찾지 못했어요.</p>}
            <p className="faint tiny">오늘 AI 를 {res.left}번 더 쓸 수 있어요.</p>
          </>
        )}
      </section>
    </div>
  );
}
