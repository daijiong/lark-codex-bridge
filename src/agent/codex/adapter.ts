import type { ChildProcessByStdio } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { log } from '../../core/logger';
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../types';
import { translateEvent } from './stream-json';

export interface CodexAdapterOptions {
  binary?: string;
  model?: string;
  profile?: string;
  profileV2?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  skipGitRepoCheck?: boolean;
  search?: boolean;
  extraArgs?: string[];
}

type CodexChild = ChildProcessByStdio<Writable, Readable, Readable>;
type ResolvedCodexOptions = Required<
  Omit<CodexAdapterOptions, 'model' | 'profile' | 'profileV2' | 'extraArgs'>
> &
  Pick<CodexAdapterOptions, 'model' | 'profile' | 'profileV2' | 'extraArgs'>;

const BRIDGE_SYSTEM_PROMPT = `# lark-codex-bridge 运行约定

你正在 lark-codex-bridge 里跑：把飞书/Lark 用户消息桥到本地 \`codex\` CLI。

## bridge_context

每条 user message 顶部会带一个 \`<bridge_context>\` 块：

\`\`\`
<bridge_context>
chat_id: oc_xxx
chat_type: p2p
sender_id: ou_xxx
sender_name: ...
thread_id: omt_xxx
</bridge_context>
\`\`\`

里面是当前对话的 chat_id、chat 类型、发送者和 thread_id。这些是 bridge 注入的元数据，不要照抄、不要在回复里渲染。

## quoted_message

如果用户用"引用回复"指向某条消息，bridge 会在 \`<bridge_context>\` 后注入一个 \`<quoted_message>\` 块：

\`\`\`
<quoted_message id="om_xxx" sender_id="ou_xxx" sender_name="..." created_at="..." type="text|merge_forward|...">
（被引用消息的内容；merge_forward 类型会展开成 <forwarded_messages>...</forwarded_messages>）
</quoted_message>
\`\`\`

这是用户指向的对象，用户的实际问题在它之后。回答时围绕这段内容展开；它也是 bridge 注入的元数据，不要照抄 XML 标签到回复里。

## 飞书交互卡片回调

如果你要发送飞书交互卡片并希望用户点击后回到当前 Codex thread：

1. 用 \`lark-cli im send-card --chat-id <chat_id> --card '<json>'\` 发送 CardKit 2.0 卡片。
2. 卡片使用 CardKit 2.0 schema（\`schema: "2.0"\`）。
3. 按钮 callback value 里放 \`"__agent_cb": true\`，并可附加业务字段，例如 \`{"__agent_cb": true, "choice": "a"}\`。
4. 用户点击后，bridge 会把 payload（去掉 \`__agent_cb\` marker）作为 \`[card-click] {...}\` 消息发回本 thread。
5. 只展示、不需要回调的按钮不要加 \`__agent_cb\`。

示例 button：

\`\`\`json
{
  "tag": "button",
  "text": { "tag": "plain_text", "content": "方案 A" },
  "behaviors": [{
    "type": "callback",
    "value": { "__agent_cb": true, "choice": "a" }
  }]
}
\`\`\`

## 飞书 OAuth 授权（\`lark-cli auth login\`）

授权流程要让 \`lark-cli\` 进程一直活到用户在浏览器里点完为止。bridge 在你的 run 结束之后会回收 Codex，后台 bash 不适合承载授权等待，所以授权必须用前台阻塞的方式跑：

1. 仅在 p2p 里发起授权。若 \`bridge_context.chat_type\` 是 group/topic，不要调 \`lark-cli auth login\`，应回复用户："授权要在私聊里做，请单独私信我。"
2. 禁止把 \`lark-cli auth login\` 放到后台运行，否则用户还没点完就可能丢掉进程。
3. 推荐两阶段流：
   - 先跑 \`lark-cli auth login --no-wait --json [--recommend | --domain ... | --scope ...]\`，stdout 里有 \`verification_url\` 和 \`device_code\`。
   - 把 \`verification_url\` 原样用代码块发给用户，不要 Markdown 链接化、不要 URL 编码。
   - 紧接着同一轮里跑 \`lark-cli auth login --device-code <code>\`，前台阻塞直到用户点完或超时。
4. 前台阻塞期间，用户发的新消息会由 bridge 排队，不会打断当前 run。
5. 如果用户中途想取消，他们会发 \`/stop\`，被 kill 是预期行为。
`;

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex';

  private readonly defaults: ResolvedCodexOptions;
  private readonly optionsProvider?: () => CodexAdapterOptions;

  constructor(opts: CodexAdapterOptions = {}, optionsProvider?: () => CodexAdapterOptions) {
    this.defaults = resolveOptions(opts);
    this.optionsProvider = optionsProvider;
  }

  private currentOptions(): ResolvedCodexOptions {
    return resolveOptions({ ...this.defaults, ...(this.optionsProvider?.() ?? {}) });
  }

  async isAvailable(): Promise<boolean> {
    const opts = this.currentOptions();
    return new Promise((resolve) => {
      const child = spawn(opts.binary, ['--version'], {
        stdio: 'ignore',
        shell: process.platform === 'win32',
      });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
  }

  run(opts: AgentRunOptions): AgentRun {
    const codexOpts = this.currentOptions();
    const args = this.buildArgs(opts, codexOpts);
    const child = spawn(codexOpts.binary, args, {
      cwd: opts.cwd,
      env: { ...process.env, LARK_CODEX: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    child.stdin.on('error', () => {
      /* child may fail before stdin flushes */
    });
    child.stdin.end(wrapPrompt(opts.prompt));

    log.info('agent', 'spawn', {
      pid: child.pid ?? null,
      cwd: opts.cwd ?? process.cwd(),
      hasSession: Boolean(opts.sessionId),
      promptChars: opts.prompt.length,
      model: opts.model ?? codexOpts.model,
      sandbox: codexOpts.sandbox,
      images: opts.imagePaths?.length ?? 0,
    });

    const stderrChunks: Buffer[] = [];
    let stderrBuffer = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrBuffer += chunk.toString('utf8');
      let nl = stderrBuffer.indexOf('\n');
      while (nl !== -1) {
        const line = stderrBuffer.slice(0, nl);
        stderrBuffer = stderrBuffer.slice(nl + 1);
        if (line.trim()) log.warn('agent', 'stderr', { line });
        nl = stderrBuffer.indexOf('\n');
      }
    });

    let runtimeError: Error | null = null;
    child.on('error', (err) => {
      runtimeError = err;
    });
    child.on('exit', (code, signal) => {
      log.info('agent', 'exit', { pid: child.pid ?? null, code, signal });
    });

    const stopGraceMs = opts.stopGraceMs ?? 5000;

    return {
      events: createEventStream(child, stderrChunks, () => runtimeError, opts.cwd),
      async stop() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        log.info('agent', 'stop-sigterm', { pid: child.pid ?? null, graceMs: stopGraceMs });
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              log.warn('agent', 'stop-sigkill', {
                pid: child.pid ?? null,
                graceMs: stopGraceMs,
                reason: 'grace-period-expired',
              });
              child.kill('SIGKILL');
            }
            resolve();
          }, stopGraceMs);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      },
      waitForExit(timeoutMs: number): Promise<boolean> {
        if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          const onExit = (): void => {
            clearTimeout(timer);
            resolve(true);
          };
          const timer = setTimeout(() => {
            child.removeListener('exit', onExit);
            resolve(false);
          }, timeoutMs);
          child.once('exit', onExit);
        });
      },
    };
  }

  private buildArgs(opts: AgentRunOptions, codexOpts: ResolvedCodexOptions): string[] {
    const args: string[] = [];
    if (codexOpts.search) args.push('--search');
    args.push('exec', '--json', '--sandbox', codexOpts.sandbox);
    const model = opts.model ?? codexOpts.model;
    if (model) args.push('--model', model);
    if (codexOpts.profile) args.push('--profile', codexOpts.profile);
    if (codexOpts.profileV2) args.push('--profile-v2', codexOpts.profileV2);
    if (codexOpts.skipGitRepoCheck) args.push('--skip-git-repo-check');
    for (const imagePath of opts.imagePaths ?? []) args.push('--image', imagePath);
    if (codexOpts.extraArgs) args.push(...codexOpts.extraArgs);
    if (opts.sessionId) {
      args.push('resume', opts.sessionId, '-');
    } else {
      args.push('-');
    }
    return args;
  }
}

