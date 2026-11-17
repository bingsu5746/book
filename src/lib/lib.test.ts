import { describe, expect, it } from 'vitest';
import { splitMarkdown, chunk } from './split';
import { analyze, sentences, stem } from './analyze';
import { findAnchor, makeAnchor } from './anchor';
import { decodeText, normalizePlain } from './importers';
import { charsNoSpace, manuscriptPages, plain } from './text';

describe('들이기: 제목으로 나누기', () => {
  it('맨 앞 # 은 책 제목, # 은 부, ## 은 장 (아티팩트의 「새벽을 건너는 꿈」 모양)', () => {
    const r = splitMarkdown('# 책\n\n# 1부 아침\n\n## 1. 첫 장\n\n가\n\n## 2. 둘째\n\n나\n\n# 2부 밤\n\n## 3. 셋째\n\n다');
    expect(r.title).toBe('책');
    expect(r.nodes.map((n) => `${n.kind}:${n.title}`)).toEqual(['part:1부 아침', 'chapter:1. 첫 장', 'chapter:2. 둘째', 'part:2부 밤', 'chapter:3. 셋째']);
    const part2 = r.nodes.find((n) => n.title === '2부 밤')!;
    expect(r.nodes.find((n) => n.title === '3. 셋째')!.parent_tmp).toBe(part2.tmp);
  });
  it('제목이 한 단계면 모두 장', () => {
    const r = splitMarkdown('## 가\n\n하나\n\n## 나\n\n둘', '파일');
    expect(r.title).toBe('파일');
    expect(r.nodes.map((n) => n.kind)).toEqual(['chapter', 'chapter']);
  });
  it('제목 기호가 없으면 「제1장」 같은 줄로 나눈다', () => {
    const r = splitMarkdown('머리말\n\n제1장 시작\n\n본문 하나\n\n제2장 끝\n\n본문 둘', 'old');
    expect(r.nodes.map((n) => n.title)).toEqual(['들어가며', '제1장 시작', '제2장 끝']);
  });
  it('아무 표시도 없으면 한 장', () => {
    expect(splitMarkdown('그냥 글', '제목').nodes).toHaveLength(1);
  });
  it('너무 긴 장은 문단 경계에서 자른다', () => {
    const parts = chunk('가'.repeat(60) + '\n\n' + '나'.repeat(60), 100);
    expect(parts).toEqual(['가'.repeat(60), '나'.repeat(60)]);
  });
});

describe('글자 파일 읽기', () => {
  it('UTF-8 과 EUC-KR 을 모두 읽는다', () => {
    expect(decodeText(new TextEncoder().encode('한글').buffer)).toBe('한글');
    // "한글" 을 EUC-KR 로 쓴 바이트
    expect(decodeText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]).buffer)).toBe('한글');
  });
  it('빈 줄이 없는 옛 txt 는 줄마다 문단', () => {
    expect(normalizePlain('가\n나\n다')).toBe('가\n\n나\n\n다');
  });
});

describe('글자 세기', () => {
  it('마크다운 기호 · 작가 메모 · 세계관 링크', () => {
    expect(plain('**굵게** [[홍설|설이]] %%메모%%[[엄마]]')).toBe('굵게 설이 엄마');
    expect(charsNoSpace('가 나')).toBe(2);
    expect(manuscriptPages('가'.repeat(201))).toBe(2);
  });
});

describe('주석 자리 찾기', () => {
  it('판이 바뀌어 위치가 밀려도 같은 문장을 찾는다', () => {
    const old = '앞글. 그녀는 웃었다. 뒷글. 그녀는 웃었다. 끝.';
    const i = old.lastIndexOf('그녀는 웃었다');
    const a = makeAnchor(old, i, i + 7);
    const next = '새로 넣은 문장. ' + old;
    const r = findAnchor(next, a)!;
    expect(next.slice(r.start, r.end)).toBe('그녀는 웃었다');
    expect(r.start).toBe(next.lastIndexOf('그녀는 웃었다'));
  });
  it('문장이 사라졌으면 못 찾는다', () => {
    expect(findAnchor('다른 글', makeAnchor('그녀는 웃었다', 0, 3))).toBeNull();
  });
});

