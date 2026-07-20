import { describe, expect, it } from 'vitest';
import { extractJsonFromReply, extractQuranicReply } from './extract-json';

describe('extractJsonFromReply', () => {
  it('returns null for null / undefined / empty input', () => {
    expect(extractJsonFromReply(null)).toBeNull();
    expect(extractJsonFromReply(undefined)).toBeNull();
    expect(extractJsonFromReply('')).toBeNull();
  });

  it('parses pure JSON', () => {
    expect(extractJsonFromReply('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a fenced JSON block', () => {
    expect(extractJsonFromReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('parses a fenced block without a language tag', () => {
    expect(extractJsonFromReply('```\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it('extracts the first balanced object from prose', () => {
    const text = 'Sure, here it is: {"name":"x","nested":{"k":1}} — done.';
    expect(extractJsonFromReply(text)).toEqual({ name: 'x', nested: { k: 1 } });
  });

  it('extracts the first balanced array from prose', () => {
    expect(extractJsonFromReply('Result: [1, 2, {"a":3}]!')).toEqual([1, 2, { a: 3 }]);
  });

  it('respects escaped quotes inside strings', () => {
    const text = '{"a":"he said \\"hi\\"","b":2}';
    expect(extractJsonFromReply(text)).toEqual({ a: 'he said "hi"', b: 2 });
  });

  it('handles nested braces inside strings', () => {
    const text = '{"a":"has { and } inside","b":2}';
    expect(extractJsonFromReply(text)).toEqual({ a: 'has { and } inside', b: 2 });
  });

  it('returns null when the JSON is malformed', () => {
    expect(extractJsonFromReply('{not json')).toBeNull();
    expect(extractJsonFromReply('plain text, no json at all')).toBeNull();
  });

  it('returns null for a fenced block that is not valid JSON', () => {
    // Fenced parse throws; falls through; the inner content has no balanced
    // span; whole-text parse also fails.
    expect(extractJsonFromReply('```json\n{broken\n```')).toBeNull();
  });
});

describe('extractQuranicReply', () => {
  it('returns null for non-JSON', () => {
    expect(extractQuranicReply('hello')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(extractQuranicReply('{"context":"y"}')).toBeNull();
    expect(extractQuranicReply('{"context":"y","related_words":[]}')).toEqual({
      context: 'y',
      related_words: [],
    });
  });

  it('returns null when related_words has wrong shape', () => {
    expect(extractQuranicReply('{"context":"y","related_words":[{"term":1}]}')).toBeNull();
  });

  it('parses a valid quranic reply', () => {
    const reply = {
      context: 'يونس',
      related_words: [
        { term: 'ذو النون', note: 'لقب' },
        { term: 'صاحب الحوت', note: 'وصف' },
      ],
      note: '',
    };
    expect(extractQuranicReply(JSON.stringify(reply))).toEqual(reply);
  });
});