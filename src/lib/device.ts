// 이 기기를 부르는 이름 · 표시 (다른 기기에서 쓰던 자리를 알려 줄 때)
import { local } from './idb';

export function deviceId(): string {
  let id = local.get<string>('deviceId', '');
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
    local.set('deviceId', id);
  }
  return id;
}
export function deviceLabel(ua = navigator.userAgent): string {
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return '태블릿';
  if (/iPhone|Android|Mobile/i.test(ua)) return '폰';
  return '컴퓨터';
}
