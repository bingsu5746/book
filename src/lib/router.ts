import { useEffect, useState } from 'react';

/** 주소의 # 뒤 (예: #/studio/abc → ['studio', 'abc']) */
export function parseHash(h = location.hash): { parts: string[]; query: URLSearchParams } {
  const raw = h.replace(/^#\/?/, '');
  const [p, q] = raw.split('?');
  return { parts: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q ?? '') };
}

export function useRoute() {
  const [r, setR] = useState(() => parseHash());
  useEffect(() => {
    const on = () => setR(parseHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

export const go = (path: string) => {
  location.hash = '#/' + path.replace(/^\/+/, '');
};
