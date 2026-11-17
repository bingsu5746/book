import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { COVERS } from '../../lib/colors';
import { download, toHtml } from '../../lib/exporters';
import { flatten } from '../../lib/store';
import { renderMd } from '../../lib/md';
import { go } from '../../lib/router';
import { fmtNum } from '../../lib/text';
import { confirmBox, Empty, Icon, Menu, Modal, promptBox, Spinner, SubNav, toast } from '../../lib/ui';
import { DEFAULT_FIELDS, deleteItems, entriesOf, fieldsFor, KINDS, kindLabel, loadWorld, newItemId, REL_CATS, relColor, saveItems, type Entry, type EntryKind, type RelCat, type Relation, type Template, type Track, type WEvent, type WItem, type WorldData, parseBulk, toRefs } from '../../lib/world';
import { Editor } from '../studio/Editor';
import { shrinkImage } from '../../lib/image';
import { WorldMaps } from './WorldMaps';

/** 인물을 깊이 들여다보는 질문 (원하는 것만 채우고, 빈 칸은 지우면 된다) */
const CHARACTER_QUESTIONS = ['가장 오래된 기억', '남에게 숨기는 것', '절대 하지 않을 일', '가장 아끼는 물건', '화가 날 때 하는 행동', '다른 인물이 보는 이 사람', '이야기 처음과 끝에서 달라지는 믿음'];

type Tab = 'entries' | 'graph' | 'maps' | 'timeline' | 'appear' | 'templates' | 'settings';

