# DSH 端配置与验收记录（audit-minimal 插件）

本文件记录该插件在**本机** DeepSeek Harness（DSH 0.2.1-rc.3 桌面版）上的实际配置、
验收证据与已知限制。插件本身的说明见项目根 `README.md`。

---

## 1. 结论速览

| 项目 | 状态 |
| --- | --- |
| 专用 `audit` profile（交互式 Web UI） | ✅ 已创建并装载插件 |
| 专用 `audit-headless` profile（一次性/批处理） | ✅ 已创建并实测跑通 |
| audit-tools 四个工具 | ✅ 全部注册，逻辑 20/20 通过 |
| audit-guard 拒绝闸门 | ✅ 实测 `AUDIT_DENY` / `STAGE_DENY` / `REVIEW_DENY` / `BUDGET_EXCEEDED` |
| submit_review 写盘 + SHA 复核 | ✅ 实测写出唯一一份 review JSON |
| 真实模型端到端（账号路由） | ✅ 已跑通（headless 实测两次） |
| 工作区 git 基线 | ✅ `D:\3-4论文\实验文件` 已建仓，冻结 tag `freeze-2026-10-30`（commit `db0e7ef`），`audit_diff` 实测可见改动 |
| `.gitignore` 取舍 | ✅ 入库 665 文件 / 6.23 MB，出库 1.37 GB 运行产物（靠 SHA 清单核对） |

**与插件原始代码的唯一差异**：`dsh/plugins/audit-guard/index.{ts,js}` 里
`ctx.tools.restrict(...)` 改成 try/catch 降级（第 6 节详述）。其余文件未改动。

---

## 2. DSH 侧改动清单

### 2.1 新增 profile：`audit`（交互式审计）

- 目录：`C:\Users\Yankee TSui\.dsh\profiles\audit\`
- 生成方式：`dsh --profile audit --from-default-profile web --dump-config`
- 安装插件：`dsh plugin --profile audit add 'C:\Users\Yankee TSui\Downloads\dsh-audit-minimal\dsh-audit-minimal'`
  - 结果：`package.json` 的 `dependencies` 增加
    `"dsh-audit-local-minimal": "link:C:/Users/Yankee TSui/Downloads/dsh-audit-minimal/dsh-audit-minimal"`，
    `dsh.profile.bundles` 变为
    `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-audit-local-minimal"]`。
- 用户补丁层 `cordis.patch.yml`：

```yaml
- id: agent-default-model
  config:
    provider: deepseek-account
    model: deepseek-flash
    reasoningEffort: high
```

  base 层默认 `provider: deepseek-official` 需要 `DEEPSEEK_API_KEY`；本机没配 Key，
  但有 DeepSeek 账号登录凭据（`~/.dsh/.credentials.yaml` 里有
  `deepseek-account-platform/default` grant），所以走 `deepseek-account` 路由。

### 2.2 新增 profile：`audit-headless`（一次性/批处理审计）

- 目录：`C:\Users\Yankee TSui\.dsh\profiles\audit-headless\`
- 生成方式：`dsh --profile audit-headless --from-default-profile headless --dump-config`
- 安装插件同上（`dsh plugin --profile audit-headless add <插件目录>`）。
- 用户补丁层 `cordis.patch.yml`：

```yaml
- id: agent-default-model
  config:
    provider: deepseek-account
    model: deepseek-flash
    reasoningEffort: high

- id: authorization
  disabled: false
- id: credentials
  disabled: false
- id: deepseek-account
  disabled: false
