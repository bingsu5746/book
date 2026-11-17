// 집필실 도구: 플롯 선(이야기 줄기 × 장) · 책 전체 찾아 바꾸기
import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { COVERS } from '../../lib/colors';
import { flatten } from '../../lib/store';
import { findAll, replaceAll } from '../../lib/replace';
import type { Book, BookNode } from '../../lib/types';
import { confirmBox, Empty, Icon, promptBox, toast } from '../../lib/ui';

export interface Thread {
  id: string;
  name: string;
  color: string;
}
const tid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- 플롯 선
export function PlotThreads({ book, nodes, onPatchBook, onPatchNode, onOpen }: { book: Book; nodes: BookNode[]; onPatchBook: (p: Record<string, unknown>) => void; onPatchNode: (id: string, p: Partial<BookNode>) => void; onOpen: (id: string) => void }) {
  const threads = (book.meta.threads as Thread[] | undefined) ?? [];
  const chapters = flatten(nodes.filter((n) => n.kind !== 'note'));
  const setThreads = (t: Thread[]) => onPatchBook({ meta: { ...book.meta, threads: t } });
  const cell = (n: BookNode, t: Thread) => ((n.meta.threads as Record<string, string> | undefined) ?? {})[t.id] ?? '';
  const add = async () => {
    const name = await promptBox('새 이야기 줄기 이름', threads.length ? '' : '주인공의 길');
    if (name) setThreads([...threads, { id: tid(), name, color: COVERS[threads.length % COVERS.length][0] }]);
  };
  const touched = (t: Thread) => chapters.filter((n) => n.kind !== 'part' && cell(n, t).trim()).length;
  return (
    <div className="view-pad">
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <p className="muted small grow">이야기 줄기(본 줄거리 · 곁가지 · 인물별 흐름)마다 장에서 일어나는 일을 적어요. 빈칸이 길게 이어지면 그 줄기를 잊고 있는 거예요.</p>
        <button className="small primary" onClick={add}>
          <Icon name="plus" size={14} />
          줄기 더하기
        </button>
      </div>
      {!threads.length ? (
        <Empty title="이야기 줄기가 없어요" action={<button className="primary" onClick={add}>첫 줄기 만들기</button>}>
          예: 「홍설과 엄마」 「꿈의 규칙」 「현실의 시간」
        </Empty>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="thread-table">
            <thead>
              <tr>
                <th className="sticky">장</th>
                {threads.map((t, i) => (
                  <th key={t.id} style={{ borderTop: `3px solid ${t.color}` }}>
                    <div className="row" style={{ gap: 2 }}>
                      <span className="grow">{t.name}</span>
                      <span className="faint tiny">{touched(t)}</span>
                      <button
                        className="icon-btn"
                        style={{ padding: 3 }}
                        aria-label={`${t.name} 이름 바꾸기`}
                        onClick={async () => {
                          const name = await promptBox('줄기 이름', t.name);
                          if (name) setThreads(threads.map((x) => (x.id === t.id ? { ...x, name } : x)));
                        }}
                      >
                        <Icon name="pen" size={12} />
                      </button>
                      <button className="icon-btn" style={{ padding: 3 }} aria-label={`${t.name} 왼쪽으로`} disabled={i === 0} onClick={() => setThreads(threads.map((x, j) => (j === i - 1 ? t : j === i ? threads[i - 1] : x)))}>
                        ‹
                      </button>
                      <button
                        className="icon-btn"
                        style={{ padding: 3 }}
                        aria-label={`${t.name} 지우기`}
                        onClick={async () => {
                          if (await confirmBox(`「${t.name}」 줄기를 지울까요?`, { danger: true, ok: '지우기', detail: '장마다 적은 내용은 장 정보에 남아 있지만 이 표에서는 보이지 않아요.' })) setThreads(threads.filter((x) => x.id !== t.id));
                        }}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chapters.map((n) =>
                n.kind === 'part' ? (
                  <tr key={n.id} className="part">
                    <td colSpan={threads.length + 1}>{n.title}</td>
                  </tr>
                ) : (
                  <tr key={n.id}>
                    <td className="sticky">
                      <button className="ghost small" style={{ whiteSpace: 'normal', textAlign: 'left', paddingLeft: n.kind === 'scene' ? 18 : 6 }} onClick={() => onOpen(n.id)}>
                        {n.title || '제목 없음'}
                      </button>
                    </td>
                    {threads.map((t) => (
                      <td key={t.id} style={cell(n, t) ? { background: `color-mix(in srgb, ${t.color} 9%, transparent)` } : undefined}>
                        <textarea
                          rows={2}
                          defaultValue={cell(n, t)}
                          aria-label={`${n.title} · ${t.name}`}
                          onBlur={(e) => {
                            if (e.target.value === cell(n, t)) return;
                            const cur = { ...((n.meta.threads as Record<string, string> | undefined) ?? {}) };
                            if (e.target.value.trim()) cur[t.id] = e.target.value;
                            else delete cur[t.id];
                            onPatchNode(n.id, { meta: { ...n.meta, threads: cur } });
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 책 전체 찾아 바꾸기
export function FindReplace({ nodes, initialFrom, initialTo, onReplace, onOpen }: { nodes: BookNode[]; initialFrom?: string; initialTo?: string; onReplace: (id: string, body: string) => void; onOpen: (id: string, find: string) => void }) {
  const [from, setFrom] = useState(initialFrom ?? '');
  const [to, setTo] = useState(initialTo ?? '');
  const [regex, setRegex] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const opts = { regex, ignoreCase };
  const list = useMemo(() => flatten(nodes.filter((n) => n.kind !== 'part')).map((n) => ({ n, hits: findAll(n.body ?? '', from, opts) })).filter((x) => x.hits.length), [nodes, from, regex, ignoreCase]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = list.filter((x) => !skip.has(x.n.id)).reduce((s, x) => s + x.hits.length, 0);
  const ctx = (body: string, h: { at: number; len: number }) => {
    const a = Math.max(0, h.at - 24);
    return (
      <>
        {a ? '…' : ''}
        {body.slice(a, h.at)}
        <del>{body.slice(h.at, h.at + h.len)}</del>
        {to && <ins>{regex ? '…' : to}</ins>}
        {body.slice(h.at + h.len, h.at + h.len + 24)}…
      </>
    );
  };
  const run = async () => {
    if (!(await confirmBox(`${list.length - skip.size}개 장에서 ${total}곳을 바꿀까요?`, { ok: '바꾸기', detail: '바꾸기 전 글은 장마다 「기록」에 남겨 둬요. 언제든 되돌릴 수 있어요.' }))) return;
    setBusy(true);
    let done = 0;
    for (const { n } of list) {
      if (skip.has(n.id)) continue;
      try {
        await api(`nodes/${n.id}/snapshots`, { body: { label: `바꾸기 전: 「${from.slice(0, 20)}」→「${to.slice(0, 20)}」` } });
        onReplace(n.id, replaceAll(n.body ?? '', from, to, opts));
        done++;
      } catch (e) {
        toast((e as Error).message, 'err');
      }
    }
    setBusy(false);
    setSkip(new Set());
    toast(`${done}개 장을 바꿨어요`);
  };
  return (
    <div className="view-pad stack" style={{ maxWidth: 900 }}>
      <p className="muted small">책 전체(모든 장 · 장면 · 메모)에서 찾아 한꺼번에 바꿔요. 인물 이름을 바꿀 때 쓰기 좋아요.</p>
      <div className="row wrap">
        <input className="input grow" style={{ minWidth: 180 }} placeholder="찾을 말" value={from} onChange={(e) => setFrom(e.target.value)} autoFocus />
        <span>→</span>
        <input className="input grow" style={{ minWidth: 180 }} placeholder="바꿀 말 (비우면 지워요)" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="row wrap">
        <label className="check small">
          <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} />
          영문 대소문자 무시
        </label>
        <label className="check small">
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
          정규식 ($1 같은 묶음 쓰기)
        </label>
        <span className="grow" />
        <button className="primary" disabled={!from || !total || busy} onClick={run}>
          {busy ? '바꾸는 중…' : `${total}곳 바꾸기`}
        </button>
      </div>
      {from && !list.length && <p className="faint small">찾은 곳이 없어요.</p>}
      <div className="list">
        {list.map(({ n, hits }) => (
          <div key={n.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={!skip.has(n.id)}
              aria-label={`${n.title} 바꾸기`}
              onChange={(e) =>
                setSkip((s) => {
                  const x = new Set(s);
                  if (e.target.checked) x.delete(n.id);
                  else x.add(n.id);
                  return x;
                })
              }
              style={{ marginTop: 4 }}
            />
            <div className="grow">
              <div className="row">
                <b className="grow">{n.title || '제목 없음'}</b>
                <span className="faint tiny">{hits.length}곳</span>
                <button className="small ghost" onClick={() => onOpen(n.id, regex ? '' : from)}>
                  열기
                </button>
              </div>
              {hits.slice(0, 3).map((h, i) => (
                <p key={i} className="diff" style={{ border: 0, padding: '2px 0', maxHeight: 'none', background: 'none', fontSize: 14 }}>
                  {ctx(n.body ?? '', h)}
                </p>
              ))}
              {hits.length > 3 && <p className="faint tiny">외 {hits.length - 3}곳</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 소리 내어 듣기 (퇴고용)
export function speakSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
export function speak(text: string, onEnd: () => void) {
  const synth = window.speechSynthesis;
  synth.cancel();
  // 긴 글은 문단 단위로 끊어 읽는다 (브라우저가 긴 글을 중간에 멈추는 일을 줄이려고)
  const parts = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const ko = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith('ko'));
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = 'ko-KR';
    if (ko) u.voice = ko;
    if (i === parts.length - 1) u.onend = onEnd;
    synth.speak(u);
  });
  if (!parts.length) onEnd();
}
export function stopSpeaking() {
  if (speakSupported()) window.speechSynthesis.cancel();
}
