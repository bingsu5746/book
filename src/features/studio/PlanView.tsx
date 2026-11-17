// 구상: 쓰기 전에 줄거리부터. 책 전체 줄거리 → 부(대단원) · 장 줄거리 → 장마다 「쪽 줄거리」 목록.
// 쪽 줄거리는 원고 안에 안내 줄(%%▸ …%%)로 들어가서, 쓰는 동안 「여기서 이걸 쓰면 되는구나」가 보인다.
import { useState } from 'react';
import { addBeat, beatWritten, moveBeat, parseBeats, removeBeat, renameBeat } from '../../lib/beats';
import { flatten } from '../../lib/store';
import { KIND_LABEL, type Book, type BookNode, type NodeKind } from '../../lib/types';
import { Icon } from '../../lib/ui';

export function PlanView({
  book,
  nodes,
  onPatchBook,
  onPatchNode,
  onBody,
  onOpen,
  onAdd,
}: {
  book: Book;
  nodes: BookNode[];
  onPatchBook: (p: Record<string, unknown>) => void;
  onPatchNode: (id: string, p: Partial<BookNode>) => void;
  onBody: (id: string, body: string) => void;
  onOpen: (id: string, pos?: number) => void;
  onAdd: (kind: NodeKind, parent: string | null) => void;
}) {
  const flat = flatten(nodes.filter((n) => n.kind !== 'note'));
  const plot = String(book.meta.plot ?? '');
  const totalBeats = flat.reduce((s, n) => s + parseBeats(n.body ?? '').beats.length, 0);
  const doneBeats = flat.reduce((s, n) => s + parseBeats(n.body ?? '').beats.filter(beatWritten).length, 0);
  return (
    <div className="view-pad plan">
      <section className="plan-book">
        <div className="row">
          <h2 className="serif grow">전체 줄거리</h2>
          {!!totalBeats && (
            <span className="faint small">
              쪽 줄거리 {doneBeats}/{totalBeats} 씀
            </span>
          )}
        </div>
        <textarea
          className="plain-area serif"
          rows={Math.max(4, Math.min(14, Math.ceil(plot.length / 60)))}
          defaultValue={plot}
          key={book.id}
          placeholder="이 책은 어떤 이야기인가요? 처음부터 끝까지 큰 줄기를 적어 두세요."
          onBlur={(e) => e.target.value !== plot && onPatchBook({ meta: { ...book.meta, plot: e.target.value } })}
        />
      </section>
      {flat.map((n) =>
        n.kind === 'part' ? (
          <section key={n.id} className="plan-part">
            <input className="plain-title serif" defaultValue={n.title} placeholder="부 이름" aria-label="부 이름" onBlur={(e) => e.target.value !== n.title && onPatchNode(n.id, { title: e.target.value })} />
            <textarea className="plain-area" rows={2} defaultValue={n.synopsis} placeholder="이 부(대단원)에서 일어날 일" onBlur={(e) => e.target.value !== n.synopsis && onPatchNode(n.id, { synopsis: e.target.value })} />
          </section>
        ) : (
          <ChapterPlan key={n.id} node={n} onPatchNode={onPatchNode} onBody={onBody} onOpen={onOpen} />
        ),
      )}
      <div className="row" style={{ marginTop: 18 }}>
        <button className="ghost" onClick={() => onAdd('chapter', null)}>
          <Icon name="plus" size={15} />장 더하기
        </button>
        <button className="ghost" onClick={() => onAdd('part', null)}>
          <Icon name="plus" size={15} />부 더하기
        </button>
      </div>
    </div>
  );
}

function ChapterPlan({ node, onPatchNode, onBody, onOpen }: { node: BookNode; onPatchNode: (id: string, p: Partial<BookNode>) => void; onBody: (id: string, body: string) => void; onOpen: (id: string, pos?: number) => void }) {
  const body = node.body ?? '';
  const { beats } = parseBeats(body);
  const [adding, setAdding] = useState('');
  const [open, setOpen] = useState(false);
  const add = () => {
    if (!adding.trim()) return;
    onBody(node.id, addBeat(body, adding.trim()));
    setAdding('');
  };
  return (
    <section className={`plan-ch${node.kind === 'scene' ? ' scene' : ''}`}>
      <div className="row">
        <span className="faint tiny">{KIND_LABEL[node.kind]}</span>
        <input className="plain-title grow" defaultValue={node.title} key={`t${node.id}`} placeholder="제목" aria-label="제목" onBlur={(e) => e.target.value !== node.title && onPatchNode(node.id, { title: e.target.value })} />
        <button className="quiet-btn" onClick={() => onOpen(node.id)}>
          쓰기 →
        </button>
      </div>
      <textarea
        className="plain-area"
        rows={2}
        defaultValue={node.synopsis}
        key={`s${node.id}:${node.synopsis}`}
        placeholder="이 장의 줄거리"
        onBlur={(e) => e.target.value !== node.synopsis && onPatchNode(node.id, { synopsis: e.target.value, meta: { ...node.meta, synopsisAi: false } })}
      />
      <ol className="beats">
        {beats.map((b, i) => (
          <li key={`${i}:${b.text}`} className={beatWritten(b) ? 'done' : ''}>
            <span className="beat-dot" title={beatWritten(b) ? '썼어요' : '아직 안 썼어요'} />
            <input className="plain-input grow" defaultValue={b.text} aria-label={`쪽 줄거리 ${i + 1}`} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== b.text && onBody(node.id, renameBeat(body, i, e.target.value))} />
            <span className="beat-tools">
              <button className="icon-btn" aria-label="위로" disabled={i === 0} onClick={() => onBody(node.id, moveBeat(body, i, -1))}>
                ↑
              </button>
              <button className="icon-btn" aria-label="아래로" disabled={i === beats.length - 1} onClick={() => onBody(node.id, moveBeat(body, i, 1))}>
                ↓
              </button>
              <button className="icon-btn" aria-label="쪽 줄거리 빼기 (쓴 글은 남아요)" title="빼기 (쓴 글은 남아요)" onClick={() => onBody(node.id, removeBeat(body, i))}>
                <Icon name="close" size={13} />
              </button>
              <button className="quiet-btn" onClick={() => onOpen(node.id, b.lineEnd + 1)}>
                여기 쓰기
              </button>
            </span>
          </li>
        ))}
      </ol>
      {open || !beats.length ? (
        <input
          className="plain-input add"
          value={adding}
          autoFocus={open}
          placeholder={beats.length ? '다음 쪽 줄거리 (Enter)' : '＋ 쪽 줄거리: 이 장에서 한 쪽씩 쓸 내용 (Enter)'}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
            if (e.key === 'Escape') setOpen(false);
          }}
          onBlur={() => (add(), setOpen(false))}
        />
      ) : (
        <button className="quiet-btn" onClick={() => setOpen(true)}>
          ＋ 쪽 줄거리
        </button>
      )}
    </section>
  );
}
