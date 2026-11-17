import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource/noto-serif-kr/400.css';
import '@fontsource/noto-serif-kr/600.css';
import './styles.css';
import { App } from './App';
import { local } from './lib/idb';

const theme = local.get<string>('theme', 'auto');
if (theme !== 'auto') document.documentElement.dataset.theme = theme;

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // 새 판이 배포되면 새 서비스 워커가 자리를 잡는다 → 「새로고침」 안내 (처음 설치할 때는 빼고)
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => had && dispatchEvent(new Event('app-update')));
  addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => setInterval(() => void reg.update().catch(() => {}), 30 * 60_000))
      .catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
