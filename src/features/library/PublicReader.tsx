// 로그인 없는 읽기 링크 (#/p/토큰): 작가가 링크로 보여 준 책의 가장 최근 판을 읽기만. 읽던 자리는 이 기기에만.
import { bookStyleOf } from '../../lib/bookStyle';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { ReadNode } from '../../lib/types';
import { Spinner } from '../../lib/ui';
import { Reader } from './Reader';

interface Pub {
  book: { title: string; author: string; color: string; blurb: string; print?: unknown };
  edition: { id: string; number: number; created: number };
  nodes: ReadNode[];
}

export function PublicReader({ token }: { token: string }) {
  const [data, setData] = useState<Pub | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<Pub>(`public/${token}`)
      .then((r) => {
        setData(r);
        document.title = `${r.book.title} · 서재`;
      })
      .catch((e) => setErr((e as Error).message));
  }, [token]);
  if (err)
    return (
      <div className="main" style={{ maxWidth: 520, margin: '80px auto', padding: 24 }}>
        <h1 className="serif" style={{ fontSize: 24 }}>
          책을 열 수 없어요
        </h1>
        <p className="muted" style={{ marginTop: 12 }}>
          {err}
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
  return (
    <Reader
      title={data.book.title}
      nodes={data.nodes.map((n) => ({ ...n, body: n.body ?? '' }))}
      progressKey={`l:${token}`}
      localOnly
      lineBreaks
      bookStyle={bookStyleOf({ print: data.book.print })}
      onExit={() => (history.length > 1 ? history.back() : undefined)}
    />
  );
}
