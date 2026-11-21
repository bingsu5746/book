// 줄거리 짜기: 대략의 아이디어를 적으면 AI 가 한 줄 줄거리 · 줄거리 · 기승전결 · 인물 · 세계 · 장 구성 초안을 짠다.
// 초안은 수첩에 저장하거나, 새 책(구상 · 장 줄거리)과 세계관 항목으로 바로 만들 수 있다.
import { useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { go } from '../lib/router';
import { createBookFrom } from '../lib/store';
import type { DraftNode } from '../lib/split';
import { Icon, Spinner, toast } from '../lib/ui';
import { kindLabel, newItemId, type EntryKind } from '../lib/world';

export interface Outline {
  title: string;
  logline: string;
  synopsis: string;
  acts: { name: string; summary: string }[];
  characters: { name: string; role: string; want: string; secret: string }[];
  world: { name: string; kind: string; note: string }[];
  chapters: { title: string; summary: string }[];
  questions: string[];
}

/** 초안을 수첩에 적을 글로 */
export function outlineText(o: Outline): string {
  const out = [`▸ 줄거리 초안${o.title ? ` · ${o.title}` : ''}`, o.logline, '', o.synopsis];
  if (o.acts.length) out.push('', ...o.acts.map((a) => `${a.name}: ${a.summary}`));
  if (o.characters.length) out.push('', '[인물]', ...o.characters.map((c) => `- ${c.name} (${c.role}) — 원하는 것: ${c.want}${c.secret ? ` / 숨기는 것: ${c.secret}` : ''}`));
  if (o.world.length) out.push('', '[세계]', ...o.world.map((w) => `- ${w.name} (${kindLabel(w.kind)}): ${w.note}`));
  if (o.chapters.length) out.push('', '[장 구성]', ...o.chapters.map((c, i) => `${i + 1}. ${c.title} — ${c.summary}`));
  if (o.questions.length) out.push('', '[더 정할 것]', ...o.questions.map((q) => `- ${q}`));
  return out.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim();
}

const KEY = 'outlineDraft';
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as { idea: string; tone: string; outline: Outline | null } | null;
  } catch {
    return null;
  }
};
const store = (v: unknown) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* 저장 못 해도 괜찮음 */
  }
};

