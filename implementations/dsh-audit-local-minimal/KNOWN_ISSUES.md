# 已知问题与部署陷阱

按严重程度排列，均来自本机部署与验收时实际遇到的失败。

## 1. 不要手工覆盖 `node_modules` 里的插件目录（会破坏 junction）

`dsh plugin add <dir>` 在 profile 的 `node_modules` 下创建的是 **junction / 符号链接**，
指向插件真实目录。若按“把文件复制进 `~/.dsh/profiles/<name>/node_modules/dsh-audit-local-minimal`”
的方式升级（有些补齐补丁的说明会这么写），会先删除链接再写入副本：

- 两个 profile 原本共享同一实体目录，覆盖后各自分叉，后续升级只更新其中一个；
- 删除链接后，原实体目录仍在，容易留下“看似已升级、实际没生效”的假象。

正确做法：直接更新插件真实目录，然后重新 `--dump-config` 确认；升级/回滚都作用于实体目录。

## 2. 旧压缩包会装回“无闸门回退版”

本机早先导出的 `dsh-audit-minimal.zip` 是修复前的快照（`audit-guard/index.js` 仍会
直接调用 `ctx.tools.restrict()`，在 DSH 0.2.1-rc.3 上抛错导致整条 guard 插件失活）。
如果从那个 zip 重装，得到的是“没有 guard 的审计 profile”。**以本仓库为准**，不要用旧 zip。

## 3. `restrict()` 在 DSH 0.2.1-rc.3 上会抛错（已降级处理）

`tools.restrict()` 要求在 agent 作用域内调用；profile 级插件是全局上下文，调用会抛
`tools.restrict() requires a scoped context (agent.ctx)`，并且**整条 guard 插件失活**。
当前实现用 `try/catch` 降级：工具隐藏失效，但下面的 `ctx.tools.guard()`（全局
deny-by-default）仍然生效，拒绝强度不变。若将来的 DSH 支持按 agent 作用域限制工具，
应按官方方式改回真正的工具白名单。

## 4. `index.ts` 与 `index.js` 是双份：改 js 必须同步 ts

DSH 实际加载的是 `index.js`；`index.ts` 是源码。本仓库内的两份文件已同步到
fail-closed 版本（预算检查 `beginAuditReview` / `finishAuditReview`）。如果只改 js 不改 ts，
下一次“按 ts 重新转译”会静默回退补丁，而且 diff 里看不出来。

## 5. 预算语义容易被误读

- 29 次预算统计的是**工具调用次数**，不是 token 数，也不是模型请求数。
- 预算耗尽后只接受 `Unknown`；这是有意的 fail-closed，不是 bug。
- `submit_review` 每进程一次：多个 `check_id` 必须分批运行，或先 `data_audit` 取证、
  再按主张分组进入 `conclusion`。

## 6. 工作区必须是 Git 仓库，且 `.audit/` 应被忽略

`audit_diff` 依赖 `DSH_AUDIT_WORKSPACE` 内的 Git；非 Git 目录返回
`status: "unavailable"`（不是“无变化”）。`.audit/reviews/` 是审计产物，建议加进
工作区 `.gitignore`，避免候选结论混入被审版本。

## 7. 结论是候选，不是权威判定

`submit_review` 写出的 JSON 带 `verification: file_sha256_matches_at_submission` 和
`final_verdict_authoritative: false`。权威结论由研究者写入实验门控记录；不要把
`candidate_verdict: Success` 当成“审计通过”。

## 8. 工具名与 `policy/audit-capability.json` 草案不一致

策略草案里的工具名（`audit_read` / `audit_verify`）是早期设计目标，当前实现的工具名是
`audit_diff` / `audit_read_range` / `audit_search` / `submit_review`。草案只作为
fail-closed 原则参考，不要直接当配置使用。

## 9. 这不是 OS 级沙箱

插件只拦截经过 DSH 工具注册表的调用。同一 Windows 账户、其它本地进程、或可卸载
插件的路径都不受约束；需要更强隔离时应在操作系统/账户层面另做。

## 10. 启动脚本含机器本地路径

`plugin/scripts/*.ps1` 里 `$dsh = 'D:\DS Harness\resources\runtime\cli\bin\dsh.cmd'`
和默认 `-Workspace` 是某台机器的本地值；移植时按本机路径修改，否则脚本直接 throw
“dsh CLI not found”。
