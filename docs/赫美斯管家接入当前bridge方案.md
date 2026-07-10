# 赫美斯管家接入当前 bridge 方案

> 生成日期：2026-07-09  
> 目标：在不影响现有“虾一号管家”的前提下，把新的飞书机器人“赫美斯管家”也接入当前 `lark-codex-bridge`，并让它默认操作 `C:\Users\Administrator\AppData\Local\hermes`。

## 1. 当前事实与关键判断

当前机器上已经有一个 bridge 进程在运行：

- bot：虾一号管家
- App ID：`cli_aaad313a49381bfd`
- 配置文件：`C:\Users\Administrator\.lark-codex\config.json`
- 当前绑定工作目录：`C:\Users\Administrator\.openclaw`
- bridge 版本：`0.0.2`

当前代码的运行模型是：

- `lark-codex-bridge start` 一次只连接一个飞书 / Lark App。
- 命令支持 `-c <config>`，所以可以用同一套 bridge 程序启动多个独立 bot 进程。
- 不同 bot 应使用不同飞书 App ID；同一个 App 多开会导致飞书开放平台把事件随机分发到某个长连接。
- `config.json` 可以分开，但 `sessions.json`、`workspaces.json`、`processes.json`、日志、加密密钥库仍共用 `C:\Users\Administrator\.lark-codex`。
- 工作目录不是写在 bot 配置里的，而是按飞书会话 scope 存在 `workspaces.json` 里；最简单的设置方式是在对应机器人会话里发送 `/cd <绝对路径>`。

因此推荐方案是：**同一套 bridge 安装，两个 bot 进程，两个配置文件，两个飞书 App，按会话分别绑定 cwd**。

## 2. 成功标准

完成后应满足：

1. `lark-codex-bridge ps` 能同时看到“虾一号管家”和“赫美斯管家”两个运行中的 bot。
2. 虾一号管家的现有会话仍指向 `C:\Users\Administrator\.openclaw`。
3. 赫美斯管家的目标会话执行 `/status` 时，cwd 显示为 `C:\Users\Administrator\AppData\Local\hermes`。
4. 在赫美斯管家里发送普通消息时，Codex 在 Hermes 目录上下文中工作。
5. 任一 bot 重启不要求重新配置另一个 bot。

## 3. 推荐目录与文件命名

保留现有默认配置给虾一号管家：

```powershell
C:\Users\Administrator\.lark-codex\config.json
```

为赫美斯管家新增独立配置：

```powershell
C:\Users\Administrator\.lark-codex\config-hermes.json
```

建议给多 bot 常驻脚本和日志使用以下路径：

```powershell
C:\Users\Administrator\.lark-codex\scripts\Watch-LarkCodexBridge-Multi.ps1
C:\Users\Administrator\.lark-codex\logs\bridge-xiayihao-watchdog.log
C:\Users\Administrator\.lark-codex\logs\bridge-hermes-watchdog.log
```

## 4. 实施步骤

### 4.1 准备赫美斯管家的飞书 App

在飞书开放平台准备一个独立应用，名称建议为“赫美斯管家”。不要复用虾一号管家的 App ID。

需要确认的权限和事件：

- 权限：
  - `im:message`
  - `im:message:send_as_bot`
  - `im:resource`
  - `im:chat`，如果需要让 bot 创建群
  - `drive:drive`，如果需要处理云文档评论
- 事件订阅，长连接模式：
  - `im.message.receive_v1`
  - `card.action.trigger`
  - `drive.notice.comment_add_v1`，如果需要云文档评论 @bot
  - `im.message.reaction.created_v1` / `im.message.reaction.deleted_v1`，可选
  - `im.chat.member.bot.added_v1`，可选

### 4.2 创建赫美斯配置文件

在 PowerShell 中运行：

```powershell
$bridgeCmd = "$env:APPDATA\npm\lark-codex-bridge.cmd"
$hermesConfig = "$HOME\.lark-codex\config-hermes.json"

& $bridgeCmd start -c $hermesConfig
```

如果配置文件不存在，bridge 会进入首次配置向导。按提示完成扫码和 App 绑定。

配置成功后，终端应看到类似：

```text
配置已保存到 C:\Users\Administrator\.lark-codex\config-hermes.json
✓ 已连接  bot: 赫美斯管家 (...)
```