```

  **为什么必须重新启用这三行**：`@deepseek-ai/dsh-headless` bundle 默认把
  `authorization` / `credentials` / `deepseek-account` 三行 `disabled: true`（它假定无浏览器
  就无法登录）。不启用时账号路由会报：

```
ACCOUNT_SIGN_IN_REQUIRED: Sign in to DeepSeek to use the account provider.
The request destination must allow account authentication.
```

  这是本次排查中最关键的一处 DSH 端配置；只改 `agent-default-model` 是不够的。

### 2.3 没有动过的东西

- 正在使用的 `desktop` profile（GUI 用的那个）与 `web` profile **完全未改**。
  原因：插件是 deny-by-default，装进日常 profile 后所有工具都会被拒。
- `D:\DS Harness`（安装目录）与 `D:\Deepseek Harness`（开发 checkout）均未修改。
- 插件包内除 audit-guard 的 try/catch 外未改动。

---

## 3. 怎么用

### 3.1 交互式（推荐日常周审/终审）

```powershell
& 'C:\Users\Yankee TSui\Downloads\dsh-audit-minimal\dsh-audit-minimal\scripts\Start-AuditWeb.cmd' `
  -Workspace 'D:\3-4论文\实验文件' -Base HEAD -Stage conclusion
```

浏览器打开脚本打印的 `http://127.0.0.1:3080/?token=...`，在网页里和审计 agent 对话。
审计会话里模型只能调用 `audit_diff` / `audit_read_range` / `audit_search` / `submit_review`。

### 3.2 一次性（脚本化/批处理）

```powershell
& '...\scripts\Invoke-AuditHeadless.cmd' `
  -Workspace 'D:\3-4论文\实验文件' -Base 'HEAD' -Stage conclusion `
  -Prompt 'Call audit_diff, then audit_read_range audit_subject.md 1-200, then submit_review with the sha256 it printed, verdict Fail, finding ..., suggestion ...'
```

注意：**prompt 必须单行**。实测 DSH CLI 传给 agent 的只有第一行，多行会被截断。
需要长指令时先 `(Get-Content xx.md -Raw) -replace '\s+', ' '` 压成一行再传。

### 3.3 先检查基线证据

```powershell
& '...\scripts\Get-AuditBaseline.cmd' -Workspace 'D:\3-4论文\实验文件'
```

输出 HEAD SHA、脏文件、未跟踪文件；不是 git 仓库时退出码 2 并给出两种补救方案。
把打印出的 SHA 写进 handoff 包，作为 `DSH_AUDIT_BASE` 的冻结基线。

**该工作区现在已经是 git 仓库**（见 §4.4），冻结基线：

```
commit db0e7ef9ffc533f90df382834aad1ae0fb172159
tag    freeze-2026-10-30
```

所以日常审计应当显式传冻结基线，而不是用默认的 `HEAD`：

```powershell
& '...\scripts\Start-AuditWeb.cmd' -Workspace 'D:\3-4论文\实验文件' `
  -Base 'freeze-2026-10-30' -Stage conclusion
