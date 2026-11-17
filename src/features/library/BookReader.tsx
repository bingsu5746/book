import { useEffect, useState } from 'react';
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
  const nodes = toReadNodes(data.nodes);
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
    <Reader
      title={data.book.title}
      nodes={nodes}
      progressKey={`b:${bookId}`}
      initialFind={find ?? undefined}
      start={nodeId ? { n: nodeId, o: Number(at ?? 0) } : null}
      onExit={() => (history.length > 1 ? history.back() : go('library'))}
      actions={[
        ...(data.book.kind === 'write' ? [{ label: '집필실에서 고치기', icon: 'pen', href: `#/write/${bookId}` }] : []),
        { label: '전자책(EPUB)으로 받기', icon: 'download', onClick: () => download(`${data.book.title}.epub`, new Blob([makeEpub(data.book, nodes) as BlobPart], { type: 'application/epub+zip' })) },
      ]}
    />
  );
}