如果当前终端需要继续保留，可先用 `Ctrl+C` 关闭这个前台进程，后面再用后台脚本常驻。

### 4.3 验证两个 bot 配置互不覆盖

检查两个配置文件都存在：

```powershell
Test-Path "$HOME\.lark-codex\config.json"
Test-Path "$HOME\.lark-codex\config-hermes.json"
```

查看两个配置的 App ID，不输出 App Secret：

```powershell
$defaultConfig = Get-Content -Raw "$HOME\.lark-codex\config.json" | ConvertFrom-Json
$hermesConfigObj = Get-Content -Raw "$HOME\.lark-codex\config-hermes.json" | ConvertFrom-Json

[pscustomobject]@{
  XiayihaoAppId = $defaultConfig.accounts.app.id
  HermesAppId = $hermesConfigObj.accounts.app.id
  XiayihaoTenant = $defaultConfig.accounts.app.tenant
  HermesTenant = $hermesConfigObj.accounts.app.tenant
}
```

验收要求：

- `XiayihaoAppId` 和 `HermesAppId` 不相同。
- 两者 `tenant` 通常都是 `feishu`。

### 4.4 启动两个 bot

如果虾一号管家已经在运行，不需要重复启动它。只启动赫美斯管家即可：

```powershell
$bridgeCmd = "$env:APPDATA\npm\lark-codex-bridge.cmd"
$repoDir = "D:\Workspaces\AI\lark-codex-bridge"
$hermesConfig = "$HOME\.lark-codex\config-hermes.json"
$hermesLog = "$HOME\.lark-codex\logs\bridge-hermes-autostart.log"

New-Item -ItemType Directory -Force -Path (Split-Path $hermesLog) | Out-Null
Start-Process powershell.exe `
  -WindowStyle Hidden `
  -WorkingDirectory $repoDir `
  -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location -LiteralPath '$repoDir'; & '$bridgeCmd' start -c '$hermesConfig' *>> '$hermesLog'`""
```

随后验证：

```powershell
lark-codex-bridge ps
```

期望看到两个 bot：

```text
虾一号管家 (...)
赫美斯管家 (...)
```

### 4.5 把赫美斯会话绑定到 Hermes 目录

在飞书里打开“赫美斯管家”的私聊，或把赫美斯管家拉进目标群后 @ 它，发送：

```text
/cd C:\Users\Administrator\AppData\Local\hermes
```

机器人应回复：

```text
✓ 已切换 cwd 到 C:\Users\Administrator\AppData\Local\hermes
（session 已重置）
```

再发送：

```text
/status
```

验收要求：状态卡片里的 cwd 是：

```text
C:\Users\Administrator\AppData\Local\hermes
```

如果赫美斯管家要在多个会话里使用，例如私聊和某个群都要用，则每个会话 scope 都要执行一次 `/cd`。这是当前 bridge 的设计：cwd 跟随飞书会话，而不是跟随 bot 全局配置。

## 5. 建议的后台常驻方案

当前 bridge 没有内置 Windows service 命令，`service` 还是占位命令。建议用一个 PowerShell watchdog 管两个 bot。这样 gateway、Codex、某个 bot 崩溃时，watchdog 可以重新拉起 bridge。

新建：

```powershell
C:\Users\Administrator\.lark-codex\scripts\Watch-LarkCodexBridge-Multi.ps1
```

内容建议如下：

