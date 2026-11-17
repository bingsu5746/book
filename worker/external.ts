// 저작권이 끝난(자유롭게 쓸 수 있는) 책 찾기
// - 구텐베르크 프로젝트: Gutendex(구텐베르크 목록을 JSON 으로 주는 공개 API, gutendex.com) 로 찾고, 파일은 gutenberg.org 에서만 받는다.
// - 한국어 위키문헌(ko.wikisource.org): MediaWiki API 로 찾고, 문서 HTML 을 받는다.
// 받은 내용은 서버에 따로 저장하지 않는다 (사용자가 들이기를 누르면 그 사람 서재에만 들어감).

const UA = 'BookReader/1.0 (personal reading app)';
const MAX_FILE = 30_000_000;

export interface ExtBook {
  id: string;
  title: string;
  authors: string[];
  languages: string[];
  downloads: number;
  epub: string | null;
  text: string | null;
  html: string | null;
}

type Json = Record<string, unknown>;
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asObj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});

async function getJson(url: string): Promise<Json> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return asObj(await res.json());
}

/** Gutendex 결과 한 권을 우리 모양으로 (모르는 칸은 비워 둔다) */
export function readGutendexBook(raw: unknown): ExtBook | null {
  const b = asObj(raw);
  if (typeof b.id !== 'number' || typeof b.title !== 'string') return null;
  const formats = asObj(b.formats);
  const pick = (test: (mime: string) => boolean) => {
    for (const [mime, url] of Object.entries(formats)) if (test(mime) && typeof url === 'string' && isGutenbergUrl(url)) return url;
    return null;
  };
  return {
    id: String(b.id),
    title: b.title,
    authors: asArr(b.authors).map((a) => String(asObj(a).name ?? '')).filter(Boolean),
    languages: asArr(b.languages).map(String),
    downloads: typeof b.download_count === 'number' ? b.download_count : 0,
    epub: pick((m) => m.startsWith('application/epub+zip')),
    text: pick((m) => m.startsWith('text/plain') && !m.includes('zip')),
    html: pick((m) => m.startsWith('text/html') && !m.includes('zip')),
  };
}

export function isGutenbergUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? /(^|\.)gutenberg\.org$/.test(url.hostname) : false;
  } catch {
    return false;
  }
}

export async function gutenbergSearch(q: string, page: number, lang: string) {
  const query = q.normalize('NFC').trim().slice(0, 100);
  if (!query) return { books: [], next: false, count: 0 };
  const u = new URL('https://gutendex.com/books/');
  u.searchParams.set('search', query);
  if (/^[a-z]{2}(,[a-z]{2})*$/.test(lang)) u.searchParams.set('languages', lang);
  if (page > 1 && page < 100) u.searchParams.set('page', String(Math.floor(page)));
  try {
    const data = await getJson(u.toString());
    return {
      books: asArr(data.results).map(readGutendexBook).filter((b): b is ExtBook => !!b),
      next: !!data.next,
      count: typeof data.count === 'number' ? data.count : 0,
    };
  } catch (e) {
    console.error('gutendex', e);
    return { books: [], next: false, count: 0, error: '구텐베르크 목록 서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.' };
  }
}

/** gutenberg.org 의 파일만 받아서 그대로 넘긴다 (다른 곳으로 넘겨 보내면 따라가지 않음) */
export async function gutenbergFile(raw: string): Promise<Response> {
  let url = raw;
  for (let hop = 0; hop < 5; hop++) {
    if (!isGutenbergUrl(url)) return new Response(JSON.stringify({ error: '구텐베르크 파일 주소가 아니에요.' }), { status: 400, headers: { 'content-type': 'application/json' } });
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    if (!res.ok) return new Response(JSON.stringify({ error: '파일을 받지 못했어요.' }), { status: 502, headers: { 'content-type': 'application/json' } });
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_FILE) return new Response(JSON.stringify({ error: '파일이 너무 커요.' }), { status: 413, headers: { 'content-type': 'application/json' } });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_FILE) return new Response(JSON.stringify({ error: '파일이 너무 커요.' }), { status: 413, headers: { 'content-type': 'application/json' } });
    return new Response(buf, { headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }
  return new Response(JSON.stringify({ error: '파일을 받지 못했어요.' }), { status: 502, headers: { 'content-type': 'application/json' } });
}

const WS = 'https://ko.wikisource.org/w/api.php';
const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export async function wikisourceSearch(q: string) {
  const query = q.normalize('NFC').trim().slice(0, 100);
  if (!query) return { pages: [] };
  const u = new URL(WS);
  for (const [k, v] of Object.entries({ action: 'query', list: 'search', srsearch: query, srnamespace: '0', srlimit: '30', format: 'json', formatversion: '2' })) u.searchParams.set(k, v);
  try {
    const data = await getJson(u.toString());
    const pages = asArr(asObj(data.query).search).map((p) => {
      const o = asObj(p);
      return { title: String(o.title ?? ''), snippet: stripTags(String(o.snippet ?? '')), size: typeof o.size === 'number' ? o.size : 0 };
    });
    return { pages: pages.filter((p) => p.title) };
  } catch (e) {
    console.error('wikisource', e);
    return { pages: [], error: '위키문헌에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.' };
  }
}

export async function wikisourcePage(title: string) {
  const t = title.normalize('NFC').trim().slice(0, 300);
  if (!t) return { error: '문서 이름이 없어요.' };
  try {
    const p = new URL(WS);
    for (const [k, v] of Object.entries({ action: 'parse', page: t, prop: 'text', redirects: '1', format: 'json', formatversion: '2', disableeditsection: '1' })) p.searchParams.set(k, v);
    const s = new URL(WS);
    for (const [k, v] of Object.entries({ action: 'query', list: 'allpages', apprefix: `${t}/`, apnamespace: '0', aplimit: '500', format: 'json', formatversion: '2' })) s.searchParams.set(k, v);
    const [page, subs] = await Promise.all([getJson(p.toString()), getJson(s.toString()).catch(() => ({}) as Json)]);
    const parse = asObj(page.parse);
    if (!parse.text) return { error: '문서를 찾지 못했어요.' };
    return {
      title: String(parse.title ?? t),
      html: String(parse.text),
      subpages: asArr(asObj(asObj(subs).query).allpages).map((x) => String(asObj(x).title ?? '')).filter(Boolean),
    };
  } catch (e) {
    console.error('wikisource page', e);
    return { error: '위키문헌에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.' };
  }
}
