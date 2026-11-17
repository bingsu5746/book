import { describe, expect, it } from 'vitest';
import { cleanRecap, fakeTool, findDialogue, markDialogue, parseEdits, parseIssues, parseNames, parseQuestions, parseSpeakers, previousDigest, readJson } from './tools';

describe('대사 찾기', () => {
  const body = '홍설이 말했다. “안녕.” 민우는 「그래」 하고 웃었다.\n%%“메모 속 대사”%%\n"또 보자."';
  it('세 가지 따옴표, 주석 안은 뺀다', () => {
    const l = findDialogue(body);
    expect(l.map((x) => x.text)).toEqual(['안녕.', '그래', '또 보자.']);
    expect(body.slice(l[0].at, l[0].at + l[0].text.length)).toBe('안녕.');
  });
  it('번호 붙이기', () => {
    const l = findDialogue(body);
    const m = markDialogue(body, l);
    expect(m).toContain('⟦1⟧“안녕.”');
    expect(m).toContain('⟦2⟧「그래」');
    expect(m.replace(/⟦\d+⟧/g, '')).toBe(body);
  });
  it('화자: ? 와 빈 칸은 모름으로', () => {
    const l = findDialogue(body);
    const r = parseSpeakers({ speakers: { '1': '홍설', '2': '?' } }, l);
    expect(r.map((x) => x.speaker)).toEqual(['홍설', '', '']);
  });
});

describe('AI 답 읽기', () => {
  it('JSON 앞뒤 군말 · 생각 덩어리를 걷는다', () => {
    expect(readJson('<think>{"x":1}</think>답: {"a": [1]} 끝')).toEqual({ a: [1] });
    expect(readJson('없음')).toBeNull();
    expect(readJson('[1,2]')).toBeNull();
  });
  it('충돌 · 이름 · 퇴고 · 질문', () => {
    expect(parseIssues({ issues: [{ quote: 'a', problem: 'p', source: 's' }, { quote: 'b' }] })).toEqual([{ quote: 'a', problem: 'p', source: 's', sourceQuote: '' }]);
    expect(parseNames({ names: [{ name: '서울', kind: 'place' }, { name: '서울', kind: 'place' }, { name: '빛', kind: '마법' }] }).map((x) => `${x.name}:${x.kind}`)).toEqual(['서울:place', '빛:other']);
    expect(parseEdits({ edits: [{ before: '같다', after: '같다' }, { before: '가', after: '나', why: '리듬' }] })).toEqual([{ before: '가', after: '나', why: '리듬' }]);
    expect(parseQuestions({ questions: ['왜?', { q: '무엇을 원하지?', about: '홍설' }, 3] })).toEqual([
      { q: '왜?', about: '' },
      { q: '무엇을 원하지?', about: '홍설' },
    ]);
  });
  it('지난 이야기 다듬기', () => {
    expect(cleanRecap('## 지난 이야기\n\n- 첫 일.\n둘째.\n\n바로 앞에서는 끝.')).toBe('첫 일. 둘째.\n\n바로 앞에서는 끝.');
  });
});

describe('앞 장 자료', () => {
  it('가까운 장부터 담고 순서는 그대로, 줄거리가 없으면 앞부분', () => {
    const units = [
      { title: '1장', synopsis: '처음', body: '' },
      { title: '2장', synopsis: '', body: '둘째 장 원고' },
      { title: '3장', synopsis: '셋째', body: '' },
    ];
    const d = previousDigest(units);
    expect(d.indexOf('[1] 1장')).toBeLessThan(d.indexOf('[3] 3장'));
    expect(d).toContain('원고 앞부분: 둘째 장 원고');
    expect(previousDigest(units, 30)).toBe('[3] 3장\n줄거리: 셋째');
  });
});

describe('가짜 답 (개발용)', () => {
  it('도구마다 JSON 모양이 맞다', () => {
    expect(readJson(fakeTool('질문을 던지는 편집자', '')!)?.questions).toBeTruthy();
    const sp = readJson(fakeTool('대사의 화자를 가리는 편집자', '⟦1⟧“a” ⟦2⟧“b”')!);
    expect(Object.keys(sp!.speakers as object)).toEqual(['1', '2']);
    expect(fakeTool('다른 일', '')).toBeNull();
  });
});
