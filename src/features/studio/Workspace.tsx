// 집필실 작업 화면: 왼쪽 원고 목록 · 가운데 편집기(또는 코르크보드 · 개요 · 통계 · 작가 노트 · 책 설정) · 오른쪽 곁 패널
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { download, toHtml, toMarkdown, toText } from '../../lib/exporters';
import { makeEpub } from '../../lib/epub';
import { local } from '../../lib/idb';
import { go } from '../../lib/router';
import { flatten, loadFull, onSaveState, saveBody, toReadNodes, type FullBook } from '../../lib/store';
import { charsNoSpace, charsWithSpace, fmtNum, manuscriptPages, plain } from '../../lib/text';
import { KIND_LABEL, type BookNode, type NodeKind } from '../../lib/types';
import { confirmBox, Icon, Menu, Modal, promptBox, Spinner, toast } from '../../lib/ui';
import { entriesOf, loadWorld, newItemId, saveItems, toRefs, type Entry, type WItem } from '../../lib/world';
import { Binder, type BinderActions } from './Binder';
import { Editor, type EditorHandle } from './Editor';
import { SidePanel, type SideTab } from './SidePanel';
import { BookNotes, BookSettings, BookStats, Corkboard, Outline } from './Views';
import { FindReplace, PlotThreads, speak, speakSupported, stopSpeaking } from './StudioTools';

type View = 'write' | 'cork' | 'outline' | 'threads' | 'replace' | 'stats' | 'notes' | 'settings';
const VIEWS: View[] = ['write', 'cork', 'outline', 'threads', 'replace', 'stats', 'notes', 'settings'];
const VIEW_LABEL: Record<View, string> = { write: '원고', cork: '코르크보드', outline: '개요', threads: '플롯 선', replace: '찾아 바꾸기', stats: '통계', notes: '작가 노트', settings: '책 설정' };
const VIEW_ICON: Record<View, string> = { write: 'pen', cork: 'grid', outline: 'layers', threads: 'share', replace: 'search', stats: 'chart', notes: 'note', settings: 'settings' };
interface WsPrefs {
  binder: boolean;
  side: boolean;
  focus: boolean;
  typewriter: boolean;
  dialogue: boolean;
  fs: number;
  width: number;
  sideTab: SideTab;
  names: boolean;
}
const DEFAULT_PREFS: WsPrefs = { binder: true, side: true, focus: false, typewriter: false, dialogue: false, fs: 17, width: 44, sideTab: 'info', names: true };