```

`-Base HEAD` 只审“未提交的工作树改动”，适合“冻结后马上被改”的即时检查；
`-Base freeze-2026-10-30` 审“自冻结以来的一切已跟踪改动”，适合周审/终审。

### 3.4 环境变量（脚本会自动设置）

| 变量 | 含义 | 默认 |
| --- | --- | --- |
| `DSH_AUDIT_WORKSPACE` | 审计根目录；取证与 `.audit\reviews` 都限定在这里 | 插件内置 `D:\3-4论文\实验文件` |
| `DSH_AUDIT_BASE` | diff 基线：`HEAD`、冻结 commit SHA 或 tag | `HEAD` |
| `DSH_AUDIT_STAGE` | `conclusion` 才允许 `submit_review`；`data_audit` 只取证 | 未设时拒绝提交 |
| `DSH_AUDIT_RUN_ID` | 写入 review JSON 的 run_id，便于对账 | `manual-run` |

---

## 4. 验收证据

### 4.1 工具逻辑验收（脱离 DSH 运行的确定性测试）

`audit-e2e.mjs` 把 `@deepseek-ai/dsh-tools` 打桩（`defineTool = o => o`），在临时 git
仓库上直接驱动插件逻辑：**20/20 全部通过**，覆盖：

- 4 个工具注册、`audit_diff` 非 git 时 `unavailable`、diff+未跟踪、`INVALID_BASE`
- `audit_read_range` 全文件 SHA-256、1-based 行号、160 行截断、`PATH_DENY`（绝对路径/`..`/`.audit`）、`FILE_DENY`（二进制）、`LINE_DENY`
- `audit_search` 命中与空查询 `SEARCH_DENY`
- `submit_review` 的 `EVIDENCE_NOT_READ`、`EVIDENCE_INVALID`、`INVALID_CHECK_ID/SHA256/VERDICT/REVIEW_TEXT`、`STAGE_DENY`，以及成功路径只写唯一 JSON
- guard：29 次取证后第 30 次 `BUDGET_EXCEEDED`、第二次提交 `REVIEW_DENY`

### 4.2 真实 DSH 进程 + 真实模型（headless）

夹具工作区：`%TEMP%\audit-e2e-live\ws`（git 基线已提交，之后手改 `run_baseline.m`）。
实测终端输出（节选）：

```
[audit-guard] restrict() skipped (...); global guard still denies every non-audit tool
[audit-guard] ready: deny-by-default, 29 evidence calls + 1 review
[audit-tools] ready; workspace=...\ws
[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 2 model(s)
```

模型实际行为（一次会话内）：

- `audit_diff` → `status: ok`，看到 `iters = 25; % changed after freeze` 的 diff
- `working_directory` / `glob` / `pwsh` → 均被拒：`AUDIT_DENY: tool ... is not allowed`
- `audit_search 'freeze'` → 命中 `run_baseline.m:2`
- `audit_read_range audit_subject.md` → 返回 sha256 `020e5717…9bb73`
- `submit_review` → `submitted: true`，写入
  `.audit\reviews\review-7600cf46-89c0-4d7d-a0c4-b407fa505372.json`（1824 B）

review JSON 实际字段（节选）：

```json
{
  "review_id": "7600cf46-89c0-4d7d-a0c4-b407fa505372",
  "run_id": "probe-005",
  "check_id": "EXP-E2E-001",
  "path": "audit_subject.md",
  "sha256": "020e57174739af0f4390375167b840653201935ec6f01c399239b90aba39bb73",
  "candidate_verdict": "Fail",
  "verification": "file_sha256_matches_at_submission",
  "final_verdict_authoritative": false
}
```

### 4.3 重启复验

- `audit` profile（web）：`Start-AuditWeb.cmd -Port 3099` 启动后打印
  `[audit-guard] ready` / `[audit-tools] ready` / `dsh web: http://127.0.0.1:3099/?token=…`；
  带 token 的 `GET /` 返回 200（37907 B HTML），**不带 token 返回 401**（浏览器信任围栏生效）。
- `audit-headless` profile：`Invoke-AuditHeadless.cmd -Prompt '…'` 实测两次成功
  （一次 SHA 取证问答、一次 diff+取证问答），均先打印两条 ready 日志再调用模型。
- 两个 profile 的 `package.json` 都包含 `dsh-audit-local-minimal` 这个 bundle，
  `--dump-config` 能看到 `audit-guard` / `audit-tools` 两行。

### 4.4 真实工作区实测（`D:\3-4论文\实验文件`）

该工作区原本没有 git，`audit_diff` 返回 `status:'unavailable'`。现已就地建仓并冻结基线：

| 项 | 值 |
| --- | --- |
| 仓库 | `D:\3-4论文\实验文件\.git`（branch `main`） |
| 冻结 commit | `db0e7ef9ffc533f90df382834aad1ae0fb172159` |
| 冻结 tag | `freeze-2026-10-30` |
| 入库文件 | 665 个 / 6.23 MB（`.m` `.md` `.txt` `.py` `.json` 等可人手审的源材料） |
| `.git` 体积 | 1.01 MB（`git gc --prune=now` 后） |
| 出库（被 `.gitignore` 忽略） | 约 62,000 个 / 1.37 GB：`results/_runtime/`（SVG 绘图中间产物）、`*.mat` `*.csv` `*.db` 等 |

用真实工作区直接驱动插件工具（不经过模型）的结果：

```json
// audit_diff（干净，base = 冻结 commit）
{"status":"ok","baseline":"db0e7ef…","diff":"","diff_truncated":false,"untracked_files":[],
 "empty_not_proof":true,"complete":true}

// audit_diff（故意改一个已跟踪文件 + 加一个未跟踪文件）
{"status":"ok","diff":"diff --git a/AGENTS.md b/AGENTS.md\n… +<!-- probe -->",
 "untracked_files":["__audit_probe_tmp.txt"],"empty_not_proof":false,"complete":true}

// audit_read_range（file_path 参数名，不是 path）
{"path":"AGENTS.md","sha256":"5b3a2f75…c668","start_line":1,"end_line":12,
 "total_lines":27,"truncated":false}

// audit_search
{"matches":[{"file":"AGENTS.md","line":10,"excerpt":"… review for that exact plan SHA-256."},
 {"file":"bsm1_file_sha256_20261014.m","line":13,"excerpt":"… 'SHA-256' …"}],
 "files_scanned":160,"incomplete":true}

// 路径逃逸
refused: PATH_DENY: parent or protected directory is forbidden
```

注意 `audit_search` 返回 `incomplete:true`（有界搜索，最多 160 文件/20 命中）；
判断“工作区里没有 X”之前必须缩小 `file_path` 范围。

另一个实测教训：插件参数名是 **`file_path`**（`audit_diff` / `audit_read_range` /
`audit_search` / `submit_review` 全部如此），传 `path` 会得到 `PATH_DENY: invalid path`。

**真实模型 + 真实工作区端到端**（`Invoke-AuditHeadless.cmd`，2026-10-30）：

```
[audit] headless run real-ws-audit-001 | base=freeze-2026-10-30 stage=conclusion
[audit-guard] ready: deny-by-default, 29 evidence calls + 1 review
[audit-tools] ready; workspace=D:\3-4论文\实验文件
[llm-deepseek-account] model listing … loaded 2 model(s)
→ 模型依次调用 audit_diff（空树，自己指出 empty_not_proof:true）、
  audit_read_range AGENTS.md 1-30（sha 5b3a2f75…c668）、submit_review（verdict Unknown）
→ 落盘 .audit\reviews\review-1b99167c-0920-4725-81d0-4e480a8d20ec.json（637 B）
```

review JSON 关键字段：`run_id real-ws-audit-001`、`check_id WS-AGENTS-001`、
`sha256` 与文件实测一致、`verification "file_sha256_matches_at_submission"`、
`final_verdict_authoritative false`。`.audit/` 已被 `.gitignore` 排除，工作树仍干净。

注意：**别只看退出码**。实测有的成功运行（含 `submit_review`）`dsh` 返回 1，
建议以“`.audit\reviews` 是否出现新 JSON + ready 两行日志”为成功判据（脚本会打印清单）。

---

## 5. 与 `D:\3-4论文\实验文件\AGENTS.md` 的对接建议

该协议要求 DSH 作为**独立、无记忆**的审计方，通过固定版本交接。落地建议：

1. **给实验工作区建 git —— 已完成**（§4.4）。冻结 commit `db0e7ef` / tag
   `freeze-2026-10-30`；之后每次改动都有 diff 可审 —— 这是 `audit_diff` 唯一的信息来源。
   新实验冻结时：`git add -A && git commit -m 'freeze EXP-NNN' && git tag freeze-YYYY-MM-DD`，
   把新 commit SHA 写进交接包。
2. handoff 包固定写：`DSH_AUDIT_WORKSPACE`、`DSH_AUDIT_BASE`（冻结 SHA）、
   `DSH_AUDIT_STAGE`、`DSH_AUDIT_RUN_ID`、被审文件清单与各自 sha256、判定标准。
3. 不要给审计侧执行器对话历史；只给可复核的文件与哈希。
4. 审计结论落地：`.audit\reviews\review-<uuid>.json` 是**候选**结论
   （`final_verdict_authoritative: false`），最终判定仍由人写入
   `audits/experiment-gates/EXP-NNN.json`。
5. 交接包直接套模板：**`docs\handoff-template.md`**（冻结版本 / 被审主张与判定标准 /
   证据路径+sha256 / 环境限制 / 期望产出 / 冻结新基线命令）。

---

## 6. 插件源码的一处必要修复（已应用）

**现象**（首次启动，audit profile）：

```
audit-guard (...\.dsh\profiles\audit\node_modules\dsh-audit-local-minimal\dsh\plugins\audit-guard\index.js):
Error: tools.restrict() requires a scoped context (agent.ctx):
a context-global restriction would mask every agent — deny the tool for the intended agent instead
    at Proxy.restrict (...app.asar\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js:2993:31)
dsh: warning: 1 entry did not activate
```

**原因**：DSH 0.2.1-rc.3 的 `ctx.tools.restrict()` 只允许在 agent 作用域调用；
profile 级插件是全局上下文，调用直接抛错，导致整条 audit-guard 插件失活
（此时只剩 audit-tools，**没有拒绝闸门**，是真正的安全风险）。

**修复**（`dsh/plugins/audit-guard/index.ts` 与 `index.js`）：把 `restrict()` 包进 try/catch，
失败只打印一行提示，下方全局 `ctx.tools.guard(...)` 的 deny-by-default 保持不变：

```ts
try {
  ctx.tools.restrict({ allow: [...ALLOWED] })
} catch (error) {
  console.log(
    `[audit-guard] restrict() skipped (${error instanceof Error ? error.message : String(error)}); global guard still denies every non-audit tool`,
  )
}
```

修复后启动日志出现 `[audit-guard] ready: deny-by-default, 29 evidence calls + 1 review`，
且实测非审计工具在调用边界被拒。

---

## 7. 已知限制

1. **`restrict()` 只是“让模型少看到工具”**，本机被降级跳过 ⇒ 模型仍能看到全部工具
   schema（bash/write/pwsh/…），只是调用时被 `AUDIT_DENY` 拒绝。拒绝强度不变，
   但 UI 里会出现这些工具。若要彻底隐藏，需要把审计插件改造成 agent preset
   （preset 内只声明 4 个工具），属于后续增强。
2. **不是操作系统级沙箱**：guard 只拦 DSH 工具调用。插件自身写 review JSON 用的是
   Node `fs`，不经过工具层（这正是它能在只读沙箱下写盘的原因）。
3. **账号路由依赖桌面登录态**：`deepseek-account` 用的是
   `~/.dsh/.credentials.yaml` 里的 grant；退出登录后需重新登录，否则
   `ACCOUNT_SIGN_IN_REQUIRED`。也可以用 API Key 路由（改回 `deepseek-official` + 导出
   `DEEPSEEK_API_KEY`）。
4. **`audit_diff` 只覆盖**：`DSH_AUDIT_BASE..工作树` 的已跟踪改动 + 未跟踪文件清单。
   空 diff **不等于**审计通过（插件返回值里已有 `empty_not_proof` 提示）。
5. **审计预算**：29 次取证 + 1 次提交，超限报 `BUDGET_EXCEEDED`；一次进程只允许提交一次
   （`REVIEW_DENY`）。批量审计请每个被审对象单独起一个进程/会话。
6. **搜索是近似且有界的**：最多 160 个文件、20 处命中，返回里有 `incomplete` 标志。
7. **`audit_diff` 看不到被 `.gitignore` 排除的大体积结果**（`.mat`/`.csv`/`.db`/`results/_runtime/`）。
   这是刻意的取舍：1.37 GB 运行产物不入库，所以“结果数据被改/被换”不会出现在 diff 里，
   只能靠实验的 SHA-256 清单（`bsm1_file_sha256_20261014.m` 产出的 manifest）核对。
   脚本、计划、文档、小体积证据（`*.json`/`*.jsonl`/`*.log`/`*.patch`）仍全程可审。
   写 `.gitignore` 时注意：只支持整行注释，行尾 `# …` 会被当成模式的一部分（踩过一次，
   导致 693 MB 被 `git add`）。

---

## 8. 回滚 / 卸载

```powershell
# 移除插件（保留 profile）
& 'D:\DS Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile audit remove dsh-audit-local-minimal

# 或者直接删掉两个专用 profile（不影响 desktop/web）
Remove-Item -Recurse -Force 'C:\Users\Yankee TSui\.dsh\profiles\audit'
Remove-Item -Recurse -Force 'C:\Users\Yankee TSui\.dsh\profiles\audit-headless'
```

`dsh` 不在 PATH 上，等价的完整路径是
`D:\DS Harness\resources\runtime\cli\bin\dsh.cmd`。
