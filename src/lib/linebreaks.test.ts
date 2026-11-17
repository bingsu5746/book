import { describe, expect, it } from 'vitest';
import { countBreaks, tidyBreaks } from './linebreaks';

const src = '첫 문장.\n둘째 문장.\n\n\n\n셋째 문장.\n“안녕.” 민우가 말했다.\n넷째 문장.\n\n***\n\n%%▸ 쪽 줄거리%%\n다섯째.\n%%여러\n줄 메모%%\n여섯째.';

describe('줄바꿈 정리', () => {
  it('빈 줄만 줄이기', () => {
    expect(tidyBreaks('가.\n나.\n\n\n\n다.  \n', 'blank')).toBe('가.\n나.\n\n다.\n');
  });
  it('한 번 친 엔터 잇기: 문단은 두고, 장면 나눔 · 메모 · 쪽 줄거리는 제 줄로', () => {
    expect(tidyBreaks(src, 'join')).toBe('첫 문장. 둘째 문장.\n\n셋째 문장. “안녕.” 민우가 말했다. 넷째 문장.\n\n***\n\n%%▸ 쪽 줄거리%%\n다섯째.\n%%여러\n줄 메모%%\n여섯째.');
  });
  it('엔터 모두 잇기 · 대사 따로', () => {
    expect(tidyBreaks('가.\n\n나.\n\n“안녕.”\n\n다.\n\n라.', 'all')).toBe('가. 나. “안녕.” 다. 라.');
    expect(tidyBreaks('가.\n\n나.\n\n“안녕.”\n\n다.\n\n라.', 'all', { dialogue: true })).toBe('가. 나.\n\n“안녕.”\n\n다. 라.');
    expect(tidyBreaks('# 제목\n가.\n나.', 'all')).toBe('# 제목\n\n가. 나.');
  });
  it('글자는 줄지 않는다 (공백 빼고)', () => {
    for (const m of ['blank', 'join', 'all'] as const) expect(tidyBreaks(src, m, { dialogue: true }).replace(/\s/g, '')).toBe(src.replace(/\s/g, ''));
    expect(countBreaks(tidyBreaks(src, 'all'))).toBeLessThan(countBreaks(src));
  });
});
