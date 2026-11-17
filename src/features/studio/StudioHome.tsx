import { GoalPicker } from './GoalPicker';
import { distributeGoal, SEED_PER_PAGE } from '../../lib/goals';
import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { BookCard, charsLabel } from '../../lib/BookCard';
import { COVERS } from '../../lib/colors';
import { go } from '../../lib/router';
import { useSession } from '../../lib/session';
import type { DraftNode } from '../../lib/split';
import { createBookFrom } from '../../lib/store';
import { ago, fmtNum, today } from '../../lib/text';
import type { Book } from '../../lib/types';
import { Empty, Icon, Menu, Modal, Spinner, toast, useAsync } from '../../lib/ui';
import { ImportDialog } from '../library/ImportDialog';
import { fmtMinutes, importSeed } from '../library/LibraryHome';
import { Heatmap, streakOf } from './Views';

type Beat = [string, string];
const TEMPLATES: { id: string; name: string; desc: string; parts?: { title: string; beats: Beat[] }[]; beats?: Beat[] }[] = [
  { id: 'blank', name: '빈 책', desc: '1장 하나로 시작해요.', beats: [['1장', '']] },
  { id: 'short', name: '단편', desc: '장면 몇 개로 이루어진 짧은 이야기.', beats: [['본문', '']] },
  {
    id: 'kishotenketsu',
    name: '기승전결',
    desc: '네 부분으로 나눈 이야기 틀.',
    parts: [
      { title: '기', beats: [['1장', '인물과 세계를 보여 주고, 이야기의 씨앗을 심어요.']] },
      { title: '승', beats: [['2장', '사건이 커지고 인물이 움직이기 시작해요.']] },
      { title: '전', beats: [['3장', '예상하지 못한 전환이 와요.']] },
      { title: '결', beats: [['4장', '전환을 거쳐 이야기가 맺어져요.']] },
    ],
  },
  {
    id: 'three-act',
    name: '3막 구조',
    desc: '설정 · 대립 · 해결의 세 막과 주요 전환점.',
    parts: [
      {
        title: '1막 설정',
        beats: [
          ['일상', '주인공의 평소 모습과 바라는 것.'],
          ['계기 사건', '일상을 흔드는 일이 일어나요.'],
          ['첫 번째 전환점', '주인공이 되돌아갈 수 없는 선택을 해요.'],
        ],
      },
      {
        title: '2막 대립',
        beats: [
          ['시련', '목표를 향해 가며 부딪혀요.'],
          ['중간점', '판이 뒤집히거나 진실 하나가 드러나요.'],
          ['가장 어두운 순간', '모든 것을 잃은 것처럼 보여요.'],
        ],
      },
      {
        title: '3막 해결',
        beats: [
          ['절정', '가장 큰 대결 · 선택.'],
          ['결말', '바뀐 주인공과 바뀐 세계.'],
        ],
      },
    ],
  },
  {
    id: 'hero',
    name: '영웅의 여정 (12단계)',
    desc: '크리스토퍼 보글러가 정리한 12단계.',
    beats: [
      ['일상 세계', ''],
      ['모험에의 소명', ''],
      ['소명의 거부', ''],
      ['정신적 스승과의 만남', ''],
      ['첫 관문의 통과', ''],
      ['시험, 협력자, 적', ''],
      ['동굴 가장 깊은 곳으로의 접근', ''],
      ['시련', ''],
      ['보상', ''],
      ['귀환의 길', ''],
      ['부활', ''],
      ['영약을 가지고 귀환', ''],
    ],
  },
  { id: 'essay', name: '산문집', desc: '꼭지마다 따로 쓰는 글 모음.', beats: [['첫 꼭지', ''], ['둘째 꼭지', ''], ['셋째 꼭지', '']] },
];

function templateNodes(id: string): DraftNode[] {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0];
  const out: DraftNode[] = [];
  let n = 0;
  const add = (beats: Beat[], parent?: string) => beats.forEach(([title, syn]) => out.push({ tmp: `t${n++}`, parent_tmp: parent, kind: 'chapter', title, body: '', sort: out.length, ...(syn ? { synopsis: syn } : {}) } as DraftNode));
  if (t.parts)
    for (const p of t.parts) {
      const tmp = `t${n++}`;
      out.push({ tmp, kind: 'part', title: p.title, body: '', sort: out.length });
      add(p.beats, tmp);
    }
  else add(t.beats ?? []);
  return out;
}

