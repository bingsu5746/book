// 시간 표현 모으기: 장마다 원고에 쓴 시간 표현을 모아 세계관 연표 사건으로 넣는다. 연도가 거꾸로 가는 곳은 알려 준다.
import { useMemo, useState } from 'react';
import { backwards, chapterTimes, TIME_KIND_LABEL, type TimeKind } from '../../lib/timewords';
import type { BookNode } from '../../lib/types';
import { Modal, toast } from '../../lib/ui';
import { newItemId, type WEvent, type WItem } from '../../lib/world';

const PRIORITY: TimeKind[] = ['meta', 'date', 'span', 'day', 'season', 'weekday'];

export function TimeWords({ nodes, items, hasWorld, onAdd, onOpen, onClose }: { nodes: BookNode[]; items: WItem[]; hasWorld: boolean; onAdd: (e: WEvent[]) => Promise<void>; onOpen: (id: string, find: string) => void; onClose: () => void }) {
  const chapters = useMemo(() => nodes.filter((n) => (n.kind === 'chapter' || n.kind === 'scene') && (n.body ?? '').trim()), [nodes]);
  const times = useMemo(() => chapterTimes(chapters.map((n) => ({ id: n.id, title: n.title || '제목 없음', body: n.body ?? '', time: String(n.meta.time ?? '') }))), [chapters]);
  const events = items.filter((i): i is WEvent => i.type === 'event');
  const has = (id: string) => events.some((e) => e.nodes.includes(id));
  const best = (id: string) => {
    const w = times.find((t) => t.id === id)?.words ?? [];
    return [...w].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))[0]?.text ?? '';
  };
  const [when, setWhen] = useState<Record<string, string>>({});
  const [on, setOn] = useState<Set<string>>(() => new Set(times.filter((t) => t.words.length && !has(t.id)).map((t) => t.id)));
  const [busy, setBusy] = useState(false);
  const back = useMemo(() => backwards(times), [times]);
  const rows = times.filter((t) => t.words.length);
  const chosen = rows.filter((t) => on.has(t.id) && !has(t.id));
  const add = async () => {
    const base = Math.max(0, ...events.map((e) => e.order));
    const list: WEvent[] = chosen.map((t, i) => ({ id: newItemId(), type: 'event', title: t.title, track: '', when: when[t.id] ?? best(t.id), order: base + (i + 1) * 10, body: '', entries: [], nodes: [t.id] }));
    setBusy(true);
    try {
      await onAdd(list);
      toast(`연표에 ${list.length}개를 넣었어요`);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      title="시간 표현 모으기 (연표 후보)"
      onClose={onClose}
      foot={
        <>
          <span className="faint small grow">{hasWorld ? `${chosen.length}개 고름` : '세계관을 연결하면 연표에 넣을 수 있어요'}</span>
          <button onClick={onClose}>닫기</button>
          <button className="primary" disabled={!hasWorld || !chosen.length || busy} onClick={add}>
            연표에 넣기
          </button>
        </>
      }
    >
      <p className="muted small">장마다 원고에 쓴 「1998년」 · 「사흘 뒤」 · 「다음 날」 · 계절 · 요일을 모았어요(AI 를 쓰지 않아요). 연표에 넣을 장을 고르고, 표현을 눌러 그 장의 「때」로 정해요. 장 정보의 「이야기 속 시간」은 맨 앞에 나와요.</p>
      {!!back.length && (
        <div className="ai-card">
          <b className="small ages-warn">연도가 거꾸로 가는 곳</b>
          {back.map((b, i) => (
            <p key={i} className="small" style={{ margin: 0 }}>
              「{b.from.title}」 {b.from.year}년 → 「{b.to.title}」 {b.to.year}년 <span className="faint tiny">회상이면 괜찮아요</span>
            </p>
          ))}
        </div>
      )}
      {!rows.length && <p className="small">시간 표현을 찾지 못했어요.</p>}
      <div className="stack" style={{ gap: 8 }}>
        {rows.map((t) => {
          const exist = has(t.id);
          const cur = when[t.id] ?? best(t.id);
          return (
            <div key={t.id} className="ai-card">
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  aria-label={`${t.title} 연표에 넣기`}
                  disabled={exist}
                  checked={on.has(t.id) && !exist}
                  onChange={(e) =>
                    setOn((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(t.id);
                      else n.delete(t.id);
                      return n;
                    })
                  }
                />
                <button className="ghost small grow" style={{ justifyContent: 'flex-start', fontWeight: 600 }} onClick={() => onOpen(t.id, cur)}>
                  {t.title}
                </button>
                {exist && <span className="faint tiny">연표에 있음</span>}
              </div>
              <div className="row wrap" style={{ gap: 4 }}>
                {t.words.map((w, i) => (
                  <button key={i} className={`chip${cur === w.text ? ' on' : ''}`} title={TIME_KIND_LABEL[w.kind]} onClick={() => setWhen((m) => ({ ...m, [t.id]: w.text }))}>
                    {w.text} <span className="faint">{TIME_KIND_LABEL[w.kind]}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