```powershell
param(
  [string]$BridgeCmd = "$env:APPDATA\npm\lark-codex-bridge.cmd",
  [string]$RepoDir = "D:\Workspaces\AI\lark-codex-bridge",
  [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = "Stop"

$logDir = "$HOME\.lark-codex\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$bots = @(
  @{
    Name = "xiayihao"
    Config = "$HOME\.lark-codex\config.json"
    Log = Join-Path $logDir "bridge-xiayihao-watchdog.log"
  },
  @{
    Name = "hermes"
    Config = "$HOME\.lark-codex\config-hermes.json"
    Log = Join-Path $logDir "bridge-hermes-watchdog.log"
  }
)

function Write-WatchLog {
  param([string]$Path, [string]$Message)
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $Path -Value "[$ts] $Message" -Encoding UTF8
}

function Start-BotLoop {
  param([hashtable]$Bot)

  Start-Job -Name "lark-codex-bridge-$($Bot.Name)" -ScriptBlock {
    param($BridgeCmd, $RepoDir, $Bot, $RestartDelaySeconds)

    function Write-WatchLog {
      param([string]$Path, [string]$Message)
      $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
      Add-Content -Path $Path -Value "[$ts] $Message" -Encoding UTF8
    }

    while ($true) {
      try {
        if (-not (Test-Path -LiteralPath $Bot.Config)) {
          Write-WatchLog $Bot.Log "config missing: $($Bot.Config); sleep"
          Start-Sleep -Seconds $RestartDelaySeconds
          continue
        }

        Write-WatchLog $Bot.Log "starting bridge: $($Bot.Name), config=$($Bot.Config)"
        Push-Location $RepoDir
        try {
          & $BridgeCmd start -c $Bot.Config *>> $Bot.Log
        } finally {
          Pop-Location
        }
        Write-WatchLog $Bot.Log "bridge exited: $($Bot.Name)"
      } catch {
        Write-WatchLog $Bot.Log "bridge failed: $($_.Exception.Message)"
      }

      Start-Sleep -Seconds $RestartDelaySeconds
    }
  } -ArgumentList $BridgeCmd, $RepoDir, $Bot, $RestartDelaySeconds | Out-Null
}

foreach ($bot in $bots) {
  Write-WatchLog $bot.Log "watchdog requested for $($bot.Name)"
  Start-BotLoop -Bot $bot
}

while ($true) {
  Start-Sleep -Seconds 60
  Get-Job -Name "lark-codex-bridge-*" | Where-Object State -ne "Running" | ForEach-Object {
    Receive-Job $_ -Keep | Out-Null
  }
}
```

手动启动 watchdog：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$HOME\.lark-codex\scripts\Watch-LarkCodexBridge-Multi.ps1"
```

隐藏后台启动：

```powershell
$watchScript = "$HOME\.lark-codex\scripts\Watch-LarkCodexBridge-Multi.ps1"
Start-Process powershell.exe `
  -WindowStyle Hidden `
  -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$watchScript`""
```

验证：

```powershell
lark-codex-bridge ps
Get-Content -Tail 40 "$HOME\.lark-codex\logs\bridge-hermes-watchdog.log"
Get-Content -Tail 40 "$HOME\.lark-codex\logs\bridge-xiayihao-watchdog.log"
```

## 6. 开机自启动方案

如果希望 Windows 登录后自动启动两个 bot，建议用计划任务启动上面的 multi watchdog。

```powershell
$taskName = "LarkCodexBridgeMultiWatchdog"
$watchScript = "$HOME\.lark-codex\scripts\Watch-LarkCodexBridge-Multi.ps1"

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchScript`""

$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Keep Xiayihao and Hermes lark-codex-bridge bots running" `
  -Force
```

立即启动任务：

```powershell
Start-ScheduledTask -TaskName "LarkCodexBridgeMultiWatchdog"
```

查看任务状态：

```powershell
Get-ScheduledTask -TaskName "LarkCodexBridgeMultiWatchdog" | Format-List TaskName,State
```

取消自启动：

```powershell
Unregister-ScheduledTask -TaskName "LarkCodexBridgeMultiWatchdog" -Confirm:$false
```

## 7. 访问控制建议

默认配置下，bot 对能找到它的人开放。赫美斯管家如果会操作 `C:\Users\Administrator\AppData\Local\hermes`，建议至少设置管理员白名单。

最简单方式是在赫美斯管家私聊里发送：

```text
/config
```

然后设置：

- 管理员 open_id：只填允许管理 `/config`、`/cd`、`/ws`、`/exit` 的人。
- 允许用户：如果要限制谁能使用 bot，就填 open_id 白名单。
- 允许群聊：如果只允许某几个群触发 bot，就填 chat_id 白名单。

注意：

- 设置管理员列表时必须包含你自己的 open_id，否则提交会被 bridge 拒绝，避免自锁。
- 私聊不受群白名单约束，便于误配后回到私聊修复。

## 8. 验收清单

### 8.1 本机进程验收

```powershell
lark-codex-bridge ps
```

应看到两个不同 App ID 的 bot。

### 8.2 配置文件验收

```powershell
$configs = @(
  "$HOME\.lark-codex\config.json",
  "$HOME\.lark-codex\config-hermes.json"
)

