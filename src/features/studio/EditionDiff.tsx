// 공유한 판과 지금 원고 비교: 장마다 더한 글 · 지운 글, 새로 생긴 장 · 빠진 장
import { useEffect, useMemo, useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import { api } from '../../lib/api';
import { flatten } from '../../lib/store';
import { fmtNum } from '../../lib/text';
import type { BookNode } from '../../lib/types';
import { Modal, Spinner } from '../../lib/ui';

interface ENode {
  id: string;
  title: string;
  body: string;
  kind: string;
}

export function EditionDiff({ editionId, number, nodes, onClose }: { editionId: string; number: number; nodes: BookNode[]; onClose: () => void }) {
  const [ed, setEd] = useState<ENode[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    api<{ nodes: ENode[] }>(`editions/${editionId}`)
      .then((r) => setEd(r.nodes))
      .catch(() => setEd([]));
  }, [editionId]);
  const rows = useMemo(() => {
    if (!ed) return [];
    const cur = flatten(nodes.filter((n) => n.kind !== 'note' && !n.deleted));
    const old = new Map(ed.map((n) => [n.id, n]));
    const out: { id: string; title: string; state: 'same' | 'changed' | 'new' | 'gone'; plus: number; minus: number; a: string; b: string }[] = [];
    for (const n of cur) {
      const o = old.get(n.id);
      const b = n.body ?? '';
      if (!o) {
        out.push({ id: n.id, title: n.title, state: 'new', plus: b.replace(/\s/g, '').length, minus: 0, a: '', b });
        continue;
      }
      if (o.body === b && o.title === n.title) {
        out.push({ id: n.id, title: n.title, state: 'same', plus: 0, minus: 0, a: o.body, b });
        continue;
      }
      let plus = 0;
      let minus = 0;
      for (const p of diffWordsWithSpace(o.body, b)) {
        const c = p.value.replace(/\s/g, '').length;
        if (p.added) plus += c;
        else if (p.removed) minus += c;
      }
      out.push({ id: n.id, title: n.title, state: 'changed', plus, minus, a: o.body, b });
    }
    for (const o of ed) if (!cur.some((n) => n.id === o.id)) out.push({ id: o.id, title: o.title, state: 'gone', plus: 0, minus: o.body.replace(/\s/g, '').length, a: o.body, b: '' });
    return out;
  }, [ed, nodes]);
  const changed = rows.filter((r) => r.state !== 'same');
  const sel = rows.find((r) => r.id === open);
  return (
    <Modal wide title={`${number}판과 지금 원고`} onClose={onClose}>
      {!ed ? (
        <Spinner />
      ) : (
        <>
          <p className="muted small">
            {changed.length ? `${changed.length}개 장이 달라졌어요. 장을 누르면 바뀐 곳을 보여요.` : '공유한 판과 지금 원고가 같아요.'} (+ 더한 글자 · − 지운 글자, 공백 제외)
          </p>
          <div className="list">
            {changed.map((r) => (
              <button key={r.id} className="list-item" onClick={() => setOpen(open === r.id ? null : r.id)} style={open === r.id ? { background: 'var(--soft)' } : undefined}>
                <span className="grow">
                  {r.title || '제목 없음'} <span className="faint tiny">{r.state === 'new' ? '새 장' : r.state === 'gone' ? '빠진 장' : ''}</span>
                </span>
                {!!r.plus && <span className="num small" style={{ color: '#3f8a6c' }}>+{fmtNum(r.plus)}</span>}
                {!!r.minus && <span className="num small" style={{ color: 'var(--bad)' }}>−{fmtNum(r.minus)}</span>}
              </button>
            ))}
          </div>
          {sel && (
            <div className="diff">
              {diffWordsWithSpace(sel.a, sel.b).map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
