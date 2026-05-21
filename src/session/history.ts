import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export interface SessionSummary {
  sessionId: string;
  mtime: number;
  preview: string;
  lineCount: number;
}

interface RolloutCandidate {
  path: string;
  mtime: number;
}

interface RolloutSummary {
  sessionId?: string;
  cwd?: string;
  preview: string;
  lineCount: number;
}

function codexSessionsDir(): string {
  return join(homedir(), '.codex', 'sessions');
}

/** Return the most recent `limit` Codex sessions for the given cwd, newest first. */
export async function listRecentSessions(cwd: string, limit = 5): Promise<SessionSummary[]> {
  const root = codexSessionsDir();
  let files: RolloutCandidate[];
  try {
    files = await listRollouts(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const sorted = files.sort((a, b) => b.mtime - a.mtime);
  const out: SessionSummary[] = [];
  const seen = new Set<string>();
  for (const entry of sorted) {
    if (out.length >= limit) break;
    const summary = await summarize(entry.path);
    if (!summary.sessionId || summary.cwd !== cwd || seen.has(summary.sessionId)) continue;
    seen.add(summary.sessionId);
    out.push({
      sessionId: summary.sessionId,
      mtime: entry.mtime,
      preview: summary.preview || '(空会话)',
      lineCount: summary.lineCount,
    });
  }
  return out;
}

async function listRollouts(dir: string): Promise<RolloutCandidate[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: RolloutCandidate[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listRollouts(path)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl') || !entry.name.startsWith('rollout-')) {
      continue;
    }
    const st = await stat(path).catch(() => null);
    if (st) out.push({ path, mtime: st.mtimeMs });
  }
  return out;
}

async function summarize(path: string): Promise<RolloutSummary> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream });
  const summary: RolloutSummary = { preview: '', lineCount: 0 };
  try {
    for await (const line of rl) {
      summary.lineCount++;
      try {
        const obj = JSON.parse(line) as {
          type?: string;
          payload?: unknown;
        };
        if (obj.type === 'session_meta') {
          const payload = obj.payload as { id?: unknown; cwd?: unknown } | undefined;
          if (typeof payload?.id === 'string') summary.sessionId = payload.id;
          if (typeof payload?.cwd === 'string') summary.cwd = payload.cwd;
        } else if (!summary.preview) {
          const preview = extractPreview(obj.payload);
          if (preview) summary.preview = preview.slice(0, 80);
        }
      } catch {
        /* malformed line */
      }
      if (summary.sessionId && summary.cwd && summary.preview) break;
      if (summary.lineCount > 20_000) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return summary;
}

function extractPreview(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const rec = payload as Record<string, unknown>;

  if (rec.type === 'message') {
    const role = rec.role;
    if (role !== 'user') return '';
    return extractContentText(rec.content);
  }

  if (rec.type === 'user_message' && typeof rec.message === 'string') {
    return rec.message.trim();
  }

  return '';
}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const rec = block as Record<string, unknown>;
    if (typeof rec.text === 'string') return rec.text.trim();
    if (typeof rec.message === 'string') return rec.message.trim();
  }
  return '';
}

/** Format a relative time like "3 小时前", "昨天", "3 天前". */
export function formatRelTime(mtime: number): string {
  const diffMs = Date.now() - mtime;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨天';
  if (day < 30) return `${day} 天前`;
  const mo = Math.floor(day / 30);
  return `${mo} 个月前`;
}
