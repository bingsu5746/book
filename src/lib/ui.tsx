import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

// ---------- 아이콘 (가는 선) ----------
const P: Record<string, string> = {
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 5.2l3.8-1 3.2 15.6-3.8.9z',
  pen: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  people: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.5a3.3 3.3 0 010 6.3M18 14.8c2 .6 3.3 2.4 3.6 5.2',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c.8-4 4-6 8-6s7.2 2 8 6',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  book: 'M5 4h10a4 4 0 014 4v12H9a4 4 0 01-4-4zM5 16a4 4 0 014-4h10',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  note: 'M5 4h14v12l-4 4H5zM15 20v-4h4',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  focus: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  share: 'M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  heart: 'M12 20s-7-4.4-9-9.2C1.6 7.3 4 4 7.3 4c2 0 3.6 1.1 4.7 2.7C13.1 5.1 14.7 4 16.7 4 20 4 22.4 7.3 21 10.8 19 15.6 12 20 12 20z',
  comment: 'M4 5h16v11H9l-5 4z',
  history: 'M3 12a9 9 0 103-6.7L3 8M3 3v5h5M12 7v5l3 2',
  compass: 'M12 3a9 9 0 100 18 9 9 0 000-18zM15.5 8.5l-2 5-5 2 2-5z',
  type: 'M5 6V4h14v2M12 4v16M9 20h6',
  check: 'M5 12l5 5L20 7',
  timer: 'M12 8v5l3 2M9 2h6M12 22a9 9 0 100-18 9 9 0 000 18z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
};
export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">
      <path d={P[name] ?? ''} />
    </svg>
  );
}

// ---------- 알림(토스트) ----------
type ToastFn = (msg: string, kind?: 'ok' | 'err') => void;
let pushToast: ToastFn = () => {};
export const toast: ToastFn = (m, k) => pushToast(m, k);
export function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string; kind: string }[]>([]);
  useEffect(() => {
    let n = 0;
    pushToast = (msg, kind = 'ok') => {
      const id = ++n;
      setItems((x) => [...x.slice(-2), { id, msg, kind }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 5000 : 2800);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ---------- 창(모달) ----------
export function Modal({ title, onClose, children, wide, foot }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; foot?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button.primary')?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => {
      removeEventListener('keydown', k);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

/** 확인 창 (Promise) */
export function confirmBox(message: string, opts: { ok?: string; danger?: boolean; detail?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: boolean) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(
      <Modal
        title={message}
        onClose={() => done(false)}
        foot={
          <>
            <button onClick={() => done(false)}>그만두기</button>
            <button className={opts.danger ? 'danger primary' : 'primary'} onClick={() => done(true)}>
              {opts.ok ?? '확인'}
            </button>
          </>
        }
      >
        {opts.detail && <p className="muted">{opts.detail}</p>}
      </Modal>,
    );
  });
}

/** 글 한 줄 묻기 */
export function promptBox(title: string, initial = '', opts: { ok?: string; placeholder?: string; multiline?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: string | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    function Body() {
      const [v, setV] = useState(initial);
      return (
        <Modal
          title={title}
          onClose={() => done(null)}
          foot={
            <>
              <button onClick={() => done(null)}>그만두기</button>
              <button className="primary" onClick={() => done(v)}>
                {opts.ok ?? '확인'}
              </button>
            </>
          }
        >
          {opts.multiline ? (
            <textarea className="input" rows={5} value={v} placeholder={opts.placeholder} onChange={(e) => setV(e.target.value)} />
          ) : (
            <input className="input" value={v} placeholder={opts.placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && done(v)} />
          )}
        </Modal>
      );
    }
    root.render(<Body />);
  });
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="muted">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Spinner({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="dot" />
      {label}
    </div>
  );
}

/** 세부 메뉴: PC 는 왼쪽 세로, 폰은 아래 가로 (life 지침과 같게) */
export function SubNav<T extends string>({ items, value, onChange }: { items: { id: T; label: string; icon?: string; badge?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <nav className="subnav" aria-label="세부 메뉴">
      {items.map((i) => (
        <button key={i.id} className={i.id === value ? 'on' : ''} aria-current={i.id === value ? 'page' : undefined} onClick={() => onChange(i.id)}>
          {i.icon && <Icon name={i.icon} size={16} />}
          <span>{i.label}</span>
          {!!i.badge && <em className="badge">{i.badge}</em>}
        </button>
      ))}
    </nav>
  );
}

/** 바깥을 누르면 닫히는 작은 메뉴 */
export function Menu({ label, children, icon = 'more' }: { label: string; children: (close: () => void) => ReactNode; icon?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      removeEventListener('keydown', k);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={icon} />
      </button>
      {open && <div className="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void; setData: (v: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), setData };
}