export function StudioHome() {
  const { user } = useSession();
  const [newOpen, setNewOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const [b, s] = await Promise.all([api<{ books: Book[] }>('books'), api<{ days: { day: string; chars: number }[]; write?: { day: string; secs: number }[] }>('stats').catch(() => ({ days: [], write: [] }))]);
    const since = new Date(Date.now() - 6 * 86_400_000).toLocaleDateString('sv-SE');
    const todayKey = new Date().toLocaleDateString('sv-SE');
    const ws = s.write ?? [];
    return { books: b.books.filter((x) => !x.deleted && x.kind === 'write'), days: new Map(s.days.map((d) => [d.day, d.chars])), writeToday: ws.filter((d) => d.day === todayKey).reduce((a, d) => a + d.secs, 0), writeWeek: ws.filter((d) => d.day >= since).reduce((a, d) => a + d.secs, 0) };
  }, []);
  const week = useMemo(() => {
    if (!data) return 0;
    let s = 0;
    const d = new Date();
    for (let i = 0; i < 7; i++) {
      s += data.days.get(today(d)) ?? 0;
      d.setDate(d.getDate() - 1);
    }
    return s;
  }, [data]);

  if (loading && !data) return <Spinner />;
  if (error) return <div className="error-box">{error}</div>;
  const { books, days } = data!;
  const hasSeed = books.some((b) => b.meta?.template === 'seed-dawn');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>집필실</h1>
          <button className="stat-line" onClick={() => setShowStats(!showStats)} aria-expanded={showStats}>
            오늘 {fmtNum(days.get(today()) ?? 0)}자 · {fmtMinutes(data!.writeToday)}
            {streakOf(days, 0) > 0 && <> · {streakOf(days, 0)}일째</>}
            <span className="chev">{showStats ? '▴' : '▾'}</span>
          </button>
        </div>
        <div className="actions">
          <Menu label="더하기" icon="plus" btnClass="round-add">
            {(close) => (
              <>
                <button onClick={() => (close(), setNewOpen(true))}>
                  <Icon name="plus" size={16} />새 책
                </button>
                <button onClick={() => (close(), setImporting(true))}>
                  <Icon name="upload" size={16} />
                  원고 파일 들이기
                </button>
                <button onClick={() => (close(), go('jots'))}>
                  <Icon name="note" size={16} />
                  아이디어 수첩
                </button>
              </>
            )}
          </Menu>
        </div>
      </div>
      {showStats && (
        <div className="stack fade-in" style={{ marginBottom: 28 }}>
          <div className="stat-grid">
            <div className="stat">
              <div className="v">{fmtNum(week)}</div>
              <div className="k">최근 7일 쓴 글자</div>
            </div>
            <div className="stat">
              <div className="v">{fmtMinutes(data!.writeWeek)}</div>
              <div className="k">최근 7일 쓴 시간</div>
            </div>
            <div className="stat">
              <div className="v">{fmtNum(books.reduce((s, b) => s + (b.total_chars ?? 0), 0))}</div>
              <div className="k">모든 원고 글자</div>
            </div>
          </div>
          <section className="panel">
            <Heatmap days={days} />
          </section>
        </div>
      )}
      <section className="section">
        <div className="section-head">
          <h2>내 원고</h2>
          <span className="count">{books.length}권</span>
        </div>
        {books.length ? (
          <div className="cards">
            {books.map((b) => (
              <BookCard key={b.id} title={b.title} by={b.subtitle || b.author} author={b.author} color={b.color} seed={b.id} coverStyle={b.meta?.coverStyle} href={`#/write/${b.id}`} progress={b.goal_chars ? (b.total_chars ?? 0) / b.goal_chars : null} meta={[charsLabel(b.total_chars), `${b.node_count ?? 0}장`, `${ago(b.updated)} 고침`]} />
            ))}
            <button className="card add" onClick={() => setNewOpen(true)}>
              <Icon name="plus" />새 책
            </button>
          </div>
        ) : (
          <Empty
            title="첫 책을 시작해 보세요"
            action={
              <>
                <button className="primary" onClick={() => setNewOpen(true)}>
                  새 책
                </button>
                {!hasSeed && (
                  <button
                    onClick={async () => {
                      try {
                        const b = await importSeed(user.nickname);
                        go(`write/${b.id}`);
                      } catch (e) {
                        toast((e as Error).message, 'err');
                      }
                    }}
                  >
                    「새벽을 건너는 꿈」 원고 가져오기
                  </button>
                )}
              </>
            }
          />
        )}
      </section>
      {newOpen && <NewBook onClose={() => setNewOpen(false)} />}
      {importing && (
        <ImportDialog
          defaultKind="write"
          onClose={() => {
            setImporting(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function NewBook({ onClose }: { onClose: () => void }) {
  const { user } = useSession();
  const [title, setTitle] = useState('');
  const [tpl, setTpl] = useState('blank');
  const [color, setColor] = useState(COVERS[Math.floor(Math.random() * COVERS.length)][0]);
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState(0);
  const create = async () => {
    setBusy(true);
    try {
      const nodes = templateNodes(tpl);
      if (goal) {
        const ch = nodes.filter((n) => n.kind !== 'part');
        const m = distributeGoal(ch.map((n) => ({ id: n.tmp, body: n.body, meta: {} })), goal);
        for (const n of ch) if (m.get(n.tmp)) n.meta = { target: m.get(n.tmp) };
      }
      const b = await createBookFrom({ title: title.trim() || '제목 없는 책', author: user.nickname, kind: 'write', nodes, color, meta: { template: tpl }, goal_chars: goal });
      onClose();
      go(`write/${b.id}?view=plan`);
    } catch (e) {
      toast((e as Error).message, 'err');
      setBusy(false);
    }
  };
  return (
    <Modal
      title="새 책"
      onClose={onClose}
      foot={
        <>
          <button onClick={onClose}>그만두기</button>
          <button className="primary" disabled={busy} onClick={create}>
            {busy ? '만드는 중…' : '만들기'}
          </button>
        </>
      }
    >
      <label className="field">
        제목
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="나중에 바꿀 수 있어요" onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && create()} />
      </label>
      <div className="field">
        틀
        <div className="list">
          {TEMPLATES.map((t) => (
            <label key={t.id} className="list-item" style={{ cursor: 'pointer' }}>
              <input type="radio" name="tpl" checked={tpl === t.id} onChange={() => setTpl(t.id)} />
              <span className="grow">
                <b>{t.name}</b>
                <br />
                <span className="muted small">{t.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        목표 분량 <span className="faint tiny">정하면 장마다 「이 칸 목표 글자」를 나눠 넣어요</span>
        <GoalPicker value={goal} onChange={setGoal} per={SEED_PER_PAGE} own={false} />
      </div>
      <div className="field">
        표지 색
        <div className="row wrap">
          {COVERS.map(([bg]) => (
            <button key={bg} className={`swatch${color === bg ? ' on' : ''}`} style={{ background: bg }} aria-label={`표지 색 ${bg}`} onClick={() => setColor(bg)} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
