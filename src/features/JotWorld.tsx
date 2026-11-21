// 수첩 답으로 세계관 만들기: 「오늘의 질문」에 답해 둔 글에서 AI 가 인물 · 장소 · 규칙 후보를 뽑고, 고른 것만 세계관 항목으로 넣는다.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { locate } from '../lib/aitools';
import { go } from '../lib/router';
import { Modal, Spinner, promptBox, toast } from '../lib/ui';
import { entriesOf, KINDS, loadWorld, newItemId, saveItems, type Entry, type EntryKind } from '../lib/world';

interface Hint {
  name: string;
  kind: EntryKind;
  summary: string;
  quote: string;
}
interface WorldRow {
  id: string;
  title: string;
}

export function JotWorld({ text, count, onClose }: { text: string; count: number; onClose: () => void }) {
  const [worlds, setWorlds] = useState<WorldRow[] | null>(null);
  const [world, setWorld] = useState(''); // '' = 새 세계
  const [known, setKnown] = useState<string[]>([]);
  const [hints, setHints] = useState<Hint[] | null>(null);
  const [dropped, setDropped] = useState(0);
  const [pick, setPick] = useState<Set<number>>(new Set());
  const [kinds, setKinds] = useState<Record<number, EntryKind>>({});
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    api<{ worlds: WorldRow[] }>('worlds')
      .then((r) => {
        setWorlds(r.worlds);
        if (r.worlds[0]) setWorld(r.worlds[0].id);
      })
      .catch(() => setWorlds([]));
  }, []);
  useEffect(() => {
    if (!world) return setKnown([]);
    loadWorld(world)
      .then((w) => setKnown(entriesOf(w.items).flatMap((e) => [e.name, ...e.aliases])))
      .catch(() => setKnown([]));
  }, [world]);

  const ask = async () => {
    setBusy(true);
    try {
      const r = await api<{ names: Hint[]; left: number }>('ai/extract', { body: { text, known } });
      // 수첩 글에서 그 근거를 찾을 수 있는 것만, 이미 있는 이름은 뺀다
      const have = new Set(known);
      const ok = r.names.filter((h) => !have.has(h.name) && locate(text, h.quote));
      setDropped(r.names.length - ok.length);
      setHints(ok);
      setPick(new Set(ok.map((_, i) => i)));
      setKinds({});
      setLeft(r.left);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const chosen = useMemo(() => (hints ?? []).map((h, i) => ({ h, i })).filter((x) => pick.has(x.i)), [hints, pick]);
  const add = async () => {
    const entries: Entry[] = chosen.map(({ h, i }) => ({ id: newItemId(), type: 'entry', kind: kinds[i] ?? h.kind, name: h.name, aliases: [], summary: h.summary, body: '', fields: {}, tags: [], color: '' }));
    setBusy(true);
    try {
      let id = world;
      if (!id) {
        const title = await promptBox('새 세계의 이름', '새 세계');
        if (title == null) return;
        const r = await api<{ world: { id: string } }>('worlds', { body: { title: title || '새 세계', items: entries.map(({ id: eid, type, ...data }) => ({ id: eid, type, data })) } });
        id = r.world.id;
      } else await saveItems(id, entries);
      toast(`세계관에 ${entries.length}개를 넣었어요`);
      onClose();
      go(`worlds/${id}`);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title="수첩 답으로 세계관 만들기"
      onClose={onClose}
      foot={
        hints ? (
          <>
            <span className="faint small grow">{chosen.length}개 고름</span>
            <button onClick={onClose}>닫기</button>
            <button className="primary" disabled={!chosen.length || busy} onClick={add}>
              세계관에 넣기
            </button>
          </>
        ) : (
          <button onClick={onClose}>닫기</button>
        )
      }
    >
      <p className="muted small">「오늘의 질문」에 답한 수첩 글 {count}개를 AI 가 읽고, 답에 쓰인 인물 · 장소 · 세력 · 규칙 후보를 뽑아요. 답에 없는 설정은 보태지 않고, 고른 것만 세계관에 들어가요.</p>
      {worlds && (
        <label className="field">
          넣을 세계
          <select className="input" value={world} onChange={(e) => (setWorld(e.target.value), setHints(null))}>
            {worlds.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
            <option value="">+ 새 세계 만들기</option>
          </select>
        </label>
      )}
      <div className="row">
        <button className="primary" disabled={busy || !worlds} onClick={ask}>
          {busy && !hints ? '읽는 중…' : hints ? '다시 뽑기' : '후보 뽑기 (AI)'}
        </button>
        {left != null && <span className="faint tiny">오늘 AI 를 {left}번 더 쓸 수 있어요.</span>}
      </div>
      {busy && !hints && <Spinner label="AI 가 수첩을 읽는 중" />}
      {hints && (
        <>
          {!hints.length && <p className="small">세계관에 새로 넣을 후보를 찾지 못했어요.</p>}
          <div className="stack" style={{ gap: 8 }}>
            {hints.map((h, i) => (
              <div key={i} className="ai-card">
                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    aria-label={`${h.name} 고르기`}
                    checked={pick.has(i)}
                    onChange={(e) =>
                      setPick((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(i);
                        else n.delete(i);
                        return n;
                      })
                    }
                  />
                  <b className="serif grow">{h.name}</b>
                  <select className="tiny-select" value={kinds[i] ?? h.kind} onChange={(e) => setKinds((k) => ({ ...k, [i]: e.target.value as EntryKind }))} aria-label={`${h.name} 종류`}>
                    {KINDS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="small" style={{ margin: 0 }}>
                  {h.summary}
                </p>
                <p className="faint tiny" style={{ margin: 0 }}>
                  근거: 「{h.quote}」
                </p>
              </div>
            ))}
          </div>
          {dropped > 0 && <p className="faint tiny">수첩에서 근거를 찾지 못했거나 이미 있는 {dropped}개는 뺐어요.</p>}
        </>
      )}
    </Modal>
  );
}
