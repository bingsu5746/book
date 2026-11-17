// 서재 서버 (Cloudflare Durable Object 하나 + SQLite).
// 로그인 · 책(원고) · 기록(스냅숏) · 세계관 · 열람실(판 · 주석 · 평가) · 읽던 자리 · 외부 책 찾기를 맡는다.
//
// 보안 (life 앱과 같은 방식)
// - 비밀번호: PBKDF2-SHA256 10만 번 + 사람마다 다른 소금. 원래 비밀번호는 저장하지 않는다.
// - 로그인 유지: 무작위 토큰을 HttpOnly · Secure · SameSite=Strict 쿠키로만 준다. 서버에는 토큰의 SHA-256 만 저장.
// - 바꾸는 요청은 Origin 이 이 사이트인지, 본문이 JSON 인지 확인.
// - 가입은 초대 코드(Cloudflare 비밀값 INVITE_CODE)가 맞아야 한다.
//
// 글이 사라지지 않게
// - 다른 기기에서 먼저 고친 장을 덮어쓸 때는 서버 쪽 글을 기록(스냅숏)으로 남긴다.
// - 지우기는 deleted 표시(휴지통). 30일 지난 것만 실제로 지운다.
import { DurableObject } from 'cloudflare:workers';
import { charsNoSpace, cutText, inviteOk, Limiter, passwordProblem, readCookie, COOKIE_NAME } from './security';
import { gutenbergFile, gutenbergSearch, wikisourcePage, wikisourceSearch } from './external';
import { flattenTree, snippets } from './util';
import { cleanSynopsis, FALLBACK, infoMessages, INFO_MARK, MODEL, modelInput, parseInfo, readOutput, synopsisMessages } from './ai';
import { askGemini, GeminiDayLimit, geminiKey, geminiModels, pacificDay, type Msg } from './gemini';
import { relayFetch } from './relay';
import { cleanRecap, conflictMessages, dialogueMessages, fakeTool, findDialogue, markDialogue, namesMessages, parseEdits, parseIssues, parseNames, parseQuestions, parseSpeakers, polishMessages, previousDigest, questionMessages, readJson, recapMessages, TOOLS, type ToolName } from './tools';
import { chapterMessages, chapterSummaries, cleanSection, digest, parseChapterNote, SECTIONS, sectionMessages, type ChapterNote } from './analysis';
/** 한 사람이 하루에 시작할 수 있는 분석집 수 */
const ANALYSIS_DAILY = 5;
/** 한 사람이 하루에 부를 수 있는 AI 요약 수 (무료 한도를 지키려고) */
const AI_DAILY = 60;

