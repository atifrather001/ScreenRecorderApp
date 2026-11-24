import { describe, expect, it } from 'vitest';
import { capDurations, normaliseSegments, toSrt, toTranscript, toVtt } from '@shared/captions';
import { captionConcatList } from '@shared/export-graph';

describe('captions', () => {
  it('drops silence hallucinations and splits long text', () => {
    const segs = normaliseSegments([
      { start: 0, end: 2, text: ' Thank you. ' },
      { start: 2, end: 10, text: 'word '.repeat(40) },
    ]);
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.every((s) => s.text.length <= 84)).toBe(true);
    expect(segs[0].start).toBe(2);
    expect(segs[segs.length - 1].end).toBeCloseTo(10);
  });

  it('merges short fragments into the previous caption', () => {
    const segs = capDurations(
      normaliseSegments([
        { start: 0, end: 3, text: 'Next we decided to launch the new' },
        { start: 3, end: 3.5, text: 'website' },
        { start: 6, end: 8, text: 'A separate sentence after a pause.' },
      ]),
    );
    expect(segs.map((s) => s.text)).toEqual(['Next we decided to launch the new website', 'A separate sentence after a pause.']);
  });

  it('writes SRT and VTT timestamps', () => {
    const segs = [{ id: 'a', start: 61.5, end: 63.25, text: 'Hello' }];
    expect(toSrt(segs)).toBe('1\n00:01:01,500 --> 00:01:03,250\nHello\n');
    expect(toVtt(segs)).toContain('00:01:01.500 --> 00:01:03.250');
    expect(toTranscript(segs)).toBe('[1:01] Hello');
  });

  it('builds a concat list that covers the whole timeline', () => {
    const list = captionConcatList([{ start: 1, end: 2 }, { start: 3, end: 4 }], ['/a.png', "/it's.png"], '/blank.png', 5);
    const durations = [...list.matchAll(/duration ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(durations.reduce((a, b) => a + b, 0)).toBeCloseTo(5);
    expect(list).toContain("file '/it'\\''s.png'");
  });
});
