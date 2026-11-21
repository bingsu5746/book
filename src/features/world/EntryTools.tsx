// 세계관 항목 도구: 인물 인터뷰(AI) · 빈칸 질문(규칙)
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { emptyFieldQuestions } from '../../lib/askfields';
import { Modal, Spinner, toast } from '../../lib/ui';
import { kindLabel, type Entry } from '../../lib/world';

/** 인물 인터뷰: 항목 설정으로 인물이 되어 답한다. 인물을 알아 가려는 연습이라 이야기에 쓸 글이 아니다 */
export function Interview({ entry, worldInfo, onClose }: { entry: Entry; worldInfo: string; onClose: () => void }) {
  const [turns, setTurns] = useState<{ role: 'q' | 'a'; text: string; invented?: boolean }[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const send = async () => {
    const question = q.trim();
    if (!question || busy) return;
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'q', text: question }]);
    setQ('');
    setBusy(true);
    try {
      const r = await api<{ answer: string; invented: boolean; left: number }>('ai/interview', {
        body: { entry: { name: entry.name, kind: kindLabel(entry.kind), summary: entry.summary, body: entry.body, fields: entry.fields }, world: worldInfo, history, question },
      });
      setTurns((t) => [...t, { role: 'a', text: r.answer, invented: r.invented }]);
      setLeft(r.left);
    } catch (e) {
      toast((e as Error).message, 'err');
      setTurns((t) => t.slice(0, -1));
      setQ(question);
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ block: 'end' }), 50);
    }
  };
  const save = async (i: number) => {
    try {
      await api('jots', { body: { text: `[인터뷰] ${entry.name}\nQ. ${turns[i - 1].text}\nA. ${turns[i].text}` } });
      toast('수첩에 적었어요');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  return (
    <Modal title={`${entry.name} 인터뷰`} wide onClose={onClose}>
      <p className="muted small">항목에 적은 설정을 바탕으로 AI 가 {entry.name}이(가) 되어 답해요. 인물을 더 잘 알아 가려는 연습이에요. 설정에 없는 내용을 지어낸 대답에는 표시가 붙어요. 마음에 들면 수첩에 적어 두고, 항목에는 직접 옮겨 주세요.</p>
      <div className="stack" style={{ gap: 10, minHeight: 120, maxHeight: '48vh', overflow: 'auto' }}>
        {!turns.length && <p className="faint small">무엇이든 물어보세요. 예: 「가장 후회하는 일이 뭐예요?」, 「아침에 눈을 뜨면 제일 먼저 뭘 하나요?」</p>}
        {turns.map((t, i) =>
          t.role === 'q' ? (
            <p key={i} className="small" style={{ margin: 0, alignSelf: 'flex-end', background: 'var(--soft)', padding: '6px 10px', borderRadius: 10, maxWidth: '85%' }}>
              {t.text}
            </p>
          ) : (
            <div key={i} className="ai-card" style={{ maxWidth: '92%' }}>
              <span className="faint tiny">{entry.name}</span>
              <p className="serif" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {t.text}
              </p>
              <div className="row" style={{ gap: 8 }}>
                {t.invented && <span className="faint tiny grow">설정에 없는 내용을 지어낸 대답이에요</span>}
                {!t.invented && <span className="grow" />}
                <button className="ghost small" onClick={() => save(i)}>
                  수첩에 적기
                </button>
              </div>
            </div>
          ),
        )}
        {busy && <Spinner label={`${entry.name}이(가) 생각하는 중`} />}
        <div ref={end} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input grow"
          value={q}
          placeholder={`${entry.name}에게 묻기`}
          maxLength={400}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void send()}
        />
        <button className="primary" disabled={busy || !q.trim()} onClick={send}>
          묻기
        </button>
      </div>
      {left != null && <p className="faint tiny">오늘 AI 를 {left}번 더 쓸 수 있어요.</p>}
    </Modal>
  );
}

/** 빈칸 질문: 비어 있는 칸을 하나씩 물어 채운다 */
export function FieldAsk({ entry, fields, onSave, onClose }: { entry: Entry; fields: string[]; onSave: (field: string, value: string) => void; onClose: () => void }) {
  // 시작할 때 비어 있던 칸만 (답하면서 줄어드는 목록에 밀리지 않게)
  const [list] = useState(() => emptyFieldQuestions(entry, fields));
  const [i, setI] = useState(0);
  const [a, setA] = useState('');
  const cur = list[i];
  const next = () => {
    setA('');
    setI((n) => n + 1);
  };
  return (
    <Modal
      title={`${entry.name} · 빈칸 질문`}
      onClose={onClose}
      foot={
        cur ? (
          <>
            <span className="faint small grow">
              {i + 1} / {list.length}
            </span>
            <button onClick={onClose}>그만하기</button>
            <button onClick={next}>건너뛰기</button>
            <button
              className="primary"
              disabled={!a.trim()}
              onClick={() => {
                onSave(cur.field, a.trim());
                next();
              }}
            >
              저장하고 다음
            </button>
          </>
        ) : (
          <button className="primary" onClick={onClose}>
            닫기
          </button>
        )
      }
    >
      {!list.length ? (
        <p className="small">비어 있는 칸이 없어요.</p>
      ) : !cur ? (
        <p className="small">질문을 모두 마쳤어요. 항목에서 이어 다듬어 보세요.</p>
      ) : (
        <>
          <p className="faint tiny">「{cur.field}」 칸</p>
          <p className="serif" style={{ fontSize: 18, lineHeight: 1.7, margin: 0 }}>
            {cur.q}
          </p>
          <textarea className="input serif" rows={4} autoFocus value={a} onChange={(e) => setA(e.target.value)} placeholder="떠오르는 대로, 한두 줄이면 돼요." />
        </>
      )}
    </Modal>
  );
}
