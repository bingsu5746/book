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

import { matterNodes } from './matter';
describe('앞붙이 · 뒷붙이', () => {
  it('헌사는 앞에, 작가의 말 · 판권면은 뒤에. 글은 이스케이프', () => {
    const r = matterNodes({ title: '새벽', author: '홍', meta: { matter: { dedication: '엄마에게 <3', afterword: '고마워요.', colophon: true } } }, { number: 2, date: '2026-11-17' });
    expect(r.front).toEqual([{ id: 'm-dedication', kind: 'scene', depth: 0, title: '', body: '<div class="dedication"><p>엄마에게 &lt;3</p></div>' }]);
    expect(r.back.map((n) => n.id)).toEqual(['m-afterword', 'm-colophon']);
    expect(r.back[1].body).toBe('<div class="colophon"><p>새벽</p><p>지은이 홍</p><p>2판 · 2026-11-17</p></div>');
  });
  it('비어 있으면 아무것도 붙이지 않는다', () => {
    expect(matterNodes({ title: 't', author: '', meta: {} }, { date: 'd' })).toEqual({ front: [], back: [] });
  });
});

import { agesInChapter, agesSaid, birthYear, koreanNumber, yearIn } from './ages';
describe('인물 나이', () => {
  it('연도 · 태어난 해 · 한글 수', () => {
    expect(yearIn('1998년 겨울')).toBe(1998);
    expect(yearIn('제국력 312년')).toBe(312);
    expect(yearIn('새벽')).toBeNull();
    expect(birthYear({ '태어난 해': '1981' })).toBe(1981);
    expect(birthYear({ 나이: '17 (1981년생)' })).toBe(1981);
    expect(birthYear({ 나이: '17' })).toBeNull();
    expect(koreanNumber('열일곱')).toBe(17);
    expect(koreanNumber('스무')).toBe(20);
    expect(koreanNumber('서른다섯')).toBe(35);
  });
  it('이름과 같은 문장의 「…살」만, 어긋나면 알린다', () => {
    expect(agesSaid('홍설은 열일곱 살이었다. 민우는 스무 살.', ['홍설']).map((x) => x.age)).toEqual([17]);
    const r = agesInChapter(1998, [{ name: '홍설', aliases: [], fields: { '태어난 해': '1981년' } }, { name: '민우', aliases: [], fields: {} }], '홍설은 열일곱 살이었다. 홍설은 스무 살 같았다.');
    expect(r).toHaveLength(1);
    expect(r[0].age).toBe(17);
    expect(r[0].mismatch.map((m) => m.age)).toEqual([20]);
  });
});

import { storyRoute } from './route';
describe('이야기 이동 경로', () => {
  it('장 순서대로, 같은 곳이 이어지면 한 점, 핀이 없는 장소는 따로', () => {
    const r = storyRoute(
      [
        { id: 'a', title: '1장', place: '파빌리온' },
        { id: 'b', title: '2장', place: '파빌리온' },
        { id: 'c', title: '3장', place: '숲' },
        { id: 'd', title: '4장', place: '' },
        { id: 'e', title: '5장', place: '바다' },
        { id: 'f', title: '6장', place: '정자' },
      ],
      [
        { id: 'p1', x: 0.1, y: 0.2, entry: 'e1', label: '' },
        { id: 'p2', x: 0.5, y: 0.5, entry: '', label: '숲' },
      ],
      [{ id: 'e1', name: '파빌리온', aliases: ['정자'] }],
    );
    expect(r.points.map((p) => `${p.pinId}:${p.chapters.map((c) => c.i).join(',')}`)).toEqual(['p1:1,2', 'p2:3', 'p1:6']);
    expect(r.missing).toEqual([{ i: 5, title: '5장', place: '바다' }]);
  });
});

import { isSeedJot, SEEDS, seedJotText, seedOfDay, splitSeedJot } from './seeds';
describe('오늘의 글감 질문', () => {
  it('같은 날은 같은 질문, 날이 바뀌면 다른 질문, 종류를 고르면 그 종류에서', () => {
    const t = new Date('2026-11-18T12:00:00').getTime();
    expect(seedOfDay(t)).toBe(seedOfDay(t + 3600_000));
    expect(seedOfDay(t)).not.toBe(seedOfDay(t + 86_400_000));
    expect(seedOfDay(t, '', 1)).not.toBe(seedOfDay(t, '', 0));
    expect(SEEDS[seedOfDay(t, 'place')].kind).toBe('place');
  });
  it('질문 은행: 중복 없고 모두 물음 · 종류마다 10개', () => {
    expect(new Set(SEEDS.map((s) => s.q)).size).toBe(SEEDS.length);
    expect(SEEDS.every((s) => /[?.]$/.test(s.q))).toBe(true);
    const per: Record<string, number> = {};
    for (const s of SEEDS) per[s.kind] = (per[s.kind] ?? 0) + 1;
    expect(SEEDS.length).toBe(80);
    expect(Object.values(per).every((n) => n === 10)).toBe(true);
  });
  it('수첩 글로 적고 다시 나눈다', () => {
    const t = seedJotText('왜?', ' 그래서.\n둘째 줄 ');
    expect(isSeedJot(t)).toBe(true);
    expect(isSeedJot('그냥 메모')).toBe(false);
    expect(splitSeedJot(t)).toEqual({ q: '왜?', a: '그래서.\n둘째 줄' });
  });
});