export function OutlineTool() {
  const { user } = useSession();
  const saved = load();
  const [idea, setIdea] = useState(saved?.idea ?? '');
  const [tone, setTone] = useState(saved?.tone ?? '');
  const [count, setCount] = useState(8);
  const [feedback, setFeedback] = useState('');
  const [o, setO] = useState<Outline | null>(saved?.outline ?? null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [withWorld, setWithWorld] = useState(true);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [making, setMaking] = useState(false);

  const run = async (again: boolean) => {
    setBusy(true);
    try {
      const r = await api<{ outline: Outline; left: number }>('ai/outline', { body: { idea, tone, chapters: count, feedback: again ? feedback : '', prev: again && o ? o.synopsis : '' } });
      setO(r.outline);
      setLeft(r.left);
      setSkip(new Set());
      if (again) setFeedback('');
      store({ idea, tone, outline: r.outline });
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const patch = (p: Partial<Outline>) => {
    if (!o) return;
    const next = { ...o, ...p };
    setO(next);
    store({ idea, tone, outline: next });
  };

  const saveJot = async () => {
    if (!o) return;
    try {
      await api('jots', { body: { text: outlineText(o) } });
      dispatchEvent(new Event('jots-changed'));
      toast('수첩에 적었어요');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  const makeBook = async () => {
    if (!o) return;
    setMaking(true);
    try {
      const chapters = o.chapters.filter((_, i) => !skip.has(i));
      const nodes: DraftNode[] = chapters.map((c, i) => ({ tmp: `c${i}`, kind: 'chapter', title: c.title || `${i + 1}장`, body: '', sort: i + 1, synopsis: c.summary }));
      const notes = outlineText({ ...o, chapters: [] });
      const book = await createBookFrom({
        title: o.title || '제목 없는 책',
        author: user.nickname,
        kind: 'write',
        nodes,
        notes,
        meta: { plot: [o.logline, o.synopsis].filter(Boolean).join('\n\n'), blurb: o.logline },
      });
      if (withWorld && (o.characters.length || o.world.length)) {
        const items = [
          ...o.characters.map((c) => ({
            id: newItemId(),
            type: 'entry',
            data: { kind: 'character' as EntryKind, name: c.name, aliases: [], summary: c.role, body: '', fields: { ...(c.want ? { '바라는 것': c.want } : {}), ...(c.secret ? { 비밀: c.secret } : {}) }, tags: [], color: '' },
          })),
          ...o.world.map((w) => ({ id: newItemId(), type: 'entry', data: { kind: w.kind as EntryKind, name: w.name, aliases: [], summary: w.note, body: '', fields: {}, tags: [], color: '' } })),
        ];
        const w = await api<{ world: { id: string } }>('worlds', { body: { title: `${o.title || '새 책'}의 세계`, summary: o.logline, items } });
        await api(`books/${book.id}`, { method: 'PATCH', body: { world_id: w.world.id } });
      }
      toast(`「${book.title}」을(를) 만들었어요. 구상에서 이어 다듬어 보세요.`);
      go(`write/${book.id}`);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setMaking(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="panel stack">
        <h2 className="serif" style={{ fontSize: 18 }}>
          아이디어로 줄거리 짜기
        </h2>
        <p className="muted small">대충 떠오른 것을 그대로 적어 보세요. 적은 이름 · 규칙 · 분위기는 살리고, 비어 있는 곳만 AI 가 채워 한 줄 줄거리 · 줄거리 · 인물 · 세계 · 장 구성 초안을 짜 줘요. 초안은 출발점일 뿐이라 마음에 안 들면 고치거나 다시 짤 수 있어요.</p>
        <textarea
          className="input serif"
          rows={5}
          placeholder="예: 소금으로 지은 사원이 창고가 되고 쫓겨난 사제들이 변두리에서 몰래 의식을 이어 간다. 그 의식은 바다가 마르는 걸 막는 것 같은데…"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          maxLength={3000}
        />
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="field grow" style={{ minWidth: 180 }}>
            분위기 · 장르 <span className="faint tiny">(선택)</span>
            <input className="input" value={tone} onChange={(e) => setTone(e.target.value)} placeholder="예: 음울한 판타지, 따뜻한 일상물" maxLength={80} />
          </label>
          <label className="field">
            장 구성
            <select className="input" value={count} onChange={(e) => setCount(+e.target.value)}>
              {[5, 8, 12, 16].map((n) => (
                <option key={n} value={n}>
                  {n}장 안팎
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <button className="primary" disabled={busy || idea.replace(/\s/g, '').length < 10} onClick={() => run(false)}>
            <Icon name="pen" size={16} />
            {busy && !feedback ? '짜는 중…' : o ? '처음부터 다시 짜기' : '줄거리 짜기'}
          </button>
          {left != null && <span className="faint tiny">오늘 AI 를 {left}번 더 쓸 수 있어요.</span>}
        </div>
        {busy && <Spinner label="AI 가 줄거리를 짜는 중 (30초쯤 걸려요)" />}
      </section>

      {o && !busy && (
        <>
          <section className="panel stack">
            <label className="field">
              가제
              <input className="input serif" value={o.title} onChange={(e) => patch({ title: e.target.value })} maxLength={60} />
            </label>
            <label className="field">
              한 줄 줄거리
              <textarea className="input serif" rows={2} value={o.logline} onChange={(e) => patch({ logline: e.target.value })} />
            </label>
            <label className="field">
              줄거리
              <textarea className="input serif" rows={7} value={o.synopsis} onChange={(e) => patch({ synopsis: e.target.value })} />
            </label>
            {!!o.acts.length && (
              <div className="stack" style={{ gap: 8 }}>
                <h3 className="small">흐름</h3>
                {o.acts.map((a, i) => (
                  <p key={i} className="small" style={{ margin: 0 }}>
                    <b>{a.name}</b> <span className="muted">{a.summary}</span>
                  </p>
                ))}
              </div>
            )}
          </section>

          {!!o.characters.length && (
            <section className="panel stack">
              <h3 className="small">인물</h3>
              <div className="entry-grid">
                {o.characters.map((c, i) => (
                  <div key={i} className="ai-card">
                    <b className="serif">{c.name}</b>
                    <span className="faint tiny">{c.role}</span>
                    <p className="small" style={{ margin: 0 }}>
                      원하는 것: {c.want}
                    </p>
                    {c.secret && (
                      <p className="small muted" style={{ margin: 0 }}>
                        숨기는 것: {c.secret}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {!!o.world.length && (
            <section className="panel stack">
              <h3 className="small">세계</h3>
              <div className="stack" style={{ gap: 6 }}>
                {o.world.map((w, i) => (
                  <p key={i} className="small" style={{ margin: 0 }}>
                    <b>{w.name}</b> <span className="faint tiny">{kindLabel(w.kind)}</span> <span className="muted">{w.note}</span>
                  </p>
                ))}
              </div>
            </section>
          )}

          {!!o.chapters.length && (
            <section className="panel stack">
              <h3 className="small">
                장 구성 <span className="faint tiny">· 빼고 싶은 장은 체크를 풀어요</span>
              </h3>
              <div className="stack" style={{ gap: 6 }}>
                {o.chapters.map((c, i) => (
                  <label key={i} className="check" style={{ alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={!skip.has(i)}
                      onChange={(e) =>
                        setSkip((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.delete(i);
                          else n.add(i);
                          return n;
                        })
                      }
                    />
                    <span className="small">
                      <b>
                        {i + 1}. {c.title}
                      </b>{' '}
                      <span className="muted">{c.summary}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}

          {!!o.questions.length && (
            <section className="panel stack">
              <h3 className="small">아직 정해지지 않은 것 · 작가가 정할 차례</h3>
              <ul className="route-list">
                {o.questions.map((q, i) => (
                  <li key={i} className="small serif">
                    {q}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel stack">
            <div className="row wrap" style={{ gap: 8 }}>
              <input className="input grow" style={{ minWidth: 200 }} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="바꾸고 싶은 점 (예: 더 어둡게, 반전을 넣어서, 주인공을 아이로)" maxLength={400} />
              <button disabled={busy || !feedback.trim()} onClick={() => run(true)}>
                이 방향으로 다시 짜기
              </button>
            </div>
            <label className="check">
              <input type="checkbox" checked={withWorld} onChange={(e) => setWithWorld(e.target.checked)} disabled={!o.characters.length && !o.world.length} />
              인물 · 세계를 세계관 항목으로도 만들어 새 책에 잇기
            </label>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="primary" disabled={making} onClick={makeBook}>
                {making ? '만드는 중…' : '이 초안으로 새 책 만들기'}
              </button>
              <button onClick={saveJot}>수첩에 적어 두기</button>
            </div>
            <p className="faint tiny">새 책에는 한 줄 줄거리는 책 소개로, 줄거리는 구상으로, 장 구성은 장 줄거리로 들어가요. 본문은 비어 있어요.</p>
          </section>
        </>
      )}
    </div>
  );
}
