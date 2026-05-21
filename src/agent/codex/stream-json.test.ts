import { describe, expect, it } from 'vitest';
import { translateEvent } from './stream-json';

describe('translateEvent', () => {
  it('translates Codex thread metadata into a bridge system event', () => {
    expect(Array.from(translateEvent({
      type: 'thread.started',
      thread_id: 'thread_123',
    }, '/repo'))).toEqual([
      { type: 'system', sessionId: 'thread_123', cwd: '/repo' },
    ]);
  });

  it('translates turn completion into usage followed by done', () => {
    expect(Array.from(translateEvent({
      type: 'turn.completed',
      usage: {
        input_tokens: 12,
        output_tokens: 34,
      },
    }))).toEqual([
      { type: 'usage', inputTokens: 12, outputTokens: 34 },
      { type: 'done' },
    ]);
  });

  it('translates agent messages and command execution items', () => {
    expect(Array.from(translateEvent({
      type: 'item.completed',
      item: {
        id: 'msg_1',
        type: 'agent_message',
        text: 'done',
      },
    }))).toEqual([
      { type: 'text', delta: 'done' },
    ]);

    expect(Array.from(translateEvent({
      type: 'item.started',
      item: {
        id: 'cmd_1',
        type: 'command_execution',
        command: 'pnpm test',
      },
    }))).toEqual([
      {
        type: 'tool_use',
        id: 'cmd_1',
        name: 'Bash',
        input: { command: 'pnpm test' },
      },
    ]);

    expect(Array.from(translateEvent({
      type: 'item.completed',
      item: {
        id: 'cmd_1',
        type: 'command_execution',
        aggregated_output: 'ok',
        exit_code: 0,
        status: 'completed',
      },
    }))).toEqual([
      {
        type: 'tool_result',
        id: 'cmd_1',
        output: 'ok',
        isError: false,
      },
    ]);
  });

  it('marks failed command execution results as errors', () => {
    expect(Array.from(translateEvent({
      type: 'item.completed',
      item: {
        id: 'cmd_2',
        type: 'command_execution',
        aggregated_output: 'failed',
        exit_code: 2,
        status: 'failed',
      },
    }))).toEqual([
      {
        type: 'tool_result',
        id: 'cmd_2',
        output: 'failed',
        isError: true,
      },
    ]);
  });
});