import { forecast } from './forecast';
import { backwards, chapterTimes, findTimeWords } from './timewords';
import { emptyFieldQuestions } from './askfields';
import { groupBySeries, seriesOf } from './series';
describe('완성 예측', () => {
  const now = new Date(2026, 10, 20);
  const days = Array.from({ length: 14 }, (_, i) => ({ day: new Date(2026, 10, 20 - i).toLocaleDateString('sv-SE'), chars: 1000 }));
  it('최근 14일 평균으로 완성 날짜 · 더 쓰면 당겨지는 날', () => {
    const f = forecast(days, 10_000, 30_000, now, null)!;
    expect(f).not.toBe('done');
    if (f === 'done') return;
    expect(f.perDay).toBe(1000);
    expect(f.days).toBe(20);
    expect(f.finish).toBe('2026-12-10');
    expect(f.saved).toBe(20 - Math.ceil(20_000 / 1500));
  });
  it('마감일: 하루에 써야 할 글자와 맞출 수 있는지', () => {
    const f = forecast(days, 10_000, 30_000, now, '2026-12-01')! as Exclude<ReturnType<typeof forecast>, 'done' | null>;
    expect(f.deadline?.onTrack).toBe(false);
    expect(f.deadline?.need).toBeGreaterThan(1000);
    expect((forecast(days, 10_000, 30_000, now, '2026-12-31') as { deadline: { onTrack: boolean } }).deadline.onTrack).toBe(true);
  });
  it('목표 없음 · 이미 채움 · 안 쓴 지 오래면 예측 없음', () => {
    expect(forecast(days, 0, 0, now)).toBeNull();
    expect(forecast(days, 30_000, 30_000, now)).toBe('done');
    expect(forecast([], 1, 30_000, now)).toBeNull();
  });
});
describe('시간 표현 모으기', () => {
  it('날짜 · 지난 시간 · 며칠 사이 · 계절 · 요일, 메모 안은 뺀다', () => {
    const w = findTimeWords('1998년 겨울이었다. 사흘 뒤 그는 떠났다. 다음 날 금요일이었다. %%2001년 메모%%');
    expect(w.map((x) => `${x.kind}:${x.text}`)).toEqual(['date:1998년', 'season:겨울', 'span:사흘 뒤', 'day:다음 날', 'weekday:금요일']);
  });
  it('장 연도 · 거꾸로 가는 곳', () => {
    const t = chapterTimes([
      { id: 'a', title: '1', body: '1998년 봄에', time: '' },
      { id: 'b', title: '2', body: '', time: '1995년 여름' },
      { id: 'c', title: '3', body: '글만 있다.' },
    ]);
    expect(t.map((x) => x.year)).toEqual([1998, 1995, null]);
    expect(backwards(t).map((x) => `${x.from.title}>${x.to.title}`)).toEqual(['1>2']);
    expect(t[1].words[0]).toMatchObject({ kind: 'meta', text: '1995년 여름' });
  });
});
describe('세계관 빈칸 질문', () => {
  it('비어 있는 칸만, 이름을 넣어서', () => {
    const q = emptyFieldQuestions({ name: '홍설', fields: { 나이: '17', 말투: ' ' } }, ['나이', '말투', '비밀', '특이한 칸']);
    expect(q.map((x) => x.field)).toEqual(['말투', '비밀', '특이한 칸']);
    expect(q[0].q).toContain('홍설');
    expect(q[2].q).toBe('홍설의 「특이한 칸」은(는) 어떤가요?');
  });
});
describe('시리즈 묶기', () => {
  it('같은 시리즈를 처음 나온 자리로 모으고 권 순서대로', () => {
    const books = [
      { t: 'a', m: { series: '소금', seriesNo: 2 } },
      { t: 'b', m: {} },
      { t: 'c', m: { series: '소금', seriesNo: 1 } },
      { t: 'd', m: { series: '바다' } },
    ];
    const g = groupBySeries(books, (b) => b.m);
    expect(g.map((x) => `${x.series}:${x.items.map((i) => i.t).join('')}`)).toEqual(['소금:ca', 'null:b', '바다:d']);
    expect(seriesOf({ series: ' x ', seriesNo: 'z' })).toEqual({ name: 'x', no: null });
    expect(seriesOf({})).toBeNull();
  });
});
