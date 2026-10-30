# DSH 审计端最小实现：`dsh-audit-local-minimal`

把本仓库协议（[WORKFLOW.md](../../WORKFLOW.md)、[BOUNDARIES.md](../../BOUNDARIES.md)）中的
“无跨会话记忆的独立审计 Agent”落成**可运行的 DeepSeek Harness（DSH）本地插件**：

- `audit-guard`：在 DSH 工具流水线上做 deny-by-default 白名单（只放行 4 个审计工具），
  限制每进程 29 次取证调用，并保证每进程最多一次成功结论提交；预算耗尽后只接受 `Unknown`。
- `audit-tools`：`audit_diff` / `audit_read_range` / `audit_search` / `submit_review` 四个工具，
  只读固定 Git 基线、返回整文件 SHA-256、把候选结论写到 `<workspace>/.audit/reviews/`。
- 两个专用 profile：`audit`（交互式 Web UI）与 `audit-headless`（一次性/批处理）。
- 启动脚本、交接包模板与一份 fail-closed 策略草案。

> 本实现是**工具级权限**，不是 Windows 操作系统级沙箱；它不改变“研究者裁决、审计体只读、
> 执行体整改”的协议边界。`submit_review` 写入的是**候选结论**（`final_verdict_authoritative: false`），
> 权威判定仍由人写入 `audits/` 下的实验门控记录。

## 目录

```text
implementations/dsh-audit-local-minimal/
├── README.md                     # 本文件
├── KNOWN_ISSUES.md               # 已知缺陷、限制与部署陷阱
├── plugin/                       # DSH 插件包本体（可 dsh plugin add 的目录）
│   ├── package.json
│   ├── README.md                 # 插件包的简要安装说明（原始版本）
│   ├── dsh/cordis.patch.yml      # 把两个插件插入 profile 的 bundle patch
│   ├── dsh/plugins/audit-guard/  # index.ts（源码）+ index.js（部署产物）
│   ├── dsh/plugins/audit-tools/  # 同上
│   ├── scripts/                  # Get-AuditBaseline / Start-AuditWeb / Invoke-AuditHeadless（.ps1 + .cmd）
│   └── docs/                     # 本机部署验证据录 + 审计交接包模板
├── profiles/
│   ├── audit.cordis.patch.yml            # 交互式审计 profile 的用户补丁层
│   └── audit-headless.cordis.patch.yml   # 无界面审计 profile 的用户补丁层
└── policy/
    └── audit-capability.json     # fail-closed 审计能力策略草案（设计目标，非现成配置）
```

## 与协议六项最小核验包的对应

| `BOUNDARIES.md` 要求 | 本实现的落点 |
| --- | --- |
| 审计目标和范围 | 研究者/执行体在交接包（`plugin/docs/handoff-template.md`）里写 `check_id` 与判据 |
| 固定版本 | `DSH_AUDIT_BASE` 指定冻结 commit/tag；`audit_diff` 不接受会漂移的“当前目录”作为基线 |
| 交付物清单 | 交接包第 3 节；审计体用 `audit_read_range` 逐项核对 |
| 原始证据入口 | `audit_read_range` / `audit_search` 只读 `DSH_AUDIT_WORKSPACE` 内相对路径，返回整文件 SHA-256 |
| 问题与判据 | 每个 `check_id` 一次 `submit_review`（Success / Fail / Unknown） |
| 已知限制 | 上下文中的 `Unavailable` / `incomplete` / `truncated` 字段；`Unknown` 必须写明缺什么 |

## 部署

前提：DSH 0.2.x（需 `ctx.tools.guard()`、`ctx.tools.restrict()`、`defineTool().output`）；
Node.js ≥ 22。先确认版本，不要强行安装到更低版本：

```powershell
dsh --version
```

### 部署源：让本仓库成为唯一部署源（第 1 点，推荐）

`dsh plugin add <dir>` 在 profile 里创建的是指向真实目录的 **junction / 链接**，不是副本，
profile 加载的就是链接目标。因此把链接直接指向本仓库的克隆，仓库即成为唯一部署源：
升级是 `git pull`，回滚是 `git checkout <tag|commit>`，不必再在 `Downloads` 或临时解压
目录里维护第二份“活目录”（两份迟早漂移，而且那份副本不在版本控制下）。

```powershell
# 1) 克隆到稳定路径（不要放 %TEMP%，也不要指向 Downloads 里的解压目录）
git clone https://github.com/yankeetsui7/multiagents-based-paper-writing-and-audit-workflow D:\dsh-audit-workflow

# 2) 两个 profile 都要改：各自有一条 link，共享同一实体
dsh plugin --profile audit           remove dsh-audit-local-minimal
dsh plugin --profile audit           add 'D:\dsh-audit-workflow\implementations\dsh-audit-local-minimal\plugin'
dsh plugin --profile audit-headless  remove dsh-audit-local-minimal
dsh plugin --profile audit-headless  add 'D:\dsh-audit-workflow\implementations\dsh-audit-local-minimal\plugin'

# 3) 确认链接目标是仓库，而不是 Downloads / 临时目录
Get-Item "$HOME\.dsh\profiles\audit\node_modules\dsh-audit-local-minimal" |
  Select-Object FullName, LinkType, Target   # 期望 LinkType=Junction，Target=D:\dsh-audit-workflow\...
```

改完重启 DSH，再用 `dsh --profile audit --dump-config` 确认：`audit-guard` / `audit-tools`
的 `index.js` 路径落在仓库克隆内。迁移期间的注意事项：

