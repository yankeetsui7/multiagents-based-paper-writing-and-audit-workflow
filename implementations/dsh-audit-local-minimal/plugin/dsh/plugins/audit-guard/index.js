// 本插件只限制 DSH 工具调用，不等同于 Windows 操作系统级沙箱。
export const name = 'audit-guard';
export const inject = ['tools'];
const ALLOWED = [
    'audit_diff',
    'audit_read_range',
    'audit_search',
    'submit_review',
];
const READ_LIMIT = 29; // 29 evidence calls; reaching the limit also exhausts the budget
let budgetState = null;

// Called synchronously by the trusted submit_review implementation.
// No async gap is permitted between checking the budget and locking the review.
export function beginAuditReview(verdict) {
    const state = budgetState;
    if (!state)
        throw new Error('BUDGET_STATE_UNAVAILABLE: audit-guard is not active');
    if (process.env.DSH_AUDIT_STAGE !== 'conclusion')
        throw new Error('STAGE_DENY: submit_review requires DSH_AUDIT_STAGE=conclusion');
    if (state.reviewSaved || state.reviewInFlight)
        throw new Error('REVIEW_DENY: only one successful review per DSH process');
    const exhausted = state.reads >= READ_LIMIT || state.budgetDenied;
    if (exhausted && verdict !== 'Unknown')
        throw new Error('BUDGET_VERDICT_DENY: evidence budget exhausted; only Unknown may be submitted');
    state.reviewInFlight = true;
    return { evidenceCalls: state.reads, limit: READ_LIMIT, exhausted };
}

export function finishAuditReview(success) {
    const state = budgetState;
    if (!state || !state.reviewInFlight)
        throw new Error('REVIEW_STATE_INVALID');
    if (success)
        state.reviewSaved = true;
    state.reviewInFlight = false;
}

export function apply(ctx) {
    // Preserve the existing per-process budgeting model; do not reuse past run state.
    const state = { reads: 0, budgetDenied: false, reviewInFlight: false, reviewSaved: false };
    budgetState = state;
    // 让模型尽量只看到这些工具；不可替代下方的不可撤销拒绝。
    // DSH >= 0.2.1-rc.2: restrict() 只允许在 agent 作用域调用，profile 级插件是全局
    // 上下文，调用会抛错并使整条 guard 插件失活。这里降级为“可选调用”：失败时仅跳过
    // 工具隐藏，下方 guard 仍是全局 deny-by-default，拒绝强度不变。
    try {
        ctx.tools.restrict({ allow: [...ALLOWED] });
    }
    catch (error) {
        console.log(`[audit-guard] restrict() skipped (${error instanceof Error ? error.message : String(error)}); global guard still denies every non-audit tool`);
    }
    ctx.tools.guard((exec) => {
        if (!ALLOWED.includes(exec.name)) {
            return `AUDIT_DENY: tool ${exec.name} is not allowed`;
        }
        if (exec.name === 'submit_review') {
            if (process.env.DSH_AUDIT_STAGE !== 'conclusion')
                return 'STAGE_DENY: submit_review requires DSH_AUDIT_STAGE=conclusion';
            if (state.reviewSaved || state.reviewInFlight)
                return 'REVIEW_DENY: only one successful review per DSH process';
            // Do NOT consume the review slot here: tool validation/writing can fail.
            // beginAuditReview() checks the budget again inside submit_review.
            return undefined;
        }
        if (state.reviewSaved || state.reviewInFlight)
            return 'AUDIT_CLOSED: no more evidence calls after review starts';
        if (state.reads >= READ_LIMIT) {
            state.budgetDenied = true;
            return 'BUDGET_EXCEEDED: read-call limit reached; submit Unknown review';
        }
        state.reads += 1;
        return undefined;
    });
    console.log('[audit-guard] ready: deny-by-default, 29 evidence calls + 1 review');
}