foreach ($config in $configs) {
  $j = Get-Content -Raw $config | ConvertFrom-Json
  [pscustomobject]@{
    Config = $config
    AppId = $j.accounts.app.id
    Tenant = $j.accounts.app.tenant
    SecretSource = $j.accounts.app.secret.source
    SecretProvider = $j.accounts.app.secret.provider
  }
}
```

要求：

- 两个 App ID 不同。
- Secret 不以明文展示，通常应为 `source=exec`、`provider=bridge`。

### 8.3 工作目录验收

在虾一号管家会话发送：

```text
/status
```

期望 cwd：

```text
C:\Users\Administrator\.openclaw
```

在赫美斯管家会话发送：

```text
/status
```

期望 cwd：

```text
C:\Users\Administrator\AppData\Local\hermes
```

### 8.4 真实任务验收

在赫美斯管家里发送一个只读问题：

```text
请只读检查当前目录，告诉我这里是不是 Hermes 根目录，以及 config.yaml 是否存在。
```

期望回复包含：

- 当前目录为 `C:\Users\Administrator\AppData\Local\hermes`
- 能看到 `config.yaml`
- 没有把目录切回 `.openclaw`

## 9. 回滚方案

### 9.1 停止赫美斯管家

先查看进程：

```powershell
lark-codex-bridge ps
```

找到赫美斯管家的短 ID 后停止：

```powershell
lark-codex-bridge stop <赫美斯短ID>
```

### 9.2 删除赫美斯配置

确认不再使用后再删除：

```powershell
Remove-Item -LiteralPath "$HOME\.lark-codex\config-hermes.json"
```

如果也要删除密钥库里的 Hermes App Secret：

```powershell
lark-codex-bridge secrets list
lark-codex-bridge secrets remove --app-id <HermesAppId>
```

### 9.3 保留虾一号管家

不要删除：

```powershell
C:\Users\Administrator\.lark-codex\config.json
```

这是虾一号管家的默认配置。

## 10. 风险与边界

1. 当前 bridge 的 `sessions.json` 和 `workspaces.json` 是全局共享文件，不是每个 config 独立文件。一般可接受，因为 key 是 chat scope；但如果两个 bot 被拉进同一个群，理论上可能共享同一个 chat scope 的 cwd/session。建议赫美斯管家和虾一号管家不要长期在同一个群里同时处理同类任务。
2. 如果确实需要“每个 bot 完全独立的 sessions/workspaces/logs/media”，需要改代码支持类似 `LARK_CODEX_HOME` 或 `--data-dir` 的数据目录参数。当前版本不支持。
3. bridge 日志默认写到 `C:\Users\Administrator\.lark-codex\logs\YYYY-MM-DD.log`，两个 bot 的结构化日志会混在同一天文件里；排查时可按 `appId`、`botName`、`procId`、进程 ID 过滤。
4. 首次启动赫美斯配置需要扫码和飞书开放平台配置，无法完全无人值守完成。
5. 如果 Node、npm 全局 shim 或 Codex CLI 路径变化，后台启动可能找不到 `lark-codex-bridge.cmd` 或 `codex`。这时应把绝对路径写入配置的 `preferences.agent.codexBinary`。

## 11. 后续增强建议

如果未来要把多机器人作为长期能力沉淀到 bridge 里，建议新增：

1. `--data-dir <path>` 或 `LARK_CODEX_HOME`，让不同 bot 的 config、sessions、workspaces、logs、media、secrets 都可独立。
2. `service install windows`，正式支持 Windows 计划任务或服务安装。
3. `bot profiles` 配置，允许一个管理文件声明多个 bot：

```json
{
  "bots": [
    {
      "name": "xiayihao",
      "config": "C:\\Users\\Administrator\\.lark-codex\\config.json",
      "defaultCwd": "C:\\Users\\Administrator\\.openclaw"
    },
    {
      "name": "hermes",
      "config": "C:\\Users\\Administrator\\.lark-codex\\config-hermes.json",
      "defaultCwd": "C:\\Users\\Administrator\\AppData\\Local\\hermes"
    }
  ]
}
```

短期不建议为了接入赫美斯管家先做这类改造；现有 `start -c` 已能满足“一套 bridge 接两个飞书机器人”的需求。