export function WorldView({ worldId, tab, entryId }: { worldId: string; tab?: string; entryId?: string }) {
  const [data, setData] = useState<WorldData | null>(null);
  const [err, setErr] = useState('');
  const t: Tab = (['entries', 'graph', 'maps', 'timeline', 'appear', 'templates', 'settings'] as Tab[]).includes(tab as Tab) ? (tab as Tab) : 'entries';
  useEffect(() => {
    loadWorld(worldId)
      .then(setData)
      .catch((e) => setErr((e as Error).message));
  }, [worldId]);
  const timers = useRef(new Map<string, number>());

  if (err) return <div className="error-box">{err}</div>;
  if (!data) return <Spinner />;
  const ro = data.readonly;
  const items = data.items;
  const setItems = (fn: (x: WItem[]) => WItem[]) => setData((d) => (d ? { ...d, items: fn(d.items) } : d));
  /** 바꾼 것은 바로 화면에, 저장은 잠깐 멈춘 뒤 */
  const put = (it: WItem, now = false) => {
    if (ro) return;
    setItems((x) => (x.some((y) => y.id === it.id) ? x.map((y) => (y.id === it.id ? it : y)) : [...x, it]));
    clearTimeout(timers.current.get(it.id));
    const run = () =>
      saveItems(worldId, [it])
        .then(() => timers.current.delete(it.id))
        .catch((e) => toast((e as Error).message, 'err'));
    if (now) void run();
    else timers.current.set(it.id, window.setTimeout(run, 700));
  };
  const remove = async (ids: string[]) => {
    setItems((x) => x.filter((y) => !ids.includes(y.id)));
    await deleteItems(worldId, ids).catch((e) => toast((e as Error).message, 'err'));
  };
  const setTab = (x: Tab) => go(`worlds/${worldId}/${x}`);
  const entries = entriesOf(items);
  const open = entryId ? entries.find((e) => e.id === entryId) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="tiny muted">
            <a href="#/worlds">세계관</a> {ro && '· 친구의 세계 (읽기만)'}
          </p>
          <h1>{data.world.title}</h1>
          {data.world.summary && <p className="sub">{data.world.summary}</p>}
        </div>
        <div className="actions">
          {!!data.books.length && (
            <span className="muted small">
              연결된 책:{' '}
              {data.books.map((b, i) => (
                <span key={b.id}>
                  {i ? ', ' : ''}
                  <a href={`#/write/${b.id}`}>{b.title}</a>
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
      <div className="with-sub">
        <SubNav
          value={t}
          onChange={setTab}
          items={[
            { id: 'entries', label: '항목', icon: 'list', badge: entries.length },
            { id: 'graph', label: '관계도', icon: 'share' },
            { id: 'maps', label: '지도', icon: 'compass' },
            { id: 'timeline', label: '연표', icon: 'clock' },
            ...(ro ? [] : [{ id: 'appear' as Tab, label: '등장 분포', icon: 'chart' }]),
            ...(ro ? [] : [{ id: 'templates' as Tab, label: '서식', icon: 'grid' }]),
            ...(ro ? [] : [{ id: 'settings' as Tab, label: '세계 정보', icon: 'settings' }]),
          ]}
        />
        <div style={{ minWidth: 0 }}>
          {t === 'entries' && !open && <EntryList items={items} ro={ro} worldId={worldId} onCreate={(e, stay) => (put(e, true), !stay && go(`worlds/${worldId}/entries/${e.id}`))} />}
          {t === 'entries' && open && <EntryEditor key={open.id} entry={open} items={items} ro={ro} worldId={worldId} put={put} remove={remove} books={data.books} />}
          {t === 'graph' && <Graph items={items} ro={ro} worldId={worldId} put={put} remove={remove} />}
          {t === 'maps' && <WorldMaps worldId={worldId} items={items} ro={ro} put={put} remove={remove} books={data.books} />}
          {t === 'timeline' && <Timeline items={items} ro={ro} put={put} remove={remove} books={data.books} />}
          {t === 'appear' && <Appear worldId={worldId} items={items} />}
          {t === 'templates' && <Templates items={items} put={put} />}
          {t === 'settings' && <WorldSettings data={data} onChange={(w) => setData({ ...data, world: { ...data.world, ...w } })} />}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 항목 목록
function MissingLinks({ worldId, entries, onCreate }: { worldId: string; entries: Entry[]; onCreate: (e: Entry, stay?: boolean) => void }) {
  const [links, setLinks] = useState<{ name: string; count: number; nodes: { node_id: string; book_id: string; node_title: string }[] }[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api(`worlds/${worldId}/links`)
      .then((r) => setLinks(r.links))
      .catch(() => setLinks([]));
  }, [worldId]);
  const known = new Set(entries.flatMap((e) => [e.name, ...e.aliases]));
  const missing = (links ?? []).filter((l) => !known.has(l.name));
  if (!missing.length) return null;
  return (
    <div className="note-box">
      <button className="ghost small" style={{ padding: 0 }} onClick={() => setOpen(!open)}>
        원고에서 [[링크]]로 썼지만 세계관에 없는 이름 <b>{missing.length}개</b> {open ? '접기' : '보기'}
      </button>
      {open && (
        <div className="stack" style={{ gap: 6, marginTop: 8 }}>
          {missing.map((l) => (
            <div key={l.name} className="row wrap">
              <b>{l.name}</b>
              <span className="faint tiny">{l.count}번 · {l.nodes.map((n) => n.node_title).slice(0, 3).join(', ')}</span>
              <span className="grow" />
              <select
                className="input"
                style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}
                value=""
                aria-label={`${l.name} 항목 만들기`}
                onChange={(e) => e.target.value && onCreate({ id: newItemId(), type: 'entry', kind: e.target.value as EntryKind, name: l.name, aliases: [], summary: '', body: '', fields: {}, tags: [], color: '' }, true)}
              >
                <option value="">+ 항목으로 만들기</option>
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BulkAdd({ entries, onDone, onClose }: { entries: Entry[]; onDone: (es: Entry[]) => void; onClose: () => void }) {
  const [kind, setKind] = useState<EntryKind>('character');
  const [text, setText] = useState('');
  const parsed = parseBulk(text);
  const have = new Set(entries.map((e) => e.name));
  const fresh = parsed.filter((p) => !have.has(p.name));
  return (
    <Modal
      title="항목 한꺼번에 넣기"
      onClose={onClose}
      foot={
        <>
          <button onClick={onClose}>그만두기</button>
          <button
            className="primary"
            disabled={!fresh.length}
            onClick={() => {
              onDone(fresh.map((p) => ({ id: newItemId(), type: 'entry', kind, name: p.name, aliases: p.aliases, summary: p.summary, body: '', fields: {}, tags: [], color: '' })));
              onClose();
            }}
          >
            {fresh.length}개 만들기
          </button>
        </>
      }
    >
      <p className="muted small">한 줄에 하나씩: 「이름 - 한 줄 요약」 또는 「이름 | 다른 이름, 다른 이름 | 요약」. 작품 노트에서 인물 목록을 그대로 붙여 넣어도 돼요.</p>
      <select className="input" value={kind} onChange={(e) => setKind(e.target.value as EntryKind)} aria-label="종류">
        {KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>
      <textarea className="input" rows={8} placeholder={'홍설 - 꿈속 꽃밭을 오가는 주인공\n지우 | 지우야 | 홍설의 친구'} value={text} onChange={(e) => setText(e.target.value)} />
      {!!parsed.length && (
        <p className="faint tiny">
          {fresh.length}개를 새로 만들어요{parsed.length > fresh.length ? ` (이미 있는 ${parsed.length - fresh.length}개는 빼요)` : ''}: {fresh.map((p) => p.name).join(', ')}
        </p>
      )}
    </Modal>
  );
}

function EntryList({ items, ro, worldId, onCreate }: { items: WItem[]; ro: boolean; worldId: string; onCreate: (e: Entry, stay?: boolean) => void }) {
  const [bulk, setBulk] = useState(false);
  const [kind, setKind] = useState<EntryKind | ''>('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const entries = entriesOf(items);
  const tags = [...new Set(entries.flatMap((e) => e.tags))];
  const list = entries
    .filter((e) => (!kind || e.kind === kind) && (!tag || e.tags.includes(tag)) && (!q || [e.name, ...e.aliases, e.summary, e.body, ...Object.values(e.fields)].some((x) => x?.includes(q))))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const create = async (k: EntryKind) => {
    const name = await promptBox(`새 ${kindLabel(k)} 이름`, '');
    if (!name) return;
    onCreate({ id: newItemId(), type: 'entry', kind: k, name: name.trim(), aliases: [], summary: '', body: '', fields: {}, tags: [], color: '' });
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      {!ro && <MissingLinks worldId={worldId} entries={entries} onCreate={onCreate} />}
      <div className="row wrap">
        <input className="input grow" style={{ minWidth: 180 }} placeholder="이름 · 내용으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        {!ro && (
          <Menu label="새 항목" icon="plus" btnClass="round-add">
            {(close) => (
              <>
                {KINDS.map((k) => (
                  <button key={k.id} onClick={() => (close(), void create(k.id))}>
                    새 {k.label}
                  </button>
                ))}
                <hr />
                <button onClick={() => (close(), setBulk(true))}>여러 개 한꺼번에 넣기</button>
              </>
            )}
          </Menu>
        )}
      </div>
      {bulk && <BulkAdd entries={entries} onClose={() => setBulk(false)} onDone={(es) => es.forEach((e) => onCreate(e, true))} />}
      <div className="row wrap">
        <button className={`chip${!kind ? ' on' : ''}`} onClick={() => setKind('')}>
          전체 {entries.length}
        </button>
        {KINDS.map((k) => {
          const n = entries.filter((e) => e.kind === k.id).length;
          return n ? (
            <button key={k.id} className={`chip${kind === k.id ? ' on' : ''}`} onClick={() => setKind(k.id)}>
              {k.label} {n}
            </button>
          ) : null;
        })}
        {tags.map((t) => (
          <button key={t} className={`chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? '' : t)}>
            #{t}
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="entry-grid">
          {list.map((e) => (
            <a key={e.id} className="entry-card" href={`#/worlds/${worldId}/entries/${e.id}`} style={{ textDecoration: 'none' }}>
              {e.image && <img className="entry-thumb" src={`/api/images/${e.image}`} alt="" loading="lazy" />}
              <span className="type-tag">{kindLabel(e.kind)}</span>
              <span className="n">
                <span className="swatch-dot" style={{ ['--c' as string]: e.color || undefined }} />
                {e.name}
              </span>
              {e.summary && <span className="s">{e.summary}</span>}
              {!!e.tags.length && <span className="faint tiny">{e.tags.map((t) => `#${t}`).join(' ')}</span>}
            </a>
          ))}
        </div>
      ) : (
        <Empty title={entries.length ? '맞는 항목이 없어요' : '첫 항목을 만들어 보세요'}>{!entries.length && !ro && '오른쪽 위 ＋ 에서 인물 · 장소 같은 종류를 골라요.'}</Empty>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 항목 편집
function EntryEditor({ entry, items, ro, worldId, put, remove, books }: { entry: Entry; items: WItem[]; ro: boolean; worldId: string; put: (i: WItem, now?: boolean) => void; remove: (ids: string[]) => void; books: { id: string; title: string }[] }) {
  const [e, setE] = useState(entry);
  const [origName] = useState(entry.name);
  const [imgBusy, setImgBusy] = useState(false);
  const [preview, setPreview] = useState(ro);
  const [mentions, setMentions] = useState<{ node_id: string; book_id: string; book_title: string; node_title: string; count: number }[] | null>(null);
  const upd = (p: Partial<Entry>) => {
    const v = { ...e, ...p };
    setE(v);
    put(v);
  };
  const entries = entriesOf(items);
  const refs = useMemo(() => toRefs(items), [items]);
  const fields = fieldsFor(items, e.kind);
  const extra = Object.keys(e.fields).filter((k) => !fields.includes(k));
  const rels = items.filter((i): i is Relation => i.type === 'relation' && (i.a === e.id || i.b === e.id));
  const backlinks = entries.filter((x) => x.id !== e.id && [e.name, ...e.aliases].some((n) => x.body.includes(`[[${n}]]`) || x.body.includes(`[[${n}|`)));
  const events = items.filter((i): i is WEvent => i.type === 'event' && i.entries.includes(e.id));
  useEffect(() => {
    if (ro) return;
    api<{ mentions: typeof mentions }>(`worlds/${worldId}/mentions`, { body: { terms: [{ id: e.id, words: [e.name, ...e.aliases] }] } })
      .then((r) => setMentions(r.mentions))
      .catch(() => setMentions([]));
  }, [e.id, e.name, e.aliases.join(), worldId, ro]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => entries.find((x) => x.id === id)?.name ?? '(지운 항목)';
  // 본문 속 [[이름]] 을 누르면 그 항목으로
  const bodyHtml = useMemo(() => renderMd(e.body, { links: true }), [e.body]);

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 820 }}>
      <div className="row wrap">
        <a className="btn small ghost" href={`#/worlds/${worldId}/entries`}>
          <Icon name="back" size={14} />
          항목 목록
        </a>
        <span className="grow" />
        {!ro && (
          <Menu label="항목 메뉴">
            {(close) => (
              <>
                <button
                  onClick={() => {
                    close();
                    const copy: Entry = { ...e, id: newItemId(), name: `${e.name} 사본`, image: undefined };
                    put(copy, true);
                    go(`worlds/${worldId}/entries/${copy.id}`);
                  }}
                >
                  복제
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    close();
                    if (!(await confirmBox(`「${e.name}」을(를) 지울까요?`, { danger: true, ok: '지우기', detail: '이 항목과 이어진 관계도 함께 지워져요.' }))) return;
                    await remove([e.id, ...rels.map((r) => r.id)]);
                    go(`worlds/${worldId}/entries`);
                  }}
                >
                  지우기
                </button>
              </>
            )}
          </Menu>
        )}
      </div>
      <div className="panel stack">
        <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
          {e.image ? (
            <img className="portrait" src={`/api/images/${e.image}`} alt={`${e.name} 그림`} />
          ) : (
            !ro && (
              <label className="portrait empty" title="그림 올리기">
                <Icon name="upload" />
                <span className="tiny">{imgBusy ? '올리는 중' : '그림'}</span>
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={imgBusy}
                  onChange={async (x) => {
                    const f = x.target.files?.[0];
                    if (!f) return;
                    setImgBusy(true);
                    try {
                      const img = await shrinkImage(f, 700);
                      const r = await api<{ id: string }>(`worlds/${worldId}/images`, { body: { mime: img.mime, data: img.data } });
                      upd({ image: r.id });
                    } catch (err) {
                      toast((err as Error).message, 'err');
                    } finally {
                      setImgBusy(false);
                    }
                  }}
                />
              </label>
            )
          )}
          <div className="grow stack" style={{ gap: 6 }}>
            {e.image && !ro && (
              <button
                className="small ghost"
                style={{ alignSelf: 'flex-start' }}
                onClick={async () => {
                  await api(`images/${e.image}`, { method: 'DELETE' }).catch(() => {});
                  upd({ image: undefined });
                }}
              >
                그림 빼기
              </button>
            )}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 12 }}>
          <label className="field grow">
            이름
            <input className="input serif" style={{ fontSize: 20, fontWeight: 600 }} value={e.name} disabled={ro} onChange={(x) => upd({ name: x.target.value })} />
            {!ro && origName && e.name.trim() && e.name.trim() !== origName && !!books.length && (
              <span className="tiny">
                원고 속 「{origName}」도 바꿀까요?{' '}
                {books.map((b) => (
                  <a key={b.id} href={`#/write/${b.id}?view=replace&from=${encodeURIComponent(origName)}&to=${encodeURIComponent(e.name.trim())}`} style={{ marginRight: 8 }}>
                    「{b.title}」에서 바꾸기
                  </a>
                ))}
              </span>
            )}
          </label>
          <label className="field">
            종류
            <select className="input" value={e.kind} disabled={ro} onChange={(x) => upd({ kind: x.target.value as EntryKind })}>
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          다른 이름 · 별명 (쉼표로 나눔 — 원고 속 등장을 찾을 때도 써요)
          <input
            className="input"
            defaultValue={e.aliases.join(', ')}
            disabled={ro}
            onBlur={(x) =>
              upd({
                aliases: x.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <label className="field">
          한 줄 요약
          <input className="input" value={e.summary} disabled={ro} onChange={(x) => upd({ summary: x.target.value })} />
        </label>
        <div className="row wrap" style={{ gap: 12 }}>
          <label className="field grow">
            꼬리표 (쉼표로 나눔)
            <input
              className="input"
              defaultValue={e.tags.join(', ')}
              disabled={ro}
              onBlur={(x) =>
                upd({
                  tags: x.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <div className="field">
            색
            <div className="row">
              {['', ...COVERS.slice(0, 8).map((c) => c[0])].map((c) => (
                <button key={c || 'none'} disabled={ro} className={`swatch${e.color === c ? ' on' : ''}`} style={{ background: c || 'var(--soft)', width: 22, height: 22 }} aria-label={c || '색 없음'} onClick={() => upd({ color: c })} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="panel stack">
        <h3 className="serif">{kindLabel(e.kind)} 서식</h3>
        {[...fields, ...extra].map((f) => (
          <div key={f} className="field-row">
            <span className="small muted" style={{ paddingTop: 9 }}>
              {f}
            </span>
            <textarea className="input" rows={Math.min(6, Math.max(1, Math.ceil((e.fields[f]?.length ?? 0) / 40)))} disabled={ro} value={e.fields[f] ?? ''} onChange={(x) => upd({ fields: { ...e.fields, [f]: x.target.value } })} />
            {extra.includes(f) && !ro ? (
              <button
                className="icon-btn"
                aria-label={`${f} 칸 지우기`}
                onClick={() => {
                  const fs = { ...e.fields };
                  delete fs[f];
                  upd({ fields: fs });
                }}
              >
                <Icon name="close" size={14} />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {!ro && (
          <div className="reveal">
            <button
              className="small"
              onClick={async () => {
                const f = await promptBox('이 항목에만 더할 칸 이름', '');
                if (f && !(f in e.fields)) upd({ fields: { ...e.fields, [f]: '' } });
              }}
            >
              <Icon name="plus" size={14} />칸 더하기
            </button>
            {e.kind === 'character' && (
              <button
                className="small ghost"
                title="인물을 더 깊이 알기 위한 질문 칸을 이 인물에 더해요"
                onClick={() => {
                  const fs = { ...e.fields };
                  for (const q of CHARACTER_QUESTIONS) if (!(q in fs)) fs[q] = '';
                  upd({ fields: fs });
                }}
              >
                질문지 더하기
              </button>
            )}
            <span className="faint tiny" style={{ marginLeft: 8 }}>
              모든 {kindLabel(e.kind)}의 칸은 「서식」에서 바꿔요
            </span>
          </div>
        )}
      </div>
      <div className="panel stack">
        <div className="row">
          <h3 className="serif grow">본문</h3>
          {!ro && (
            <div className="seg">
              <button className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>
                쓰기
              </button>
              <button className={preview ? 'on' : ''} onClick={() => setPreview(true)}>
                보기
              </button>
            </div>
          )}
        </div>
        {preview ? (
          <div
            className="prose"
            style={{ ['--rfont' as string]: 'var(--serif)', ['--fs' as string]: '15px', ['--ink' as string]: 'var(--text)', ['--rmuted' as string]: 'var(--muted)', ['--rline' as string]: 'var(--line)' }}
            onClick={(x) => {
              const n = (x.target as HTMLElement).closest<HTMLElement>('.wl')?.dataset.entry;
              const target = n && entries.find((y) => y.name === n || y.aliases.includes(n));
              if (target) go(`worlds/${worldId}/entries/${target.id}`);
            }}
            dangerouslySetInnerHTML={{ __html: bodyHtml || '<p class="muted">비어 있어요</p>' }}
          />
        ) : (
          <>
          <div className="entry-editor">
            <Editor doc={e.body} entries={refs} focusMode={false} typewriterMode={false} dialogueTint={false} nameComplete onChange={(d) => upd({ body: d })} onLinkClick={(n) => {
              const t = entries.find((y) => y.name === n || y.aliases.includes(n));
              if (t) go(`worlds/${worldId}/entries/${t.id}`);
            }} />
          </div>
          <p className="faint tiny">[[ 를 치면 다른 항목 이름을 고를 수 있어요. Ctrl/⌘ + 클릭으로 그 항목을 열어요.</p>
          </>
        )}
      </div>
      <div className="panel stack">
        <h3 className="serif">관계</h3>
        {!rels.length && <p className="faint small">아직 이어진 항목이 없어요.</p>}
        <div className="list">
          {rels.map((r) => {
            const other = r.a === e.id ? r.b : r.a;
            return (
              <div key={r.id} className="list-item">
                <span className="swatch-dot" style={{ ['--c' as string]: relColor(r.cat) }} title={REL_CATS.find((c) => c.id === r.cat)?.label} />
                <span className="grow">
                  {r.a === e.id ? (
                    <>
                      {e.name} → <b>{r.label || '관계'}</b> → <a href={`#/worlds/${worldId}/entries/${other}`}>{name(other)}</a>
                    </>
                  ) : (
                    <>
                      <a href={`#/worlds/${worldId}/entries/${other}`}>{name(other)}</a> → <b>{r.label || '관계'}</b> → {e.name}
                    </>
                  )}
                  {r.note && <span className="muted small"> · {r.note}</span>}
                </span>
                {!ro && (
                  <button className="icon-btn" aria-label="관계 지우기" onClick={() => remove([r.id])}>
                    <Icon name="close" size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {!ro && <AddRelation from={e} entries={entries} onAdd={(r) => put(r, true)} />}
      </div>
      {(!!backlinks.length || !!events.length) && (
        <div className="panel stack">
          {!!backlinks.length && (
            <>
              <h4 className="small muted">이 항목을 [[링크]]한 항목</h4>
              <div className="row wrap">
                {backlinks.map((b) => (
                  <a key={b.id} className="chip" href={`#/worlds/${worldId}/entries/${b.id}`}>
                    {b.name}
                  </a>
                ))}
              </div>
            </>
          )}
          {!!events.length && (
            <>
              <h4 className="small muted">연표의 사건</h4>
              <div className="row wrap">
                {events.map((v) => (
                  <a key={v.id} className="chip" href={`#/worlds/${worldId}/timeline`}>
                    {v.when ? `${v.when} · ` : ''}
                    {v.title}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {!ro && (
        <div className="panel stack">
          <h3 className="serif">원고에 나오는 곳</h3>
          <p className="faint tiny">이 세계에 연결된 책에서 이름 · 다른 이름이 나온 장</p>
          {!mentions ? (
            <Spinner />
          ) : !mentions.length ? (
            <p className="faint small">아직 원고에 나오지 않아요.</p>
          ) : (
            <div className="list">
              {mentions.map((m) => (
                <a key={m.node_id} className="list-item" href={`#/write/${m.book_id}/${m.node_id}?find=${encodeURIComponent(e.name)}`}>
                  <span className="grow">
                    <span className="muted small">{m.book_title} · </span>
                    {m.node_title || '제목 없는 장'}
                  </span>
                  <span className="faint tiny">{m.count}번</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddRelation({ from, entries, onAdd }: { from: Entry; entries: Entry[]; onAdd: (r: Relation) => void }) {
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const [cat, setCat] = useState<RelCat>('other');
  return (
    <form
      className="row wrap"
      onSubmit={(x) => {
        x.preventDefault();
        if (!to) return;
        onAdd({ id: newItemId(), type: 'relation', a: from.id, b: to, label: label.trim(), note: '', cat });
        setTo('');
        setLabel('');
      }}
    >
      <span className="small">{from.name} →</span>
      <input className="input" style={{ width: 140 }} placeholder="관계 (예: 엄마, 적)" value={label} onChange={(x) => setLabel(x.target.value)} />
      <select className="input" style={{ width: 'auto' }} value={cat} onChange={(x) => setCat(x.target.value as RelCat)} aria-label="관계 종류">
        {REL_CATS.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <span className="small">→</span>
      <select className="input" style={{ width: 'auto', minWidth: 140 }} value={to} onChange={(x) => setTo(x.target.value)} aria-label="이어질 항목">
        <option value="">항목 고르기</option>
        {entries
          .filter((x) => x.id !== from.id)
          .map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({kindLabel(x.kind)})
            </option>
          ))}
      </select>
      <button className="small primary" disabled={!to}>
        잇기
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- 관계도 (힘으로 펼치는 그래프)
function Graph({ items, ro, worldId, put, remove }: { items: WItem[]; ro: boolean; worldId: string; put: (i: WItem, now?: boolean) => void; remove: (ids: string[]) => void }) {
  const entries = entriesOf(items);
  const rels = items.filter((i): i is Relation => i.type === 'relation');
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [onlyLinked, setOnlyLinked] = useState(false);
  const [cats, setCats] = useState<Set<string>>(new Set());
  const linked = new Set(rels.flatMap((r) => [r.a, r.b]));
  const shown = entries.filter((e) => (!kinds.size || kinds.has(e.kind)) && (!onlyLinked || linked.has(e.id)));
  const ids = new Set(shown.map((e) => e.id));
  const edges = rels.filter((r) => ids.has(r.a) && ids.has(r.b) && (!cats.size || cats.has(r.cat ?? 'other')));
  const W = 900;
  const H = 620;
  const pos = useRef(new Map<string, { x: number; y: number; vx: number; vy: number }>());
  const [, tick] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<string | null>(null);

  useEffect(() => {
    const P = pos.current;
    shown.forEach((e, i) => {
      if (!P.has(e.id)) {
        const a = (i / Math.max(1, shown.length)) * Math.PI * 2;
        P.set(e.id, { x: W / 2 + Math.cos(a) * 220, y: H / 2 + Math.sin(a) * 200, vx: 0, vy: 0 });
      }
    });
    let frame = 0;
    let n = 0;
    const step = () => {
      const list = shown.map((e) => ({ id: e.id, p: P.get(e.id)! }));
      for (const a of list)
        for (const b of list) {
          if (a === b) continue;
          const dx = a.p.x - b.p.x;
          const dy = a.p.y - b.p.y;
          const d2 = Math.max(80, dx * dx + dy * dy);
          const f = 5200 / d2;
          a.p.vx += (dx / Math.sqrt(d2)) * f;
          a.p.vy += (dy / Math.sqrt(d2)) * f;
        }
      for (const r of edges) {
        const a = P.get(r.a)!;
        const b = P.get(r.b)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const f = (d - 150) * 0.012;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
      for (const { id, p } of list) {
        p.vx += (W / 2 - p.x) * 0.002;
        p.vy += (H / 2 - p.y) * 0.002;
        if (dragging.current === id) continue;
        p.x = Math.min(W - 30, Math.max(30, p.x + p.vx));
        p.y = Math.min(H - 20, Math.max(20, p.y + p.vy));
        p.vx *= 0.82;
        p.vy *= 0.82;
      }
      tick((t) => t + 1);
      if (++n < 260) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.length, edges.length, kinds, onlyLinked]);

  const toSvg = (ev: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
  };
  const selE = entries.find((e) => e.id === sel);
  const colorOf = (e: Entry) => e.color || ['#2f5d50', '#7a3b32', '#34405e', '#8c6b2f', '#5b3a55', '#3d5c3a', '#9a5a3c', '#6d6a61'][KINDS.findIndex((k) => k.id === e.kind)];

  if (!entries.length) return <Empty title="항목이 없어요">항목을 만들고 「관계」를 이으면 여기에 관계도가 그려져요.</Empty>;
  return (
    <div className="stack">
      <div className="row wrap">
        {KINDS.filter((k) => entries.some((e) => e.kind === k.id)).map((k) => (
          <button
            key={k.id}
            className={`chip${kinds.has(k.id) ? ' on' : ''}`}
            onClick={() =>
              setKinds((s) => {
                const x = new Set(s);
                if (x.has(k.id)) x.delete(k.id);
                else x.add(k.id);
                return x;
              })
            }
          >
            {k.label}
          </button>
        ))}
        <label className="check small">
          <input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} />
          이어진 항목만
        </label>
        <span className="faint tiny">점을 끌어 옮기고, 눌러서 골라요.</span>
      </div>
      <div className="row wrap">
        <span className="muted tiny">관계 종류</span>
        {REL_CATS.filter((c) => rels.some((r) => (r.cat ?? 'other') === c.id)).map((c) => (
          <button
            key={c.id}
            className={`chip${cats.has(c.id) ? ' on' : ''}`}
            onClick={() =>
              setCats((s) => {
                const x = new Set(s);
                if (x.has(c.id)) x.delete(c.id);
                else x.add(c.id);
                return x;
              })
            }
          >
            <span className="swatch-dot" style={{ ['--c' as string]: c.color }} />
            {c.label}
          </button>
        ))}
      </div>
      <svg
        ref={svg}
        className="graph"
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={(ev) => {
          const id = dragging.current;
          if (!id) return;
          const p = pos.current.get(id)!;
          const q = toSvg(ev);
          p.x = q.x;
          p.y = q.y;
          tick((t) => t + 1);
        }}
        onPointerUp={() => (dragging.current = null)}
        onPointerLeave={() => (dragging.current = null)}
      >
        {edges.map((r) => {
          const a = pos.current.get(r.a);
          const b = pos.current.get(r.b);
          if (!a || !b) return null;
          return (
            <g key={r.id}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: relColor(r.cat), strokeWidth: sel && (r.a === sel || r.b === sel) ? 2.6 : 1.4, opacity: sel && r.a !== sel && r.b !== sel ? 0.35 : 0.9 }} />
              {r.label && (
                <text className="edge-label" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle">
                  {r.label}
                </text>
              )}
            </g>
          );
        })}
        {shown.map((e) => {
          const p = pos.current.get(e.id);
          if (!p) return null;
          const deg = rels.filter((r) => r.a === e.id || r.b === e.id).length;
          return (
            <g
              key={e.id}
              className={sel === e.id ? 'sel' : ''}
              transform={`translate(${p.x},${p.y})`}
              onPointerDown={(ev) => {
                (ev.target as Element).setPointerCapture?.(ev.pointerId);
                dragging.current = e.id;
                setSel(e.id);
              }}
              style={{ cursor: 'pointer' }}
            >
              <circle r={8 + Math.min(10, deg * 1.5)} fill={colorOf(e)} />
              <text y={22 + Math.min(10, deg * 1.5)} textAnchor="middle">
                {e.name}
              </text>
            </g>
          );
        })}
      </svg>
      {selE && (
        <div className="panel row wrap">
          <span className="grow">
            <span className="type-tag">{kindLabel(selE.kind)}</span> <b className="serif">{selE.name}</b> <span className="muted small">{selE.summary}</span>
          </span>
          <a className="btn small" href={`#/worlds/${worldId}/entries/${selE.id}`}>
            열기
          </a>
          {!ro && <AddRelation from={selE} entries={entries} onAdd={(r) => put(r, true)} />}
        </div>
      )}
      {!ro && !!rels.length && (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            모든 관계 ({rels.length})
          </summary>
          <div className="list" style={{ marginTop: 8 }}>
            {rels.map((r) => (
              <div key={r.id} className="list-item small">
                <span className="grow">
                  {entries.find((x) => x.id === r.a)?.name} → <b>{r.label || '관계'}</b> → {entries.find((x) => x.id === r.b)?.name}
                </span>
                <input className="input" style={{ width: 140 }} defaultValue={r.label} aria-label="관계 이름" onBlur={(ev) => ev.target.value !== r.label && put({ ...r, label: ev.target.value })} />
                <select className="input" style={{ width: 'auto' }} value={r.cat ?? 'other'} aria-label="관계 종류" onChange={(ev) => put({ ...r, cat: ev.target.value as RelCat }, true)}>
                  {REL_CATS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button className="icon-btn" aria-label="지우기" onClick={() => remove([r.id])}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 연표 (여러 줄)
function useChapters(books: { id: string; title: string }[]) {
  const [list, setList] = useState<{ id: string; title: string; book: string; book_id: string }[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      const out: { id: string; title: string; book: string; book_id: string }[] = [];
      for (const b of books) {
        const t = await api(`books/${b.id}`).catch(() => null);
        if (!t) continue;
        for (const n of flatten((t.nodes as { id: string; parent_id: string | null; sort: number; kind: string; title: string; deleted: number | null }[]).filter((x) => !x.deleted && x.kind !== 'part' && x.kind !== 'note'))) out.push({ id: n.id, title: n.title, book: b.title, book_id: b.id });
      }
      if (live) setList(out);
    })();
    return () => {
      live = false;
    };
  }, [books.map((b) => b.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}

function Timeline({ items, ro, put, remove, books }: { items: WItem[]; ro: boolean; put: (i: WItem, now?: boolean) => void; remove: (ids: string[]) => void; books: { id: string; title: string }[] }) {
  const chapters = useChapters(ro ? [] : books);
  const tracks = items.filter((i): i is Track => i.type === 'track').sort((a, b) => a.sort - b.sort);
  const events = items.filter((i): i is WEvent => i.type === 'event');
  const entries = entriesOf(items);
  const [edit, setEdit] = useState<WEvent | null>(null);
  const allTracks: Track[] = tracks.length ? tracks : [{ id: '', type: 'track', name: '연표', color: '', sort: 0 }];
  const orders = [...new Set(events.map((e) => e.order))].sort((a, b) => a - b);
  const newEvent = (track: string, order?: number) => setEdit({ id: newItemId(), type: 'event', title: '', track, when: '', order: order ?? (orders.length ? orders[orders.length - 1] + 10 : 10), body: '', entries: [], nodes: [] });
  return (
    <div className="stack">
      <p className="muted small">줄(예: 「꿈의 시간」 「현실의 시간」)마다 사건을 놓아요. 「순서」 숫자가 같은 사건은 같은 칸(같은 때)에 나란히 놓여요.</p>
      {!ro && (
        <div className="row wrap">
          <button className="primary small" onClick={() => newEvent(allTracks[0].id)}>
            <Icon name="plus" size={14} />새 사건
          </button>
          <button
            className="small"
            onClick={async () => {
              const name = await promptBox('새 줄 이름', tracks.length ? '' : '본 이야기');
              if (name) put({ id: newItemId(), type: 'track', name, color: COVERS[tracks.length % COVERS.length][0], sort: tracks.length }, true);
            }}
          >
            <Icon name="plus" size={14} />새 줄
          </button>
        </div>
      )}
      {!events.length ? (
        <Empty title="연표가 비어 있어요" />
      ) : (
        <div className="timeline">
          <div className="tl-grid" style={{ gridTemplateColumns: `130px repeat(${orders.length}, auto)` }}>
            {allTracks.map((t) => (
              <div key={t.id || 'main'} style={{ display: 'contents' }}>
                <div className="tl-track-name">
                  <span className="swatch-dot" style={{ ['--c' as string]: t.color || undefined, display: 'inline-block', marginRight: 6 }} />
                  {t.name}
                  {!ro && t.id && (
                    <button
                      className="icon-btn"
                      aria-label="줄 이름 바꾸기"
                      onClick={async () => {
                        const name = await promptBox('줄 이름', t.name);
                        if (name) put({ ...t, name }, true);
                      }}
                    >
                      <Icon name="pen" size={12} />
                    </button>
                  )}
                </div>
                {orders.map((o) => (
                  <div key={o} className="tl-cell">
                    {events
                      .filter((e) => e.order === o && (e.track === t.id || (!t.id && !tracks.some((x) => x.id === e.track))))
                      .map((e) => (
                        <button key={e.id} className="tl-event" style={{ ['--c' as string]: t.color || undefined }} onClick={() => setEdit(e)}>
                          {e.when && <span className="d">{e.when}</span>}
                          <div className="t">{e.title || '이름 없는 사건'}</div>
                          {!!e.entries.length && <div className="d">{e.entries.map((id) => entries.find((x) => x.id === id)?.name).filter(Boolean).join(', ')}</div>}
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {edit && (
        <Modal
          title={ro ? edit.title : '사건'}
          onClose={() => setEdit(null)}
          foot={
            ro ? undefined : (
              <>
                {events.some((x) => x.id === edit.id) && (
                  <button
                    className="danger"
                    onClick={() => {
                      void remove([edit.id]);
                      setEdit(null);
                    }}
                  >
                    지우기
                  </button>
                )}
                <span className="grow" />
                <button onClick={() => setEdit(null)}>그만두기</button>
                <button
                  className="primary"
                  onClick={() => {
                    put(edit, true);
                    setEdit(null);
                  }}
                >
                  저장
                </button>
              </>
            )
          }
        >
          <label className="field">
            사건 이름
            <input className="input" disabled={ro} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          </label>
          <div className="row wrap" style={{ gap: 12 }}>
            <label className="field grow">
              세계 안 날짜 · 때 (자유롭게)
              <input className="input" disabled={ro} placeholder="예: 현실 2년 차 봄 / 오전 8시" value={edit.when} onChange={(e) => setEdit({ ...edit, when: e.target.value })} />
            </label>
            <label className="field" style={{ width: 110 }}>
              순서 (숫자)
              <input className="input" type="number" disabled={ro} value={edit.order} onChange={(e) => setEdit({ ...edit, order: +e.target.value })} />
            </label>
          </div>
          {tracks.length > 0 && (
            <label className="field">
              줄
              <select className="input" disabled={ro} value={edit.track} onChange={(e) => setEdit({ ...edit, track: e.target.value })}>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            내용
            <textarea className="input" rows={4} disabled={ro} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          </label>
          {!!chapters.length && (
            <label className="field">
              이 사건이 나오는 장
              <select
                className="input"
                disabled={ro}
                value=""
                onChange={(e) => e.target.value && !edit.nodes.includes(e.target.value) && setEdit({ ...edit, nodes: [...edit.nodes, e.target.value] })}
              >
                <option value="">장 더하기</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {books.length > 1 ? `${c.book} · ` : ''}
                    {c.title}
                  </option>
                ))}
              </select>
              <span className="row wrap">
                {edit.nodes.map((id) => {
                  const c = chapters.find((x) => x.id === id);
                  return (
                    <span key={id} className="chip on">
                      {c ? <a href={`#/write/${c.book_id}/${c.id}`}>{c.title}</a> : '(지운 장)'}
                      {!ro && (
                        <button className="icon-btn" style={{ padding: 0 }} aria-label="장 빼기" onClick={() => setEdit({ ...edit, nodes: edit.nodes.filter((x) => x !== id) })}>
                          <Icon name="close" size={12} />
                        </button>
                      )}
                    </span>
                  );
                })}
              </span>
            </label>
          )}
          <div className="field">
            관련 항목
            <div className="row wrap">
              {entries.map((x) => (
                <button key={x.id} disabled={ro} className={`chip${edit.entries.includes(x.id) ? ' on' : ''}`} onClick={() => setEdit({ ...edit, entries: edit.entries.includes(x.id) ? edit.entries.filter((y) => y !== x.id) : [...edit.entries, x.id] })}>
                  {x.name}
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 등장 분포 (항목 × 장)
function Appear({ worldId, items }: { worldId: string; items: WItem[] }) {
  const entries = entriesOf(items);
  const [kind, setKind] = useState<EntryKind>('character');
  const [data, setData] = useState<{ entry: string; node_id: string; book_id: string; book_title: string; node_title: string; count: number }[] | null>(null);
  const [order, setOrder] = useState<{ id: string; title: string; book: string }[]>([]);
  const list = entries.filter((e) => e.kind === kind);
  useEffect(() => {
    setData(null);
    api<{ mentions: NonNullable<typeof data> }>(`worlds/${worldId}/mentions`, { body: { terms: list.map((e) => ({ id: e.id, words: [e.name, ...e.aliases] })) } })
      .then(async (r) => {
        // 장 순서: 연결된 책의 나무 순서
        const books = [...new Set(r.mentions.map((m) => m.book_id))];
        const seq: { id: string; title: string; book: string }[] = [];
        for (const b of books) {
          const t = await api(`books/${b}`).catch(() => null);
          if (!t) continue;
          for (const n of flatten((t.nodes as { id: string; parent_id: string | null; sort: number; kind: string; title: string; deleted: number | null }[]).filter((x) => !x.deleted && x.kind !== 'part' && x.kind !== 'note'))) seq.push({ id: n.id, title: n.title, book: t.book.title });
        }
        setOrder(seq);
        setData(r.mentions);
      })
      .catch(() => setData([]));
  }, [worldId, kind, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const cell = new Map((data ?? []).map((m) => [`${m.entry}:${m.node_id}`, m.count]));
  const max = Math.max(1, ...(data ?? []).map((m) => m.count));
  return (
    <div className="stack">
      <p className="muted small">연결된 책의 장마다 항목 이름(다른 이름 포함)이 몇 번 나오는지 보여요. 오래 안 나온 인물, 갑자기 사라진 장소를 찾을 때 써요.</p>
      <div className="row wrap">
        {KINDS.filter((k) => entries.some((e) => e.kind === k.id)).map((k) => (
          <button key={k.id} className={`chip${kind === k.id ? ' on' : ''}`} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      {!data ? (
        <Spinner />
      ) : !order.length ? (
        <Empty title="나오는 곳이 없어요">책 설정에서 이 세계를 책에 연결하고, 원고에 항목 이름을 쓰면 여기에 나타나요.</Empty>
      ) : (
        <div style={{ overflowX: 'auto' }} className="panel">
          <table className="heatmap">
            <thead>
              <tr>
                <th />
                {order.map((n, i) => (
                  <th key={n.id} title={`${n.book} · ${n.title}`} style={{ writingMode: 'vertical-rl', fontSize: 11, height: 90 }}>
                    {n.title || i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <th>
                    <a href={`#/worlds/${worldId}/entries/${e.id}`}>{e.name}</a>
                  </th>
                  {order.map((n) => {
                    const c = cell.get(`${e.id}:${n.id}`) ?? 0;
                    return <td key={n.id} title={`${e.name} · ${n.title} · ${c}번`} style={c ? { background: `color-mix(in srgb, var(--accent) ${20 + (c / max) * 80}%, var(--soft))` } : undefined} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 서식 (종류마다 칸)
function Templates({ items, put }: { items: WItem[]; put: (i: WItem, now?: boolean) => void }) {
  return (
    <div className="stack">
      <p className="muted small">종류마다 항목에 보일 칸을 정해요. 칸 이름을 바꾸면 이미 쓴 내용은 그 칸에서 빠져 「이 항목에만 더한 칸」으로 남아요.</p>
      {KINDS.map((k) => {
        const tpl = items.find((i): i is Template => i.type === 'template' && i.kind === k.id);
        const fields = tpl?.fields ?? DEFAULT_FIELDS[k.id];
        const save = (f: string[]) => put({ id: tpl?.id ?? newItemId(), type: 'template', kind: k.id, fields: f }, true);
        return (
          <div key={k.id} className="panel stack">
            <h3 className="serif">{k.label}</h3>
            <div className="row wrap">
              {fields.map((f, i) => (
                <span key={f + i} className="chip" style={{ fontSize: 13, padding: '4px 10px' }}>
                  {f}
                  <button className="icon-btn" style={{ padding: 2 }} aria-label={`${f} 앞으로`} disabled={i === 0} onClick={() => save(fields.map((x, j) => (j === i - 1 ? f : j === i ? fields[i - 1] : x)))}>
                    ‹
                  </button>
                  <button className="icon-btn" style={{ padding: 2 }} aria-label={`${f} 빼기`} onClick={() => save(fields.filter((_, j) => j !== i))}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
              <button
                className="small"
                onClick={async () => {
                  const f = await promptBox(`${k.label}에 더할 칸`, '');
                  if (f && !fields.includes(f)) save([...fields, f.trim()]);
                }}
              >
                <Icon name="plus" size={12} />칸
              </button>
              {tpl && (
                <button className="small ghost" onClick={() => save(DEFAULT_FIELDS[k.id])}>
                  처음대로
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- 세계 정보 · 내보내기
function worldMarkdown(d: WorldData): string {
  const out = [`# ${d.world.title}`, d.world.summary, ''];
  const entries = entriesOf(d.items);
  const name = (id: string) => entries.find((e) => e.id === id)?.name ?? '';
  for (const k of KINDS) {
    const list = entries.filter((e) => e.kind === k.id).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    if (!list.length) continue;
    out.push(`## ${k.label}`, '');
    for (const e of list) {
      out.push(`### ${e.name}`);
      if (e.aliases.length) out.push(`다른 이름: ${e.aliases.join(', ')}  `);
      if (e.summary) out.push(`*${e.summary}*`);
      out.push('');
      for (const [f, v] of Object.entries(e.fields)) if (v.trim()) out.push(`- **${f}**: ${v.replace(/\n/g, ' ')}`);
      const rels = d.items.filter((i): i is Relation => i.type === 'relation' && i.a === e.id);
      for (const r of rels) out.push(`- **관계**: ${r.label || '관계'} → ${name(r.b)}`);
      if (e.body.trim()) out.push('', e.body.trim());
      out.push('');
    }
  }
  const events = d.items.filter((i): i is WEvent => i.type === 'event').sort((a, b) => a.order - b.order);
  if (events.length) {
    out.push('## 연표', '');
    const tracks = d.items.filter((i): i is Track => i.type === 'track');
    for (const e of events) out.push(`- ${e.when ? `**${e.when}** ` : ''}${e.title}${tracks.length ? ` (${tracks.find((t) => t.id === e.track)?.name ?? ''})` : ''}${e.body ? ` — ${e.body.replace(/\n/g, ' ')}` : ''}`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function WorldSettings({ data, onChange }: { data: WorldData; onChange: (w: Partial<WorldData['world']>) => void }) {
  const w = data.world;
  const patch = async (p: Partial<WorldData['world']>) => {
    onChange(p);
    await api(`worlds/${w.id}`, { method: 'PATCH', body: p }).catch((e) => toast((e as Error).message, 'err'));
  };
  const entries = entriesOf(data.items);
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <section className="panel stack">
        <label className="field">
          세계 이름
          <input className="input" defaultValue={w.title} onBlur={(e) => e.target.value !== w.title && patch({ title: e.target.value })} />
        </label>
        <label className="field">
          한 줄 소개
          <textarea className="input" rows={3} defaultValue={w.summary} onBlur={(e) => e.target.value !== w.summary && patch({ summary: e.target.value })} />
        </label>
        <div className="field">
          색
          <div className="row wrap">
            {COVERS.map(([bg]) => (
              <button key={bg} className={`swatch${w.color === bg ? ' on' : ''}`} style={{ background: bg }} aria-label={bg} onClick={() => patch({ color: bg })} />
            ))}
          </div>
        </div>
        <p className="faint tiny">
          항목 {fmtNum(entries.length)}개 · 관계 {fmtNum(data.items.filter((i) => i.type === 'relation').length)}개 · 사건 {fmtNum(data.items.filter((i) => i.type === 'event').length)}개
        </p>
      </section>
      <section className="panel stack">
        <h3 className="serif">설정집 내보내기</h3>
        <div className="row wrap">
          <button onClick={() => download(`${w.title} 설정집.md`, worldMarkdown(data), 'text/markdown;charset=utf-8')}>마크다운(.md)</button>
          <button
            onClick={async () => {
              download(`${w.title} 설정집.html`, toHtml(`${w.title} 설정집`, '', [{ id: 'w', kind: 'chapter', depth: 0, title: '', body: worldMarkdown(data).replace(/^# .+\n/, '') }]), 'text/html;charset=utf-8');
            }}
          >
            인쇄용 HTML
          </button>
        </div>
      </section>
      <section className="panel stack">
        <h3 className="serif">세계 지우기</h3>
        <div>
          <button
            className="danger"
            onClick={async () => {
              if (!(await confirmBox(`「${w.title}」을(를) 지울까요?`, { danger: true, ok: '지우기', detail: '세계관 목록 아래 「지운 세계」에서 되살릴 수 있어요. 연결된 책과의 연결은 풀려요.' }))) return;
              await api(`worlds/${w.id}`, { method: 'DELETE' });
              go('worlds');
            }}
          >
            지우기
          </button>
        </div>
      </section>
    </div>
  );
}
