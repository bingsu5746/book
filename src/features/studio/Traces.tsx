// 퇴고 탭 「AI 말투 흔적」: 규칙으로 찾기만 하고, 기호처럼 기계적인 것만 고친다 (Ctrl+Z 로 되돌리기)
import { useMemo, useState } from 'react';
import { findTraces, TRACE_HINT, TRACE_LABEL, type Trace, type TraceKind } from '../../lib/traces';
import { toast } from '../../lib/ui';
import type { EditorHandle } from './Editor';

export function Traces({ body, editor }: { body: string; editor: React.RefObject<EditorHandle | null> }) {
  const traces = useMemo(() => findTraces(body), [body]);
  const [open, setOpen] = useState<TraceKind | null>(null);
  const groups = useMemo(() => {
    const g = new Map<TraceKind, Trace[]>();
    for (const t of traces) g.set(t.kind, [...(g.get(t.kind) ?? []), t]);
    return [...g.entries()];
  }, [traces]);
  /** 편집기의 지금 글로 다시 찾아서 고친다 (그사이 글이 바뀌었을 수 있으니) */
  const fix = (kind: TraceKind | null, one?: Trace) => {
    const v = editor.current?.view;
    if (!v) return;
    const doc = v.state.doc.toString();
    const now = findTraces(doc).filter((t) => t.fix !== undefined && (!kind || t.kind === kind) && (!one || (t.at === one.at && t.text === one.text)));
    if (!now.length) return toast('고칠 곳을 찾지 못했어요. 글이 바뀌었을 수 있어요.', 'err');
    v.dispatch({ changes: now.map((t) => ({ from: t.at, to: t.at + t.len, insert: t.fix! })) });
    toast(`${now.length}곳을 고쳤어요. 되돌리려면 Ctrl+Z.`);
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h4>AI 말투 흔적</h4>
      <p className="faint tiny">다른 곳에서 AI 와 쓰다 옮겨 온 글에 남기 쉬운 것을 규칙으로 찾아요(AI 를 쓰지 않아요). 소설 속 말로 일부러 쓴 것일 수도 있으니 보고 정해 주세요.</p>
      {!traces.length && <p className="small">찾은 흔적이 없어요.</p>}
      {groups.map(([kind, list]) => {
        const fixable = list.filter((t) => t.fix !== undefined).length;
        return (
          <div key={kind} className="ai-card">
            <div className="row" style={{ gap: 6 }}>
              <button className="ghost small" style={{ padding: 0 }} onClick={() => setOpen(open === kind ? null : kind)} aria-expanded={open === kind}>
                <b>{TRACE_LABEL[kind]}</b>
              </button>
              <span className="faint tiny">{list.length}곳</span>
              <span className="grow" />
              {fixable > 0 && (
                <button className="small" onClick={() => fix(kind)}>
                  {kind === 'quote' ? '“ ” 로 모두 바꾸기' : kind === 'md' ? '기호 모두 지우기' : '모두 지우기'}
                </button>
              )}
            </div>
            <p className="faint tiny">{TRACE_HINT[kind]}</p>
            {open === kind && (
              <div className="stack" style={{ gap: 2 }}>
                {list.slice(0, 80).map((t, i) => (
                  <div key={i} className="row" style={{ gap: 4 }}>
                    <button className="ghost small grow" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => editor.current?.select(t.at, t.at + t.len)}>
                      {snippet(body, t)}
                    </button>
                    {t.fix !== undefined && (
                      <button className="ghost small" onClick={() => fix(kind, t)}>
                        고치기
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function snippet(body: string, t: Trace) {
  const a = Math.max(0, t.at - 12);
  const z = Math.min(body.length, t.at + t.len + 12);
  return (
    <span className="serif">
      {a > 0 && '…'}
      {body.slice(a, t.at).replace(/\n/g, ' ')}
      <mark>{t.text}</mark>
      {body.slice(t.at + t.len, z).replace(/\n/g, ' ')}
      {z < body.length && '…'}
    </span>
  );
}
