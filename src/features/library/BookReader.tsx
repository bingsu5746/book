import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { loadWorld, toRefs } from '../../lib/world';
import type { EntryRef } from '../studio/Editor';
import type { Book } from '../../lib/types';
import { Modal } from '../../lib/ui';
import { go } from '../../lib/router';
import { loadFull, toReadNodes, type FullBook } from '../../lib/store';
import { Spinner, toast } from '../../lib/ui';
import { makeEpub } from '../../lib/epub';
import { download } from '../../lib/exporters';
import { Reader } from './Reader';

/** 내 책 읽기 (내가 쓴 책 · 들인 책). 받아 둔 사본이 있으면 인터넷 없이도 열린다 */
export function BookReader({ bookId, nodeId, at, find }: { bookId: string; nodeId?: string; at?: string | null; find?: string | null }) {
  const [data, setData] = useState<FullBook | null>(null);
  const [err, setErr] = useState('');
  const [entries, setEntries] = useState<EntryRef[]>([]);
  const [log, setLog] = useState(false);
  useEffect(() => {
    if (!data?.book.world_id) return;
    loadWorld(data.book.world_id)
      .then((w) => setEntries(toRefs(w.items)))
      .catch(() => {});
  }, [data?.book.world_id]);
  const nodesMemo = useMemo(() => (data ? toReadNodes(data.nodes) : []), [data]);
  const patchMeta = (m: Record<string, unknown>) => {
    if (!data) return;
    const meta = { ...data.book.meta, ...m };
    setData({ ...data, book: { ...data.book, meta } });
    void api(`books/${bookId}`, { method: 'PATCH', body: { meta } }).catch(() => {});
  };
  useEffect(() => {
    loadFull(bookId)
      .then((r) => {
        setData(r.data);
        if (r.offline) toast('인터넷이 없어 기기에 받아 둔 사본을 열었어요');
      })
      .catch((e) => setErr((e as Error).message));
  }, [bookId]);
  if (err)
    return (
      <div className="main">
        <div className="error-box">{err}</div>
        <p style={{ marginTop: 12 }}>
          <a href="#/library">서재로</a>
        </p>
      </div>
    );
  if (!data)
    return (
      <div className="reader">
        <div style={{ margin: 'auto' }}>
          <Spinner />
        </div>
      </div>
    );
  const nodes = nodesMemo;
  if (!nodes.some((n) => n.body.trim()))
    return (
      <div className="main">
        <p>아직 읽을 글이 없어요.</p>
        <p style={{ marginTop: 12 }}>
          <a href={`#/write/${bookId}`}>집필실에서 쓰기</a>
        </p>
      </div>
    );
  return (
    <>
    <Reader
      title={data.book.title}
      entries={entries}
      onFinish={() => {
        if (data.book.kind === 'read' && data.book.meta.readStatus !== 'done') {
          patchMeta({ readStatus: 'done', finishedAt: new Date().toLocaleDateString('sv-SE') });
          toast('다 읽었어요! ⋯ 메뉴의 「독서 기록」에 감상을 남겨 보세요.');
        }
      }}
      nodes={nodes}
      progressKey={`b:${bookId}`}
      initialFind={find ?? undefined}
      start={nodeId ? { n: nodeId, o: Number(at ?? 0) } : null}
      onExit={() => (history.length > 1 ? history.back() : go('library'))}
      actions={[
        ...(data.book.kind === 'write' ? [{ label: '집필실에서 고치기', icon: 'pen', href: `#/write/${bookId}` }] : [{ label: '독서 기록', icon: 'star', onClick: () => setLog(true) }]),
        { label: '전자책(EPUB)으로 받기', icon: 'download', onClick: () => download(`${data.book.title}.epub`, new Blob([makeEpub(data.book, nodes) as BlobPart], { type: 'application/epub+zip' })) },
      ]}
    />
    {log && <ReadLog book={data.book} onClose={() => setLog(false)} onSave={(m) => (patchMeta(m), setLog(false))} />}
    </>
  );
}

export function ReadLog({ book, onClose, onSave }: { book: Book; onClose: () => void; onSave: (m: Record<string, unknown>) => void }) {
  const [status, setStatus] = useState(book.meta.readStatus ?? 'reading');
  const [stars, setStars] = useState(book.meta.readStars ?? 0);
  const [note, setNote] = useState(book.meta.readNote ?? '');
  const [finished, setFinished] = useState(book.meta.finishedAt ?? '');
  return (
    <Modal
      title={`「${book.title}」 독서 기록`}
      onClose={onClose}
      foot={
        <>
          <button onClick={onClose}>닫기</button>
          <button className="primary" onClick={() => onSave({ readStatus: status, readStars: stars, readNote: note, finishedAt: status === 'done' ? finished || new Date().toLocaleDateString('sv-SE') : finished })}>
            저장
          </button>
        </>
      }
    >
      <div className="seg">
        {(
          [
            ['want', '읽고 싶어요'],
            ['reading', '읽는 중'],
            ['done', '다 읽었어요'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="row" role="radiogroup" aria-label="별점">
        {[1, 2, 3, 4, 5].map((s) => (
          <button key={s} className="icon-btn" role="radio" aria-checked={stars === s} aria-label={`${s}점`} onClick={() => setStars(stars === s ? 0 : s)} style={{ color: s <= stars ? '#c99a2e' : 'var(--line-strong)', fontSize: 24, padding: 2 }}>
            ★
          </button>
        ))}
      </div>
      <textarea className="input serif" rows={4} placeholder="한 줄 감상 · 기억하고 싶은 것" value={note} onChange={(e) => setNote(e.target.value)} />
      {status === 'done' && (
        <label className="field">
          다 읽은 날
          <input className="input" type="date" value={finished} onChange={(e) => setFinished(e.target.value)} />
        </label>
      )}
    </Modal>
  );
}
