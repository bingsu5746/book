// 이름 표기 흔들림 검사 창: 세계관 이름과 조금 다른 표기를 책 전체에서 찾아 바꾸거나, 다른 이름으로 등록하거나, 넘어간다.
import { useMemo, useState } from 'react';
import { local } from '../../lib/idb';
import { findVariants, replaceVariant, type Variant } from '../../lib/namecheck';
import type { BookNode } from '../../lib/types';
import { Modal, toast } from '../../lib/ui';
import { entriesOf, type Entry, type WItem } from '../../lib/world';

export function NameCheck({
  bookId,
  nodes,
  items,
  hasWorld,
  onClose,
  onApply,
  onAlias,
  onOpen,
}: {
  bookId: string;
  nodes: BookNode[];
  items: WItem[];
  hasWorld: boolean;
  onClose: () => void;
  onApply: (changes: { id: string; body: string }[], label: string) => Promise<void>;
  onAlias: (e: Entry, alias: string) => Promise<void>;
  onOpen: (nodeId: string, find: string) => void;
}) {
  const key = `nameIgnore:${bookId}`;
  const [ignore, setIgnore] = useState<string[]>(() => local.get<string[]>(key, []));
  const [busy, setBusy] = useState('');
  const entries = entriesOf(items);
  const chapters = useMemo(() => nodes.filter((n) => n.kind !== 'part' && n.kind !== 'note' && (n.body ?? '').trim()).map((n) => ({ id: n.id, body: n.body ?? '' })), [nodes]);
  const list = useMemo(() => findVariants(chapters, entries, ignore), [chapters, entries, ignore]);
  const title = (id: string) => nodes.find((n) => n.id === id)?.title || '제목 없음';
  const skip = (v: Variant) => {
    const next = [...ignore, v.variant];
    setIgnore(next);
    local.set(key, next);
  };
  const act = async (v: Variant, fn: () => Promise<void>) => {
    setBusy(v.variant);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };
  return (
    <Modal wide title="이름 표기 검사" onClose={onClose} foot={<button onClick={onClose}>닫기</button>}>
      <p className="muted small">세계관 항목 이름과 자모 한두 개만 다른 낱말을 책 전체에서 찾아요(AI 를 쓰지 않아요). 다른 인물이거나 그냥 비슷한 말일 수도 있으니 보고 정해 주세요.</p>
      {!hasWorld && <p className="small">이 책에 연결된 세계관이 없어요. 책 설정에서 세계관을 연결하면 그 항목 이름으로 검사해요.</p>}
      {hasWorld && !list.length && <p className="small">세계관 이름과 다르게 쓴 곳을 찾지 못했어요.</p>}
      <div className="stack" style={{ gap: 10 }}>
        {list.map((v) => {
          const e = entries.find((x) => x.id === v.entryId);
          return (
            <div key={v.variant} className="ai-card">
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="serif" style={{ fontSize: 16 }}>
                  <b>{v.variant}</b> <span className="faint">→</span> {v.name}?
                </span>
                <span className="faint tiny">{v.count}번</span>
              </div>
              <div className="row wrap" style={{ gap: 4 }}>
                {Object.entries(v.where).map(([id, n]) => (
                  <button key={id} className="chip" onClick={() => onOpen(id, v.variant)}>
                    {title(id)} <span className="faint">{n}</span>
                  </button>
                ))}
              </div>
              {v.josa && <p className="faint tiny">받침이 달라요. 바꾼 뒤 조사(이/가, 은/는, 을/를)를 한번 확인해 주세요.</p>}
              <div className="row wrap" style={{ gap: 6 }}>
                <button
                  className="small"
                  disabled={!!busy}
                  onClick={() =>
                    act(v, async () => {
                      const changes = Object.keys(v.where)
                        .map((id) => {
                          const n = nodes.find((x) => x.id === id);
                          const body = n?.body ?? '';
                          return { id, body: replaceVariant(body, v.variant, v.name), before: body };
                        })
                        .filter((c) => c.body !== c.before)
                        .map(({ id, body }) => ({ id, body }));
                      await onApply(changes, '이름 표기 고치기 전');
                    })
                  }
                >
                  모두 「{v.name}」(으)로 바꾸기
                </button>
                {e && (
                  <button className="small" disabled={!!busy} onClick={() => act(v, () => onAlias(e, v.variant))}>
                    「{v.name}」의 다른 이름으로 등록
                  </button>
                )}
                <button className="ghost small" onClick={() => skip(v)}>
                  괜찮아요
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {!!ignore.length && (
        <p className="faint tiny">
          넘어간 표기 {ignore.length}개: {ignore.join(', ')} ·{' '}
          <button
            className="ghost tiny"
            style={{ padding: 0 }}
            onClick={() => {
              setIgnore([]);
              local.set(key, []);
            }}
          >
            다시 보기
          </button>
        </p>
      )}
    </Modal>
  );
}
