# lark-codex-bridge

A lightweight bot that bridges Feishu / Lark messenger with your local Codex CLI. Run one command, scan a QR code to bind a Lark app, and talk to Codex from chat — read screenshots, edit code, anything you'd do at the terminal.

> Note: this project is forked from [feishu-claude-code-bridge](https://github.com/zarazhangrui/feishu-claude-code-bridge). It keeps the original Feishu/Lark bridge, session management, interactive cards, and setup wizard, while replacing the local agent backend from Claude Code with Codex CLI and renaming the package to `lark-codex-bridge`.

[中文 README](./README.zh.md)

## What it does

- Forwards Feishu / Lark messages (DM directly, or `@bot` in a group) to your local `codex` CLI, running in a working directory you control.
- **Streaming card**: Codex's text and tool calls update on a single Lark card in real time — no waiting for the final reply.
- **Per-chat sessions**: each chat keeps its own Codex thread, so conversations resume where they left off.
- **Preempt + batch**: a new message interrupts the running run; rapid-fire messages get coalesced into one request.
- **Multiple workspaces**: `/ws` switches between named project directories, with sessions tracked per workspace.
- **Images and files**: send them to the bot directly — Codex reads the locally downloaded paths.
- **Interactive cards**: `/help`, `/ws list`, `/status` return cards with buttons you can click.

## Prerequisites

- Node.js **>= 20**
- `codex` CLI installed and logged in — see https://developers.openai.com/codex
- A Lark / Feishu **PersonalAgent** app (the QR-code wizard on first launch can create one for you).

## Install

```bash
npm i -g lark-codex-bridge
# or
pnpm add -g lark-codex-bridge
```

## First run

```bash
lark-codex-bridge start
```

The first run detects there's no app configured and **opens a QR-code wizard**:

1. A QR code renders in your terminal.
2. Scan it with the Feishu / Lark app.
3. Pick or create a PersonalAgent app.
4. Credentials are written to `~/.lark-codex/config.json`.

### Granting scopes and event subscriptions

The wizard creates the app shell, but you still need to confirm a few things on the Lark Developer Console:

**Permission scopes:**
- `im:message`
- `im:message:send_as_bot`
- `im:resource`

**Event subscriptions (over long-lived WebSocket):**
- `im.message.receive_v1`
- `card.action.trigger`
- `im.message.reaction.created_v1` / `deleted_v1` (optional)
- `im.chat.member.bot.added_v1` (optional)

After enabling those, run `lark-codex-bridge start` again. Once you see `✓ Connected`, find the bot in Feishu / Lark and start chatting.

## Commands

### Host CLI

```
lark-codex-bridge start [-c <config>]   Start the bot
lark-codex-bridge ps                    List all running start processes on this machine
lark-codex-bridge stop <id|#>           Stop a start process (SIGTERM, SIGKILL after 2s)
lark-codex-bridge --help                List all commands
```

> When the same app is started multiple times, Lark's open platform routes events to one of the live WebSocket connections at random. `start` detects existing processes for the same app and (in a TTY) prompts: `[c]ontinue / [k]ill old / [a]bort`. In non-TTY mode it warns and continues.

`status` / `doctor` / `handover` / `workspace` / `service` are placeholders, planned for later releases.

### Slash commands inside Feishu / Lark

| Command | Effect |
|---|---|
| `/new`, `/reset` | Clear the current chat's session |
| `/cd <path>` | Switch working directory (resets session) |
| `/ws list` | List named workspaces (card + buttons) |
| `/ws save <name>` | Save current cwd as a named workspace |
| `/ws use <name>` | Switch to a named workspace |
| `/ws remove <name>` | Delete a named workspace |
| `/status` | Current cwd / session / agent (card + buttons) |
| `/config` | Adjust preferences (reply style, tool-call display, ...) |
| `/stop` | Stop the run in progress (also the `⏹` button on the card) |
| `/timeout [N\|off\|default]` | Idle-watchdog (minutes) for the current session. `/config` sets the global default. See FAQ below. |
| `/ps` | List all `start` processes on this host, marking the one replying |
| `/exit <id\|#>` | Stop a `start` process (your own → graceful; another's → SIGTERM) |
| `/reconnect` | Force a WebSocket reconnect (use when the bot stops responding after a network blip) |
| `/doctor [description]` | Feed recent logs and your description back to Codex for self-diagnosis |
| `/help` | Help card |
| Any other `/xxx` | Forwarded verbatim to Codex |

**Reply policy**: in a DM, the bot replies to anything. In a **group (including topic groups), the bot only replies when `@`-mentioned** (default since 0.1.22); unmentioned messages are ignored. `@all` is never answered. Cloud-doc comments must mention the bot. To restore the older "always answer in groups" behaviour: `/config` → "Require @bot in groups" → No.

## Data directories

| Path | Content |
|---|---|
| `~/.lark-codex/config.json` | App credentials (App ID / Secret), mode 600 |
| `~/.lark-codex/sessions.json` | Codex thread id + cwd per chat / topic (+ optional `/timeout` override) |
| `~/.lark-codex/workspaces.json` | Named-workspace map |
| `~/.lark-codex/processes.json` | Process registry for live `start` instances (used by `ps`/`stop`); dead PIDs are auto-pruned |
| `~/.lark-codex/media/<chatId>/` | Downloaded images / files, cleaned up after 24h |
| `~/.lark-codex/logs/YYYY-MM-DD.log` | Structured run logs (JSONL), rotated daily; older than 7 days are pruned at startup (`LARK_CODEX_LOG_DAYS` env var overrides). `/doctor` reads these. |

> Upgrading from before 0.1.11? Run `lark-codex-bridge migrate` once — it moves anything under `~/.config/lark-codex-bridge/` and `~/.cache/lark-codex-bridge/` to the new location and upgrades `config.json` to the new schema.

## Codex Runtime Config

Send `/config` in Feishu / Lark to tune the Codex subprocess. Changes apply to the next run:

- `codexBinary`: Codex CLI command or absolute path; default `codex`
- `model`: passed to `codex exec --model`; leave blank to use Codex defaults
- `profile` / `profileV2`: passed as `--profile` and `--profile-v2`
- `sandbox`: `workspace-write` (default), `read-only`, or `danger-full-access`
- `skipGitRepoCheck`: enabled by default so `/cd` can point at non-Git folders
- `search`: enables Web Search by launching `codex --search exec ...`

You can also edit `~/.lark-codex/config.json` under `preferences.agent`:

```json
{
  "preferences": {
    "agent": {
      "provider": "codex",
      "codexBinary": "codex",
      "sandbox": "workspace-write",
      "skipGitRepoCheck": true,
      "search": false
    }
  }
}
```

## Access control (optional)

Out of the box the bot is **open**: anyone who can find it can DM it, any group member can `@`-mention it to trigger a run, and commands like `/account` or `/cd` are usable by all. **That's fine for personal use** — but for a shared team setup, or anywhere you don't want strangers calling `/cd /`, you can tighten three allowlists by sending `/config` inside Feishu.

### Common scenarios

**Just me**

In the `/config` form:
- **Allowed users**: your own `open_id`
- Leave the other two blank

Messages from anyone else are silently dropped — no denial reply, since that would just confirm the bot exists to outsiders.

**A small team**

- **Allowed users**: comma-separated `open_id`s of team members
- Other two blank

**Bot only responds in specific work groups**

DMs are unaffected; only listed groups trigger responses:
- **Allowed chats**: comma-separated `chat_id`s of the groups
- DMs are **always** exempt from this list — so you can always DM the bot to change config later.

**Anyone can chat with the bot, but only I can change settings**

- **Admins**: your own `open_id`
- Other two blank

Others running `/account`, `/config`, `/exit`, `/reconnect`, `/doctor`, `/cd`, or `/ws` get a `❌ 此命令仅管理员可用` reply. Normal conversation (asking the bot to do things) is unaffected.

**Lock everything down**

Fill all three. The `/config` form catches common mistakes — e.g. if your admin list doesn't include yourself, or your chat allowlist doesn't include the chat you're submitting from, the submit is rejected with a message explaining why, so you can't accidentally lock yourself out.

### Finding `open_id` and `chat_id`

Easiest path: have the target user send the bot a message (or `@`-mention it in the target group), then in your terminal:

```bash
grep '"event":"enter"' ~/.lark-codex/logs/$(date +%Y-%m-%d).log | tail -5
```

Every line carries `chatId` (group or DM id) and `senderId` (the user's `open_id`). Copy them from there.

The Feishu open-platform "Get user info" API also works but needs the `contact:user` scope, which is overkill if you just need a couple of IDs.

### Worth knowing

- Changes take effect on the **next message** — no restart needed.
- An empty field means **unrestricted**, not "nobody allowed".
- To revert a restricted list back to fully open, clear that field in `/config` and submit.
- DMs are deliberately exempt from the chat allowlist — meaning if you ever accidentally restrict the bot out of every group, **DM the bot and send `/config`** to recover.

### Advanced: editing the config file directly

The `/config` form writes to `~/.lark-codex/config.json` under `preferences.access`:

```json
{
  "preferences": {
    "access": {
      "allowedUsers": ["ou_xxxxxxxxxxxxx"],
      "allowedChats": ["oc_xxxxxxxxxxxxx"],
      "admins":       ["ou_xxxxxxxxxxxxx"]
    }
  }
}
```

After a manual edit, **restart the bridge** or send **`/reconnect`** from any allowed chat to pick up the changes. The form is usually faster; direct edits make sense mostly for deployment scripts where you want to pre-seed access policy.

## FAQ

**The bot stays silent / Codex never replies.** Usually the `codex` CLI itself is not logged in, or the session points to a cwd that no longer exists. Send `/status` to inspect; `/new` to start a fresh session.

**Codex subprocess looks frozen (card stuck on the last frame).** Since 0.1.20 there's an idle watchdog: if Codex emits nothing for N minutes the process is killed and the card is annotated `⏱ N min no response, auto-terminated`. Disabled by default. Enable with `/config` (global, in minutes), or `/timeout 10` to set it on the current session; `/timeout off` disables for the session; `/timeout default` clears the session override.

**Codex says it can't see the image I sent.** Confirm your local Codex CLI supports `codex exec --image`, then check the downloaded attachment path in the bridge logs.

## Maintainer Release

This project publishes through GitHub Actions + npm Trusted Publishing. See [docs/release.md](./docs/release.md).

## License

[MIT](./LICENSE)
