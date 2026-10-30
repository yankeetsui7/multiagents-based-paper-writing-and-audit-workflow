# Codex Desktop + DeepSeek Harness 部署路线

## 架构

Codex Desktop 是持续执行体，DeepSeek Harness 是无跨会话记忆的独立审计体。两者通过同一个 Git 研究仓库交换固定版本的研究产物、状态、决策、审计报告与最小交接包。研究者控制重大 Preview 和最终采用。

## 阶段 1：先运行协议

把 `templates/AGENTS.md` 和三份核心状态模板复制到实际研究仓库根目录。用新的 Codex 会话执行**只读检查**：报告当前科研角色、必须先获得 Preview 批准的操作、当前项目状态；不得修改文件。确认规则能被读取后，再开展正常研究。DeepSeek 审计会话保持独立，只给固定版本和最小交接包。

## 阶段 2：Python 3.14 SessionStart Hook

`examples/executor/stage2/` 提供候选配置和脚本。先在测试仓库运行脚本与配置检查，再复制到真实研究仓库的 `.codex/`。Hook 只检查 Git 根目录和四个必需文件，向 Codex 注入一条简短提醒；不生成总结、不修改文件、不宣称审计通过。

在 Windows 上，示例 `commandWindows` 假定 Codex 从仓库根目录启动。若要从子目录启动，应将命令改成能定位仓库根目录的绝对路径或适配当前 Shell 的定位命令。项目 Hook 只有在项目配置层受信任时才加载；新的或修改过的 Hook 还须按 Codex 的信任流程审查。Python 版本先用 `py -3.14 --version` 核对。部署后新建会话，确认只出现简短状态提示。

## 阶段 3：逐层加入强制检查

[V1.2 接入样板](examples/executor/v1.2/research-project/)已实现针对一个标准实验启动器的 `PreToolUse` 检查及启动器内二次校验，仍需在实际科研仓库适配并做 Codex 客户端触发测试。

1. `AGENTS.md` 要求加载协议、标识角色和重大变更先 Preview；这是行为规则。
2. SessionStart 检查必需状态文件；这是启动提示，不是权限控制。
3. 对少数确定性禁令使用 PreToolUse，例如破坏性命令或受保护文件修改；每条规则先测试正常与拒绝样例，再启用。
4. 用 Python 脚本检查实验元数据和交接包字段完整性。它不能代替方法审计。
5. 用 Git 分支保护或 CI 阻止未审计的候选成果合并为正式版本；这是成果验收门。

不要用简单正则表达式判断“研究阶段是否改变”或“核心结论是否推翻”。这些需要研究者审批和独立审计。DeepSeek Harness 的工具、权限与插件配置应按它自己的运行环境实现，不照搬 Codex Hook 配置。

## 阶段 4：DeepSeek Harness 审计端插件（可运行实现）

[implementations/dsh-audit-local-minimal/](implementations/dsh-audit-local-minimal/) 给出审计端的
DSH 侧实现，不再只是配置建议：

1. `audit-guard`：在 DSH 工具流水线上 deny-by-default，只放行 `audit_diff` / `audit_read_range` /
   `audit_search` / `submit_review`；每进程 29 次取证调用 + 1 次成功提交，预算耗尽后只接受 `Unknown`。
2. `audit-tools`：只读固定 Git 基线、返回整文件 SHA-256、把**候选**结论写入
   `<workspace>/.audit/reviews/`（`final_verdict_authoritative: false`）。
3. 两个专用 profile：`audit`（交互式 Web UI）与 `audit-headless`（一次性/批处理），
   以及启动脚本、交接包模板与 fail-closed 策略草案。

部署与验证据录见该目录的 `README.md`、`plugin/docs/dsh-setup.md`；已知缺陷与部署陷阱见
`KNOWN_ISSUES.md`（例如装进 `node_modules` 会破坏 junction、旧 zip 会装回无闸门版本）。

**部署源约定（第 1 点）**：不要把审计插件放在 `Downloads` 或临时解压目录里当“活目录”。
`dsh plugin add` 创建的是链接，profile 加载的是链接目标；所以让 `link:` 指向本仓库的克隆
（`git clone` 到稳定路径，两个 profile 各做一次 `remove` + `add`），仓库就是唯一部署源：
升级 = `git pull`，回滚 = `git checkout <tag|commit>`，不再需要第二份副本。完整命令、
链接目标核验与迁移注意事项见
[implementations/dsh-audit-local-minimal/README.md](implementations/dsh-audit-local-minimal/README.md)
的「部署源」一节；迁移确认（`--dump-config` + 一次 headless 冒烟）前不要删旧实体与旧 ZIP。

该实现是**工具级权限**而非操作系统沙箱，`submit_review` 的结论不替代研究者的最终裁决；
它与上面 Codex 侧的 Hook 检查互补：Codex Hook 管执行体入口，DSH 插件管审计体出口。

## 验收

- 执行体能从状态文件恢复任务，重要决策有证据与重审条件。
- 审计体以只读固定版本独立初审，之后才能查看历史问题。
- 审计发现由执行体提交整改证据，审计体复核关闭。
- 重大修改经过 Preview；未经审计的成果不能进入正式版本。
- 自动化不额外启动模型总结任务。

