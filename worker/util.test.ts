import { describe, expect, it } from 'vitest';
import { flattenTree, snippets } from './util';
import { charsNoSpace, inviteOk, passwordProblem } from './security';
import { isGutenbergUrl, readGutendexBook } from './external';

describe('찾기 조각', () => {
  it('찾은 말 앞뒤를 잘라 준다', () => {
    const s = snippets('가'.repeat(100) + '고양이' + '나'.repeat(100), '고양이', 3, 5);
    expect(s).toHaveLength(1);
    expect(s[0].at).toBe(100);
    expect(s[0].text).toBe('…가가가가가고양이나나나나나…');
  });
  it('여러 곳 · 대소문자 무시 · 최대 개수', () => {
    expect(snippets('Cat cat CAT', 'cat', 2)).toHaveLength(2);
  });
});

describe('나무 펼치기', () => {
  it('부 → 장 → 장면 순서, 순서 번호(sort)대로', () => {
    const n = [
      { id: 'c2', parent_id: 'p1', sort: 2 },
      { id: 'p1', parent_id: null, sort: 1 },
      { id: 's1', parent_id: 'c1', sort: 1 },
      { id: 'c1', parent_id: 'p1', sort: 1.5 },
      { id: 'p2', parent_id: null, sort: 2 },
    ];
    expect(flattenTree(n).map((x) => `${x.id}:${x.depth}`)).toEqual(['p1:0', 'c1:1', 's1:2', 'c2:1', 'p2:0']);
  });
  it('부모가 없어진 칸은 맨 위로', () => {
    expect(flattenTree([{ id: 'a', parent_id: 'gone', sort: 1 }]).map((x) => x.depth)).toEqual([0]);
  });
});

describe('보안', () => {
  it('초대 코드: 정해지지 않았으면 언제나 거절', () => {
    expect(inviteOk('x', undefined)).toBe(false);
    expect(inviteOk('', '')).toBe(false);
    expect(inviteOk(' abc ', 'abc')).toBe(true);
    expect(inviteOk('abd', 'abc')).toBe(false);
  });
  it('비밀번호 규칙', () => {
    expect(passwordProblem('short', 'me')).toMatch(/8자/);
    expect(passwordProblem('12345678', 'me')).toMatch(/쉬운/);
    expect(passwordProblem('good-pass-9', 'me')).toBeNull();
  });
  it('글자 수는 공백을 뺀다', () => {
    expect(charsNoSpace('가 나\n다\t라')).toBe(4);
  });
});

describe('구텐베르크', () => {
  it('gutenberg.org 주소만 받는다', () => {
    expect(isGutenbergUrl('https://www.gutenberg.org/ebooks/1342.epub3.images')).toBe(true);
    expect(isGutenbergUrl('https://gutenberg.org/cache/epub/1/pg1.txt')).toBe(true);
    expect(isGutenbergUrl('https://evil.example/gutenberg.org')).toBe(false);
    expect(isGutenbergUrl('https://gutenberg.org.evil.example/x')).toBe(false);
    expect(isGutenbergUrl('file:///etc/passwd')).toBe(false);
  });
  it('목록 한 권 읽기: 다른 곳 파일 주소는 버린다', () => {
    const b = readGutendexBook({ id: 1, title: 'T', authors: [{ name: 'A' }], languages: ['en'], download_count: 5, formats: { 'application/epub+zip': 'https://www.gutenberg.org/ebooks/1.epub3.images', 'text/plain; charset=utf-8': 'https://evil.example/x.txt' } });
    expect(b?.epub).toContain('gutenberg.org');
    expect(b?.text).toBeNull();
    expect(readGutendexBook({ title: 'no id' })).toBeNull();
  });
});

