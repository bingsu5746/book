// 빠른 이동: Ctrl/⌘ + K (편집기 밖) 또는 Ctrl/⌘ + Shift + K (어디서나) → 책 · 장 · 세계 · 세계관 항목 이름으로 바로 가기
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { go } from '../lib/router';
import { cachedBooks, flatten } from '../lib/store';
import type { Book } from '../lib/types';
import { kindLabel, loadWorld, type World } from '../lib/world';
import { Icon, toast } from '../lib/ui';

interface Item {
  label: string;
  sub: string;
  href: string;
  icon: string;
}
let cache: { at: number; items: Item[] } | null = null;

async function collect(): Promise<Item[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.items;
  const items: Item[] = [
    { label: '아이디어 수첩', sub: 'Ctrl/⌘ + J 로 바로 적기', href: 'jots', icon: 'note' },
    { label: '밑줄 모음', sub: '읽다가 그은 밑줄', href: 'lines', icon: 'bookmark' },
    { label: '자유 이용 책 찾기', sub: '위키문헌 · 구텐베르크', href: 'discover', icon: 'compass' },
    { label: '계정 · 설정', sub: '화면 밝기 · 백업', href: 'account', icon: 'user' },
  ];
  const [b, w] = await Promise.all([api<{ books: Book[] }>('books').catch(() => ({ books: [] as Book[] })), api<{ worlds: World[] }>('worlds').catch(() => ({ worlds: [] as World[] }))]);
  for (const x of b.books.filter((x) => !x.deleted)) items.push({ label: x.title, sub: x.kind === 'write' ? '내 원고 · 집필실' : '들인 책 · 읽기', href: x.kind === 'write' ? `write/${x.id}` : `read/${x.id}`, icon: x.kind === 'write' ? 'pen' : 'book' });
  for (const f of await cachedBooks()) {
    if (f.book.kind !== 'write' || f.book.deleted) continue;
    for (const n of flatten(f.nodes.filter((x) => !x.deleted && x.kind !== 'part'))) items.push({ label: n.title || '제목 없음', sub: `${f.book.title}의 장`, href: `write/${f.book.id}/${n.id}`, icon: 'note' });
  }
  for (const x of w.worlds.filter((x) => !x.deleted)) {
    items.push({ label: x.title, sub: '세계', href: `worlds/${x.id}`, icon: 'globe' });
    const d = await loadWorld(x.id).catch(() => null);
    for (const i of d?.items ?? []) if (i.type === 'entry') items.push({ label: i.name, sub: `${x.title} · ${kindLabel(i.kind)}${i.aliases.length ? ` · ${i.aliases.join(', ')}` : ''}`, href: `worlds/${x.id}/entries/${i.id}`, icon: 'user' });
  }
  cache = { at: Date.now(), items };
  return items;
}

export function QuickJump() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      const inEditor = (e.target as HTMLElement).closest?.('.cm-editor');
      if (inEditor && !e.shiftKey) return; // 편집기 안 Ctrl+K 는 [[세계관 링크]]
      e.preventDefault();
      setOpen(true);
    };
    const o = () => setOpen(true);
    addEventListener('keydown', k);
    addEventListener('quick-jump', o);
    return () => {
      removeEventListener('keydown', k);
      removeEventListener('quick-jump', o);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    setQ('');
    setI(0);
    setTimeout(() => input.current?.focus(), 10);
    void collect().then(setItems);
  }, [open]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items.slice(0, 12);
    const actions: Item[] = [
      { label: `모든 책 본문에서 「${q.trim()}」 찾기`, sub: '내 원고 · 들인 책 · 친구의 책', href: `search?q=${encodeURIComponent(q.trim())}`, icon: 'search' },
      { label: `수첩에 적기: ${q.trim()}`, sub: 'Enter 로 바로 적어요', href: `@jot:${q.trim()}`, icon: 'note' },
    ];
    const score = (x: Item) => {
      const l = x.label.toLowerCase();
      if (l === t) return 0;
      if (l.startsWith(t)) return 1;
      if (l.includes(t)) return 2;
      if (x.sub.toLowerCase().includes(t)) return 3;
      return 9;
    };
    return items
      .map((x) => ({ x, s: score(x) }))
      .filter((y) => y.s < 9)
      .sort((a, b) => a.s - b.s)
      .slice(0, 28)
      .map((y) => y.x)
      .concat(actions);
  }, [q, items]);
  if (!open) return null;
  const pick = (x: Item) => {
    setOpen(false);
    if (x.href.startsWith('@jot:')) {
      void api('jots', { body: { text: x.href.slice(5) } })
        .then(() => toast('수첩에 적었어요'))
        .catch((e) => toast((e as Error).message, 'err'));
      return;
    }
    go(x.href);
  };
  return (
    <div className="modal-back" style={{ alignItems: 'flex-start', paddingTop: '12vh' }} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal" role="dialog" aria-label="빠른 이동">
        <div className="row" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
          <Icon name="search" />
          <input
            ref={input}
            className="grow"
            style={{ border: 0, background: 'none', font: 'inherit', fontSize: 16, color: 'var(--text)', outline: 'none' }}
            placeholder="책 · 장 · 인물 이름, 또는 찾을 말"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'ArrowDown') (e.preventDefault(), setI((x) => Math.min(list.length - 1, x + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setI((x) => Math.max(0, x - 1)));
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && list[i]) pick(list[i]);
            }}
          />
          <span className="faint tiny">Esc</span>
        </div>
        <div style={{ maxHeight: '55vh', overflow: 'auto', padding: 6 }}>
          {!list.length && <p className="muted small" style={{ padding: 12 }}>{items.length ? '찾은 것이 없어요' : '불러오는 중…'}</p>}
          {list.map((x, k) => (
            <button key={x.href + k} className={`list-item${k === i ? ' on' : ''}`} style={{ borderRadius: 8, background: k === i ? 'var(--soft)' : undefined }} onMouseEnter={() => setI(k)} onClick={() => pick(x)}>
              <Icon name={x.icon} size={16} />
              <span className="grow ellipsis">{x.label}</span>
              <span className="faint tiny ellipsis" style={{ maxWidth: '45%' }}>
                {x.sub}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
