// 저작권이 끝난 책 찾아 들이기: 구텐베르크 프로젝트(주로 외국 고전) · 한국어 위키문헌
import { useState } from 'react';
import { api, apiBytes } from '../../lib/api';
import { htmlStringToMd } from '../../lib/htmlToMd';
import { importBytes, type ImportedBook } from '../../lib/importers';
import { chunk, splitMarkdown, type DraftNode } from '../../lib/split';
import { fmtNum } from '../../lib/text';
import { Empty, Icon, Spinner, SubNav, toast } from '../../lib/ui';
import { ImportDialog } from './ImportDialog';

interface GBook {
  id: string;
  title: string;
  authors: string[];
  languages: string[];
  downloads: number;
  epub: string | null;
  text: string | null;
  html: string | null;
}
const LANGS = [
  ['', '모든 언어'],
  ['en', '영어'],
  ['ko', '한국어'],
  ['ja', '일본어'],
  ['zh', '중국어'],
  ['fr', '프랑스어'],
  ['de', '독일어'],
  ['ru', '러시아어'],
  ['es', '스페인어'],
];

export function Discover() {
  const [tab, setTab] = useState<'ws' | 'gb'>('ws');
  const [ready, setReady] = useState<(ImportedBook & { sourceUrl?: string }) | null>(null);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>자유 이용 책 찾기</h1>
          <p className="sub">저작권이 끝나 누구나 읽을 수 있는 책을 찾아 내 서재에 들여요.</p>
        </div>
        <div className="actions">
          <a className="btn" href="#/library">
            서재로
          </a>
        </div>
      </div>
      <div className="with-sub">
        <SubNav
          value={tab}
          onChange={setTab}
          items={[
            { id: 'ws', label: '위키문헌 (한국어)', icon: 'book' },
            { id: 'gb', label: '구텐베르크 (외국 고전)', icon: 'globe' },
          ]}
        />
        <div>{tab === 'ws' ? <Wikisource onReady={setReady} /> : <Gutenberg onReady={setReady} />}</div>
      </div>
      {ready && <ImportDialog initial={ready} onClose={() => setReady(null)} />}
    </>
  );
}