import { cleanSynopsis, clip, readOutput, synopsisMessages } from './ai';
describe('AI 줄거리 요약 도우미', () => {
  it('모델 답 모양 셋을 모두 읽는다', () => {
    expect(readOutput({ response: '가' })).toBe('가');
    expect(readOutput({ choices: [{ message: { content: '<think>x</think>나' } }] })).toBe('나');
    expect(readOutput({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '다' }] }] })).toBe('다');
    expect(readOutput(null)).toBe('');
  });
  it('머리말 · 목록 기호를 걷어 낸다', () => {
    expect(cleanSynopsis('요약: - 홍설은 꽃밭에서 깬다.\n- 봉오리를 본다.')).toBe('홍설은 꽃밭에서 깬다. 봉오리를 본다.');
  });
  it('긴 원고는 앞뒤를 남기고 줄이며, 작가 메모는 보내지 않는다', () => {
    const r = clip('가'.repeat(20000), 1000);
    expect(r.clipped).toBe(true);
    expect(r.text.length).toBeLessThan(1100);
    expect(synopsisMessages('t', '본문 %%비밀 메모%% [[홍설|설이]]')[1].content).toBe('장 제목: t\n\n원고:\n본문  설이');
  });
});

import { chapterMessages, chapterSummaries, cleanSection, digest, parseChapterNote, sectionMessages } from './analysis';
describe('분석집', () => {
  const note = parseChapterNote('설명입니다 ```json\n{"summary":"홍설이 깬다.","characters":[{"name":"홍설","doing":"깬다","traits":["조용함"]}],"events":[{"what":"깸","why":"시작"}],"objects":[{"name":"거울","meaning":"기억"}],"places":[],"motifs":["오전 8시"],"lines":["홍설은 꽃밭에서 눈을 떴다."]}\n```');
  it('장 메모 JSON 을 읽는다 (앞뒤 군말이 있어도)', () => {
    expect(note.summary).toBe('홍설이 깬다.');
    expect(note.characters[0]).toEqual({ name: '홍설', doing: '깬다', traits: ['조용함'] });
    expect(parseChapterNote('그냥 글').summary).toBe('그냥 글');
    expect(parseChapterNote('{망가진').summary).toBe('{망가진');
  });
  it('부분마다 필요한 자료만 모은다', () => {
    const ch = [{ title: '1장', part: '1부', note }];
    expect(digest(ch, 'characters')).toContain('인물 홍설');
    expect(digest(ch, 'characters')).not.toContain('물건 거울');
    expect(digest(ch, 'things')).toContain('물건 거울');
    expect(digest(ch, 'afterword')).toContain('「홍설은 꽃밭에서 눈을 떴다.」');
  });
  it('장별 줄거리는 메모로 엮고, 부가 바뀔 때 머리를 단다', () => {
    const t = chapterSummaries([
      { title: 'a', part: '1부', note },
      { title: 'b', part: '1부', note },
      { title: 'c', part: '2부', note },
    ]);
    expect(t.match(/### /g)?.length).toBe(2);
    expect(t).toContain('**[3] c**');
  });
  it('지어내지 말라는 지시가 늘 들어간다', () => {
    expect(chapterMessages('책', '장', '본문')[0].content).toContain('지어내지 않는다');
    expect(sectionMessages('책', 'afterword', '자료', '')[0].content).toContain('지어내지 않는다');
  });
  it('부분 글 맨 앞 큰 제목은 걷어 낸다', () => {
    expect(cleanSection('## 인물 분석\n\n### 홍설\n내용')).toBe('### 홍설\n내용');
  });
});

import { parseInfo } from './ai';
describe('장 정보 답 읽기', () => {
  it('JSON 앞뒤 글을 걷어 내고 칸을 다듬는다', () => {
    const r = parseInfo('여기요:\n```json\n{"synopsis":"- 홍설이 깬다.","pov":" 홍설 ","place":"","time":"새벽","tags":["#꿈","꿈","기억"]}\n```');
    expect(r).toEqual({ synopsis: '홍설이 깬다.', pov: '홍설', place: '', time: '새벽', tags: ['꿈', '기억'] });
    expect(parseInfo('모르겠어요')).toBeNull();
  });
});

import { geminiBody, geminiChain, geminiKey } from './gemini';
describe('Gemini', () => {
  it('이름에 gemini 가 들어간 비밀값을 찾고, 정해 둔 이름을 먼저', () => {
    expect(geminiKey({ Life_gemini_api_key: ' a ', GEMINI_API_KEY: 'b', AI: {} })).toBe('b');
    expect(geminiKey({ book_Gemini: 'c' })).toBe('c');
    expect(geminiKey({ GEMINI_API: ' k ', AI: {} })).toBe('k');
    expect(geminiKey({ GEMINI_KEY: '  ' })).toBeUndefined();
  });
  it('Flash → Flash Lite → Gemma 4 순서, 그림 · 음성 모델 빼기', () => {
    const models = ['gemini-3-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemma-4-26b-it', 'gemini-3-flash-image', 'gemini-3.6-flash-preview'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] }));
    expect(geminiChain({ models })).toEqual(['gemini-3.6-flash', 'gemini-3.6-flash-preview', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemma-4-26b-it']);
  });
  it('Gemma 는 시스템 지시를 첫 질문 앞에 붙인다', () => {
    const m = [
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U' },
    ];
    expect(geminiBody(m, 'gemini-3-flash')).toMatchObject({ systemInstruction: { parts: [{ text: 'S' }] }, contents: [{ role: 'user', parts: [{ text: 'U' }] }] });
    const g = geminiBody(m, 'gemma-4-26b-it');
    expect('systemInstruction' in g).toBe(false);
    expect(g.contents[0].parts[0].text).toBe('S\n\nU');
  });
});

import { fakeOutline, OUTLINE_MARK, outlineMessages, parseOutline } from './outline';
describe('줄거리 짜기', () => {
  it('프롬프트에 아이디어 · 분위기 · 장 수 · 요청이 들어간다', () => {
    const m = outlineMessages('소금 사원이 창고가 된다', { tone: '음울한', chapters: 9, feedback: '더 어둡게', prev: '' });
    expect(m[0].content).toContain(OUTLINE_MARK);
    expect(m[0].content).toContain('9개');
    expect(m[1].content).toContain('소금 사원이 창고가 된다');
    expect(m[1].content).toContain('분위기 · 장르: 음울한');
    expect(m[1].content).toContain('더 어둡게');
  });
  it('답 읽기: 줄거리가 없으면 쓸 수 없고, 종류는 걸러 낸다', () => {
    expect(parseOutline({ title: 'x' })).toBeNull();
    const o = parseOutline(JSON.parse(fakeOutline(OUTLINE_MARK)!))!;
    expect(o.chapters).toHaveLength(3);
    expect(o.world.map((w) => w.kind)).toEqual(['place', 'faction']);
    expect(parseOutline({ synopsis: 's', world: [{ name: 'a', kind: 'weird' }] })!.world[0].kind).toBe('concept');
    expect(fakeOutline('다른 지시')).toBeNull();
  });
});

import { extractMessages, interviewMessages, parseExtract } from './tools';
describe('수첩 → 세계관 · 인터뷰', () => {
  it('근거 글이 없는 항목은 빼고 중복 이름도 뺀다', () => {
    const r = parseExtract({ names: [{ name: '소금 사원', kind: 'place', summary: 's', quote: '소금으로 지은 사원' }, { name: '소금 사원', kind: 'place', quote: 'q' }, { name: '빈', kind: 'x', summary: '' }] });
    expect(r.map((x) => x.name)).toEqual(['소금 사원']);
    expect(parseExtract({ names: [{ name: 'a', quote: 'q', kind: '이상한' }] })[0].kind).toBe('other');
  });
  it('프롬프트: 이미 있는 항목 · 인물 설정 · 대화 기록이 들어간다', () => {
    expect(extractMessages('답', ['홍설'])[1].content).toContain('홍설');
    const m = interviewMessages({ name: '홍설', kind: '인물', summary: '주인공', body: '', fields: { 말투: '느릿하게' } }, '소금 세계', [{ role: 'q', text: '왜?' }, { role: 'a', text: '그냥.' }], '지금은?');
    expect(m[0].content).toContain('말투: 느릿하게');
    expect(m[0].content).toContain('소금 세계');
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });
});
