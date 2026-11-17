// 원고 목록(바인더): 부 → 장 → 장면 나무. 끌어서 옮기기, 메뉴로 위 · 아래 옮기기(폰), 이름 바꾸기, 휴지통.
import { useMemo, useState } from 'react';
import { flatten } from '../../lib/store';
import { fmtNum } from '../../lib/text';
import { KIND_LABEL, STATUS_LABEL, type BookNode, type NodeKind } from '../../lib/types';
import { Icon, Menu } from '../../lib/ui';

export interface BinderActions {
  add: (kind: NodeKind, parent: string | null, after?: BookNode) => void;
  rename: (n: BookNode) => void;
  remove: (n: BookNode) => void;
  duplicate: (n: BookNode) => void;
  merge: (n: BookNode) => void;
  move: (id: string, parent: string | null, sort: number) => void;
  restore: (n: BookNode) => void;
}

export function Binder({ nodes, sel, onSelect, act }: { nodes: BookNode[]; sel: string | null; onSelect: (id: string) => void; act: BinderActions }) {
  const live = useMemo(() => nodes.filter((n) => !n.deleted), [nodes]);
  const flat = useMemo(() => flatten(live), [live]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; where: 'before' | 'after' | 'in' } | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [filter, setFilter] = useState('');
  const matches = (n: BookNode) => {
    const f = filter.trim();
    if (!f) return true;
    if (f.startsWith('#')) return (n.meta.tags ?? []).some((t) => t.includes(f.slice(1)));
    return [n.title, n.synopsis, n.meta.pov ?? '', n.meta.place ?? '', STATUS_LABEL[n.status]].some((x) => x.includes(f));
  };
  const trash = nodes.filter((n) => n.deleted);
  const kids = (id: string) => live.filter((n) => n.parent_id === id).sort((a, b) => a.sort - b.sort);
  const hasKids = (id: string) => live.some((n) => n.parent_id === id);
  const isHidden = (n: BookNode & { depth: number }) => {
    let p = n.parent_id;
    while (p) {
      if (closed.has(p)) return true;
      p = live.find((x) => x.id === p)?.parent_id ?? null;
    }
    return false;
  };
  const isDescendant = (id: string, of: string) => {
    let p = live.find((x) => x.id === id)?.parent_id ?? null;
    while (p) {
      if (p === of) return true;
      p = live.find((x) => x.id === p)?.parent_id ?? null;
    }
    return false;
  };
  const siblings = (n: BookNode) => live.filter((x) => x.parent_id === n.parent_id).sort((a, b) => a.sort - b.sort);

  const doDrop = (target: BookNode, where: 'before' | 'after' | 'in') => {
    if (!drag || drag === target.id || isDescendant(target.id, drag)) return;
    if (where === 'in') {
      const k = kids(target.id);
      act.move(drag, target.id, (k[k.length - 1]?.sort ?? 0) + 1);
      setClosed((c) => {
        const x = new Set(c);
        x.delete(target.id);
        return x;
      });
      return;
    }
    const sib = siblings(target).filter((x) => x.id !== drag);
    const i = sib.findIndex((x) => x.id === target.id);
    const prev = where === 'before' ? sib[i - 1] : target;
    const next = where === 'before' ? target : sib[i + 1];
    const sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1 : next.sort - 1;
    act.move(drag, target.parent_id, sort);
  };
  const nudge = (n: BookNode, d: -1 | 1) => {
    const sib = siblings(n);
    const i = sib.findIndex((x) => x.id === n.id);
    const j = i + d;
    if (j < 0 || j >= sib.length) return;
    const other = sib[j];
    const beyond = sib[j + d];
    const sort = beyond ? (other.sort + beyond.sort) / 2 : other.sort + d;
    act.move(n.id, n.parent_id, sort);
  };

  return (
    <aside className="binder" aria-label="원고 목록">
      <div className="row" style={{ padding: '2px 4px 8px', gap: 4 }}>
        <span className="tiny muted grow" style={{ letterSpacing: '.1em' }}>
          원고
        </span>
        <Menu label="새로 만들기" icon="plus">
          {(close) => (
            <>
              <button onClick={() => (close(), act.add('chapter', null))}>새 장</button>
              <button
                onClick={() => {
                  close();
                  const cur = live.find((x) => x.id === sel);
                  const parent = cur ? (cur.kind === 'scene' ? cur.parent_id : cur.kind === 'chapter' ? cur.id : null) : null;
                  act.add('scene', parent);
                }}
              >
                새 장면 (지금 장 안에)
              </button>
              <button onClick={() => (close(), act.add('part', null))}>새 부</button>
              <button onClick={() => (close(), act.add('note', null))}>메모 (원고에 안 들어감)</button>
            </>
          )}
        </Menu>
      </div>
      <input className="input" style={{ fontSize: 13, padding: '6px 9px', marginBottom: 6 }} placeholder="거르기: 제목 · 시점 · 상태 · #꼬리표" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="원고 목록 거르기" />
      {flat.map((n) => {
        if (filter ? !matches(n) && n.kind !== 'part' : isHidden(n)) return null;
        const k = hasKids(n.id);
        return (
          <div
            key={n.id}
            className={`tree-row ${n.kind}${sel === n.id ? ' on' : ''}${drag === n.id ? ' dragging' : ''}${drop?.id === n.id ? ` drop-${drop.where}` : ''}`}
            style={{ paddingLeft: 8 + n.depth * 16 }}
            draggable
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(n.id)}
            onClick={() => onSelect(n.id)}
            onDoubleClick={() => act.rename(n)}
            onDragStart={(e) => {
              setDrag(n.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', n.id);
            }}
            onDragEnd={() => {
              setDrag(null);
              setDrop(null);
            }}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const y = (e.clientY - r.top) / r.height;
              const canIn = n.kind === 'part' || n.kind === 'chapter';
              setDrop({ id: n.id, where: canIn && y > 0.3 && y < 0.7 ? 'in' : y < 0.5 ? 'before' : 'after' });
            }}
            onDragLeave={() => setDrop((d) => (d?.id === n.id ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              if (drop) doDrop(n, drop.where);
              setDrag(null);
              setDrop(null);
            }}
          >
            <span
              className="tree-twist"
              onClick={(e) => {
                if (!k) return;
                e.stopPropagation();
                setClosed((c) => {
                  const x = new Set(c);
                  if (x.has(n.id)) x.delete(n.id);
                  else x.add(n.id);
                  return x;
                });
              }}
            >
              {k && <span style={{ display: 'inline-flex', transform: closed.has(n.id) ? 'rotate(180deg)' : 'rotate(-90deg)' }}><Icon name="back" size={12} /></span>}
            </span>
            {n.kind !== 'part' && <span className={`dot ${n.status}`} style={n.label ? { background: n.label } : undefined} />}
            <span className="t">{n.title || (n.kind === 'note' ? '메모' : `제목 없는 ${KIND_LABEL[n.kind]}`)}</span>
            {n.kind !== 'part' && <span className="c" style={Number(n.meta.target) && n.chars >= Number(n.meta.target) ? { color: 'var(--accent)' } : undefined}>{n.chars ? fmtNum(n.chars) : ''}{Number(n.meta.target) ? `/${fmtNum(Number(n.meta.target))}` : ''}</span>}
            <span onClick={(e) => e.stopPropagation()}>
              <Menu label={`${n.title} 메뉴`}>
                {(close) => (
                  <>
                    <button onClick={() => (close(), act.rename(n))}>이름 바꾸기</button>
                    {n.kind !== 'scene' && n.kind !== 'note' && <button onClick={() => (close(), act.add(n.kind === 'part' ? 'chapter' : 'scene', n.id))}>안에 {n.kind === 'part' ? '장' : '장면'} 만들기</button>}
                    <button onClick={() => (close(), act.add(n.kind, n.parent_id, n))}>아래에 새 {KIND_LABEL[n.kind]}</button>
                    <button onClick={() => (close(), nudge(n, -1))}>위로 옮기기</button>
                    <button onClick={() => (close(), nudge(n, 1))}>아래로 옮기기</button>
                    {n.parent_id && (
                      <button
                        onClick={() => {
                          close();
                          const p = live.find((x) => x.id === n.parent_id);
                          if (p) act.move(n.id, p.parent_id, p.sort + 0.5);
                        }}
                      >
                        한 단계 밖으로
                      </button>
                    )}
                    <button onClick={() => (close(), act.duplicate(n))}>복제</button>
                    {n.kind !== 'part' && <button onClick={() => (close(), act.merge(n))}>아래 칸과 합치기</button>}
                    <hr />
                    <button className="danger" onClick={() => (close(), act.remove(n))}>
                      휴지통에 넣기
                    </button>
                  </>
                )}
              </Menu>
            </span>
          </div>
        );
      })}
      {!flat.length && <p className="muted small" style={{ padding: 8 }}>오른쪽 위 + 로 첫 장을 만들어 보세요.</p>}
      {!!trash.length && (
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <button className="ghost small" onClick={() => setShowTrash(!showTrash)}>
            <Icon name="trash" size={14} />
            휴지통 {trash.length}
          </button>
          {showTrash &&
            trash.map((n) => (
              <div key={n.id} className="tree-row" style={{ cursor: 'default' }}>
                <span className="t muted">{n.title || '제목 없음'}</span>
                <button className="small ghost" onClick={() => act.restore(n)}>
                  되살리기
                </button>
              </div>
            ))}
        </div>
      )}
    </aside>
  );
}