describe('퇴고 도우미', () => {
  it('조사를 떼어 같은 말로 센다', () => {
    expect(stem('고양이가')).toBe('고양이');
    expect(stem('꽃밭에서')).toBe('꽃밭');
  });
  it('문장 나누기 · 가까운 반복 · 대사 비율', () => {
    expect(sentences('하나. 둘? 셋!').map((s) => s.text)).toEqual(['하나.', '둘?', '셋!']);
    const a = analyze('꽃밭에 섰다. 꽃밭은 넓었다. "어디 가?" 그녀가 물었다.');
    expect(a.nearRepeats.some((r) => r.w === '꽃밭')).toBe(true);
    expect(a.dialogueShare).toBeGreaterThan(0);
    expect(a.sentenceCount).toBe(4);
  });
});

import { findAll, replaceAll } from './replace';
describe('책 전체 찾아 바꾸기', () => {
  it('글 그대로 찾아 바꾼다 (정규식 기호도 글자로)', () => {
    expect(replaceAll('홍설은 홍설이다. a.b', '홍설', '설이', { regex: false, ignoreCase: false })).toBe('설이은 설이이다. a.b');
    expect(findAll('a.b axb', 'a.b', { regex: false, ignoreCase: false })).toHaveLength(1);
  });
  it('정규식 · 대소문자 무시', () => {
    expect(replaceAll('Cat cat', 'c(a)t', 'd$1g', { regex: true, ignoreCase: true })).toBe('dag dag');
    expect(findAll('x', '(', { regex: true, ignoreCase: false })).toEqual([]);
  });
});

import { parseBulk } from './world';
describe('세계관 항목 한꺼번에 넣기', () => {
  it('여러 모양의 줄을 읽는다', () => {
    expect(parseBulk('- 홍설 - 꿈속 주인공\n지우: 친구\n2. 엄마\n엄마 | 어머니, 엄마 | 홍설의 엄마\n\n')).toEqual([
      { name: '홍설', aliases: [], summary: '꿈속 주인공' },
      { name: '지우', aliases: [], summary: '친구' },
      { name: '엄마', aliases: [], summary: '' },
      { name: '엄마', aliases: ['어머니', '엄마'], summary: '홍설의 엄마' },
    ]);
  });
  it('이름 속 붙임표는 나누지 않는다', () => {
    expect(parseBulk('X-23 - 실험체')).toEqual([{ name: 'X-23', aliases: [], summary: '실험체' }]);
  });
});

import { checkSpelling } from './spell';
const fixAll = (t: string) => {
  let s = t;
  for (let k = 0; k < 20; k++) {
    const i = checkSpelling(s).filter((x) => x.kind !== '확인')[0];
    if (!i) break;
    s = s.slice(0, i.from) + i.fix + s.slice(i.to);
  }
  return s;
};
describe('맞춤법 검사 (기본 규칙)', () => {
  it('자주 틀리는 말', () => {
    expect(fixAll('그렇게 되요. 몇일 뒤에 할께요.')).toBe('그렇게 돼요. 며칠 뒤에 할게요.');
    expect(fixAll('오랫만에 일일히 깨끗히 했다.')).toBe('오랜만에 일일이 깨끗이 했다.');
    expect(fixAll('그건 내 거에요. 학생이였다.')).toBe('그건 내 거예요. 학생이었다.');
    expect(fixAll('갈꺼야')).toBe('갈 거야');
  });
  it('띄어쓰기', () => {
    expect(fixAll('할수있다. 할 수있다. 할 수 있다.')).toBe('할 수 있다. 할 수 있다. 할 수 있다.');
    expect(fixAll('그럴것같다. 안하고 싶다. 편안하다.')).toBe('그럴 것 같다. 안 하고 싶다. 편안하다.');
    expect(fixAll('끝났다.그리고  갔다.')).toBe('끝났다. 그리고 갔다.');
  });
  it('문장 부호', () => {
    expect(fixAll('글쎄... 그래 .')).toBe('글쎄… 그래.');
  });
  it('틀리지 않은 말은 건드리지 않는다', () => {
    const ok = '선생님께 갔다. 불을 꺼야 한다. 그녀는 웃었다. 3.5배. “안녕.” 그가 말했다. 안하무인이다. 수있는 [[홍설께]] %%할께%%';
    expect(checkSpelling(ok).filter((x) => x.kind !== '확인').map((x) => x.text)).toEqual([]);
  });
  it('따옴표 짝', () => {
    expect(checkSpelling('“안녕 그가 말했다.').some((x) => x.rule === 'quote')).toBe(true);
  });
});