function Gutenberg({ onReady }: { onReady: (b: ImportedBook & { sourceUrl?: string }) => void }) {
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<{ books: GBook[]; next: boolean; count: number; error?: string } | null>(null);
  const [busy, setBusy] = useState('');
  const search = async (p = 1) => {
    if (!q.trim()) return;
    setBusy('찾는 중…');
    try {
      setRes(await api(`ext/gutenberg?q=${encodeURIComponent(q)}&lang=${lang}&page=${p}`));
      setPage(p);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };
  const take = async (b: GBook) => {
    const url = b.epub ?? b.text ?? b.html;
    if (!url) return toast('들일 수 있는 파일이 없어요.', 'err');
    setBusy(`「${b.title}」 받는 중…`);
    try {
      const buf = await apiBytes(`ext/gutenberg/file?url=${encodeURIComponent(url)}`);
      const ext = b.epub ? 'epub' : b.text ? 'txt' : 'html';
      const book = await importBytes(buf, `${b.title}.${ext}`, ext);
      onReady({ ...book, title: book.title || b.title, author: book.author || b.authors.join(', '), source: 'gutenberg', sourceUrl: `https://www.gutenberg.org/ebooks/${b.id}` });
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="stack">
      <p className="note-box">
        구텐베르크 프로젝트(gutenberg.org)는 미국 기준으로 저작권이 끝난 책을 모아 둔 곳이에요. 나라마다 저작권 기간이 달라서, 한국에서도 자유로운지는 책마다 다를 수 있어요. 제목이나 지은이를 영어로 찾으면 잘 나와요.
      </p>
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          void search(1);
        }}
      >
        <input className="input grow" style={{ minWidth: 200 }} placeholder="예: Pride and Prejudice, Tolstoy" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 'auto' }} value={lang} onChange={(e) => setLang(e.target.value)} aria-label="언어">
          {LANGS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button className="primary">찾기</button>
      </form>
      {busy && <Spinner label={busy} />}
      {res?.error && <div className="error-box">{res.error}</div>}
      {res && !res.error && !res.books.length && <Empty title="찾은 책이 없어요" />}
      {!!res?.books.length && (
        <>
          <p className="muted small">{fmtNum(res.count)}권 찾음</p>
          <div className="list">
            {res.books.map((b) => (
              <div key={b.id} className="list-item">
                <div className="grow">
                  <div className="serif" style={{ fontWeight: 600 }}>
                    {b.title}
                  </div>
                  <div className="muted small">
                    {b.authors.join(', ') || '지은이 모름'} · {b.languages.join(', ')} · 내려받기 {fmtNum(b.downloads)}회
                  </div>
                </div>
                <a className="btn small ghost" href={`https://www.gutenberg.org/ebooks/${b.id}`} target="_blank" rel="noopener noreferrer">
                  원본
                </a>
                <button className="small primary" disabled={!!busy || (!b.epub && !b.text && !b.html)} onClick={() => take(b)}>
                  들이기
                </button>
              </div>
            ))}
          </div>
          <div className="row">
            <button disabled={page <= 1 || !!busy} onClick={() => search(page - 1)}>
              앞
            </button>
            <span className="muted small">{page}쪽</span>
            <button disabled={!res.next || !!busy} onClick={() => search(page + 1)}>
              다음
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Wikisource({ onReady }: { onReady: (b: ImportedBook & { sourceUrl?: string }) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ pages: { title: string; snippet: string; size: number }[]; error?: string } | null>(null);
  const [busy, setBusy] = useState('');
  const search = async () => {
    if (!q.trim()) return;
    setBusy('찾는 중…');
    try {
      setRes(await api(`ext/wikisource?q=${encodeURIComponent(q)}`));
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };
  const take = async (title: string) => {
    setBusy(`「${title}」 받는 중…`);
    try {
      const page = await api<{ title: string; html: string; subpages: string[]; error?: string }>(`ext/wikisource/page?title=${encodeURIComponent(title)}`);
      if (page.error) throw new Error(page.error);
      const main = htmlStringToMd(page.html);
      const nodes: DraftNode[] = [];
      let n = 0;
      const subs = page.subpages.slice(0, 300);
      if (subs.length) {
        if (main.replace(/\s/g, '').length > 300) nodes.push({ tmp: `w${n++}`, kind: 'chapter', title: '머리말', body: main, sort: 0 });
        for (const [i, s] of subs.entries()) {
          setBusy(`「${title}」 받는 중… ${i + 1}/${subs.length}`);
          const sp = await api<{ html: string; error?: string }>(`ext/wikisource/page?title=${encodeURIComponent(s)}`);
          if (sp.error || !sp.html) continue;
          const md = htmlStringToMd(sp.html);
          for (const [k, part] of chunk(md).entries()) nodes.push({ tmp: `w${n++}`, kind: 'chapter', title: s.slice(title.length + 1) + (k ? ` (${k + 1})` : ''), body: part, sort: nodes.length });
        }
      } else nodes.push(...splitMarkdown(main, page.title).nodes);
      if (!nodes.length) throw new Error('문서에서 글을 찾지 못했어요.');
      onReady({ title: page.title, author: '', nodes, source: 'wikisource', notes: ['위키문헌 문서의 글만 가져와요. 각주 · 그림은 빠져요.'], sourceUrl: `https://ko.wikisource.org/wiki/${encodeURIComponent(page.title)}` });
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="stack">
      <p className="note-box">위키문헌(ko.wikisource.org)은 저작권이 끝났거나 자유 이용이 허락된 글을 모은 곳이에요. 문서에 딸린 하위 문서(예: 「책 이름/1」)가 있으면 장으로 나눠 함께 들여요.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input className="input grow" placeholder="예: 진달래꽃, 운수 좋은 날, 홍길동전" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="primary">찾기</button>
      </form>
      {busy && <Spinner label={busy} />}
      {res?.error && <div className="error-box">{res.error}</div>}
      {res && !res.error && !res.pages.length && <Empty title="찾은 문서가 없어요" />}
      {!!res?.pages.length && (
        <div className="list">
          {res.pages.map((p) => (
            <div key={p.title} className="list-item">
              <div className="grow">
                <div className="serif" style={{ fontWeight: 600 }}>
                  {p.title}
                </div>
                <div className="muted small ellipsis">{p.snippet}</div>
              </div>
              <a className="btn small ghost" href={`https://ko.wikisource.org/wiki/${encodeURIComponent(p.title)}`} target="_blank" rel="noopener noreferrer">
                원본
              </a>
              <button className="small primary" disabled={!!busy} onClick={() => take(p.title)}>
                <Icon name="download" size={14} />
                들이기
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
