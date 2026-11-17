// 한 장의 다른 안 (A안 · B안 …): 지금 원고가 고른 안이고, 나머지 안은 기록 표에 「안」으로 남는다.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, fmtNum } from '../../lib/text';
import type { BookNode } from '../../lib/types';
import { confirmBox, Modal, promptBox, toast } from '../../lib/ui';

interface Alt {
  id: string;
  label: string;
  auto: number;
  chars: number;
  at: number;
}
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function Alts({ node, body, onPatch, onRestore, flush }: { node: BookNode; body: string; onPatch: (p: Partial<BookNode>) => void; onRestore: (b: string) => void; flush: () => Promise<void> }) {
  const [alts, setAlts] = useState<Alt[]>([]);
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState<string | null>(null);
  const [view, setView] = useState<{ alt: Alt; body: string } | null>(null);
  const current = String(node.meta.altName ?? '') || 'A안';
  const load = () =>
    api<{ snapshots: Alt[] }>(`nodes/${node.id}/snapshots`)
      .then((r) => setAlts(r.snapshots.filter((s) => s.auto === 2)))
      .catch(() => setAlts([]));
  useEffect(() => {
    setMaking(null);
    void load();
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const used = new Set([current, ...alts.map((a) => a.label)]);
  const nextName = `${[...LETTERS].find((l) => !used.has(`${l}안`)) ?? 'Z'}안`;
  const setName = (altName: string) => onPatch({ meta: { ...node.meta, altName } });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
      void load();
    }
  };

  const start = (blank: boolean) =>
    run(async () => {
      const name = (making ?? '').trim() || nextName;
      if (used.has(name)) throw new Error('같은 이름의 안이 있어요.');
      await flush();
      await api(`nodes/${node.id}/snapshots`, { body: { alt: true, label: current } });
      setName(name);
      if (blank) onRestore('');
      setMaking(null);
      toast(`「${current}」을 남겨 두었어요. 이제 「${name}」을 써요.`);
    });
  const switchTo = (a: Alt) =>
    run(async () => {
      const r = await api<{ snapshot: { body: string } }>(`snapshots/${a.id}`);
      await flush();
      await api(`nodes/${node.id}/snapshots`, { body: { alt: true, label: a.label === current ? `${current} (전)` : current } });
      await api(`snapshots/${a.id}`, { method: 'DELETE' });
      onRestore(r.snapshot.body);
      setName(a.label);
      setView(null);
      toast(`「${a.label}」으로 바꿨어요. 「${current}」은 다른 안에 남아 있어요.`);
    });
  const open = async (a: Alt) => {
    try {
      const r = await api<{ snapshot: { body: string } }>(`snapshots/${a.id}`);
      setView({ alt: a, body: r.snapshot.body });
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <h4>이 장의 안</h4>
      <p className="faint tiny">같은 장을 다른 버전으로 써 두고 나란히 비교해서 하나를 골라요. 리더 · 공유본에는 지금 고른 안만 나가요.</p>
      <div className="list">
        <div className="list-item" style={{ cursor: 'default' }}>
          <span className="grow small">
            <b>{current}</b> <span className="faint tiny">지금 쓰는 안 · {fmtNum(node.chars)}자</span>
          </span>
        </div>
        {alts.map((a) => (
          <div key={a.id} className="list-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
            <span className="grow small">
              {a.label} <span className="faint tiny">{fmtNum(a.chars)}자 · {fmtDate(a.at, true)}</span>
            </span>
            <span className="row" style={{ gap: 4 }}>
              <button className="ghost small" onClick={() => open(a)}>
                나란히 보기
              </button>
              <button className="ghost small" disabled={busy} onClick={() => switchTo(a)}>
                이 안으로
              </button>
              <button
                className="ghost small"
                disabled={busy}
                onClick={async () => {
                  const v = await promptBox('안 이름', a.label);
                  if (v?.trim() && v.trim() !== a.label)
                    await run(async () => {
                      if (used.has(v.trim())) throw new Error('같은 이름의 안이 있어요.');
                      await api(`snapshots/${a.id}`, { method: 'PATCH', body: { label: v.trim() } });
                    });
                }}
              >
                이름
              </button>
              <button
                className="ghost small"
                disabled={busy}
                onClick={async () => {
                  if (await confirmBox(`「${a.label}」을 지울까요?`, { ok: '지우기', danger: true, detail: '지운 안은 되살릴 수 없어요.' })) await run(() => api(`snapshots/${a.id}`, { method: 'DELETE' }));
                }}
              >
                지우기
              </button>
            </span>
          </div>
        ))}
      </div>
      {making == null ? (
        <button className="small" disabled={busy} onClick={() => setMaking(nextName)} style={{ alignSelf: 'flex-start' }}>
          새 안 쓰기 ({nextName})
        </button>
      ) : (
        <div className="ai-card">
          <label className="field small">
            새 안 이름
            <input className="input" value={making} onChange={(e) => setMaking(e.target.value)} maxLength={40} />
          </label>
          <p className="faint tiny">지금 글은 「{current}」으로 남겨 둬요.</p>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="small primary" disabled={busy} onClick={() => start(false)}>
              지금 글에서 고쳐 쓰기
            </button>
            <button className="small" disabled={busy} onClick={() => start(true)}>
              빈 글로 새로 쓰기
            </button>
            <button className="ghost small" onClick={() => setMaking(null)}>
              그만두기
            </button>
          </div>
        </div>
      )}
      {view && (
        <Modal
          wide
          title={`${current} · ${view.alt.label}`}
          onClose={() => setView(null)}
          foot={
            <>
              <span className="grow" />
              <button onClick={() => setView(null)}>닫기</button>
              <button className="primary" disabled={busy} onClick={() => switchTo(view.alt)}>
                「{view.alt.label}」으로 바꾸기
              </button>
            </>
          }
        >
          <div className="tidy-preview">
            <div>
              <h4>
                {current} <span className="faint tiny">지금 · {fmtNum(node.chars)}자</span>
              </h4>
              <div className="diff alt-col">{body}</div>
            </div>
            <div>
              <h4>
                {view.alt.label} <span className="faint tiny">{fmtNum(view.alt.chars)}자</span>
              </h4>
              <div className="diff alt-col">{view.body}</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