function resolveOptions(opts: CodexAdapterOptions = {}): ResolvedCodexOptions {
  return {
    binary: opts.binary ?? 'codex',
    sandbox: opts.sandbox ?? 'workspace-write',
    skipGitRepoCheck: opts.skipGitRepoCheck ?? true,
    search: opts.search ?? false,
    model: opts.model,
    profile: opts.profile,
    profileV2: opts.profileV2,
    extraArgs: opts.extraArgs,
  };
}

async function* createEventStream(
  child: CodexChild,
  stderrChunks: Buffer[],
  getError: () => Error | null,
  cwd?: string,
): AsyncGenerator<AgentEvent> {
  if (!child.pid) {
    const err = getError();
    yield {
      type: 'error',
      message: err ? `failed to spawn codex: ${err.message}` : 'spawn returned no pid',
    };
    return;
  }

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      yield* translateEvent(parsed, cwd);
    }
  } finally {
    rl.close();
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode);
    } else {
      child.once('exit', (code) => resolve(code));
    }
  });

  const runtimeError = getError();
  if (exitCode !== 0 && exitCode !== null) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    const detail = stderr ? `: ${stderr.slice(0, 500)}` : '';
    yield { type: 'error', message: `codex exited with code ${exitCode}${detail}` };
  } else if (runtimeError) {
    yield { type: 'error', message: `codex runtime error: ${runtimeError.message}` };
  }
}

function wrapPrompt(prompt: string): string {
  return `${BRIDGE_SYSTEM_PROMPT}\n\n${prompt}`;
}
