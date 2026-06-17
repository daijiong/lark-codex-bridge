import { describe, expect, it } from 'vitest';
import { shouldSkipLowIntentDm } from './channel';

const imageResource = {
  type: 'image',
  fileKey: 'img_v3_0212n_test',
} as const;

describe('shouldSkipLowIntentDm', () => {
  it('skips short p2p presence probes', () => {
    expect(shouldSkipLowIntentDm({
      chatType: 'p2p',
      content: '在?',
      resources: [],
    })).toBe(true);

    expect(shouldSkipLowIntentDm({
      chatType: 'p2p',
      content: '在的?',
      resources: [],
    })).toBe(true);
  });

  it('skips low-intent image followups without action words', () => {
    expect(shouldSkipLowIntentDm({
      chatType: 'p2p',
      content: '![image](img_v3_0212n_test)\n还有这个也是',
      resources: [imageResource],
    })).toBe(true);
  });

  it('keeps actionable p2p image requests', () => {
    expect(shouldSkipLowIntentDm({
      chatType: 'p2p',
      content: '![image](img_v3_0212n_test)\n帮我分析这个',
      resources: [imageResource],
    })).toBe(false);
  });

  it('does not skip group messages', () => {
    expect(shouldSkipLowIntentDm({
      chatType: 'group',
      content: '在?',
      resources: [],
    })).toBe(false);
  });
});
