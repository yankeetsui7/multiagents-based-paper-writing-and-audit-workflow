# 审计交接包模板（Codex 执行方 → DSH 审计方）

> 原则：审计方**无记忆**，只信可复核的文件与哈希。不要把执行方对话历史当事实。
> 模板里的 `<...>` 全部填实，缺项的写 `N/A` 并说明理由。

---

## 1. 冻结版本

```
workspace      : D:\3-4论文\实验文件
git repo       : yes（branch main）
baseline commit: <40 位 SHA，例 db0e7ef9ffc533f90df382834aad1ae0fb172159>
baseline tag   : <例 freeze-2026-10-30>
freeze 时间    : <YYYY-MM-DD HH:mm>
```

审计启动参数（对应 `DSH_AUDIT_*` 环境变量）：

| 变量 | 本次取值 |
| --- | --- |
| `DSH_AUDIT_WORKSPACE` | `D:\3-4论文\实验文件` |
| `DSH_AUDIT_BASE` | `<baseline commit SHA 或 tag>`（**不要**用 `HEAD` 做周审/终审） |
| `DSH_AUDIT_STAGE` | `conclusion`（终审） / `data_audit`（只取证，不允许提交结论） |
| `DSH_AUDIT_RUN_ID` | `<例 EXP-004-final-20261102>` |

## 2. 被审计主张（一次审计只审一组可判定的主张）

| check_id | 主张 | 判定标准（通过 / 不通过的客观界线） |
| --- | --- | --- |
| `<EXP-004-C1>` | `<例：新模型在留出集上的误报率低于 v3>` | `<例：holdout F2 误报率 < 5%，且 95% CI 上界 < 6%>` |
| `<EXP-004-C2>` | `<...>` | `<...>` |

## 3. 证据位置（审计方只读这些，路径必须相对 workspace）

| 证据 | 相对路径 | SHA-256 |
| --- | --- | --- |
| 冻结计划 | `experiments/plans/EXP-004.md` | `<sha256>` |
| 执行脚本 | `scripts/run_experiment.py` | `<sha256>` |
| 结果清单 | `results/<run>/manifest.txt` | `<sha256>` |
| 关键结果表 | `results/<run>/summary.json` | `<sha256>` |
| 数据/模型大文件 SHA 清单 | `results/<run>/sha256_manifest.csv` | `<sha256>` |

> 大体积产物（`.mat` / `.csv` / `.db` / `results/_runtime/`）不在 git 里，
> 它们只能靠上表的 SHA-256 清单核对；`audit_diff` 看不到这类文件的变化。

## 4. 环境与限制（审计方必须知情）

```
MATLAB / Python 版本 : <例 MATLAB R2024b, python 3.12.14>
随机种子与重复次数   : <例 seed=20261030, n=3 组独立重复>
已知未覆盖范围       : <例 只跑了 F2 工况，未覆盖 W10_D24>
已知失败/返工历史    : <例 v02 因 holdout 泄漏重跑，旧结果已作废>
```

## 5. 期望审计产出

1. 每个 `check_id` 一条 `submit_review`（同一进程只能提交一次 ⇒ 多条主张请分多次运行；
   或先 `data_audit` 取证、再按主张分组 `conclusion` 提交）。
2. 结论落地位置：`.audit\reviews\review-<uuid>.json` 是**候选**结论
   （`final_verdict_authoritative: false`），最终判定由人写入
   `audits/experiment-gates/EXP-NNN.json`。
3. 若证据不足，verdict 用 `Unknown` 并写明缺什么；不要用 `Success` 代替“没发现问题”。

## 6. 冻结新基线（每次新实验冻结后执行）

```powershell
cd 'D:\3-4论文\实验文件'
git add -A
git commit -m 'freeze EXP-004'
git tag freeze-2026-11-02
git rev-parse HEAD      # 把结果填进第 1 节 baseline commit
```

然后重跑 `scripts\Get-AuditBaseline.cmd -Workspace 'D:\3-4论文\实验文件'` 确认干净。
