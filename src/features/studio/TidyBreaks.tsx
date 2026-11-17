// 줄바꿈 정리 창: 고르는 대로 바로 앞 · 뒤를 보여 주고, 고친 장은 먼저 「기록」에 남긴다.
import { useMemo, useState } from 'react';
import { countBreaks, TIDY_MODES, tidyBreaks, type TidyMode } from '../../lib/linebreaks';
import { fmtNum } from '../../lib/text';
import type { BookNode } from '../../lib/types';
import { Modal } from '../../lib/ui';

export function TidyBreaks({ node, nodes, onClose, onApply }: { node: BookNode | null; nodes: BookNode[]; onClose: () => void; onApply: (changes: { id: string; body: string }[]) => Promise<void> }) {
  const [mode, setMode] = useState<TidyMode>('join');
  const [dialogue, setDialogue] = useState(true);
  const [scope, setScope] = useState<'one' | 'all'>(node ? 'one' : 'all');
  const [busy, setBusy] = useState(false);
  const targets = useMemo(() => (scope === 'one' && node ? [node] : nodes.filter((n) => n.kind !== 'part' && n.kind !== 'note' && (n.body ?? '').trim())), [scope, node, nodes]);
  const changes = useMemo(
    () =>
      targets
        .map((n) => {
          const before = n.body ?? '';
          const body = tidyBreaks(before, mode, { dialogue });
          return { id: n.id, before, body, cut: countBreaks(before) - countBreaks(body) };
        })
        .filter((c) => c.body !== c.before),
    [targets, mode, dialogue],
  );
  const cut = changes.reduce((s, c) => s + c.cut, 0);
  const sample = changes[0];
  const peek = (s: string) => (s.length > 700 ? `${s.slice(0, 700)}…` : s);
  return (
    <Modal
      wide
      title="줄바꿈 정리"
      onClose={onClose}
      foot={
        <>
          <span className="faint small grow">{changes.length ? `${changes.length}개 장 · 줄바꿈 ${fmtNum(cut)}개를 줄여요` : '바꿀 곳이 없어요'}</span>
          <button onClick={onClose}>닫기</button>
          <button
            className="primary"
            disabled={!changes.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onApply(changes.map(({ id, body }) => ({ id, body })));
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '정리하는 중…' : '정리하기'}
          </button>
        </>
      }
    >
      <p className="muted small">글자는 그대로 두고 줄바꿈만 바꿔요. 바꾸기 전 글은 장마다 「기록」에 남겨 두니 언제든 되돌릴 수 있어요. 장면 나눔(***) · 제목 · 작가 메모 · 쪽 줄거리 줄은 건드리지 않아요.</p>
      <div className="stack" style={{ gap: 6 }}>
        {TIDY_MODES.map((m) => (
          <label key={m.id} className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" name="tidy" checked={mode === m.id} onChange={() => setMode(m.id)} style={{ marginTop: 4 }} />
            <span>
              {m.label}
              <span className="faint tiny" style={{ display: 'block' }}>
                {m.desc}
              </span>
            </span>
          </label>
        ))}
      </div>
      {mode === 'all' && (
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={dialogue} onChange={(e) => setDialogue(e.target.checked)} />
          대사(“ ” 「 」로 시작하는 줄)는 따로 문단으로 두기
        </label>
      )}
      {node && (
        <div className="seg">
          <button className={scope === 'one' ? 'on' : ''} onClick={() => setScope('one')}>
            이 장만
          </button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            책 전체
          </button>
        </div>
      )}
      {sample && (
        <div className="tidy-preview">
          <div>
            <h4>지금</h4>
            <div className="diff">{peek(sample.before)}</div>
          </div>
          <div>
            <h4>정리한 뒤</h4>
            <div className="diff">{peek(sample.body)}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
