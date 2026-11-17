import { describe, expect, it } from 'vitest';
import { endingOverlap, locate, newNames, recapMaterial, voiceStats, worldText } from './aitools';
import type { Entry } from './world';

const ent = (name: string, extra: Partial<Entry> = {}): Entry => ({ id: name, type: 'entry', kind: 'character', name, aliases: [], summary: '', body: '', fields: {}, tags: [], color: '', ...extra });

describe('인용 찾기', () => {
  it('그대로 · 띄어쓰기 차이 · 없음', () => {
    const body = '그는 문을\n열었다. 바람이 불었다.';
    expect(locate(body, '바람이 불었다')).toEqual({ at: 11, len: 7 });
    expect(locate(body, '문을 열었다')).toEqual({ at: 3, len: 6 });
    expect(locate(body, '비가 왔다')).toBeNull();
    expect(locate(body, '  ')).toBeNull();
  });
});

describe('세계관 자료 · 새 이름', () => {
  it('이 장에 나오는 항목을 먼저', () => {
    const t = worldText([ent('민우', { summary: '친구' }), ent('홍설', { fields: { 눈: '회색', 나이: '' } })], '홍설이 웃었다');
    expect(t.split('\n')[0]).toBe('- 홍설 / 눈: 회색');
    expect(t.split('\n')[1]).toBe('- 민우 / 친구');
  });
  it('원고에 실제로 나오고 세계관에 없는 이름만, 많이 나온 순', () => {
    const r = newNames(
      [
        { name: '홍설', kind: 'character', summary: '' },
        { name: '파빌리온', kind: 'place', summary: '' },
        { name: '없는이름', kind: 'character', summary: '' },
        { name: '설아', kind: 'character', summary: '' },
      ],
      [ent('홍설', { aliases: [] })],
      '홍설은 파빌리온에 갔다. 파빌리온은 조용했다. 설아가 왔다. %%없는이름%%',
    );
    expect(r.map((x) => `${x.name}${x.count}`)).toEqual(['파빌리온2', '설아1']);
  });
});

describe('대사 통계', () => {
  it('인물별 비율 · 끝맺음 · 모름', () => {
    const lines = [
      { id: 1, at: 0, text: '그랬거든. 정말이거든.', speaker: 'A' },
      { id: 2, at: 0, text: '알았어요.', speaker: 'B' },
      { id: 3, at: 0, text: '몰랐거든.', speaker: 'A' },
      { id: 4, at: 0, text: '음.', speaker: '' },
    ];
    const { voices, unknown } = voiceStats(lines);
    expect(unknown).toBe(1);
    expect(voices[0].speaker).toBe('A');
    expect(voices[0].share).toBe(0.5);
    expect(voices[0].endings[0]).toEqual({ e: '거든', n: 3 });
    expect(voices[1].endings[0].e).toBe('어요');
    expect(endingOverlap(voices[0], voices[1])).toBe(0);
    expect(endingOverlap(voices[0], voices[0])).toBe(1);
  });
});

describe('지난 이야기 자료', () => {
  const blocks = [
    { n: 'a', o: 0, text: '1장', head: true },
    { n: 'a', o: 0, text: '첫 장 글.' },
    { n: 'b', o: 0, text: '2장', head: true },
    { n: 'b', o: 0, text: '둘째 장 앞.' },
    { n: 'b', o: 7, text: '둘째 장 뒤 (아직 안 읽음).' },
    { n: 'c', o: 0, text: '셋째 장 (안 읽음).' },
  ];
  it('읽은 데까지만, 뒤 내용은 넣지 않는다', () => {
    const m = recapMaterial(blocks, ['a', 'b', 'c'], { n: 'b', o: 7 });
    expect(m).toBe('## 1장\n첫 장 글.\n\n## 2장\n둘째 장 앞.');
    expect(m).not.toContain('안 읽음');
  });
  it('길면 줄여도 멈춘 곳 바로 앞은 남긴다', () => {
    const long = [
      { n: 'a', o: 0, text: '가'.repeat(5000) + '앞끝' },
      { n: 'b', o: 0, text: '나'.repeat(5000) + '멈춘곳앞' },
      { n: 'b', o: 99999, text: '안 읽음' },
    ];
    const m = recapMaterial(long, ['a', 'b'], { n: 'b', o: 99999 }, 3000);
    expect(m.length).toBeLessThanOrEqual(3000);
    expect(m).toContain('멈춘곳앞');
    expect(m).toContain('앞끝');
    expect(m).not.toContain('안 읽음');
  });
  it('모르는 자리는 빈 글', () => {
    expect(recapMaterial(blocks, ['a'], { n: 'x', o: 0 })).toBe('');
  });
});