- 链接切换前，旧实体 `Downloads\dsh-audit-minimal\dsh-audit-minimal` 仍是活部署，先别删；
- 切换并完成一次 headless 冒烟后，旧实体与旧 ZIP 就只是历史快照，可归档（本仓库已含
  同版本源码，且 `.ts` 已同步 fail-closed 逻辑，不必再留第二份活副本）；
- 不要手工往 `node_modules` 里复制文件——那会删掉 junction、让两个 profile 分叉（见
  `KNOWN_ISSUES.md` 第 1 条）。

1. **创建专用 profile**（不要与日常 `desktop` / `web` 共用）：

   ```powershell
   dsh --profile audit --from-default-profile web --dump-config
   dsh --profile audit-headless --from-default-profile headless --dump-config
   ```

2. **把本仓库的插件目录装进 profile**（`dsh plugin add` 会用 `link:` 指向该目录，
   不会复制；因此插件目录应放在稳定位置，不要用临时解压目录）：

   ```powershell
   dsh plugin --profile audit          add '<repo>\implementations\dsh-audit-local-minimal\plugin'
   dsh plugin --profile audit-headless add '<repo>\implementations\dsh-audit-local-minimal\plugin'
   dsh --profile audit          --dump-config   # 应出现 id: audit-guard / id: audit-tools
   dsh --profile audit-headless --dump-config
   ```

   这就是上面「部署源（第 1 点）」的落地方式；如果本机已有指向 `Downloads` 的旧 link，
   按该节的 `remove` + `add` 步骤迁移，不要保留两份活目录。

3. **叠加 profile 补丁**：把 `profiles/*.cordis.patch.yml` 的内容并入对应
   `~/.dsh/profiles/<name>/cordis.patch.yml`。它们只做两件事：把默认模型改到可用的
   凭据路由（`deepseek-account`），以及在 headless profile 里重新启用
   `authorization` / `credentials` / `deepseek-account` 三行（headless bundle 默认关闭，
   不启用会报 `ACCOUNT_SIGN_IN_REQUIRED`）。用 API Key 的话把 provider 改回
   `deepseek-official` 并导出 `DEEPSEEK_API_KEY`。

4. **启动一次审计**：

   ```powershell
   # 交互式（推荐周审/终审）
   .\plugin\scripts\Start-AuditWeb.ps1 -Workspace 'D:\path\to\research-repo' -Base '<frozen-sha>'

   # 一次性/批处理：Prompt 必须压成一行（DSH CLI 多行 prompt 只取首行）
   .\plugin\scripts\Invoke-AuditHeadless.ps1 -Prompt '<one-line audit instruction>' -Base '<frozen-sha>'
   ```

   脚本里 `$dsh` 的路径与默认 `-Workspace` 是某台机器的本地值，使用前按本机实际路径修改。

## 审计会话的环境变量

| 变量 | 含义 | 备注 |
| --- | --- | --- |
| `DSH_AUDIT_WORKSPACE` | 被审科研仓库根目录 | 必须位于 Git 仓库内，否则 `audit_diff` 返回 `unavailable` |
| `DSH_AUDIT_BASE` | 对比基线 commit/tag | 默认 `HEAD`；周审/终审**必须**用冻结 commit，不要用 `HEAD` |
| `DSH_AUDIT_STAGE` | `data_audit` 或 `conclusion` | 只有 `conclusion` 阶段才允许 `submit_review` |
| `DSH_AUDIT_RUN_ID` | 本轮运行标识 | 写入 review JSON 的 `run_id`，便于审计记录归档 |

## 预算与结论语义（fail-closed）

- 每进程最多 **29 次取证调用**（`audit_diff` / `audit_read_range` / `audit_search`）+
  **1 次成功提交**（`submit_review`）。到顶即标记预算耗尽。
- 预算耗尽后，只有 `verdict = Unknown` 的提交会被接受；`Success` / `Fail` 一律以
  `BUDGET_VERDICT_DENY` 拒绝。提交在校验/写盘失败时释放名额（可用合法重试），
  成功后才永久锁定。
- 这是**工具调用次数**预算，不等于模型 token 额度。真正的费用硬上限需要 DSH 侧
  的模型用量限制/API 配额，本插件不假装实现。

## 安全边界

- 只约束经过 DSH 工具注册表的调用；同一 Windows 账户仍有源码写权限，不能据此宣称
  “绝对无法修改源码”，也不是 OS 沙箱。
- SHA-256 校验的是“提交时文件内容”；执行体并发改动会使旧哈希失配，此时应重审或
  给 `Unknown`。
- 空 diff、`incomplete` 的搜索、截断的读取都不能推出“审计通过”。
- `audit_search` 只扫描白名单文本扩展名，不能证明覆盖了全部引用。
- 插件自带的 `plugin/docs/dsh-setup.md` 是一台 Windows 11 机器的**部署与验收记录**
  （本机路径、`--dump-config` 输出、headless 实跑与 20/20 用例），可当作端到端样例，
  但不能当作跨机器“已通过”的保证。

## 相关

- 已知问题与部署陷阱：[KNOWN_ISSUES.md](KNOWN_ISSUES.md)
- 审计交接包模板：[plugin/docs/handoff-template.md](plugin/docs/handoff-template.md)
- 本机部署验证据录：[plugin/docs/dsh-setup.md](plugin/docs/dsh-setup.md)
- 协议与边界：[WORKFLOW.md](../../WORKFLOW.md)、[BOUNDARIES.md](../../BOUNDARIES.md)、
  [DEPLOYMENT.md](../../DEPLOYMENT.md)
