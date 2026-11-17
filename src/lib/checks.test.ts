import { describe, expect, it } from 'vitest';
import { applyFixes, findTraces } from './traces';
import { distance, findVariants, jamo, replaceVariant } from './namecheck';

describe('AI 말투 흔적', () => {
  it('대화체 · 기호 · 따옴표 · 이모지를 찾고, 메모 · 링크 안은 뺀다', () => {
    const body = '물론이죠! 다음은 수정한 버전입니다.\n\n**그날** 아침 [[홍설]]은 웃었다 😊\n- 첫째 줄\n\n"안녕." 그가 말했다. "또 봐."\n\n%%물론이죠 메모%%\n\n* * *\n\nSure, here is the next scene.';
    const t = findTraces(body);
    const kinds = t.map((x) => `${x.kind}:${x.text}`);
    expect(kinds).toContain('chat:물론이죠');
    expect(kinds).toContain('md:**그날**');
    expect(kinds).toContain('md:-');
    expect(kinds).toContain('emoji:😊');
    expect(kinds.filter((k) => k.startsWith('quote'))).toHaveLength(4);
    expect(kinds.some((k) => k.startsWith('english'))).toBe(true);
    expect(kinds.filter((k) => k === 'chat:물론이죠')).toHaveLength(1);
    expect(kinds.filter((k) => k.startsWith('bracket'))).toHaveLength(0);
  });
  it('고칠 수 있는 것만 고친다: 따옴표는 문단마다 여닫기', () => {
    const body = '"안녕." 그가 말했다. "또 봐."\n\n"응"\n\n**굵게** 1. 줄';
    expect(applyFixes(body, findTraces(body))).toBe('“안녕.” 그가 말했다. “또 봐.”\n\n“응”\n\n굵게 1. 줄');
  });
});

describe('이름 표기 흔들림', () => {
  it('자모 거리', () => {
    expect(distance(jamo('홍설'), jamo('홍셜'))).toBe(1);
    expect(distance(jamo('파빌리온'), jamo('파빌온'))).toBe(2);
  });
  const entries = [
    { id: 'a', name: '홍설', aliases: ['설이'] },
    { id: 'b', name: '파빌리온', aliases: [] },
    { id: 'c', name: '민우', aliases: [] },
  ];
  it('세계관 이름과 조금 다른 표기만, 장별로 센다', () => {
    const v = findVariants(
      [
        { id: 'n1', body: '홍설은 웃었다. 홍셜이 울었다. 파빌리언에 갔다. 설이가 왔다.' },
        { id: 'n2', body: '홍셜은 다시 파빌리온에 갔다. 민수가 따라왔다. %%홍셜 메모%%' },
      ],
      entries,
    );
    expect(v.map((x) => `${x.variant}>${x.name}:${x.count}`)).toEqual(['홍셜>홍설:2', '파빌리언>파빌리온:1', '민수>민우:1']);
    expect(v[0].where).toEqual({ n1: 1, n2: 1 });
    expect(v[2].josa).toBe(false);
  });
  it('무시 목록 · 다른 항목 이름은 뺀다', () => {
    const v = findVariants([{ id: 'n', body: '민수와 민우. 홍셜.' }], [...entries, { id: 'd', name: '민수', aliases: [] }], ['홍셜']);
    expect(v).toEqual([]);
  });
  it('낱말 머리만 바꾼다', () => {
    expect(replaceVariant('홍셜이 왔다. 김홍셜. 홍셜', '홍셜', '홍설')).toBe('홍설이 왔다. 김홍셜. 홍설');
  });
});

import { clueMarker, collectClues, markerSpot } from './clues';
describe('복선 장부', () => {
  it('깐 곳 · 거둔 곳을 이름으로 모은다', () => {
    const c = collectClues([
      { id: 'a', body: '은열쇠가 있었다.%%복선: 은열쇠 - 할머니 것%% 그리고 %%떡밥:편지%%' },
      { id: 'b', body: '문이 열렸다. %%회수: 은열쇠%%' },
    ]);
    expect(c).toEqual([
      { name: '은열쇠', plants: [{ nodeId: 'a', at: 9, note: '할머니 것' }], payoffs: [{ nodeId: 'b', at: 8, note: '' }] },
      { name: '편지', plants: [{ nodeId: 'a', at: 33, note: '' }], payoffs: [] },
    ]);
  });
  it('표시는 인용이 든 문장 끝에', () => {
    const body = '그녀는 은열쇠를 쥐었다. 바람이 불었다.';
    expect(body.slice(0, markerSpot(body, 4, 3))).toBe('그녀는 은열쇠를 쥐었다.');
    expect(clueMarker('payoff', '편지')).toBe('%%회수: 편지%%');
  });
});
