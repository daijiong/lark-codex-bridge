import type { AgentEvent } from '../types';

type CodexEventType =
  | 'thread.started'
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'item.started'
  | 'item.updated'
  | 'item.completed'
  | 'error';

interface CodexRawEvent {
  type?: CodexEventType | string;
  thread_id?: string;
  message?: string;
  error?: { message?: string } | string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
  };
  item?: CodexItem;
}

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  content?: unknown;
  summary?: unknown;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  server?: string;
  tool?: string;
  name?: string;
  query?: string;
  path?: string;
  error?: { message?: string } | string;
  [key: string]: unknown;
}

export function* translateEvent(raw: unknown, cwd?: string): Generator<AgentEvent> {
  if (!raw || typeof raw !== 'object') return;
  const evt = raw as CodexRawEvent;

  if (evt.type === 'thread.started') {
    yield { type: 'system', sessionId: evt.thread_id, cwd };
    return;
  }

  if (evt.type === 'turn.completed') {
    if (evt.usage) {
      yield {
        type: 'usage',
        inputTokens: evt.usage.input_tokens,
        outputTokens: evt.usage.output_tokens,
      };
    }
    yield { type: 'done' };
    return;
  }

  if (evt.type === 'turn.failed') {
    yield { type: 'error', message: errorMessage(evt.error) || evt.message || 'codex turn failed' };
    return;
  }

  if (evt.type === 'error') {
    yield { type: 'error', message: errorMessage(evt.error) || evt.message || 'codex error' };
    return;
  }

  if (!evt.item || !evt.type?.startsWith('item.')) return;
  yield* translateItem(evt.type, evt.item);
}

function* translateItem(eventType: string, item: CodexItem): Generator<AgentEvent> {
  const id = item.id ?? stableItemId(item);
  const itemType = item.type ?? 'unknown';

  if (itemType === 'agent_message') {
    if (eventType === 'item.completed' && typeof item.text === 'string' && item.text) {
      yield { type: 'text', delta: item.text };
    }
    return;
  }

  if (itemType === 'reasoning') {
    const text = reasoningText(item);
    if (text) yield { type: 'thinking', delta: text };
    return;
  }

  if (itemType === 'command_execution') {
    if (eventType === 'item.started') {
      yield {
        type: 'tool_use',
        id,
        name: 'Bash',
        input: { command: item.command ?? '' },
      };
      return;
    }
    if (eventType === 'item.completed') {
      const failed = item.status === 'failed' || typeof item.exit_code === 'number' && item.exit_code !== 0;
      yield {
        type: 'tool_result',
        id,
        output: item.aggregated_output ?? statusText(item),
        isError: failed,
      };
      return;
    }
  }

  if (itemType === 'mcp_tool_call') {
    const name = `MCP ${[item.server, item.tool].filter(Boolean).join('.') || item.name || 'tool'}`;
    if (eventType === 'item.started') {
      yield { type: 'tool_use', id, name, input: redactItem(item) };
      return;
    }
    if (eventType === 'item.completed') {
      yield {
        type: 'tool_result',
        id,
        output: item.error ? errorMessage(item.error) : stringify(item.content ?? statusText(item)),
        isError: item.status === 'failed' || Boolean(item.error),
      };
      return;
    }
  }

  if (itemType === 'web_search') {
    if (eventType === 'item.started') {
      yield { type: 'tool_use', id, name: 'WebSearch', input: { query: item.query ?? item.content } };
      return;
    }
    if (eventType === 'item.completed') {
      yield {
        type: 'tool_result',
        id,
        output: stringify(item.content ?? statusText(item)),
        isError: item.status === 'failed',
      };
      return;
    }
  }

  if (itemType === 'file_change') {
    if (eventType === 'item.started') {
      yield { type: 'tool_use', id, name: 'FileChange', input: redactItem(item) };
      return;
    }
    if (eventType === 'item.completed') {
      yield {
        type: 'tool_result',
        id,
        output: stringify(item.content ?? statusText(item)),
        isError: item.status === 'failed',
      };
      return;
    }
  }

  if (itemType === 'plan_update') {
    if (eventType === 'item.completed') {
      const text = stringify(item.content ?? item.text ?? redactItem(item));
      if (text) yield { type: 'thinking', delta: text };
    }
    return;
  }

  // Item-level errors are not always fatal in Codex exec JSONL. Render them
  // as a tool block so the user sees the problem without terminating a run
  // that may still end successfully.
  if (itemType === 'error') {
    if (eventType === 'item.completed') {
      yield { type: 'tool_use', id, name: 'CodexError', input: {} };
      yield {
        type: 'tool_result',
        id,
        output: errorMessage(item.error) || item.message as string || stringify(redactItem(item)),
        isError: true,
      };
    }
  }
}

function reasoningText(item: CodexItem): string {
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  if (Array.isArray(item.summary)) return item.summary.map(stringify).filter(Boolean).join('\n');
  return '';
}

function errorMessage(err: CodexRawEvent['error']): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err.message ?? stringify(err);
}

function statusText(item: CodexItem): string {
  const parts = [item.status, typeof item.exit_code === 'number' ? `exit_code=${item.exit_code}` : '']
    .filter(Boolean);
  return parts.join(' ') || stringify(redactItem(item));
}

function stableItemId(item: CodexItem): string {
  const basis = `${item.type ?? 'item'}:${item.command ?? item.name ?? item.path ?? item.query ?? ''}`;
  let hash = 0;
  for (const ch of basis) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `codex_${hash.toString(16)}`;
}

function redactItem(item: CodexItem): Record<string, unknown> {
  const { aggregated_output: _output, error: _error, ...rest } = item;
  return rest;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
