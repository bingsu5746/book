// 책마다 기억하는 인쇄 설정 (pdf-lib 없이 불러올 수 있게 따로 둔다)
import type { PrintOptions } from './layout';

export interface PrintSettings {
  size: PrintOptions['size'];
  font: PrintOptions['font'];
  rightStart: boolean;
  heads: boolean;
  noteStyle: PrintOptions['noteStyle'];
  multipleOf4: boolean;
  bleed: boolean;
}
export const DEFAULT_PRINT: PrintSettings = { size: 'sinkook', font: 'normal', rightStart: true, heads: true, noteStyle: 'star', multipleOf4: true, bleed: false };
export function printSettingsOf(meta: Record<string, unknown> | undefined): PrintSettings {
  const p = (meta?.print && typeof meta.print === 'object' ? meta.print : {}) as Partial<PrintSettings>;
  return { ...DEFAULT_PRINT, ...p };
}