export function Workspace({ bookId, nodeId }: { bookId: string; nodeId?: string }) {
  const [data, setData] = useState<FullBook | null>(null);
  const [err, setErr] = useState('');
  const q0 = useMemo(() => new URLSearchParams(location.hash.split('?')[1] ?? ''), []);
  const [view, setView] = useState<View>(() => (VIEWS.includes(q0.get('view') as View) ? (q0.get('view') as View) : 'write'));
  const [speaking, setSpeaking] = useState(false);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => () => stopSpeaking(), []);
  const [prefs, setPrefsS] = useState<WsPrefs>(() => ({ ...DEFAULT_PREFS, ...local.get<Partial<WsPrefs>>('ws', {}) }));
  const setPrefs = (p: Partial<WsPrefs>) =>
    setPrefsS((o) => {
      const v = { ...o, ...p };
      local.set('ws', v);
      return v;
    });
  const [mobile, setMobile] = useState<'' | 'binder' | 'side'>('');
  const [items, setItems] = useState<WItem[]>([]);
  const [save, setSave] = useState({ pending: 0, error: null as string | null });
  const [selChars, setSelChars] = useState(0);
  const [sprint, setSprint] = useState<{ end: number; start: number; startChars: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [edKey, setEdKey] = useState(0);
  const editor = useRef<EditorHandle>(null);
  const revs = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, number>());
  const sessionStart = useRef<number | null>(null);
  const findQ = new URLSearchParams(location.hash.split('?')[1] ?? '').get('find');

  useEffect(() => onSaveState(setSave), []);
  useEffect(() => {
    loadFull(bookId)
      .then((r) => {
        if (r.offline) toast('인터넷이 없어 기기에 받아 둔 원고를 열었어요. 고친 글은 연결되면 보내요.');
        for (const n of r.data.nodes) revs.current.set(n.id, n.rev);
        setData(r.data);
        sessionStart.current = r.data.nodes.reduce((s, n) => s + (n.deleted ? 0 : charsNoSpace(n.body ?? '')), 0);
      })
      .catch((e) => setErr((e as Error).message));
  }, [bookId]);
  useEffect(() => {
    if (!data?.book.world_id) return setItems([]);
    loadWorld(data.book.world_id)
      .then((w) => setItems(w.items))
      .catch(() => setItems([]));
  }, [data?.book.world_id]);
  useEffect(() => {
    if (!sprint) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sprint]);
  // 창을 닫기 전에 저장 중이면 알린다
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (timers.current.size || save.pending) e.preventDefault();
    };
    addEventListener('beforeunload', h);
    return () => removeEventListener('beforeunload', h);
  }, [save.pending]);

  const nodes = data?.nodes ?? [];
  const live = useMemo(() => nodes.filter((n) => !n.deleted), [nodes]);
  const ordered = useMemo(() => flatten(live), [live]);
  const sel = useMemo(() => {
    const want = nodeId && live.find((n) => n.id === nodeId);
    if (want) return want;
    const last = live.find((n) => n.id === local.get<string>(`lastNode:${bookId}`, ''));
    if (last) return last;
    const firstText = ordered.find((n) => n.kind !== 'part' && n.kind !== 'note') ?? ordered[0];
    return firstText ?? null;
  }, [nodeId, live, ordered]);
  const refs = useMemo(() => toRefs(items), [items]);
  const total = useMemo(() => live.filter((n) => n.kind !== 'note').reduce((s, n) => s + charsNoSpace(n.body ?? ''), 0), [live]);

  const select = (id: string) => {
    setMobile('');
    if (view !== 'write') setView('write');
    history.replaceState(null, '', `#/write/${bookId}/${id}`);
    dispatchEvent(new HashChangeEvent('hashchange'));
  };

  const updateNode = useCallback((id: string, p: Partial<BookNode>) => setData((d) => (d ? { ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) } : d)), []);

  const onBody = useCallback(
    (id: string, body: string) => {
      updateNode(id, { body, chars: charsNoSpace(body) });
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        window.setTimeout(async () => {
          timers.current.delete(id);
          const r = await saveBody(id, bookId, body, revs.current.get(id) ?? 1);
          if (r) {
            revs.current.set(id, r.rev);
            updateNode(id, { rev: r.rev, updated: Date.now() });
            if (r.conflict) toast('다른 기기에서 고친 글이 있어 그 글을 「기록」에 남겨 두었어요.', 'err');
          }
        }, 900),
      );
    },
    [bookId, updateNode],
  );

  const patchNode = async (id: string, p: Partial<BookNode>) => {
    updateNode(id, p);
    try {
      await api(`nodes/${id}`, { method: 'PATCH', body: p });
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  const patchBook = async (p: Record<string, unknown>) => {
    try {
      const r = await api(`books/${bookId}`, { method: 'PATCH', body: p });
      setData((d) => (d ? { ...d, book: { ...d.book, ...r.book } } : d));
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  const act: BinderActions = {
    add: async (kind: NodeKind, parent: string | null, after?: BookNode) => {
      const title = await promptBox(`새 ${KIND_LABEL[kind]} 이름`, kind === 'chapter' ? `${live.filter((n) => n.kind === 'chapter').length + 1}장` : '');
      if (title == null) return;
      let sort: number | undefined;
      if (after) {
        const sib = live.filter((n) => n.parent_id === after.parent_id).sort((a, b) => a.sort - b.sort);
        const next = sib[sib.findIndex((x) => x.id === after.id) + 1];
        sort = next ? (after.sort + next.sort) / 2 : after.sort + 1;
      }
      try {
        const r = await api<{ created: { id: string; parent_id: string | null; sort: number }[] }>(`books/${bookId}/nodes`, { body: { items: [{ kind, title, parent_id: parent, sort }] } });
        const c = r.created[0];
        const n: BookNode = { id: c.id, book_id: bookId, parent_id: c.parent_id, kind, sort: c.sort, title, body: '', synopsis: '', status: '', label: '', meta: {}, chars: 0, rev: 1, updated: Date.now(), deleted: null };
        revs.current.set(n.id, 1);
        setData((d) => (d ? { ...d, nodes: [...d.nodes, n] } : d));
        if (kind !== 'part') select(n.id);
      } catch (e) {
        toast((e as Error).message, 'err');
      }
    },
    rename: async (n) => {
      const t = await promptBox('이름 바꾸기', n.title);
      if (t != null && t !== n.title) void patchNode(n.id, { title: t });
    },
    remove: async (n) => {
      if (!(await confirmBox(`「${n.title || '제목 없음'}」을(를) 휴지통에 넣을까요?`, { ok: '휴지통에 넣기', danger: true, detail: '안에 든 장면도 함께 들어가요. 바인더 아래 휴지통에서 되살릴 수 있어요.' }))) return;
      try {
        const r = await api<{ removed: string[] }>(`nodes/${n.id}`, { method: 'DELETE' });
        const t = Date.now();
        setData((d) => (d ? { ...d, nodes: d.nodes.map((x) => (r.removed.includes(x.id) ? { ...x, deleted: t } : x)) } : d));
      } catch (e) {
        toast((e as Error).message, 'err');
      }
    },
    restore: async (n) => {
      await api(`nodes/${n.id}/restore`, { body: {} });
      setData((d) => (d ? { ...d, nodes: d.nodes.map((x) => (x.deleted === n.deleted ? { ...x, deleted: null } : x)) } : d));
    },
    duplicate: async (n) => {
      const r = await api<{ created: { id: string; sort: number }[] }>(`books/${bookId}/nodes`, { body: { items: [{ kind: n.kind, title: `${n.title} 사본`, parent_id: n.parent_id, sort: n.sort + 0.01, body: n.body, synopsis: n.synopsis, meta: n.meta, status: n.status }] } });
      const c = r.created[0];
      revs.current.set(c.id, 1);
      setData((d) => (d ? { ...d, nodes: [...d.nodes, { ...n, id: c.id, sort: c.sort, title: `${n.title} 사본`, rev: 1 }] } : d));
    },
    merge: async (n) => {
      const sib = live.filter((x) => x.parent_id === n.parent_id && x.kind !== 'part').sort((a, b) => a.sort - b.sort);
      const next = sib[sib.findIndex((x) => x.id === n.id) + 1];
      if (!next) return toast('아래에 합칠 칸이 없어요.', 'err');
      if (live.some((x) => x.parent_id === next.id)) return toast('아래 칸 안에 장면이 있어서 합칠 수 없어요. 장면을 먼저 옮겨 주세요.', 'err');
      if (!(await confirmBox(`「${n.title}」에 「${next.title}」을(를) 합칠까요?`, { ok: '합치기', detail: '아래 칸의 글을 이어 붙이고, 아래 칸은 휴지통에 넣어요. 합치기 전 글은 기록에 남아요.' }))) return;
      await api(`nodes/${n.id}/snapshots`, { body: { label: '합치기 전' } }).catch(() => {});
      const merged = `${(n.body ?? '').replace(/\s+$/, '')}\n\n***\n\n${(next.body ?? '').replace(/^\s+/, '')}`;
      onBody(n.id, merged);
      await api(`nodes/${next.id}`, { method: 'DELETE' }).catch(() => {});
      setData((d) => (d ? { ...d, nodes: d.nodes.map((x) => (x.id === next.id ? { ...x, deleted: Date.now() } : x)) } : d));
      setEdKey((k) => k + 1);
      select(n.id);
    },
    move: async (id, parent, sort) => {
      updateNode(id, { parent_id: parent, sort });
      try {
        await api(`books/${bookId}/reorder`, { body: { items: [{ id, parent_id: parent, sort }] } });
      } catch (e) {
        toast((e as Error).message, 'err');
      }
    },
  };

  const createEntry = async (name: string) => {
    const wid = data?.book.world_id;
    if (!wid) return toast('먼저 책 설정에서 세계관을 연결해 주세요.', 'err');
    if (!(await confirmBox(`「${name}」을(를) 세계관 항목으로 만들까요?`, { ok: '만들기' }))) return;
    const e: Entry = { id: newItemId(), type: 'entry', kind: 'character', name, aliases: [], summary: '', body: '', fields: {}, tags: [], color: '' };
    await saveItems(wid, [e]);
    setItems((x) => [...x, e]);
    toast('항목을 만들었어요. 세계관에서 자세히 채울 수 있어요.');
  };

  useEffect(() => {
    if (findQ && sel && view === 'write') setTimeout(() => editor.current?.find(findQ), 200);
  }, [findQ, sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 쓰던 장을 기억해 두었다가 다음에 그 장으로 연다
  useEffect(() => {
    if (sel) local.set(`lastNode:${bookId}`, sel.id);
  }, [sel?.id, bookId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSpell = () => {
    setView('write');
    if (innerWidth <= 820) setMobile('side');
    setPrefs({ side: true, sideTab: 'spell' });
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F7') {
        e.preventDefault();
        openSpell();
      }
      if (e.key === '?' && (e.ctrlKey || e.metaKey)) setHelp(true);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (err)
    return (
      <div className="main">
        <div className="error-box">{err}</div>
        <p style={{ marginTop: 12 }}>
          <a href="#/studio">집필실로</a>
        </p>
      </div>
    );
  if (!data)
    return (
      <div className="ws">
        <div style={{ gridColumn: '1/-1', padding: 40 }}>
          <Spinner />
        </div>
      </div>
    );

  const book = data.book;
  const body = sel?.body ?? '';
  const written = sessionStart.current != null ? total - sessionStart.current : 0;
  const sprintLeft = sprint ? Math.max(0, sprint.end - now) : 0;
  const readNodes = () => toReadNodes(data.nodes);
  const toggleSpeak = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    const v = editor.current?.view;
    const from = v ? v.state.selection.main.head : 0;
    setSpeaking(true);
    speak(plain(body.slice(from)), () => setSpeaking(false));
  };
  const splitHere = async () => {
    const v = editor.current?.view;
    if (!v || !sel) return;
    const at = v.state.selection.main.head;
    const before = v.state.doc.sliceString(0, at).replace(/\s+$/, '');
    const after = v.state.doc.sliceString(at).replace(/^\s+/, '');
    if (!after) return toast('커서 뒤에 글이 없어요. 나눌 곳에 커서를 두세요.', 'err');
    const title = await promptBox('새로 나뉠 칸의 이름', `${sel.title} (2)`);
    if (title == null) return;
    try {
      const sib = live.filter((x) => x.parent_id === sel.parent_id).sort((a, b) => a.sort - b.sort);
      const next = sib[sib.findIndex((x) => x.id === sel.id) + 1];
      const sort = next ? (sel.sort + next.sort) / 2 : sel.sort + 1;
      const r = await api<{ created: { id: string; sort: number }[] }>(`books/${bookId}/nodes`, { body: { items: [{ kind: sel.kind, title, parent_id: sel.parent_id, sort, body: after, meta: { pov: sel.meta.pov, place: sel.meta.place } }] } });
      const c = r.created[0];
      revs.current.set(c.id, 1);
      const nn: BookNode = { ...sel, id: c.id, sort: c.sort, title, body: after, chars: charsNoSpace(after), synopsis: '', rev: 1, updated: Date.now(), deleted: null };
      setData((d) => (d ? { ...d, nodes: [...d.nodes, nn] } : d));
      onBody(sel.id, before);
      setEdKey((k) => k + 1);
      toast('장을 나눴어요');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  const cls = ['ws', prefs.binder ? '' : 'no-binder', prefs.side && view === 'write' ? '' : 'no-side', prefs.focus ? 'focus' : '', mobile ? `m-${mobile}` : ''].join(' ');

  return (
    <div className={cls} style={{ ['--ed-fs' as string]: `${prefs.fs}px`, ['--ed-w' as string]: `${prefs.width}em` }}>
      <header className="ws-top">
        <button className="icon-btn" aria-label="집필실로" onClick={() => go('studio')}>
          <Icon name="back" />
        </button>
        <button className="icon-btn" aria-label="원고 목록" aria-pressed={prefs.binder} onClick={() => (innerWidth <= 820 ? setMobile(mobile === 'binder' ? '' : 'binder') : setPrefs({ binder: !prefs.binder }))}>
          <Icon name="list" />
        </button>
        <span className="book-name grow">{book.title}</span>
        <span className={`status${save.error ? ' err' : ''}`}>{save.error ? '기기에 저장됨 · 연결되면 보내요' : save.pending || timers.current.size ? '저장 중…' : '저장됨'}</span>
        <Menu label="보기 고르기" icon="layers" text={VIEW_LABEL[view]}>
          {(close) => (
            <>
              {VIEWS.map((k) => (
                <button key={k} className={view === k ? 'on' : ''} onClick={() => (close(), setView(k))}>
                  <Icon name={VIEW_ICON[k]} size={16} />
                  {VIEW_LABEL[k]}
                </button>
              ))}
            </>
          )}
        </Menu>
        <a className="icon-btn" href={`#/read/${bookId}${sel ? '/' + sel.id : ''}`} aria-label="리더로 미리 보기" title="리더로 미리 보기">
          <Icon name="book" />
        </a>
        <Menu label="더 보기">
          {(close) => (
            <>
              {view === 'write' && sel && (
                <>
                  <button onClick={() => (close(), editor.current?.insertLine('***'))}>장면 나눔 넣기</button>
                  <button onClick={() => (close(), editor.current?.find(''))}>이 장에서 찾기 · 바꾸기 (Ctrl+F)</button>
                  <button onClick={() => (close(), void splitHere())}>커서 자리에서 장 나누기</button>
                  {speakSupported() && <button onClick={() => (close(), toggleSpeak())}>{speaking ? '듣기 멈추기' : '소리 내어 듣기 (커서부터)'}</button>}
                  <button onClick={() => (close(), openSpell())}>맞춤법 검사 (F7)</button>
                  <hr />
                </>
              )}
              <button onClick={() => (close(), setPrefs({ focus: !prefs.focus }))}>{prefs.focus ? '집중 모드 끄기' : '집중 모드 (지금 문단만)'}</button>
              <button onClick={() => (close(), setPrefs({ typewriter: !prefs.typewriter }))}>{prefs.typewriter ? '타자기 모드 끄기' : '타자기 모드 (쓰는 줄을 가운데)'}</button>
              <button onClick={() => (close(), setPrefs({ dialogue: !prefs.dialogue }))}>{prefs.dialogue ? '대사 색 끄기' : '대사에 옅은 색'}</button>
              <button onClick={() => (close(), setPrefs({ names: !prefs.names }))}>{prefs.names ? '세계관 이름 자동 완성 끄기' : '세계관 이름 자동 완성 켜기'}</button>
              <hr />
              <button onClick={() => (close(), setPrefs({ fs: Math.min(24, prefs.fs + 1) }))}>글자 크게 ({prefs.fs + 1})</button>
              <button onClick={() => (close(), setPrefs({ fs: Math.max(13, prefs.fs - 1) }))}>글자 작게 ({prefs.fs - 1})</button>
              <button onClick={() => (close(), setPrefs({ width: prefs.width >= 52 ? 36 : prefs.width + 8 }))}>원고 폭 {prefs.width >= 52 ? '좁게' : '넓게'}</button>
              <hr />
              {!sprint ? (
                [15, 25, 45].map((m) => (
                  <button key={m} onClick={() => (close(), setSprint({ start: Date.now(), end: Date.now() + m * 60_000, startChars: total }), setNow(Date.now()))}>
                    {m}분 집중해서 쓰기
                  </button>
                ))
              ) : (
                <button onClick={() => (close(), setSprint(null))}>집중 쓰기 그만두기</button>
              )}
              <hr />
              <button onClick={() => (close(), setHelp(true))}>단축키 보기</button>
              <hr />
              <button onClick={() => (close(), download(`${book.title}.epub`, new Blob([makeEpub(book, readNodes()) as BlobPart], { type: 'application/epub+zip' })))}>전자책(EPUB)으로 내보내기</button>
              <button onClick={() => (close(), download(`${book.title}.md`, toMarkdown(book.title, book.author, readNodes()), 'text/markdown;charset=utf-8'))}>마크다운(.md)으로 내보내기</button>
              <button onClick={() => (close(), download(`${book.title}.txt`, toText(book.title, book.author, readNodes())))}>글(.txt)로 내보내기</button>
              <button onClick={() => (close(), download(`${book.title}.html`, toHtml(book.title, book.author, readNodes()), 'text/html;charset=utf-8'))}>인쇄용 HTML 로 내보내기</button>
            </>
          )}
        </Menu>
        {view === 'write' && (
          <button className="icon-btn" aria-label="곁 패널" aria-pressed={prefs.side} onClick={() => (innerWidth <= 820 ? setMobile(mobile === 'side' ? '' : 'side') : setPrefs({ side: !prefs.side }))}>
            <Icon name="layers" />
          </button>
        )}
      </header>

      {help && (
        <Modal title="단축키" onClose={() => setHelp(false)}>
          <dl className="kv" style={{ gridTemplateColumns: 'auto 1fr', fontSize: 14, gap: '8px 18px' }}>
            {[
              ['Ctrl/⌘ + B', '굵게'],
              ['Ctrl/⌘ + I', '기울임'],
              ['Ctrl/⌘ + K', '[[세계관 항목]] 링크 · [[ 를 치면 이름 고르기'],
              ['Ctrl/⌘ + /', '%%작가 메모%% (리더에는 안 보여요)'],
              ['Ctrl/⌘ + F', '이 장에서 찾기 · 바꾸기'],
              ['Ctrl/⌘ + Z / Shift + Z', '되돌리기 / 다시'],
              ['F7', '맞춤법 검사'],
              ['Ctrl/⌘ + Shift + K', '빠른 이동 (책 · 장 · 항목)'],
              ['Ctrl/⌘ + 클릭', '[[링크]] 의 세계관 항목 열기'],
              ['Ctrl/⌘ + ?', '이 도움말'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd style={{ textAlign: 'left' }}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="muted small">글을 고르면 위에 작은 서식 말풍선이 떠요.</p>
        </Modal>
      )}
      <Binder nodes={data.nodes} sel={sel?.id ?? null} onSelect={select} act={act} />

      <section className="editor-wrap">
        {view === 'write' &&
          (sel ? (
            <>
              <div className="ed-head row">
                <input className="grow" key={sel.id} defaultValue={sel.title} placeholder={`${KIND_LABEL[sel.kind]} 제목`} aria-label="제목" onBlur={(e) => e.target.value !== sel.title && patchNode(sel.id, { title: e.target.value })} />
                <button className="quiet-btn" onClick={openSpell} title="맞춤법 검사 (F7)">
                  <Icon name="check" size={15} />
                  맞춤법
                </button>
              </div>
              {bubble && (
                <div className="fmt-bubble" style={{ left: bubble.x, top: bubble.y }} onMouseDown={(e) => e.preventDefault()}>
                  <button onClick={() => editor.current?.wrap('**')} title="굵게 (Ctrl+B)">
                    <b>가</b>
                  </button>
                  <button onClick={() => editor.current?.wrap('*')} title="기울임 (Ctrl+I)">
                    <i>가</i>
                  </button>
                  <button onClick={() => editor.current?.wrap('[[', ']]')} title="세계관 항목으로 잇기 (Ctrl+K)">
                    [[ ]]
                  </button>
                  <button onClick={() => editor.current?.wrap('%%', '%%')} title="작가 메모로 (Ctrl+/) — 리더에는 안 보여요">
                    메모
                  </button>
                  <button onClick={() => editor.current?.wrap('> ', '')} title="인용">
                    인용
                  </button>
                </div>
              )}
              <Editor
                key={`${sel.id}:${edKey}`}
                ref={editor}
                doc={sel.body ?? ''}
                onChange={(d) => onBody(sel.id, d)}
                onSelection={setSelChars}
                onSelectRect={setBubble}
                entries={refs}
                focusMode={prefs.focus}
                typewriterMode={prefs.typewriter}
                dialogueTint={prefs.dialogue}
                nameComplete={prefs.names}
                onLinkClick={(name) => {
                  const e = entriesOf(items).find((x) => x.name === name || x.aliases.includes(name));
                  if (e && book.world_id) go(`worlds/${book.world_id}/entries/${e.id}`);
                  else void createEntry(name);
                }}
              />
              <footer className="ed-foot">
                <span>
                  이 {KIND_LABEL[sel.kind]} {fmtNum(charsNoSpace(body))}자 (공백 포함 {fmtNum(charsWithSpace(plain(body)))}) · 원고지 약 {fmtNum(manuscriptPages(body))}매
                </span>
                {!!Number(sel.meta.target) && (
                  <span style={{ color: charsNoSpace(body) >= Number(sel.meta.target) ? 'var(--accent)' : undefined }}>
                    목표 {Math.min(100, Math.round((charsNoSpace(body) / Number(sel.meta.target)) * 100))}%
                  </span>
                )}
                {selChars > 0 && <span>고른 글 {fmtNum(selChars)}자</span>}
                <span>책 전체 {fmtNum(total)}자</span>
                {written !== 0 && <span>이번에 {written > 0 ? '+' : ''}{fmtNum(written)}자</span>}
                {sprint && (
                  <span style={{ color: sprintLeft ? 'var(--accent)' : 'var(--text)' }}>
                    <Icon name="timer" size={12} /> {sprintLeft ? `${Math.floor(sprintLeft / 60000)}:${String(Math.floor((sprintLeft % 60000) / 1000)).padStart(2, '0')}` : '끝!'} · {fmtNum(Math.max(0, total - sprint.startChars))}자 씀
                  </span>
                )}
              </footer>
            </>
          ) : (
            <div style={{ padding: 40 }}>
              <p className="muted">왼쪽 + 로 첫 장을 만들어 보세요.</p>
            </div>
          ))}
        {view === 'cork' && <Corkboard nodes={live} onOpen={select} onMove={act.move} onAdd={(k, p) => act.add(k, p)} />}
        {view === 'outline' && <Outline nodes={live} onOpen={select} onPatch={patchNode} />}
        {view === 'threads' && <PlotThreads book={book} nodes={live} onPatchBook={patchBook} onPatchNode={patchNode} onOpen={select} />}
        {view === 'replace' && (
          <FindReplace
            nodes={live}
            initialFrom={q0.get('from') ?? ''}
            initialTo={q0.get('to') ?? ''}
            onReplace={(id, b) => {
              onBody(id, b);
              setEdKey((k) => k + 1);
            }}
            onOpen={(id, f) => {
              select(id);
              if (f) setTimeout(() => editor.current?.find(f), 250);
            }}
          />
        )}
        {view === 'stats' && <BookStats book={book} nodes={live} onPatchBook={patchBook} />}
        {view === 'notes' && <BookNotes book={book} entries={refs} onSave={(notes) => patchBook({ notes })} />}
        {view === 'settings' && (
          <BookSettings
            book={book}
            nodes={live}
            onPatch={patchBook}
            onWorldLinked={(w) => {
              setData((d) => (d ? { ...d, book: { ...d.book, world_id: w } } : d));
            }}
          />
        )}
      </section>

      {view === 'write' && (
        <SidePanel
          tab={prefs.sideTab}
          setTab={(t) => setPrefs({ sideTab: t })}
          node={sel}
          body={body}
          worldId={book.world_id}
          items={items}
          editor={editor}
          bookId={bookId}
          onPatch={(p) => sel && patchNode(sel.id, p)}
          onRestore={(b) => {
            if (!sel) return;
            onBody(sel.id, b);
            // 편집기를 새 글로 다시 연다
            setEdKey((k) => k + 1);
          }}
          onOpenWorld={() => setView('settings')}
        />
      )}
    </div>
  );
}
