# V1.2 实验门控示例

这是可复制到**实际科研 Git 仓库根目录**的示例，不含真实实验实现。启动 Codex 时以仓库根目录为工作目录；若从子目录启动，需将 `commandWindows` 改为稳定的脚本绝对路径。合并已有 `.codex/hooks.json`，不要直接覆盖。项目与新 Hook 均需在 Codex 中完成信任审查。

## 三个记录

- `experiments/plans/EXP-001.md`：计划正文，按文件原始字节计算 SHA-256。
- `audits/experiment-gates/EXP-001.json`：`{"experiment_id":"EXP-001","verdict":"PASS","plan_sha256":"<64位小写SHA-256>"}`。
- `approvals/EXP-001.json`：`{"experiment_id":"EXP-001","approved":true,"plan_sha256":"<相同SHA-256>"}`。

审计记录由独立审查过程提交；批准记录由研究者控制。若执行体对这些 JSON 有写权限，仍可伪造记录，不能把本示例称为完整安全边界。正式项目应通过分支保护、独立权限或 CI 核验来源。

## 流程

1. 冻结计划并计算 SHA-256。独立 Codex 审查当前计划，得到 PASS、REVISE 或 BLOCK。
2. PASS 后向研究者展示 Preview；只有研究者批准，才记录批准 JSON。
3. 使用 `py -3.14 scripts/run_experiment.py --experiment EXP-001`。PreToolUse 检查匹配到的命令；启动器再次检查计划、审计和批准文件。
4. 将项目实际实验实现接入 `scripts/run_experiment.py` 的 `run()`。未接入时仅打印授权信息，**不会执行实验**。

Hook 只检查被匹配的 `Bash` 工具调用，其他启动方式可能绕过。启动器的二次检查也只保护通过该入口运行的实验；后续应结合项目入口规范与 Git/CI 保护。

