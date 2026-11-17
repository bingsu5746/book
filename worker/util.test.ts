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