const ITER = 100_000;
const SESSION_DAYS = 90;
const RENEW_DAYS = 60;
const DAY = 86_400_000;
/** 장 하나 본문 최대 길이 (Durable Object SQLite 한 칸 2MB 제한 안쪽) */
export const MAX_BODY = 1_500_000;
const MAX_REQUEST = 4_000_000;
const MAX_ITEM = 200_000;
const AUTO_SNAPSHOT_GAP = 10 * 60_000;
const MAX_AUTO_SNAPSHOTS = 100;
const TRASH_DAYS = 30;
const USERNAME = /^[A-Za-z0-9_가-힣]{3,16}$/;
const ID = /^[a-z0-9]{8,32}$/;

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const newId = () => randomHex(10);
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: ITER }, key, 256);
  return hex(bits);
}
function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { ...HEADERS, ...extra } });
const fail = (message: string, status = 400) => json({ error: message }, status);
const sessionCookie = (token: string, maxAge: number) => `${COOKIE_NAME}=${token}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
const clearCookie = () => sessionCookie('', 0);

type Body = Record<string, unknown>;
type Row = Record<string, SqlStorageValue>;
interface UserRow extends Row {
  id: string;
  username: string;
  nickname: string;
  salt: string;
  hash: string;
  created: number;
}
interface BookRow extends Row {
  id: string;
  owner: string;
  kind: string;
  title: string;
  shared: number;
  share_world: number;
  world_id: string | null;
  deleted: number | null;
}
interface NodeRow extends Row {
  id: string;
  book_id: string;
  parent_id: string | null;
  kind: string;
  sort: number;
  title: string;
  body: string;
  rev: number;
  chars: number;
}

const str = (v: unknown, max: number) => cutText(String(v ?? '').normalize('NFC'), max);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const optStr = (v: unknown, max: number) => (v == null ? null : str(v, max));
const jsonText = (v: unknown, max = MAX_ITEM) => {
  const t = JSON.stringify(v ?? {});
  if (t.length > max) throw new HttpError('내용이 너무 커요.', 413);
  return t;
};
const parseJson = (t: unknown) => {
  try {
    return JSON.parse(String(t ?? '{}'));
  } catch {
    return {};
  }
};
class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const NODE_KINDS = new Set(['part', 'chapter', 'scene', 'note']);
const BOOK_KINDS = new Set(['write', 'read']);
const STATUSES = new Set(['', 'idea', 'draft', 'revise', 'done']);
const WITEM_TYPES = new Set(['entry', 'relation', 'track', 'event', 'template', 'note', 'map', 'thread']);
/** 그림(지도 · 초상) 한 장 최대 크기(base64 글자) · 세계마다 최대 장 수 */
const MAX_IMAGE = 1_400_000;
const MAX_IMAGES = 80;
const IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

export class Library extends DurableObject<Env> {
  private sql: SqlStorage;
  private loginByIp = new Limiter(100, 15 * 60_000);
  private signupByIp = new Limiter(10, DAY);
  private writeByUser = new Limiter(600, 60_000);
  private extByUser = new Limiter(60, 60_000);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, nickname TEXT NOT NULL,
        salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
      CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', world_id TEXT, goal_chars INTEGER NOT NULL DEFAULT 0, deadline TEXT,
        notes TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', shared INTEGER NOT NULL DEFAULT 0, share_world INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER);
      CREATE INDEX IF NOT EXISTS books_owner ON books (owner);
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, parent_id TEXT, kind TEXT NOT NULL, sort REAL NOT NULL,
        title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', synopsis TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', chars INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 1,
        updated INTEGER NOT NULL, deleted INTEGER);
      CREATE INDEX IF NOT EXISTS nodes_book ON nodes (book_id);
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, book_id TEXT NOT NULL, body TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '', auto INTEGER NOT NULL DEFAULT 0, chars INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS snapshots_node ON snapshots (node_id, at);
      CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '',
        meta TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER);
      CREATE TABLE IF NOT EXISTS witems (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER);
      CREATE INDEX IF NOT EXISTS witems_world ON witems (world_id);
      CREATE TABLE IF NOT EXISTS editions (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, number INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', chars INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS editions_book ON editions (book_id);
      CREATE TABLE IF NOT EXISTS edition_nodes (edition_id TEXT NOT NULL, node_id TEXT NOT NULL, sort INTEGER NOT NULL, depth INTEGER NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (edition_id, node_id));
      CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, edition_id TEXT NOT NULL, node_id TEXT NOT NULL, quote TEXT NOT NULL DEFAULT '',
        prefix TEXT NOT NULL DEFAULT '', suffix TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, author TEXT NOT NULL, parent_id TEXT,
        resolved INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER);
      CREATE INDEX IF NOT EXISTS annotations_book ON annotations (book_id);
      CREATE TABLE IF NOT EXISTS ratings (book_id TEXT NOT NULL, user_id TEXT NOT NULL, stars INTEGER NOT NULL, text TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL,
        PRIMARY KEY (book_id, user_id));
      CREATE TABLE IF NOT EXISTS likes (edition_id TEXT NOT NULL, node_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (edition_id, node_id, user_id));
      CREATE TABLE IF NOT EXISTS progress (user_id TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, key));
      CREATE TABLE IF NOT EXISTS bookmarks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key TEXT NOT NULL, node_id TEXT NOT NULL, pos INTEGER NOT NULL,
        quote TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS bookmarks_user ON bookmarks (user_id, key);
      CREATE TABLE IF NOT EXISTS daily (user_id TEXT NOT NULL, day TEXT NOT NULL, chars INTEGER NOT NULL, PRIMARY KEY (user_id, day));
      CREATE TABLE IF NOT EXISTS prefs (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, mime TEXT NOT NULL, data TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS images_world ON images (world_id);
      CREATE TABLE IF NOT EXISTS read_daily (user_id TEXT NOT NULL, day TEXT NOT NULL, secs INTEGER NOT NULL, PRIMARY KEY (user_id, day));
      CREATE TABLE IF NOT EXISTS write_daily (user_id TEXT NOT NULL, day TEXT NOT NULL, secs INTEGER NOT NULL, PRIMARY KEY (user_id, day));
      CREATE TABLE IF NOT EXISTS analysis_notes (node_id TEXT PRIMARY KEY, hash TEXT NOT NULL, note TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS analysis_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, book_id TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL, step INTEGER NOT NULL,
        total INTEGER NOT NULL, state TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL, next_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS analysis_jobs_book ON analysis_jobs (book_id);
      CREATE TABLE IF NOT EXISTS ai_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (user_id, day));
      CREATE TABLE IF NOT EXISTS gem_out (model TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (model, day));
      CREATE TABLE IF NOT EXISTS jots (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS jots_user ON jots (user_id);
    `);
    // 책갈피 종류: mark(책갈피) · line(밑줄). 예전 표에는 칸이 없다
    try {
      this.sql.exec("ALTER TABLE bookmarks ADD COLUMN kind TEXT NOT NULL DEFAULT 'mark'");
    } catch {
      /* 이미 있음 */
    }
  }

  private rows<T extends Row = Row>(q: string, ...args: SqlStorageValue[]): T[] {
    return this.sql.exec<T>(q, ...args).toArray();
  }
  private one<T extends Row = Row>(q: string, ...args: SqlStorageValue[]): T | undefined {
    return this.rows<T>(q, ...args)[0];
  }

  async fetch(req: Request): Promise<Response> {
    try {
      return await this.handle(req);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.message, e.status);
      console.error('library error', e);
      const msg = e instanceof Error ? e.message : String(e);
      if (/Exceeded allowed .* free tier/i.test(msg)) return fail('오늘 서버 무료 사용 한도를 다 써서 한국 시간 오전 9시까지 저장할 수 없어요.', 503);
      return fail('서버 오류가 났어요. 잠시 뒤 다시 해 주세요.', 500);
    }
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\//, '');
    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    const writes = req.method !== 'GET' && req.method !== 'HEAD';
    if (writes) {
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) return fail('허용되지 않은 요청이에요.', 403);
      if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) return fail('잘못된 요청이에요.', 415);
    }
    let body: Body = {};
    if (writes) {
      const text = await req.text();
      if (text.length > MAX_REQUEST) return fail('보낸 내용이 너무 커요.', 413);
      try {
        const parsed: unknown = text ? JSON.parse(text) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('잘못된 요청이에요.');
        body = parsed as Body;
      } catch {
        return fail('잘못된 요청이에요.');
      }
    }

    if (path === 'auth/signup' && req.method === 'POST') return this.signup(body, ip);
    if (path === 'auth/login' && req.method === 'POST') return this.login(body, ip);
    const session = await this.sessionFrom(req);
    if (path === 'auth/logout' && req.method === 'POST') {
      if (session) this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', session.tokenHash);
      return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
    }
    if (path === 'auth/status') return json({ invite: !!this.env.INVITE_CODE, user: session ? this.publicUser(session.user) : null });
    if (!session) return json({ error: '로그인이 필요해요.' }, 401, { 'set-cookie': clearCookie() });
    let renewed: string | null = null;
    if (session.expires - Date.now() < RENEW_DAYS * DAY) {
      this.sql.exec('UPDATE sessions SET expires = ? WHERE token_hash = ?', Date.now() + SESSION_DAYS * DAY, session.tokenHash);
      renewed = sessionCookie(session.token, SESSION_DAYS * 86_400);
    }
    if (writes) {
      const wait = this.writeByUser.hit(session.user.id);
      if (wait) return fail(`요청이 너무 많아요. ${wait}초 뒤에 다시 해 주세요.`, 429);
    }
    const res = await this.route(req.method, path, url.searchParams, body, session.user, session.tokenHash);
    if (renewed && !res.headers.has('set-cookie')) res.headers.set('set-cookie', renewed);
    return res;
  }

  // ---------------------------------------------------------------- 길목
  private async route(method: string, path: string, q: URLSearchParams, b: Body, user: UserRow, tokenHash: string): Promise<Response> {
    const m = (re: RegExp) => path.match(re);
    let r: RegExpMatchArray | null;

    // 계정
    if (path === 'me' && method === 'GET') return json({ user: this.publicUser(user) });
    if (path === 'me/nickname' && method === 'POST') return this.setNickname(user, b);
    if (path === 'me/password' && method === 'POST') return this.changePassword(user, tokenHash, b);
    if (path === 'me/delete' && method === 'POST') return this.deleteAccount(user, b);
    if (path === 'me/export' && method === 'GET') return this.exportAll(user);
    if (path === 'auth/logout-all' && method === 'POST') {
      this.sql.exec('DELETE FROM sessions WHERE user_id = ?', user.id);
      return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
    }
    if (path === 'prefs' && method === 'GET') return json({ prefs: parseJson(this.one('SELECT data FROM prefs WHERE user_id = ?', user.id)?.data) });
    if (path === 'prefs' && method === 'PUT') {
      this.sql.exec('INSERT OR REPLACE INTO prefs (user_id, data) VALUES (?, ?)', user.id, jsonText(b.prefs, 50_000));
      return json({ ok: true });
    }
    if (path === 'stats' && method === 'GET') return json({ days: this.rows('SELECT day, chars FROM daily WHERE user_id = ? ORDER BY day DESC LIMIT 400', user.id), read: this.rows('SELECT day, secs FROM read_daily WHERE user_id = ? ORDER BY day DESC LIMIT 400', user.id), write: this.rows('SELECT day, secs FROM write_daily WHERE user_id = ? ORDER BY day DESC LIMIT 400', user.id) });
    if (path === 'stats/write' && method === 'POST') {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day ?? '')) ? String(b.day) : new Date().toISOString().slice(0, 10);
      const secs = Math.max(0, Math.min(3600, Math.floor(num(b.secs))));
      if (secs) this.sql.exec('INSERT INTO write_daily (user_id, day, secs) VALUES (?, ?, ?) ON CONFLICT (user_id, day) DO UPDATE SET secs = secs + excluded.secs', user.id, day, secs);
      return json({ ok: true });
    }
    if (path === 'ai/synopsis' && method === 'POST') return this.aiSynopsis(user, b);
    if (path === 'ai/chapter-info' && method === 'POST') return this.aiChapterInfo(user, b);
    if (path === 'ai/tool' && method === 'POST') return this.aiTool(user, b);
    if (path === 'ai/recap' && method === 'POST') return this.aiRecap(user, b);
    if (path === 'ai/status' && method === 'GET') {
      const day = pacificDay(Date.now());
      return json({ gemini: !!geminiKey(this.env), cloudflare: !!this.env.AI, geminiOut: this.rows('SELECT model FROM gem_out WHERE day = ?', day).map((r) => r.model), lastVia: this.lastVia });
    }
    // 아이디어 수첩
    if (path === 'jots' && method === 'GET') return json({ jots: this.rows('SELECT id, text, done, created, updated FROM jots WHERE user_id = ? ORDER BY done, updated DESC LIMIT 1000', user.id) });
    if (path === 'jots' && method === 'POST') {
      const text = str(b.text, 20_000).trim();
      if (!text) return fail('적은 내용이 없어요.');
      if (Number(this.one('SELECT COUNT(*) AS n FROM jots WHERE user_id = ?', user.id)?.n ?? 0) >= 2000) return fail('수첩이 가득 찼어요. 다 쓴 메모를 지워 주세요.', 413);
      const id = newId();
      const now = Date.now();
      this.sql.exec('INSERT INTO jots (id, user_id, text, created, updated) VALUES (?, ?, ?, ?, ?)', id, user.id, text, now, now);
      return json({ jot: { id, text, done: 0, created: now, updated: now } });
    }
    if ((r = m(/^jots\/([a-z0-9]+)$/))) {
      if (method === 'PATCH') {
        if ('text' in b) this.sql.exec('UPDATE jots SET text = ?, updated = ? WHERE id = ? AND user_id = ?', str(b.text, 20_000), Date.now(), r[1], user.id);
        if ('done' in b) this.sql.exec('UPDATE jots SET done = ?, updated = ? WHERE id = ? AND user_id = ?', b.done ? 1 : 0, Date.now(), r[1], user.id);
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        this.sql.exec('DELETE FROM jots WHERE id = ? AND user_id = ?', r[1], user.id);
        return json({ ok: true });
      }
    }
    if (path === 'stats/read' && method === 'POST') {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day ?? '')) ? String(b.day) : new Date().toISOString().slice(0, 10);
      const secs = Math.max(0, Math.min(3600, Math.floor(num(b.secs))));
      if (secs) this.sql.exec('INSERT INTO read_daily (user_id, day, secs) VALUES (?, ?, ?) ON CONFLICT (user_id, day) DO UPDATE SET secs = secs + excluded.secs', user.id, day, secs);
      return json({ ok: true });
    }

    // 책
    if (path === 'books' && method === 'GET') return this.listBooks(user);
    if (path === 'books' && method === 'POST') return this.createBook(user, b);
    if ((r = m(/^books\/([a-z0-9]+)$/))) {
      if (method === 'GET') return this.getBook(user, r[1]);
      if (method === 'PATCH') return this.patchBook(user, r[1], b);
      if (method === 'DELETE') return this.deleteBook(user, r[1]);
    }
    if ((r = m(/^books\/([a-z0-9]+)\/restore$/)) && method === 'POST') return this.restoreBook(user, r[1]);
    if ((r = m(/^books\/([a-z0-9]+)\/purge$/)) && method === 'POST') return this.purgeBook(user, r[1]);
    if ((r = m(/^books\/([a-z0-9]+)\/full$/)) && method === 'GET') return this.fullBook(user, r[1]);
    if ((r = m(/^books\/([a-z0-9]+)\/nodes$/)) && method === 'POST') return this.createNodes(user, r[1], b);
    if ((r = m(/^books\/([a-z0-9]+)\/reorder$/)) && method === 'POST') return this.reorder(user, r[1], b);
    if ((r = m(/^books\/([a-z0-9]+)\/publish$/)) && method === 'POST') return this.publish(user, r[1], b);
    if ((r = m(/^books\/([a-z0-9]+)\/unshare$/)) && method === 'POST') return this.unshare(user, r[1]);
    if ((r = m(/^books\/([a-z0-9]+)\/editions$/)) && method === 'GET') return this.bookEditions(user, r[1]);
    if ((r = m(/^books\/([a-z0-9]+)\/annotations$/)) && method === 'GET') return this.annotationsFor(user, r[1]);
    if ((r = m(/^books\/([a-z0-9]+)\/rating$/)) && method === 'PUT') return this.rate(user, r[1], b);
    if ((r = m(/^books\/([a-z0-9]+)\/snapshots$/)) && method === 'GET') return this.bookSnapshots(user, r[1]);
    if ((r = m(/^books\/([a-z0-9]+)\/readers$/)) && method === 'GET') return this.readers(user, r[1]);
    if ((r = m(/^books\/([a-z0-9]+)\/analysis$/))) {
      if (method === 'GET') return this.analysisStatus(user, r[1]);
      if (method === 'POST') {
        if (b.action === 'cancel') {
          this.ownBook(user, r[1]);
          this.sql.exec("UPDATE analysis_jobs SET status = 'canceled', updated = ? WHERE book_id = ? AND status = 'running'", Date.now(), r[1]);
          return this.analysisStatus(user, r[1]);
        }
        const started = await this.startAnalysis(user, r[1]);
        if (typeof started === 'string') return fail(started, started.includes('하루') ? 429 : 400);
        return this.analysisStatus(user, r[1]);
      }
    }
    if ((r = m(/^books\/([a-z0-9]+)\/finish$/)) && method === 'POST') {
      const book = this.ownBook(user, r[1]);
      const meta = { ...parseJson(book.meta), finishedAt: new Date().toISOString().slice(0, 10) };
      this.sql.exec('UPDATE books SET meta = ? WHERE id = ?', JSON.stringify(meta), r[1]);
      const started = this.autoAnalysisOn(user) && !meta.analysisOf ? await this.startAnalysis(user, r[1]) : null;
      return json({ ok: true, started: started === true, note: typeof started === 'string' ? started : '' });
    }

    if ((r = m(/^nodes\/([a-z0-9]+)$/))) {
      if (method === 'GET') return this.getNode(user, r[1]);
      if (method === 'PATCH') return this.patchNode(user, r[1], b);
      if (method === 'DELETE') return this.deleteNode(user, r[1]);
    }
    if ((r = m(/^nodes\/([a-z0-9]+)\/restore$/)) && method === 'POST') return this.restoreNode(user, r[1]);
    if ((r = m(/^nodes\/([a-z0-9]+)\/snapshots$/))) {
      if (method === 'GET') return this.listSnapshots(user, r[1]);
      if (method === 'POST') return this.takeSnapshot(user, r[1], b);
    }
    if ((r = m(/^snapshots\/([a-z0-9]+)$/))) {
      if (method === 'GET') return this.getSnapshot(user, r[1]);
      if (method === 'DELETE') return this.deleteSnapshot(user, r[1]);
    }
    if (path === 'search' && method === 'GET') return this.search(user, q);

    // 읽던 자리 · 책갈피
    if (path === 'progress' && method === 'GET') return json({ progress: Object.fromEntries(this.rows('SELECT key, data, at FROM progress WHERE user_id = ?', user.id).map((x) => [x.key, { ...parseJson(x.data), at: x.at }])) });
    if ((r = m(/^progress\/([a-z]:[a-z0-9]+)$/)) && method === 'PUT') {
      const at = num(b.at, Date.now());
      const old = this.one('SELECT at FROM progress WHERE user_id = ? AND key = ?', user.id, r[1]);
      if (!old || Number(old.at) <= at) this.sql.exec('INSERT OR REPLACE INTO progress (user_id, key, data, at) VALUES (?, ?, ?, ?)', user.id, r[1], jsonText(b.data, 2000), at);
      return json({ ok: true });
    }
    if (path === 'bookmarks' && method === 'GET') return json({ bookmarks: this.rows('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY at DESC', user.id) });
    if (path === 'bookmarks' && method === 'POST') {
      const id = newId();
      this.sql.exec('INSERT INTO bookmarks (id, user_id, key, node_id, pos, quote, note, at, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, user.id, str(b.key, 40), str(b.node_id, 40), Math.max(0, Math.floor(num(b.pos))), str(b.quote, 1000), str(b.note, 2000), Date.now(), b.kind === 'line' ? 'line' : 'mark');
      return json({ id });
    }
    if ((r = m(/^bookmarks\/([a-z0-9]+)$/)) && method === 'PATCH') {
      this.sql.exec('UPDATE bookmarks SET note = ? WHERE id = ? AND user_id = ?', str(b.note, 2000), r[1], user.id);
      return json({ ok: true });
    }
    if ((r = m(/^bookmarks\/([a-z0-9]+)$/)) && method === 'DELETE') {
      this.sql.exec('DELETE FROM bookmarks WHERE id = ? AND user_id = ?', r[1], user.id);
      return json({ ok: true });
    }

    // 세계관
    if (path === 'worlds' && method === 'GET') return this.listWorlds(user);
    if (path === 'worlds' && method === 'POST') return this.createWorld(user, b);
    if ((r = m(/^worlds\/([a-z0-9]+)$/))) {
      if (method === 'GET') return this.getWorld(user, r[1]);
      if (method === 'PATCH') return this.patchWorld(user, r[1], b);
      if (method === 'DELETE') return this.deleteWorld(user, r[1]);
    }
    if ((r = m(/^worlds\/([a-z0-9]+)\/restore$/)) && method === 'POST') {
      this.ownWorld(user, r[1], true);
      this.sql.exec('UPDATE worlds SET deleted = NULL WHERE id = ?', r[1]);
      return json({ ok: true });
    }
    if ((r = m(/^worlds\/([a-z0-9]+)\/items$/)) && method === 'POST') return this.putItems(user, r[1], b);
    if ((r = m(/^worlds\/([a-z0-9]+)\/mentions$/)) && method === 'POST') return this.mentions(user, r[1], b);
    if ((r = m(/^worlds\/([a-z0-9]+)\/links$/)) && method === 'GET') return this.links(user, r[1]);
    if ((r = m(/^worlds\/([a-z0-9]+)\/images$/)) && method === 'POST') return this.putImage(user, r[1], b);
    if ((r = m(/^images\/([a-z0-9]+)$/))) {
      if (method === 'GET') return this.getImage(user, r[1]);
      if (method === 'DELETE') return this.deleteImage(user, r[1]);
    }

    // 열람실
    if (path === 'community' && method === 'GET') return this.community(user);
    if (path === 'feed' && method === 'GET') return this.feed(user);
    if ((r = m(/^editions\/([a-z0-9]+)$/)) && method === 'GET') return this.getEdition(user, r[1]);
    if (path === 'annotations' && method === 'POST') return this.annotate(user, b);
    if ((r = m(/^annotations\/([a-z0-9]+)$/))) {
      if (method === 'PATCH') return this.patchAnnotation(user, r[1], b);
      if (method === 'DELETE') return this.deleteAnnotation(user, r[1]);
    }
    if (path === 'likes' && method === 'POST') return this.like(user, b);

    // 밖의 책 찾기 (저작권이 끝난 책)
    if (path.startsWith('ext/')) {
      const wait = this.extByUser.hit(user.id);
      if (wait) return fail(`찾기를 너무 자주 했어요. ${wait}초 뒤에 다시 해 주세요.`, 429);
      if (path === 'ext/gutenberg' && method === 'GET') return json(await gutenbergSearch(q.get('q') ?? '', Number(q.get('page') ?? 1), q.get('lang') ?? ''));
      if (path === 'ext/gutenberg/file' && method === 'GET') return gutenbergFile(q.get('url') ?? '');
      if (path === 'ext/wikisource' && method === 'GET') return json(await wikisourceSearch(q.get('q') ?? ''));
      if (path === 'ext/wikisource/page' && method === 'GET') return json(await wikisourcePage(q.get('title') ?? ''));
    }
    return fail('없는 주소예요.', 404);
  }

  // ---------------------------------------------------------------- 계정
  private publicUser(u: UserRow) {
    return { id: u.id, username: u.username, nickname: u.nickname };
  }
  private async newSession(userId: string) {
    const token = randomHex(32);
    const now = Date.now();
    this.sql.exec('DELETE FROM sessions WHERE expires < ?', now);
    this.sql.exec('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)', await sha256(token), userId, now + SESSION_DAYS * DAY);
    return { 'set-cookie': sessionCookie(token, SESSION_DAYS * 86_400) };
  }
  private async sessionFrom(req: Request) {
    const token = readCookie(req, COOKIE_NAME) ?? '';
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const tokenHash = await sha256(token);
    const row = this.one<UserRow & { expires: number }>('SELECT u.*, s.expires AS expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?', tokenHash, Date.now());
    return row ? { user: row, token, tokenHash, expires: row.expires } : null;
  }
  private async signup(b: Body, ip: string) {
    if (!this.env.INVITE_CODE) return fail('가입이 아직 열리지 않았어요. 사이트 주인이 초대 코드를 정해야 해요.', 403);
    if (!inviteOk(b.invite, this.env.INVITE_CODE)) {
      this.loginByIp.hit(ip);
      return fail('초대 코드가 맞지 않아요.', 403);
    }
    const username = String(b.username ?? '').normalize('NFC').trim();
    const password = String(b.password ?? '');
    const nickname = str(String(b.nickname ?? '').trim(), 16) || username;
    if (!USERNAME.test(username)) return fail('아이디는 3~16자의 한글·영문·숫자·_ 로 정해 주세요.');
    const bad = passwordProblem(password, username);
    if (bad) return fail(bad);
    if (this.one('SELECT id FROM users WHERE username = ?', username)) return fail('이미 있는 아이디예요.', 409);
    if (this.signupByIp.hit(ip)) return fail('이 곳에서 오늘 만든 계정이 너무 많아요. 내일 다시 해 주세요.', 429);
    const id = randomHex(12);
    const salt = randomHex(16);
    const hash = await hashPassword(password, salt);
    try {
      this.sql.exec('INSERT INTO users (id, username, nickname, salt, hash, created) VALUES (?, ?, ?, ?, ?, ?)', id, username, nickname, salt, hash, Date.now());
    } catch (e) {
      if (/UNIQUE/i.test(e instanceof Error ? e.message : String(e))) return fail('이미 있는 아이디예요.', 409);
      throw e;
    }
    return json({ user: { id, username, nickname } }, 200, await this.newSession(id));
  }
  private async verify(u: UserRow | undefined, password: string) {
    let ok = u ? sameHex(await hashPassword(password, u.salt), u.hash) : (await hashPassword(password, 'x'.repeat(32)), false);
    if (!ok && u && /[^\x00-\x7f]/.test(password))
      for (const form of ['NFC', 'NFD'] as const) {
        const alt = password.normalize(form);
        if (alt !== password && sameHex(await hashPassword(alt, u.salt), u.hash)) {
          ok = true;
          break;
        }
      }
    return ok;
  }
  private async login(b: Body, ip: string) {
    const wait = this.loginByIp.hit(ip);
    if (wait) return fail(`로그인 시도가 너무 많아요. ${wait}초 뒤에 다시 해 주세요.`, 429);
    const raw = String(b.username ?? '').trim().slice(0, 32);
    const password = String(b.password ?? '').slice(0, 256);
    const u = this.one<UserRow>('SELECT * FROM users WHERE username = ? OR username = ? LIMIT 1', raw.normalize('NFC'), raw);
    if (!(await this.verify(u, password)) || !u) return fail('아이디 또는 비밀번호가 맞지 않아요.', 401);
    return json({ user: this.publicUser(u) }, 200, await this.newSession(u.id));
  }
  private setNickname(user: UserRow, b: Body) {
    const nickname = str(String(b.nickname ?? '').trim(), 16);
    if (!nickname) return fail('닉네임을 적어 주세요.');
    this.sql.exec('UPDATE users SET nickname = ? WHERE id = ?', nickname, user.id);
    return json({ user: { ...this.publicUser(user), nickname } });
  }
  private async changePassword(user: UserRow, keep: string, b: Body) {
    if (!(await this.verify(user, String(b.current ?? '').slice(0, 256)))) return fail('지금 비밀번호가 맞지 않아요.', 403);
    const next = String(b.password ?? '');
    const problem = passwordProblem(next, user.username);
    if (problem) return fail(problem);
    const salt = randomHex(16);
    this.sql.exec('UPDATE users SET salt = ?, hash = ? WHERE id = ?', salt, await hashPassword(next, salt), user.id);
    this.sql.exec('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', user.id, keep);
    return json({ ok: true });
  }
  private async deleteAccount(user: UserRow, b: Body) {
    if (!(await this.verify(user, String(b.password ?? '').slice(0, 256)))) return fail('비밀번호가 맞지 않아요.', 403);
    const books = this.rows<{ id: string }>('SELECT id FROM books WHERE owner = ?', user.id).map((x) => x.id);
    for (const id of books) this.purgeBookData(id);
    for (const w of this.rows<{ id: string }>('SELECT id FROM worlds WHERE owner = ?', user.id)) {
      this.sql.exec('DELETE FROM witems WHERE world_id = ?', w.id);
      this.sql.exec('DELETE FROM images WHERE world_id = ?', w.id);
      this.sql.exec('DELETE FROM worlds WHERE id = ?', w.id);
    }
    for (const t of ['sessions', 'progress', 'bookmarks', 'daily', 'read_daily', 'write_daily', 'jots', 'ai_usage', 'analysis_jobs', 'prefs', 'ratings', 'likes']) this.sql.exec(`DELETE FROM ${t} WHERE user_id = ?`, user.id);
    this.sql.exec('UPDATE annotations SET deleted = ?, body = ? WHERE author = ?', Date.now(), '', user.id);
    this.sql.exec('DELETE FROM users WHERE id = ?', user.id);
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  }
  private exportAll(user: UserRow) {
    const books = this.rows('SELECT * FROM books WHERE owner = ?', user.id);
    const ids = books.map((x) => String(x.id));
    const nodes = ids.flatMap((id) => this.rows('SELECT * FROM nodes WHERE book_id = ?', id));
    const worlds = this.rows('SELECT * FROM worlds WHERE owner = ?', user.id);
    const witems = worlds.flatMap((w) => this.rows('SELECT * FROM witems WHERE world_id = ?', String(w.id)));
    return json({ exported: Date.now(), user: this.publicUser(user), books, nodes, worlds, witems, progress: this.rows('SELECT * FROM progress WHERE user_id = ?', user.id), jots: this.rows('SELECT text, done, created FROM jots WHERE user_id = ?', user.id), bookmarks: this.rows('SELECT * FROM bookmarks WHERE user_id = ?', user.id), daily: this.rows('SELECT * FROM daily WHERE user_id = ?', user.id) });
  }

  // ---------------------------------------------------------------- 책
  private ownBook(user: UserRow, id: string, allowDeleted = false): BookRow {
    const b = this.one<BookRow>('SELECT * FROM books WHERE id = ? AND owner = ?', id, user.id);
    if (!b || (b.deleted && !allowDeleted)) throw new HttpError('책을 찾을 수 없어요.', 404);
    return b;
  }
  private bookOut(b: Row) {
    return { ...b, meta: parseJson(b.meta) };
  }
  private listBooks(user: UserRow) {
    const now = Date.now();
    for (const old of this.rows<{ id: string }>('SELECT id FROM books WHERE owner = ? AND deleted IS NOT NULL AND deleted < ?', user.id, now - TRASH_DAYS * DAY)) this.purgeBookData(old.id);
    const books = this.rows(
      `SELECT b.*, (SELECT COALESCE(SUM(chars),0) FROM nodes n WHERE n.book_id = b.id AND n.deleted IS NULL) AS total_chars,
        (SELECT COUNT(*) FROM nodes n WHERE n.book_id = b.id AND n.deleted IS NULL AND n.kind != 'part') AS node_count,
        (SELECT MAX(number) FROM editions e WHERE e.book_id = b.id) AS last_edition
       FROM books b WHERE b.owner = ? ORDER BY b.updated DESC`,
      user.id,
    ).map((x) => this.bookOut(x));
    return json({ books });
  }
  private createBook(user: UserRow, b: Body) {
    const id = newId();
    const now = Date.now();
    const kind = BOOK_KINDS.has(String(b.kind)) ? String(b.kind) : 'write';
    this.sql.exec(
      'INSERT INTO books (id, owner, kind, title, subtitle, author, color, world_id, goal_chars, deadline, notes, meta, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      user.id,
      kind,
      str(b.title, 200) || '제목 없는 책',
      str(b.subtitle, 200),
      str(b.author ?? user.nickname, 100),
      str(b.color, 20),
      this.worldIdOrNull(user, b.world_id),
      Math.max(0, Math.floor(num(b.goal_chars))),
      optStr(b.deadline, 10),
      str(b.notes, MAX_BODY),
      jsonText(b.meta, 20_000),
      now,
      now,
    );
    return json({ book: this.bookOut(this.one('SELECT * FROM books WHERE id = ?', id)!) });
  }
  private worldIdOrNull(user: UserRow, v: unknown): string | null {
    if (!v) return null;
    const w = this.one('SELECT id FROM worlds WHERE id = ? AND owner = ? AND deleted IS NULL', String(v), user.id);
    return w ? String(w.id) : null;
  }
  private getBook(user: UserRow, id: string) {
    const book = this.ownBook(user, id, true);
    const nodes = this.rows('SELECT id, book_id, parent_id, kind, sort, title, synopsis, status, label, meta, chars, rev, updated, deleted FROM nodes WHERE book_id = ?', id).map((n) => ({ ...n, meta: parseJson(n.meta) }));
    return json({ book: this.bookOut(book), nodes });
  }
  private fullBook(user: UserRow, id: string) {
    const book = this.ownBook(user, id);
    const nodes = this.rows('SELECT * FROM nodes WHERE book_id = ? AND deleted IS NULL', id).map((n) => ({ ...n, meta: parseJson(n.meta) }));
    return json({ book: this.bookOut(book), nodes });
  }
  private patchBook(user: UserRow, id: string, b: Body) {
    this.ownBook(user, id);
    const sets: string[] = [];
    const args: SqlStorageValue[] = [];
    const put = (col: string, v: SqlStorageValue) => {
      sets.push(`${col} = ?`);
      args.push(v);
    };
    if ('title' in b) put('title', str(b.title, 200) || '제목 없는 책');
    if ('subtitle' in b) put('subtitle', str(b.subtitle, 200));
    if ('author' in b) put('author', str(b.author, 100));
    if ('color' in b) put('color', str(b.color, 20));
    if ('world_id' in b) put('world_id', this.worldIdOrNull(user, b.world_id));
    if ('goal_chars' in b) put('goal_chars', Math.max(0, Math.floor(num(b.goal_chars))));
    if ('deadline' in b) put('deadline', optStr(b.deadline, 10));
    if ('notes' in b) put('notes', str(b.notes, MAX_BODY));
    if ('meta' in b) put('meta', jsonText(b.meta, 20_000));
    if ('kind' in b && BOOK_KINDS.has(String(b.kind))) put('kind', String(b.kind));
    if ('share_world' in b) put('share_world', b.share_world ? 1 : 0);
    put('updated', Date.now());
    this.sql.exec(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
    return json({ book: this.bookOut(this.one('SELECT * FROM books WHERE id = ?', id)!) });
  }
  private deleteBook(user: UserRow, id: string) {
    this.ownBook(user, id);
    this.sql.exec('UPDATE books SET deleted = ?, shared = 0 WHERE id = ?', Date.now(), id);
    return json({ ok: true });
  }
  private restoreBook(user: UserRow, id: string) {
    this.ownBook(user, id, true);
    this.sql.exec('UPDATE books SET deleted = NULL WHERE id = ?', id);
    return json({ ok: true });
  }
  private purgeBook(user: UserRow, id: string) {
    const b = this.ownBook(user, id, true);
    if (!b.deleted) return fail('휴지통에 있는 책만 완전히 지울 수 있어요.');
    this.purgeBookData(id);
    return json({ ok: true });
  }
  private purgeBookData(id: string) {
    for (const e of this.rows<{ id: string }>('SELECT id FROM editions WHERE book_id = ?', id)) {
      this.sql.exec('DELETE FROM edition_nodes WHERE edition_id = ?', e.id);
      this.sql.exec('DELETE FROM likes WHERE edition_id = ?', e.id);
    }
    for (const t of ['nodes', 'snapshots', 'editions', 'annotations', 'ratings']) this.sql.exec(`DELETE FROM ${t} WHERE book_id = ?`, id);
    this.sql.exec('DELETE FROM books WHERE id = ?', id);
  }
  private touchBook(id: string) {
    this.sql.exec('UPDATE books SET updated = ? WHERE id = ?', Date.now(), id);
  }

  /** 장 여러 개 한꺼번에 만들기 (새 장 하나도 이걸로). parent 는 실제 id 나 같은 요청 안의 tmp */
  private createNodes(user: UserRow, bookId: string, b: Body) {
    this.ownBook(user, bookId);
    const items = Array.isArray(b.items) ? (b.items as Body[]) : [];
    if (!items.length || items.length > 2000) return fail('잘못된 요청이에요.');
    const map: Record<string, string> = {};
    const now = Date.now();
    const out: Row[] = [];
    for (const it of items) {
      const kind = NODE_KINDS.has(String(it.kind)) ? String(it.kind) : 'chapter';
      const body = String(it.body ?? '');
      if (body.length > MAX_BODY) return fail('장 하나가 너무 길어요. 나눠서 넣어 주세요.', 413);
      let parent: string | null = null;
      if (it.parent_tmp && map[String(it.parent_tmp)]) parent = map[String(it.parent_tmp)];
      else if (it.parent_id) {
        const p = this.one('SELECT id FROM nodes WHERE id = ? AND book_id = ?', String(it.parent_id), bookId);
        parent = p ? String(p.id) : null;
      }
      let sort = num(it.sort, NaN);
      if (!Number.isFinite(sort)) {
        const mx = this.one('SELECT MAX(sort) AS m FROM nodes WHERE book_id = ? AND parent_id IS ?', bookId, parent);
        sort = Number(mx?.m ?? 0) + 1;
      }
      const id = newId();
      if (it.tmp) map[String(it.tmp)] = id;
      this.sql.exec(
        'INSERT INTO nodes (id, book_id, parent_id, kind, sort, title, body, synopsis, status, label, meta, chars, rev, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
        id,
        bookId,
        parent,
        kind,
        sort,
        str(it.title, 300),
        body,
        str(it.synopsis, 5000),
        STATUSES.has(String(it.status ?? '')) ? String(it.status ?? '') : '',
        str(it.label, 20),
        jsonText(it.meta, 20_000),
        charsNoSpace(body),
        now,
      );
      out.push({ id, tmp: String(it.tmp ?? ''), parent_id: parent, sort });
    }
    this.touchBook(bookId);
    return json({ created: out, map });
  }
  private ownNode(user: UserRow, id: string): NodeRow & { owner: string } {
    const n = this.one<NodeRow & { owner: string }>('SELECT n.*, b.owner AS owner FROM nodes n JOIN books b ON b.id = n.book_id WHERE n.id = ?', id);
    if (!n || n.owner !== user.id) throw new HttpError('원고를 찾을 수 없어요.', 404);
    return n;
  }
  private getNode(user: UserRow, id: string) {
    const n = this.ownNode(user, id);
    return json({ node: { ...n, meta: parseJson(n.meta) } });
  }
  private snapshot(n: NodeRow, label: string, auto: boolean) {
    this.sql.exec('INSERT INTO snapshots (id, node_id, book_id, body, title, label, auto, chars, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', newId(), n.id, n.book_id, n.body, n.title, label, auto ? 1 : 0, charsNoSpace(n.body), Date.now());
    if (auto) {
      const extra = this.rows<{ id: string }>('SELECT id FROM snapshots WHERE node_id = ? AND auto = 1 ORDER BY at DESC LIMIT -1 OFFSET ?', n.id, MAX_AUTO_SNAPSHOTS);
      for (const x of extra) this.sql.exec('DELETE FROM snapshots WHERE id = ?', x.id);
    }
  }
  private patchNode(user: UserRow, id: string, b: Body) {
    const n = this.ownNode(user, id);
    const sets: string[] = [];
    const args: SqlStorageValue[] = [];
    const put = (col: string, v: SqlStorageValue) => {
      sets.push(`${col} = ?`);
      args.push(v);
    };
    let conflict = false;
    if ('title' in b) put('title', str(b.title, 300));
    if ('synopsis' in b) put('synopsis', str(b.synopsis, 5000));
    if ('status' in b && STATUSES.has(String(b.status))) put('status', String(b.status));
    if ('label' in b) put('label', str(b.label, 20));
    if ('meta' in b) put('meta', jsonText(b.meta, 20_000));
    if ('kind' in b && NODE_KINDS.has(String(b.kind))) put('kind', String(b.kind));
    if (typeof b.body === 'string') {
      const body = b.body.normalize('NFC');
      if (body.length > MAX_BODY) return fail('장 하나가 너무 길어요 (150만 자까지). 장을 나눠 주세요.', 413);
      if (body !== n.body) {
        const base = num(b.base_rev, n.rev);
        if (base < n.rev && n.body.trim()) {
          // 다른 기기에서 먼저 고친 글: 지우지 않고 기록으로 남긴다
          this.snapshot(n, '다른 기기에서 고친 글', false);
          conflict = true;
        } else if (n.body.trim()) {
          const last = this.one('SELECT at FROM snapshots WHERE node_id = ? ORDER BY at DESC LIMIT 1', id);
          if (!last || Date.now() - Number(last.at) > AUTO_SNAPSHOT_GAP) this.snapshot(n, '', true);
        }
        const chars = charsNoSpace(body);
        const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day ?? '')) ? String(b.day) : new Date().toISOString().slice(0, 10);
        const gain = chars - Number(n.chars);
        if (gain > 0 && gain < 200_000) this.sql.exec('INSERT INTO daily (user_id, day, chars) VALUES (?, ?, ?) ON CONFLICT (user_id, day) DO UPDATE SET chars = chars + excluded.chars', user.id, day, gain);
        put('body', body);
        put('chars', chars);
      }
    }
    if (!sets.length) return json({ rev: n.rev, conflict });
    // rev 는 본문이 바뀔 때만 올린다 (다른 기기와 본문이 엇갈렸는지 알아보는 번호)
    const bodyChanged = sets.includes('body = ?');
    const rev = Number(n.rev) + (bodyChanged ? 1 : 0);
    put('rev', rev);
    put('updated', Date.now());
    this.sql.exec(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
    this.touchBook(n.book_id);
    return json({ rev, conflict });
  }
  private deleteNode(user: UserRow, id: string) {
    const n = this.ownNode(user, id);
    const now = Date.now();
    // 아래 칸까지 함께 휴지통으로
    const all = this.rows<{ id: string; parent_id: string | null }>('SELECT id, parent_id FROM nodes WHERE book_id = ?', n.book_id);
    const drop = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of all) if (x.parent_id && drop.has(x.parent_id) && !drop.has(x.id)) (drop.add(x.id), (grew = true));
    }
    for (const x of drop) this.sql.exec('UPDATE nodes SET deleted = ? WHERE id = ? AND deleted IS NULL', now, x);
    this.touchBook(n.book_id);
    return json({ ok: true, removed: [...drop] });
  }
  private restoreNode(user: UserRow, id: string) {
    const n = this.ownNode(user, id);
    const t = this.one('SELECT deleted FROM nodes WHERE id = ?', id)?.deleted;
    if (t) this.sql.exec('UPDATE nodes SET deleted = NULL WHERE book_id = ? AND deleted = ?', n.book_id, t);
    this.touchBook(n.book_id);
    return json({ ok: true });
  }
  private reorder(user: UserRow, bookId: string, b: Body) {
    this.ownBook(user, bookId);
    const items = Array.isArray(b.items) ? (b.items as Body[]) : [];
    const ids = new Set(this.rows<{ id: string }>('SELECT id FROM nodes WHERE book_id = ?', bookId).map((x) => x.id));
    for (const it of items.slice(0, 5000)) {
      const id = String(it.id);
      if (!ids.has(id)) continue;
      const parent = it.parent_id && ids.has(String(it.parent_id)) && String(it.parent_id) !== id ? String(it.parent_id) : null;
      this.sql.exec('UPDATE nodes SET parent_id = ?, sort = ? WHERE id = ?', parent, num(it.sort), id);
    }
    this.touchBook(bookId);
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- 기록(스냅숏)
  private listSnapshots(user: UserRow, nodeId: string) {
    this.ownNode(user, nodeId);
    return json({ snapshots: this.rows('SELECT id, node_id, title, label, auto, chars, at FROM snapshots WHERE node_id = ? ORDER BY at DESC', nodeId) });
  }
  private bookSnapshots(user: UserRow, bookId: string) {
    this.ownBook(user, bookId);
    return json({ snapshots: this.rows('SELECT id, node_id, title, label, auto, chars, at FROM snapshots WHERE book_id = ? AND auto = 0 ORDER BY at DESC LIMIT 300', bookId) });
  }
  private takeSnapshot(user: UserRow, nodeId: string, b: Body) {
    const n = this.ownNode(user, nodeId);
    this.snapshot(n, str(b.label, 100) || '직접 남긴 기록', false);
    return json({ ok: true });
  }
  private ownSnapshot(user: UserRow, id: string) {
    const s = this.one('SELECT s.*, b.owner AS owner FROM snapshots s JOIN books b ON b.id = s.book_id WHERE s.id = ?', id);
    if (!s || s.owner !== user.id) throw new HttpError('기록을 찾을 수 없어요.', 404);
    return s;
  }
  private getSnapshot(user: UserRow, id: string) {
    const s = this.ownSnapshot(user, id);
    delete s.owner;
    return json({ snapshot: s });
  }
  private deleteSnapshot(user: UserRow, id: string) {
    this.ownSnapshot(user, id);
    this.sql.exec('DELETE FROM snapshots WHERE id = ?', id);
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- 찾기
  private search(user: UserRow, q: URLSearchParams) {
    const text = String(q.get('q') ?? '').normalize('NFC').trim().slice(0, 100);
    if (text.length < 1) return json({ books: [], hits: [] });
    const scope = q.get('scope') ?? 'all';
    const bookFilter = q.get('book');
    const like = `%${text.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const books = this.rows(
      `SELECT id, title, subtitle, author, kind, color FROM books WHERE owner = ? AND deleted IS NULL AND (title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR subtitle LIKE ? ESCAPE '\\') LIMIT 50`,
      user.id,
      like,
      like,
      like,
    );
    const hits: Row[] = [];
    const mine = this.rows<NodeRow & { book_title: string; book_kind: string }>(
      `SELECT n.id, n.book_id, n.title, n.body, b.title AS book_title, b.kind AS book_kind FROM nodes n JOIN books b ON b.id = n.book_id
       WHERE b.owner = ? AND b.deleted IS NULL AND n.deleted IS NULL ${scope === 'write' ? "AND b.kind = 'write'" : scope === 'read' ? "AND b.kind = 'read'" : ''} ${bookFilter ? 'AND b.id = ?' : ''}
       AND (instr(lower(n.body), lower(?)) > 0 OR instr(lower(n.title), lower(?)) > 0) LIMIT 300`,
      ...([user.id, ...(bookFilter ? [bookFilter] : []), text, text] as SqlStorageValue[]),
    );
    for (const n of mine) {
      const low = n.body.toLowerCase();
      const needle = text.toLowerCase();
      let count = 0;
      for (let i = low.indexOf(needle); i >= 0 && count < 999; i = low.indexOf(needle, i + needle.length)) count++;
      hits.push({ where: 'mine', book_id: n.book_id, book_title: n.book_title, book_kind: n.book_kind, node_id: n.id, node_title: n.title, count, snippets: JSON.stringify(snippets(n.body, text)) });
    }
    if (scope === 'all' && !bookFilter) {
      // 친구가 공유한 책 (가장 최근 판)
      const shared = this.rows<{ edition_id: string; book_id: string; title: string; node_id: string; node_title: string; body: string }>(
        `SELECT e.id AS edition_id, e.book_id, e.title, en.node_id, en.title AS node_title, en.body FROM editions e
         JOIN books b ON b.id = e.book_id JOIN edition_nodes en ON en.edition_id = e.id
         WHERE b.shared = 1 AND b.deleted IS NULL AND b.owner != ? AND e.number = (SELECT MAX(number) FROM editions x WHERE x.book_id = e.book_id)
         AND instr(lower(en.body), lower(?)) > 0 LIMIT 200`,
        user.id,
        text,
      );
      for (const n of shared) hits.push({ where: 'shared', book_id: n.book_id, edition_id: n.edition_id, book_title: n.title, node_id: n.node_id, node_title: n.node_title, count: snippets(n.body, text, 999).length, snippets: JSON.stringify(snippets(n.body, text)) });
    }
    return json({ books, hits: hits.map((h) => ({ ...h, snippets: JSON.parse(String(h.snippets)) })) });
  }

  // ---------------------------------------------------------------- 세계관
  private ownWorld(user: UserRow, id: string, allowDeleted = false) {
    const w = this.one('SELECT * FROM worlds WHERE id = ? AND owner = ?', id, user.id);
    if (!w || (w.deleted && !allowDeleted)) throw new HttpError('세계를 찾을 수 없어요.', 404);
    return w;
  }
  private listWorlds(user: UserRow) {
    const worlds = this.rows(
      `SELECT w.*, (SELECT COUNT(*) FROM witems i WHERE i.world_id = w.id AND i.type = 'entry' AND i.deleted IS NULL) AS entry_count FROM worlds w WHERE w.owner = ? ORDER BY w.updated DESC`,
      user.id,
    ).map((w) => ({ ...w, meta: parseJson(w.meta) }));
    return json({ worlds });
  }
  private createWorld(user: UserRow, b: Body) {
    const id = newId();
    const now = Date.now();
    this.sql.exec('INSERT INTO worlds (id, owner, title, summary, color, meta, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, user.id, str(b.title, 200) || '이름 없는 세계', str(b.summary, 5000), str(b.color, 20), jsonText(b.meta, 50_000), now, now);
    if (Array.isArray(b.items)) this.writeItems(id, b.items as Body[]);
    return json({ world: { ...this.one('SELECT * FROM worlds WHERE id = ?', id), meta: parseJson(b.meta) } });
  }
  /** 내 세계거나, 세계관까지 공유한 친구 책의 세계면 읽을 수 있다 */
  private getWorld(user: UserRow, id: string) {
    const w = this.one('SELECT * FROM worlds WHERE id = ? AND deleted IS NULL', id);
    if (!w) return fail('세계를 찾을 수 없어요.', 404);
    const mine = w.owner === user.id;
    if (!mine && !this.one('SELECT id FROM books WHERE world_id = ? AND shared = 1 AND share_world = 1 AND deleted IS NULL', id)) return fail('세계를 찾을 수 없어요.', 404);
    const items = this.rows('SELECT id, type, data, updated FROM witems WHERE world_id = ? AND deleted IS NULL', id).map((i) => ({ id: i.id, type: i.type, updated: i.updated, ...parseJson(i.data) }));
    const books = mine ? this.rows('SELECT id, title FROM books WHERE world_id = ? AND owner = ? AND deleted IS NULL', id, user.id) : [];
    return json({ world: { ...w, meta: parseJson(w.meta) }, items, books, readonly: !mine });
  }
  private patchWorld(user: UserRow, id: string, b: Body) {
    this.ownWorld(user, id);
    if ('title' in b) this.sql.exec('UPDATE worlds SET title = ? WHERE id = ?', str(b.title, 200) || '이름 없는 세계', id);
    if ('summary' in b) this.sql.exec('UPDATE worlds SET summary = ? WHERE id = ?', str(b.summary, 5000), id);
    if ('color' in b) this.sql.exec('UPDATE worlds SET color = ? WHERE id = ?', str(b.color, 20), id);
    if ('meta' in b) this.sql.exec('UPDATE worlds SET meta = ? WHERE id = ?', jsonText(b.meta, 50_000), id);
    this.sql.exec('UPDATE worlds SET updated = ? WHERE id = ?', Date.now(), id);
    return json({ ok: true });
  }
  private deleteWorld(user: UserRow, id: string) {
    this.ownWorld(user, id);
    this.sql.exec('UPDATE worlds SET deleted = ? WHERE id = ?', Date.now(), id);
    this.sql.exec('UPDATE books SET world_id = NULL WHERE world_id = ? AND owner = ?', id, user.id);
    return json({ ok: true });
  }
  private writeItems(worldId: string, items: Body[]) {
    const now = Date.now();
    const saved: string[] = [];
    for (const it of items.slice(0, 500)) {
      const id = ID.test(String(it.id ?? '')) ? String(it.id) : newId();
      const exists = this.one('SELECT world_id FROM witems WHERE id = ?', id);
      if (exists && exists.world_id !== worldId) continue;
      if (it.deleted) {
        this.sql.exec('UPDATE witems SET deleted = ?, updated = ? WHERE id = ?', now, now, id);
        saved.push(id);
        continue;
      }
      const type = WITEM_TYPES.has(String(it.type)) ? String(it.type) : 'entry';
      const data = { ...((it.data as Body) ?? {}) };
      this.sql.exec('INSERT OR REPLACE INTO witems (id, world_id, type, data, updated, deleted) VALUES (?, ?, ?, ?, ?, NULL)', id, worldId, type, jsonText(data), now);
      saved.push(id);
    }
    this.sql.exec('UPDATE worlds SET updated = ? WHERE id = ?', now, worldId);
    return saved;
  }
  private putItems(user: UserRow, id: string, b: Body) {
    this.ownWorld(user, id);
    const saved = this.writeItems(id, Array.isArray(b.items) ? (b.items as Body[]) : []);
    return json({ saved });
  }
  /** 항목 이름(과 다른 이름)이 이 세계에 연결된 내 책의 어느 장에 몇 번 나오는지 */
  private mentions(user: UserRow, worldId: string, b: Body) {
    this.ownWorld(user, worldId);
    const terms = (Array.isArray(b.terms) ? (b.terms as Body[]) : []).slice(0, 1000).map((t) => ({ id: String(t.id), words: (Array.isArray(t.words) ? t.words : []).map((w) => String(w).trim()).filter((w) => w.length >= 1).slice(0, 10) }));
    const nodes = this.rows<NodeRow & { book_title: string }>(
      `SELECT n.id, n.book_id, n.title, n.body, n.parent_id, n.sort, b.title AS book_title FROM nodes n JOIN books b ON b.id = n.book_id WHERE b.owner = ? AND b.world_id = ? AND b.deleted IS NULL AND n.deleted IS NULL`,
      user.id,
      worldId,
    );
    const out: { entry: string; node_id: string; book_id: string; book_title: string; node_title: string; count: number }[] = [];
    for (const t of terms) {
      if (!t.words.length) continue;
      for (const n of nodes) {
        let count = 0;
        for (const w of t.words) for (let i = n.body.indexOf(w); i >= 0; i = n.body.indexOf(w, i + w.length)) count++;
        if (count) out.push({ entry: t.id, node_id: n.id, book_id: n.book_id, book_title: n.book_title, node_title: n.title, count });
      }
    }
    return json({ mentions: out });
  }

  /** 원고 속 [[이름]] 을 모두 모은다 (세계관에 아직 없는 이름을 찾을 때) */
  private links(user: UserRow, worldId: string) {
    this.ownWorld(user, worldId);
    const nodes = this.rows<NodeRow & { book_title: string }>(
      `SELECT n.id, n.book_id, n.title, n.body, b.title AS book_title FROM nodes n JOIN books b ON b.id = n.book_id WHERE b.owner = ? AND b.world_id = ? AND b.deleted IS NULL AND n.deleted IS NULL`,
      user.id,
      worldId,
    );
    const found = new Map<string, { name: string; count: number; nodes: { node_id: string; book_id: string; node_title: string }[] }>();
    for (const n of nodes)
      for (const m of n.body.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g)) {
        const name = m[1].trim();
        if (!name) continue;
        const f = found.get(name) ?? { name, count: 0, nodes: [] };
        f.count++;
        if (!f.nodes.some((x) => x.node_id === n.id)) f.nodes.push({ node_id: n.id, book_id: n.book_id, node_title: n.title });
        found.set(name, f);
      }
    return json({ links: [...found.values()].sort((a, b) => b.count - a.count) });
  }
  private putImage(user: UserRow, worldId: string, b: Body) {
    this.ownWorld(user, worldId);
    const mime = String(b.mime ?? '');
    const data = String(b.data ?? '');
    if (!IMAGE_TYPES.has(mime) || !/^[A-Za-z0-9+/=]+$/.test(data)) return fail('그림 파일이 아니에요.');
    if (data.length > MAX_IMAGE) return fail('그림이 너무 커요.', 413);
    const n = Number(this.one('SELECT COUNT(*) AS n FROM images WHERE world_id = ?', worldId)?.n ?? 0);
    if (n >= MAX_IMAGES) return fail(`한 세계에 그림은 ${MAX_IMAGES}장까지예요. 안 쓰는 그림을 지워 주세요.`, 413);
    const id = newId();
    this.sql.exec('INSERT INTO images (id, world_id, mime, data, size, created) VALUES (?, ?, ?, ?, ?, ?)', id, worldId, mime, data, data.length, Date.now());
    return json({ id });
  }
  private imageAccess(user: UserRow, id: string) {
    const img = this.one('SELECT i.*, w.owner AS owner FROM images i JOIN worlds w ON w.id = i.world_id WHERE i.id = ?', id);
    if (!img) return null;
    const mine = img.owner === user.id;
    if (!mine && !this.one('SELECT id FROM books WHERE world_id = ? AND shared = 1 AND share_world = 1 AND deleted IS NULL', String(img.world_id))) return null;
    return { img, mine };
  }
  private getImage(user: UserRow, id: string) {
    const a = this.imageAccess(user, id);
    if (!a) return fail('그림을 찾을 수 없어요.', 404);
    const bin = Uint8Array.from(atob(String(a.img.data)), (c) => c.charCodeAt(0));
    return new Response(bin, { headers: { 'content-type': String(a.img.mime), 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
  }
  private deleteImage(user: UserRow, id: string) {
    const a = this.imageAccess(user, id);
    if (!a || !a.mine) return fail('그림을 찾을 수 없어요.', 404);
    this.sql.exec('DELETE FROM images WHERE id = ?', id);
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- 열람실
  private async publish(user: UserRow, bookId: string, b: Body) {
    const book = this.ownBook(user, bookId);
    if (book.kind !== 'write') return fail('내가 쓴 책만 공유할 수 있어요. (들인 책은 나만 볼 수 있어요)', 403);
    const nodes = flattenTree(this.rows<NodeRow>('SELECT id, parent_id, sort, kind, title, body FROM nodes WHERE book_id = ? AND deleted IS NULL', bookId)).filter((n) => n.kind !== 'note');
    if (!nodes.length) return fail('공유할 원고가 없어요.');
    const number = Number(this.one('SELECT MAX(number) AS m FROM editions WHERE book_id = ?', bookId)?.m ?? 0) + 1;
    const id = newId();
    const full = this.one('SELECT * FROM books WHERE id = ?', bookId)!;
    const chars = nodes.reduce((s, n) => s + charsNoSpace(n.body), 0);
    this.sql.exec('INSERT INTO editions (id, book_id, number, note, title, subtitle, author, color, chars, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, bookId, number, str(b.note, 1000), full.title, full.subtitle, full.author, full.color, chars, Date.now());
    nodes.forEach((n, i) => this.sql.exec('INSERT INTO edition_nodes (edition_id, node_id, sort, depth, kind, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)', id, n.id, i, n.depth, n.kind, n.title, n.body));
    this.sql.exec('UPDATE books SET shared = 1, share_world = ? WHERE id = ?', b.share_world ? 1 : 0, bookId);
    let analysis = false;
    if (this.autoAnalysisOn(user) && !parseJson(full.meta).analysisOf) analysis = (await this.startAnalysis(user, bookId)) === true;
    return json({ edition: { id, number }, analysis });
  }
  private unshare(user: UserRow, bookId: string) {
    this.ownBook(user, bookId);
    this.sql.exec('UPDATE books SET shared = 0 WHERE id = ?', bookId);
    return json({ ok: true });
  }
  /** 장 줄거리 요약 (AI). 저장은 하지 않고 글만 돌려준다 */
  private async aiSynopsis(user: UserRow, b: Body) {
    const n = this.ownNode(user, String(b.node_id ?? ''));
    if (n.body.replace(/\s/g, '').length < 80) return fail('요약하기엔 글이 너무 짧아요.');
    if (!this.env.AI && !geminiKey(this.env) && this.env.FAKE_AI !== '1') return fail('AI 요약을 쓸 수 없어요. (서버에 AI 연결이 없음)', 503);
    const day = new Date().toISOString().slice(0, 10);
    const used = Number(this.one('SELECT n FROM ai_usage WHERE user_id = ? AND day = ?', user.id, day)?.n ?? 0);
    if (used >= AI_DAILY) return fail(`오늘 AI 요약을 ${AI_DAILY}번 다 썼어요. 내일 다시 해 주세요.`, 429);
    let text = '';
    try {
      text = cleanSynopsis(await this.callAI(synopsisMessages(n.title, n.body), 500));
    } catch (e) {
      console.error('ai synopsis', e instanceof Error ? e.message : String(e));
    }
    if (!text) return fail('AI 가 요약을 만들지 못했어요. 잠시 뒤 다시 해 주세요.', 502);
    this.sql.exec('INSERT INTO ai_usage (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET n = n + 1', user.id, day);
    return json({ synopsis: text, left: AI_DAILY - used - 1 });
  }

  /** 장 정보 채우기: 원고를 읽고 줄거리 · 시점 · 장소 · 시간 · 꼬리표를 돌려준다 (저장은 쓰는 쪽이 빈 칸만) */
  private async aiChapterInfo(user: UserRow, b: Body) {
    const n = this.ownNode(user, String(b.node_id ?? ''));
    if (n.body.replace(/%%[\s\S]*?%%/g, '').replace(/\s/g, '').length < 80) return fail('채우기엔 글이 너무 짧아요.');
    if (!this.env.AI && !geminiKey(this.env) && this.env.FAKE_AI !== '1') return fail('AI 를 쓸 수 없어요. (서버에 AI 연결이 없음)', 503);
    const day = new Date().toISOString().slice(0, 10);
    const used = Number(this.one('SELECT n FROM ai_usage WHERE user_id = ? AND day = ?', user.id, day)?.n ?? 0);
    if (used >= AI_DAILY) return fail(`오늘 AI 를 ${AI_DAILY}번 다 썼어요. 내일 다시 해 주세요.`, 429);
    const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 40).trim()).filter(Boolean).slice(0, 80) : []);
    let info = null;
    try {
      info = parseInfo(await this.callAI(infoMessages(n.title, n.body, names(b.people), names(b.places)), 900));
    } catch (e) {
      console.error('ai info', e instanceof Error ? e.message : String(e));
    }
    if (!info) return fail('AI 가 장 정보를 만들지 못했어요. 잠시 뒤 다시 해 주세요.', 502);
    this.sql.exec('INSERT INTO ai_usage (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET n = n + 1', user.id, day);
    return json({ info, left: AI_DAILY - used - 1 });
  }

  /** 오늘 AI 를 더 부를 수 있는지. 안 되면 오류 응답 */
  private aiGate(user: UserRow): { used: number; day: string } | Response {
    if (!this.env.AI && !geminiKey(this.env) && this.env.FAKE_AI !== '1') return fail('AI 를 쓸 수 없어요. (서버에 AI 연결이 없음)', 503);
    const day = new Date().toISOString().slice(0, 10);
    const used = Number(this.one('SELECT n FROM ai_usage WHERE user_id = ? AND day = ?', user.id, day)?.n ?? 0);
    if (used >= AI_DAILY) return fail(`오늘 AI 를 ${AI_DAILY}번 다 썼어요. 내일 다시 해 주세요.`, 429);
    return { used, day };
  }
  private aiCount(user: UserRow, day: string) {
    this.sql.exec('INSERT INTO ai_usage (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET n = n + 1', user.id, day);
  }
  /** 이 장보다 앞에 있는 장들 (부 · 메모 · 빈 장 빼고) */
  private unitsBefore(n: NodeRow): { title: string; synopsis: string; body: string }[] {
    const all = flattenTree(this.rows<NodeRow>('SELECT id, parent_id, sort, kind, title, synopsis, body FROM nodes WHERE book_id = ? AND deleted IS NULL', n.book_id));
    const at = all.findIndex((x) => x.id === n.id);
    return all
      .slice(0, Math.max(0, at))
      .filter((x) => x.kind !== 'part' && x.kind !== 'note' && (String(x.synopsis ?? '').trim() || String(x.body ?? '').replace(/\s/g, '').length >= 50))
      .map((x) => ({ title: String(x.title ?? ''), synopsis: String(x.synopsis ?? ''), body: String(x.body ?? '') }));
  }

  /** 집필을 돕는 AI 도구 (한 장 기준). 저장은 하지 않고 결과만 돌려준다 */
  private async aiTool(user: UserRow, b: Body) {
    const tool = String(b.tool ?? '') as ToolName;
    if (!TOOLS.includes(tool)) return fail('모르는 도구예요.');
    const n = this.ownNode(user, String(b.node_id ?? ''));
    const body = String(n.body ?? '');
    const plain = body.replace(/%%[\s\S]*?%%/g, '').replace(/\s/g, '');
    if (tool === 'polish') {
      if (str(b.text, 5000).replace(/\s/g, '').length < 10) return fail('고칠 문단을 골라 주세요.');
    } else if (tool !== 'questions' && plain.length < 80) return fail('글이 너무 짧아요.');
    const gate = this.aiGate(user);
    if (gate instanceof Response) return gate;
    const names = (v: unknown, max = 300) => (Array.isArray(v) ? v.map((x) => str(x, 40).trim()).filter(Boolean).slice(0, max) : []);
    let lines: ReturnType<typeof findDialogue> = [];
    let msgs: Msg[];
    if (tool === 'conflicts') msgs = conflictMessages(n.title, body, str(b.world, 9000), previousDigest(this.unitsBefore(n)));
    else if (tool === 'names') msgs = namesMessages(body, names(b.known));
    else if (tool === 'polish') msgs = polishMessages(str(b.text, 4000));
    else if (tool === 'questions') msgs = questionMessages(n.title, String(n.synopsis ?? ''), previousDigest(this.unitsBefore(n), 5000), body);
    else {
      lines = findDialogue(body);
      if (lines.length < 2) return fail('따옴표(“ ” 「 」)로 묶인 대사가 거의 없어요.');
      msgs = dialogueMessages(markDialogue(body, lines), names(b.people, 80));
    }
    let o: Record<string, unknown> | null = null;
    try {
      o = readJson(await this.callAI(msgs, tool === 'dialogue' ? 2500 : 1800));
    } catch (e) {
      console.error('ai tool', tool, e instanceof Error ? e.message : String(e));
      return fail('AI 가 답하지 않았어요. 잠시 뒤 다시 해 주세요.', 502);
    }
    if (!o) return fail('AI 답을 읽지 못했어요. 다시 해 주세요.', 502);
    this.aiCount(user, gate.day);
    const left = AI_DAILY - gate.used - 1;
    if (tool === 'conflicts') return json({ issues: parseIssues(o), left });
    if (tool === 'names') return json({ names: parseNames(o), left });
    if (tool === 'polish') return json({ edits: parseEdits(o), left });
    if (tool === 'questions') return json({ questions: parseQuestions(o), left });
    return json({ lines: parseSpeakers(o, lines), left });
  }

  /** 지난 이야기: 읽은 데까지의 글(쓰는 쪽이 잘라서 보냄)만으로 요약 */
  private async aiRecap(user: UserRow, b: Body) {
    const material = str(b.material, 20000);
    if (material.replace(/\s/g, '').length < 100) return fail('아직 읽은 글이 적어서 정리할 게 없어요.');
    const gate = this.aiGate(user);
    if (gate instanceof Response) return gate;
    let text = '';
    try {
      text = cleanRecap(await this.callAI(recapMessages(str(b.title, 200), material), 1500));
    } catch (e) {
      console.error('ai recap', e instanceof Error ? e.message : String(e));
    }
    if (!text) return fail('AI 가 지난 이야기를 만들지 못했어요. 잠시 뒤 다시 해 주세요.', 502);
    this.aiCount(user, gate.day);
    return json({ recap: text, left: AI_DAILY - gate.used - 1 });
  }

  // ---------------------------------------------------------------- 분석집 (작품 해설)
  private autoAnalysisOn(user: UserRow): boolean {
    const p = parseJson(this.one('SELECT data FROM prefs WHERE user_id = ?', user.id)?.data) as { autoAnalysis?: boolean };
    return p.autoAnalysis !== false;
  }
  private analysisStatus(user: UserRow, bookId: string) {
    const book = this.ownBook(user, bookId);
    const row = this.one('SELECT id, status, phase, step, total, error, created, updated, next_at, state FROM analysis_jobs WHERE book_id = ? ORDER BY created DESC LIMIT 1', bookId);
    let job: Row | null = null;
    if (row) {
      // 진행: 장 읽기 → 해설 쓰기 → 엮기 를 한 줄로 이어서 센다
      const units = ((parseJson(row.state) as { units?: unknown[] }).units ?? []).length;
      const step = Number(row.step);
      const done = row.status === 'done' ? Number(row.total) : row.phase === 'chapters' ? step : row.phase === 'sections' ? units + step : units + SECTIONS.length;
      const { state: _s, ...rest } = row;
      void _s;
      job = { ...rest, step: done };
    }
    const aid = (parseJson(book.meta) as { analysisBookId?: string }).analysisBookId;
    const exists = aid ? this.one('SELECT id FROM books WHERE id = ? AND owner = ? AND deleted IS NULL', aid, user.id) : null;
    return json({ job, analysisBookId: exists ? aid : null, auto: this.autoAnalysisOn(user) });
  }
  /** 분석집 만들기를 시작한다. 이미 만드는 중이면 그대로. 막히면 까닭(글) */
  private async startAnalysis(user: UserRow, bookId: string): Promise<true | string> {
    const book = this.ownBook(user, bookId);
    if ((parseJson(book.meta) as { analysisOf?: string }).analysisOf) return '해설집은 다시 분석하지 않아요.';
    if (this.one("SELECT id FROM analysis_jobs WHERE book_id = ? AND status = 'running'", bookId)) return true;
    const day = new Date().toISOString().slice(0, 10);
    const n = Number(this.one('SELECT COUNT(*) AS n FROM analysis_jobs WHERE user_id = ? AND created >= ?', user.id, Date.parse(day))?.n ?? 0);
    if (n >= ANALYSIS_DAILY) return `분석집은 하루 ${ANALYSIS_DAILY}번까지 만들 수 있어요. 내일 다시 해 주세요.`;
    const all = flattenTree(this.rows<NodeRow>('SELECT id, parent_id, sort, kind, title, body FROM nodes WHERE book_id = ? AND deleted IS NULL', bookId));
    const units: { id: string; title: string; part: string }[] = [];
    let part = '';
    for (const x of all) {
      if (x.kind === 'part') part = x.title;
      else if (x.kind !== 'note' && x.body.replace(/\s/g, '').length >= 50) units.push({ id: x.id, title: x.title, part: x.depth === 0 ? '' : part });
    }
    if (!units.length) return '분석할 원고가 없어요.';
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO analysis_jobs (id, user_id, book_id, status, phase, step, total, state, created, updated, next_at) VALUES (?, ?, ?, 'running', 'chapters', 0, ?, ?, ?, ?, ?)",
      newId(),
      user.id,
      bookId,
      units.slice(0, 300).length + SECTIONS.length + 1,
      JSON.stringify({ units: units.slice(0, 300), sections: {}, retries: 0 }),
      now,
      now,
      now,
    );
    await this.ctx.storage.setAlarm(now + 100);
    return true;
  }
  private lastVia = '';
  private gemList: { at: number; v: string[] } | null = null;
  /** Gemini 모델 순서 (하루 한 번 새로 받는다) */
  private async gemModels(key: string, f: typeof fetch): Promise<string[]> {
    if (this.gemList && Date.now() - this.gemList.at < 86_400_000) return this.gemList.v;
    const v = await geminiModels(key, f).catch(() => null);
    if (v) this.gemList = { at: Date.now(), v };
    return v ?? [];
  }
  private async callAI(messages: unknown[], max: number): Promise<string> {
    if (this.env.FAKE_AI === '1') {
      // 개발용 (wrangler dev 에서는 Workers AI 를 부를 수 없다): 모양만 맞는 가짜 답
      const sys = String((messages[0] as { content?: string })?.content ?? '');
      const fake = fakeTool(sys, String((messages[1] as { content?: string })?.content ?? ''));
      if (fake) return fake;
      if (sys.includes(INFO_MARK)) return JSON.stringify({ synopsis: '가짜 요약: 이 장에서 일이 일어난다.', pov: '홍설', place: '파빌리온', time: '오전 8시', tags: ['꿈', '시작'] });
      const isChapter = sys.includes('메모를 남긴다');
      return isChapter ? JSON.stringify({ summary: '가짜 요약: 이 장에서 일이 일어난다.', characters: [{ name: '홍설', doing: '꽃밭에 간다', traits: ['조용함'] }], events: [{ what: '꽃밭에 감', why: '시작' }], objects: [{ name: '거울', meaning: '기억' }], places: [{ name: '파빌리온', meaning: '쉼' }], motifs: ['오전 8시'], lines: ['홍설은 꽃밭에서 눈을 떴다.'] }) : '가짜 해설 문단입니다. [1] 장을 근거로 씁니다.';
    }
    let last: unknown = null;
    // 1) Gemini (등록한 키가 있으면): Flash → Flash Lite → Gemma 4, 하루 한도가 찬 모델은 태평양 시간 자정까지 건너뛴다
    const key = geminiKey(this.env);
    if (key) {
      const f = relayFetch(this.env.RELAY);
      const day = pacificDay(Date.now());
      const out = new Set(this.rows<{ model: string }>('SELECT model FROM gem_out WHERE day = ?', day).map((r) => r.model));
      for (const model of (await this.gemModels(key, f)).filter((m) => !out.has(m)).slice(0, 4)) {
        try {
          const t = await askGemini(key, model, messages as Msg[], f);
          this.lastVia = `Gemini ${model}`;
          return t;
        } catch (e) {
          last = e;
          if (e instanceof GeminiDayLimit) this.sql.exec('INSERT OR IGNORE INTO gem_out (model, day) VALUES (?, ?)', model, day);
          console.error('gemini', model, e instanceof Error ? e.message : String(e));
        }
      }
    }
    // 2) Cloudflare Workers AI
    if (!this.env.AI) throw last instanceof Error ? last : new Error('AI 연결이 없어요');
    for (const model of [MODEL, FALLBACK]) {
      try {
        const t = readOutput(await this.env.AI.run(model as never, modelInput(model, messages, max) as never));
        if (t) {
          this.lastVia = `Cloudflare ${model}`;
          return t;
        }
      } catch (e) {
        last = e;
        console.error('analysis ai', model, e instanceof Error ? e.message : String(e));
      }
    }
    throw last instanceof Error ? last : new Error('AI 가 답하지 않았어요');
  }
  async alarm() {
    const job = this.one<Row & { id: string; book_id: string; user_id: string; phase: string; step: number; state: string }>("SELECT * FROM analysis_jobs WHERE status = 'running' AND next_at <= ? ORDER BY next_at LIMIT 1", Date.now());
    if (job) {
      try {
        await this.stepAnalysis(job);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const st = parseJson(job.state) as { retries?: number };
        const quota = /exceeded|limit|quota|neuron|capacity|429|4006/i.test(msg);
        const retries = (st.retries ?? 0) + 1;
        if (quota || retries <= 3) {
          // 한도에 걸리면 한 시간 뒤, 그 밖의 오류는 조금 뒤에 다시
          this.sql.exec('UPDATE analysis_jobs SET state = ?, error = ?, next_at = ?, updated = ? WHERE id = ?', JSON.stringify({ ...st, retries: quota ? st.retries ?? 0 : retries }), quota ? 'AI 무료 한도에 걸려 잠시 쉬었다가 이어서 만들어요.' : '', Date.now() + (quota ? 3600_000 : 60_000 * retries), Date.now(), job.id);
        } else this.sql.exec("UPDATE analysis_jobs SET status = 'error', error = ?, updated = ? WHERE id = ?", 'AI 가 여러 번 답하지 않아 멈췄어요. 다시 만들기를 눌러 주세요.', Date.now(), job.id);
      }
    }
    const next = this.one("SELECT MIN(next_at) AS t FROM analysis_jobs WHERE status = 'running'");
    if (next?.t != null) await this.ctx.storage.setAlarm(Math.max(Date.now() + 300, Number(next.t)));
  }
  private async stepAnalysis(job: { id: string; book_id: string; user_id: string; phase: string; step: number; state: string }) {
    const st = parseJson(job.state) as { units: { id: string; title: string; part: string }[]; sections: Record<string, string>; retries?: number };
    const book = this.one<BookRow & { meta: string }>('SELECT * FROM books WHERE id = ? AND deleted IS NULL', job.book_id);
    if (!book) return this.sql.exec("UPDATE analysis_jobs SET status = 'canceled', updated = ? WHERE id = ?", Date.now(), job.id);
    const save = (phase: string, step: number, extra: Record<string, unknown> = {}) =>
      this.sql.exec('UPDATE analysis_jobs SET phase = ?, step = ?, state = ?, error = ?, updated = ?, next_at = ? WHERE id = ?', phase, step, JSON.stringify({ ...st, retries: 0, ...extra }), '', Date.now(), Date.now(), job.id);
    if (job.phase === 'chapters') {
      // 바뀌지 않은 장은 지난번 메모를 그대로 쓴다 (한 번에 여러 장 넘어감)
      let i = job.step;
      while (i < st.units.length) {
        const u = st.units[i];
        const node = this.one<NodeRow>('SELECT id, title, body FROM nodes WHERE id = ?', u.id);
        if (!node) {
          i++;
          continue;
        }
        const hash = await sha256(node.body);
        const cached = this.one('SELECT hash FROM analysis_notes WHERE node_id = ?', u.id);
        if (cached?.hash === hash) {
          i++;
          continue;
        }
        const note = parseChapterNote(await this.callAI(chapterMessages(book.title, node.title, node.body), 1600));
        this.sql.exec('INSERT OR REPLACE INTO analysis_notes (node_id, hash, note, at) VALUES (?, ?, ?, ?)', u.id, hash, JSON.stringify(note), Date.now());
        i++;
        break;
      }
      return i >= st.units.length ? save('sections', 0) : save('chapters', i);
    }
    const blank: ChapterNote = { summary: '', characters: [], events: [], objects: [], places: [], motifs: [], lines: [] };
    const chapters = st.units.map((u) => ({ title: u.title, part: u.part, note: Object.assign({}, blank, parseJson(this.one('SELECT note FROM analysis_notes WHERE node_id = ?', u.id)?.note)) as ChapterNote }));
    if (job.phase === 'sections') {
      const sec = SECTIONS[job.step];
      if (!sec) return save('write', 0);
      let world = '';
      if (book.world_id) {
        const items = this.rows<{ data: string }>("SELECT data FROM witems WHERE world_id = ? AND type = 'entry' AND deleted IS NULL LIMIT 200", book.world_id).map((x) => parseJson(x.data) as { name?: string; summary?: string });
        world = items
          .filter((x) => x.name)
          .map((x) => `${x.name}: ${x.summary ?? ''}`)
          .join('\n')
          .slice(0, 4000);
      }
      const text = cleanSection(await this.callAI(sectionMessages(book.title, sec.key, digest(chapters, sec.key), world), sec.key === 'afterword' ? 3000 : 2400));
      st.sections[sec.key] = text;
      return save('sections', job.step + 1);
    }
    // 책으로 엮기
    const meta = parseJson(book.meta) as Record<string, unknown>;
    let aid = typeof meta.analysisBookId === 'string' ? meta.analysisBookId : '';
    const now = Date.now();
    if (aid && this.one('SELECT id FROM books WHERE id = ? AND owner = ? AND deleted IS NULL', aid, job.user_id)) {
      this.sql.exec('UPDATE nodes SET deleted = ? WHERE book_id = ? AND deleted IS NULL', now, aid);
      this.sql.exec('UPDATE books SET updated = ?, title = ? WHERE id = ?', now, `《${book.title}》 해설`, aid);
    } else {
      aid = newId();
      this.sql.exec(
        "INSERT INTO books (id, owner, kind, title, subtitle, author, color, meta, created, updated) VALUES (?, ?, 'write', ?, ?, ?, ?, ?, ?, ?)",
        aid,
        job.user_id,
        `《${book.title}》 해설`,
        '줄거리 · 인물 · 사건 · 물건 · 주제',
        'AI 해설 (검토 필요)',
        book.color ?? '',
        JSON.stringify({ analysisOf: book.id, template: 'analysis', coverStyle: 'minimal' }),
        now,
        now,
      );
      this.sql.exec('UPDATE books SET meta = ? WHERE id = ?', JSON.stringify({ ...meta, analysisBookId: aid }), book.id);
    }
    const parts: [string, string][] = [
      ['읽기 전에', `이 해설은 ${new Date().toISOString().slice(0, 10)}에 AI 가 《${book.title}》 원고 ${st.units.length}개 장을 읽고 쓴 것이에요. 원고에 있는 것만 근거로 쓰게 했지만, 잘못 읽은 곳이 있을 수 있으니 작가가 확인하고 고쳐 주세요. 이 책은 집필실에서 자유롭게 고칠 수 있어요.\n\n본문의 [숫자]는 「장별 줄거리」의 장 번호예요.`],
      ['작품 개요와 줄거리', st.sections.overview ?? ''],
      ['장별 줄거리', chapterSummaries(chapters)],
      ['인물 분석', st.sections.characters ?? ''],
      ['사건의 흐름', st.sections.events ?? ''],
      ['중요한 물건과 장소', st.sections.things ?? ''],
      ['주제와 모티프', st.sections.themes ?? ''],
      ['해설', st.sections.afterword ?? ''],
    ];
    parts.forEach(([title, body], k) =>
      this.sql.exec("INSERT INTO nodes (id, book_id, parent_id, kind, sort, title, body, chars, rev, updated) VALUES (?, ?, NULL, 'chapter', ?, ?, ?, ?, 1, ?)", newId(), aid, k + 1, title, body, charsNoSpace(body), now),
    );
    this.sql.exec("UPDATE analysis_jobs SET status = 'done', phase = 'done', step = total, updated = ? WHERE id = ?", now, job.id);
  }

  /** 작가에게: 친구가 공유본을 어디까지 읽었나 */
  private readers(user: UserRow, bookId: string) {
    this.ownBook(user, bookId);
    const rows = this.rows<{ user_id: string; data: string; at: number; nickname: string }>('SELECT p.user_id, p.data, p.at, u.nickname FROM progress p JOIN users u ON u.id = p.user_id WHERE p.key = ? AND p.user_id != ? ORDER BY p.at DESC', `e:${bookId}`, user.id);
    const titles = new Map(this.rows<{ node_id: string; title: string }>('SELECT DISTINCT en.node_id, en.title FROM edition_nodes en JOIN editions e ON e.id = en.edition_id WHERE e.book_id = ?', bookId).map((x) => [x.node_id, x.title]));
    return json({
      readers: rows.map((r) => {
        const d = parseJson(r.data) as { n?: string; f?: number };
        return { nickname: r.nickname, at: r.at, f: typeof d.f === 'number' ? d.f : 0, node_title: (d.n && titles.get(d.n)) || '' };
      }),
    });
  }
  private bookEditions(user: UserRow, bookId: string) {
    this.ownBook(user, bookId);
    return json({ editions: this.rows('SELECT id, number, note, chars, created FROM editions WHERE book_id = ? ORDER BY number DESC', bookId) });
  }
  private readableBook(user: UserRow, bookId: string) {
    const b = this.one<BookRow>('SELECT * FROM books WHERE id = ? AND deleted IS NULL', bookId);
    if (!b || (b.owner !== user.id && !b.shared)) throw new HttpError('책을 찾을 수 없어요.', 404);
    return b;
  }
  private ratingsOf(bookId: string) {
    return this.rows('SELECT r.stars, r.text, r.updated, r.user_id, u.nickname FROM ratings r JOIN users u ON u.id = r.user_id WHERE r.book_id = ? ORDER BY r.updated DESC', bookId);
  }
  private community(user: UserRow) {
    const books = this.rows(
      `SELECT b.id, b.owner, b.title, b.subtitle, b.author, b.color, b.world_id, b.share_world, u.nickname AS owner_name,
        e.id AS edition_id, e.number AS edition, e.created AS published, e.chars, e.note,
        (SELECT AVG(stars) FROM ratings r WHERE r.book_id = b.id) AS stars, (SELECT COUNT(*) FROM ratings r WHERE r.book_id = b.id) AS rating_count,
        (SELECT COUNT(*) FROM annotations a WHERE a.book_id = b.id AND a.deleted IS NULL) AS note_count
       FROM books b JOIN users u ON u.id = b.owner JOIN editions e ON e.book_id = b.id AND e.number = (SELECT MAX(number) FROM editions x WHERE x.book_id = b.id)
       WHERE b.shared = 1 AND b.deleted IS NULL ORDER BY e.created DESC`,
    );
    return json({ books, me: user.id });
  }
  private feed(user: UserRow) {
    const editions = this.rows(
      `SELECT e.id, e.book_id, e.number, e.title, e.created, e.note, u.nickname FROM editions e JOIN books b ON b.id = e.book_id JOIN users u ON u.id = b.owner
       WHERE b.shared = 1 AND b.deleted IS NULL ORDER BY e.created DESC LIMIT 20`,
    );
    const notes = this.rows(
      `SELECT a.id, a.book_id, a.edition_id, a.node_id, a.quote, a.body, a.created, a.parent_id, u.nickname, b.title FROM annotations a JOIN books b ON b.id = a.book_id JOIN users u ON u.id = a.author
       WHERE a.deleted IS NULL AND a.author != ? AND (b.owner = ? OR a.parent_id IN (SELECT id FROM annotations WHERE author = ?)) ORDER BY a.created DESC LIMIT 30`,
      user.id,
      user.id,
      user.id,
    );
    const ratings = this.rows(
      `SELECT r.book_id, r.stars, r.text, r.updated, u.nickname, b.title FROM ratings r JOIN books b ON b.id = r.book_id JOIN users u ON u.id = r.user_id
       WHERE b.owner = ? AND r.user_id != ? ORDER BY r.updated DESC LIMIT 20`,
      user.id,
      user.id,
    );
    return json({ editions, notes, ratings });
  }
  private getEdition(user: UserRow, id: string) {
    const e = this.one('SELECT * FROM editions WHERE id = ?', id);
    if (!e) return fail('판을 찾을 수 없어요.', 404);
    const book = this.readableBook(user, String(e.book_id));
    const nodes = this.rows('SELECT node_id AS id, sort, depth, kind, title, body FROM edition_nodes WHERE edition_id = ? ORDER BY sort', id);
    const editions = this.rows('SELECT id, number, note, created FROM editions WHERE book_id = ? ORDER BY number DESC', book.id);
    const likes = this.rows('SELECT node_id, COUNT(*) AS n, SUM(user_id = ?) AS mine FROM likes WHERE edition_id = ? GROUP BY node_id', user.id, id);
    const owner = this.one('SELECT nickname FROM users WHERE id = ?', book.owner);
    return json({
      edition: e,
      book: { id: book.id, title: book.title, owner: book.owner, owner_name: owner?.nickname ?? '', world_id: book.share_world ? book.world_id : null, mine: book.owner === user.id, blurb: str((parseJson(book.meta) as { blurb?: unknown }).blurb, 3000) },
      nodes,
      editions,
      likes,
      ratings: this.ratingsOf(book.id),
      annotations: this.annotationRows(book.id),
    });
  }
  private annotationRows(bookId: string) {
    return this.rows(
      `SELECT a.id, a.edition_id, a.node_id, a.quote, a.prefix, a.suffix, a.pos, a.body, a.author, a.parent_id, a.resolved, a.created, a.updated, u.nickname,
        (SELECT number FROM editions e WHERE e.id = a.edition_id) AS edition
       FROM annotations a LEFT JOIN users u ON u.id = a.author WHERE a.book_id = ? AND a.deleted IS NULL ORDER BY a.created`,
      bookId,
    );
  }
  private annotationsFor(user: UserRow, bookId: string) {
    this.ownBook(user, bookId);
    return json({ annotations: this.annotationRows(bookId) });
  }
  private annotate(user: UserRow, b: Body) {
    const e = this.one('SELECT * FROM editions WHERE id = ?', String(b.edition_id ?? ''));
    if (!e) return fail('판을 찾을 수 없어요.', 404);
    this.readableBook(user, String(e.book_id));
    const node = this.one('SELECT node_id FROM edition_nodes WHERE edition_id = ? AND node_id = ?', String(e.id), String(b.node_id ?? ''));
    if (!node) return fail('장을 찾을 수 없어요.', 404);
    const text = str(b.body, 5000).trim();
    if (!text) return fail('주석 내용을 적어 주세요.');
    let parent: string | null = null;
    if (b.parent_id) {
      const p = this.one('SELECT id, parent_id FROM annotations WHERE id = ? AND book_id = ?', String(b.parent_id), String(e.book_id));
      if (!p) return fail('답할 주석을 찾을 수 없어요.', 404);
      parent = String(p.parent_id ?? p.id);
    }
    const id = newId();
    const now = Date.now();
    this.sql.exec(
      'INSERT INTO annotations (id, book_id, edition_id, node_id, quote, prefix, suffix, pos, body, author, parent_id, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      String(e.book_id),
      String(e.id),
      String(node.node_id),
      str(b.quote, 1000),
      str(b.prefix, 64),
      str(b.suffix, 64),
      Math.max(0, Math.floor(num(b.pos))),
      text,
      user.id,
      parent,
      now,
      now,
    );
    return json({ id });
  }
  private patchAnnotation(user: UserRow, id: string, b: Body) {
    const a = this.one('SELECT a.*, b.owner AS owner FROM annotations a JOIN books b ON b.id = a.book_id WHERE a.id = ? AND a.deleted IS NULL', id);
    if (!a) return fail('주석을 찾을 수 없어요.', 404);
    if ('body' in b) {
      if (a.author !== user.id) return fail('내가 쓴 주석만 고칠 수 있어요.', 403);
      const text = str(b.body, 5000).trim();
      if (!text) return fail('주석 내용을 적어 주세요.');
      this.sql.exec('UPDATE annotations SET body = ?, updated = ? WHERE id = ?', text, Date.now(), id);
    }
    if ('resolved' in b) {
      if (a.owner !== user.id) return fail('작가만 「반영함」을 표시할 수 있어요.', 403);
      this.sql.exec('UPDATE annotations SET resolved = ? WHERE id = ?', b.resolved ? 1 : 0, id);
    }
    return json({ ok: true });
  }
  private deleteAnnotation(user: UserRow, id: string) {
    const a = this.one('SELECT a.*, b.owner AS owner FROM annotations a JOIN books b ON b.id = a.book_id WHERE a.id = ?', id);
    if (!a || (a.author !== user.id && a.owner !== user.id)) return fail('주석을 찾을 수 없어요.', 404);
    this.sql.exec('UPDATE annotations SET deleted = ? WHERE id = ? OR parent_id = ?', Date.now(), id, id);
    return json({ ok: true });
  }
  private rate(user: UserRow, bookId: string, b: Body) {
    const book = this.readableBook(user, bookId);
    if (book.owner === user.id) return fail('내 책은 평가할 수 없어요.', 403);
    const stars = Math.round(num(b.stars));
    if (stars === 0) {
      this.sql.exec('DELETE FROM ratings WHERE book_id = ? AND user_id = ?', bookId, user.id);
      return json({ ok: true });
    }
    if (stars < 1 || stars > 5) return fail('별점은 1~5 사이로 골라 주세요.');
    this.sql.exec('INSERT OR REPLACE INTO ratings (book_id, user_id, stars, text, updated) VALUES (?, ?, ?, ?, ?)', bookId, user.id, stars, str(b.text, 300), Date.now());
    return json({ ok: true });
  }
  private like(user: UserRow, b: Body) {
    const e = this.one('SELECT * FROM editions WHERE id = ?', String(b.edition_id ?? ''));
    if (!e) return fail('판을 찾을 수 없어요.', 404);
    this.readableBook(user, String(e.book_id));
    const nodeId = String(b.node_id ?? '');
    const had = this.one('SELECT 1 AS x FROM likes WHERE edition_id = ? AND node_id = ? AND user_id = ?', String(e.id), nodeId, user.id);
    if (had) this.sql.exec('DELETE FROM likes WHERE edition_id = ? AND node_id = ? AND user_id = ?', String(e.id), nodeId, user.id);
    else this.sql.exec('INSERT INTO likes (edition_id, node_id, user_id) VALUES (?, ?, ?)', String(e.id), nodeId, user.id);
    return json({ liked: !had });
  }
}
