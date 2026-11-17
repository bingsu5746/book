import { useState } from 'react';
import { api } from '../../lib/api';
import type { User } from '../../lib/types';

export function AuthScreen({ onDone, inviteOpen }: { onDone: (u: User) => void; inviteOpen: boolean }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [f, setF] = useState({ username: '', password: '', nickname: '', invite: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ user: User }>(mode === 'login' ? 'auth/login' : 'auth/signup', { body: f });
      onDone(r.user);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-art">
        <h1>서재</h1>
        <p>
          쓰고, 세계를 짓고,
          <br />
          어디서든 이어 읽는 곳.
        </p>
      </div>
      <div className="auth-form">
        <form onSubmit={submit}>
          <h2>{mode === 'login' ? '로그인' : '가입하기'}</h2>
          <label className="field">
            아이디
            <input className="input" autoComplete="username" value={f.username} onChange={set('username')} required />
          </label>
          <label className="field">
            비밀번호
            <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={set('password')} required />
          </label>
          {mode === 'signup' && (
            <>
              <label className="field">
                닉네임 (친구에게 보이는 이름)
                <input className="input" value={f.nickname} onChange={set('nickname')} />
              </label>
              <label className="field">
                초대 코드
                <input className="input" value={f.invite} onChange={set('invite')} required />
              </label>
              {!inviteOpen && <p className="note-box">아직 초대 코드가 정해지지 않아 가입할 수 없어요. 사이트 주인이 Cloudflare 에서 INVITE_CODE 를 정하면 열립니다.</p>}
              <p className="muted tiny">아이디는 3~16자 한글·영문·숫자·_, 비밀번호는 8자 이상이에요. 이메일은 받지 않아요.</p>
            </>
          )}
          {err && <div className="error-box">{err}</div>}
          <button className="primary" disabled={busy} style={{ justifyContent: 'center', padding: '10px' }}>
            {busy ? '잠시만요…' : mode === 'login' ? '로그인' : '가입하기'}
          </button>
          <button
            type="button"
            className="ghost"
            style={{ justifyContent: 'center' }}
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setErr('');
            }}
          >
            {mode === 'login' ? '초대받았나요? 가입하기' : '이미 계정이 있어요'}
          </button>
        </form>
      </div>
    </div>
  );
}
