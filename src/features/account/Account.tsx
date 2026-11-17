import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { download } from '../../lib/exporters';
import { idb, local } from '../../lib/idb';
import { useSession } from '../../lib/session';
import { hasUnsaved } from '../../lib/store';
import { confirmBox, Icon, promptBox, toast } from '../../lib/ui';
import { today } from '../../lib/text';
import { restoreBackup } from '../../lib/restore';

export function Account() {
  const { user, setUser } = useSession();
  const [theme, setTheme] = useState(local.get<string>('theme', 'auto'));
  const [pw, setPw] = useState({ current: '', password: '' });
  const [restoring, setRestoring] = useState('');
  const [prefs, setPrefs] = useState<{ autoAnalysis?: boolean; [k: string]: unknown }>({});
  useEffect(() => {
    api<{ prefs: Record<string, unknown> }>('prefs')
      .then((r) => setPrefs(r.prefs ?? {}))
      .catch(() => {});
  }, []);

  const applyTheme = (t: string) => {
    setTheme(t);
    local.set('theme', t);
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  const logout = async (all = false) => {
    const n = await hasUnsaved();
    if (n && !(await confirmBox(`아직 서버에 못 보낸 원고가 ${n}개 있어요. 그래도 로그아웃할까요?`, { danger: true, ok: '로그아웃', detail: '로그아웃하면 이 기기에 남은 원고도 지워져요.' }))) return;
    await api(all ? 'auth/logout-all' : 'auth/logout', { body: {} }).catch(() => {});
    await idb.clear();
    local.set('lastUser', null);
    setUser(null);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>계정</h1>
          <p className="sub">
            {user.nickname} · 아이디 {user.username}
          </p>
        </div>
        <div className="actions">
          <a className="btn" href="#/search">
            <Icon name="search" size={16} />
            찾기
          </a>
          <button onClick={() => dispatchEvent(new Event('quick-jump'))}>
            <Icon name="command" size={16} />
            빠른 이동
          </button>
          <a className="btn" href="#/lines">
            밑줄 모음
          </a>
          <a className="btn" href="#/jots">
            수첩
          </a>
        </div>
      </div>
      <div className="stack" style={{ maxWidth: 560 }}>
        <section className="panel stack">
          <h3 className="serif">화면</h3>
          <div className="seg">
            {[
              ['auto', '기기 설정 따르기'],
              ['light', '밝게'],
              ['dark', '어둡게'],
            ].map(([k, l]) => (
              <button key={k} className={theme === k ? 'on' : ''} onClick={() => applyTheme(k)}>
                {l}
              </button>
            ))}
          </div>
        </section>
        <section className="panel stack">
          <h3 className="serif">분석집</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.autoAnalysis !== false}
              onChange={async (e) => {
                const next = { ...prefs, autoAnalysis: e.target.checked };
                setPrefs(next);
                await api('prefs', { method: 'PUT', body: { prefs: next } }).catch((x) => toast((x as Error).message, 'err'));
              }}
            />
            「다 썼어요」를 누르거나 판을 찍을 때 AI 분석집 자동으로 만들기
          </label>
          <p className="muted small">AI 가 원고 전체를 읽고 줄거리 · 인물 · 사건 · 물건 · 주제 · 해설을 담은 책을 만들어요. 책마다 집필실 「책 설정」에서 직접 만들 수도 있어요.</p>
        </section>
        <section className="panel stack">
          <h3 className="serif">닉네임</h3>
          <button
            onClick={async () => {
              const v = await promptBox('새 닉네임', user.nickname);
              if (!v) return;
              try {
                const r = await api('me/nickname', { body: { nickname: v } });
                setUser(r.user);
                toast('닉네임을 바꿨어요');
              } catch (e) {
                toast((e as Error).message, 'err');
              }
            }}
          >
            닉네임 바꾸기
          </button>
        </section>
        <section className="panel stack">
          <h3 className="serif">비밀번호 바꾸기</h3>
          <input className="input" type="password" placeholder="지금 비밀번호" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <input className="input" type="password" placeholder="새 비밀번호 (8자 이상)" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
          <div>
            <button
              className="primary"
              disabled={!pw.current || !pw.password}
              onClick={async () => {
                try {
                  await api('me/password', { body: pw });
                  setPw({ current: '', password: '' });
                  toast('비밀번호를 바꿨어요. 다른 기기는 로그아웃됐어요.');
                } catch (e) {
                  toast((e as Error).message, 'err');
                }
              }}
            >
              바꾸기
            </button>
          </div>
        </section>
        <section className="panel stack">
          <h3 className="serif">내 자료</h3>
          <p className="muted small">책 · 원고 · 세계관 · 읽던 자리 · 책갈피를 파일 하나(.json)로 내려받아요.</p>
          <div>
            <button
              onClick={async () => {
                try {
                  const r = await api('me/export');
                  download(`서재-백업-${today()}.json`, JSON.stringify(r, null, 1), 'application/json');
                  local.set('lastBackup', Date.now());
                } catch (e) {
                  toast((e as Error).message, 'err');
                }
              }}
            >
              <Icon name="download" size={16} />
              전부 내려받기
            </button>
          </div>
          <p className="muted small">백업 파일로 되살리면 책 · 원고 · 세계관이 새 사본으로 더해져요 (지금 있는 것은 그대로). 그림(초상 · 지도)은 백업에 들어가지 않아요.</p>
          <div>
            <label className="btn">
              <Icon name="upload" size={16} />
              {restoring || '백업에서 되살리기'}
              <input
                type="file"
                accept=".json,application/json"
                hidden
                disabled={!!restoring}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  let data: unknown;
                  try {
                    data = JSON.parse(await f.text());
                  } catch {
                    return toast('JSON 파일을 읽지 못했어요.', 'err');
                  }
                  const d = data as { books?: unknown[]; worlds?: unknown[] };
                  if (!(await confirmBox(`책 ${d.books?.length ?? 0}권 · 세계 ${d.worlds?.length ?? 0}개를 새 사본으로 되살릴까요?`, { ok: '되살리기' }))) return;
                  try {
                    const r = await restoreBackup(data, setRestoring);
                    toast(`책 ${r.books}권 · 세계 ${r.worlds}개를 되살렸어요${r.skippedImages ? ` (그림 ${r.skippedImages}개는 빠졌어요)` : ''}`);
                  } catch (err) {
                    toast((err as Error).message, 'err');
                  } finally {
                    setRestoring('');
                  }
                }}
              />
            </label>
          </div>
        </section>
        <section className="panel stack">
          <h3 className="serif">로그아웃</h3>
          <div className="row wrap">
            <button onClick={() => logout(false)}>이 기기에서 로그아웃</button>
            <button onClick={() => logout(true)}>모든 기기에서 로그아웃</button>
          </div>
        </section>
        <section className="panel stack">
          <h3 className="serif">계정 지우기</h3>
          <p className="muted small">내 책 · 원고 · 세계관 · 기록이 모두 지워지고 되돌릴 수 없어요. 먼저 「전부 내려받기」로 백업해 두세요.</p>
          <div>
            <button
              className="danger"
              onClick={async () => {
                const p = await promptBox('비밀번호를 넣으면 계정이 지워져요', '', { ok: '계정 지우기' });
                if (!p) return;
                try {
                  await api('me/delete', { body: { password: p } });
                  await idb.clear();
                  setUser(null);
                } catch (e) {
                  toast((e as Error).message, 'err');
                }
              }}
            >
              계정 지우기
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
