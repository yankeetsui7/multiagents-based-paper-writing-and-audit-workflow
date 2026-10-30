import { defineTool } from '@deepseek-ai/dsh-tools';
import { beginAuditReview, finishAuditReview } from '../audit-guard/index.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const name = 'audit-tools';
export const inject = ['tools'];
const runFile = promisify(execFile);
const WORKSPACE = path.resolve(process.env.DSH_AUDIT_WORKSPACE || 'D:\\3-4论文\\实验文件');
const REVIEW_DIR = path.join(WORKSPACE, '.audit', 'reviews');
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_CHARS = 12_000;
const MAX_READ_LINES = 160;
const SEARCH_FILES_LIMIT = 160;
const SEARCH_MATCHES_LIMIT = 20;
const SKIP_DIRS = new Set(['.git', '.audit', 'node_modules', '__pycache__', '.venv', 'dist', 'build']);
const TEXT_EXT = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml', '.md', '.txt', '.toml', '.m', '.cpp', '.h', '.hpp', '.rs', '.ps1', '.sh', '.sql']);
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
const asText = (value) => JSON.stringify(value);
function inside(root, candidate) {
    const rel = path.relative(root, candidate);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
function validRelative(userPath, allowDot = false) {
    if (!userPath || userPath.length > 300 || userPath.includes('\0'))
        throw new Error('PATH_DENY: invalid path');
    if (path.isAbsolute(userPath) || /^[A-Za-z]:/.test(userPath) || userPath.startsWith('\\\\')) {
        throw new Error('PATH_DENY: absolute path is forbidden');
    }
    const normalized = userPath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    if (parts.includes('..') || parts.some(p => SKIP_DIRS.has(p.toLowerCase()))) {
        throw new Error('PATH_DENY: parent or protected directory is forbidden');
    }
    if (!allowDot && (normalized === '.' || normalized === ''))
        throw new Error('PATH_DENY: choose a file');
    return normalized;
}
async function existingPath(userPath, allowDir = false) {
    const rel = validRelative(userPath, allowDir);
    const root = await fs.realpath(WORKSPACE);
    const abs = await fs.realpath(path.resolve(root, rel));
    if (!inside(root, abs))
        throw new Error('PATH_DENY: path escapes the workspace (symlink/junction)');
    const stat = await fs.stat(abs);
    if (!(stat.isFile() || (allowDir && stat.isDirectory())))
        throw new Error('PATH_DENY: not a regular source file or permitted directory');
    return { root, abs, rel: path.relative(root, abs).replace(/\\/g, '/'), stat };
}
async function readSmallFile(userPath, signal) {
    const p = await existingPath(userPath);
    if (p.stat.size > MAX_FILE_BYTES)
        throw new Error(`FILE_TOO_LARGE: limit ${MAX_FILE_BYTES} bytes`);
    const bytes = await fs.readFile(p.abs, { signal });
    if (bytes.length > MAX_FILE_BYTES || bytes.includes(0))
        throw new Error('FILE_DENY: oversized or binary file');
    const content = bytes.toString('utf8');
    return { ...p, content, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
function capString(text, max = MAX_RESULT_CHARS) {
    return { value: text.slice(0, max), truncated: text.length > max };
}
async function git(args) {
    const { stdout } = await runFile('git', ['-c', 'core.quotepath=false', ...args], {
        cwd: WORKSPACE, timeout: 6000, maxBuffer: 768 * 1024,
        windowsHide: true, encoding: 'utf8'
    });
    return stdout;
}
async function safeReviewDirectory() {
    await fs.mkdir(REVIEW_DIR, { recursive: true });
    const root = await fs.realpath(WORKSPACE);
    const target = await fs.realpath(REVIEW_DIR);
    if (!inside(root, target))
        throw new Error('REVIEW_DIR_DENY: redirected outside the workspace');
    const parents = [path.join(WORKSPACE, '.audit'), REVIEW_DIR];
    for (const item of parents) {
        if ((await fs.lstat(item)).isSymbolicLink())
            throw new Error('REVIEW_DIR_DENY: symlink or junction');
    }
    return target;
}
export function apply(ctx) {
    const inspected = new Map(); // 本次 DSH 进程实际读取过的文件哈希
    ctx.tools.register(defineTool({
        name: 'audit_diff',
        description: '优先调用：查看固定 Git 基线到当前工作树的修改，以及未跟踪文件。空 Diff 不代表审计通过。',
        parameters: { file_path: { type: 'string', description: '相对文件路径；不传则检查整个仓库' } },
        output,
        async execute(args) {
            const target = args.file_path ? validRelative(args.file_path) : '.';
            const base = process.env.DSH_AUDIT_BASE || 'HEAD';
            if (!/^[A-Za-z0-9_./^~{}-]{1,100}$/.test(base) || base.startsWith('-')) {
                throw new Error('INVALID_BASE: set a valid DSH_AUDIT_BASE revision');
            }
            try {
                const diff = await git(['diff', '--no-ext-diff', '--no-textconv', '--unified=3', base, '--', target]);
                const untrackedRaw = await git(['ls-files', '--others', '--exclude-standard', '--', target]);
                const paths = untrackedRaw.split(/\r?\n/).filter(Boolean);
                const snippet = capString(diff);
                return asText({
                    status: 'ok', baseline: base, target, diff: snippet.value,
                    diff_truncated: snippet.truncated,
                    untracked_files: paths.slice(0, 40),
                    untracked_truncated: paths.length > 40,
                    empty_not_proof: diff.trim() === '' && paths.length === 0,
                    complete: !snippet.truncated && paths.length <= 40,
                    note: 'Includes tracked staged/unstaged changes relative to baseline; untracked files are listed, not read.'
                });
            }
            catch (e) {
                return asText({ status: 'unavailable', complete: false, baseline: base,
                    reason: `Git baseline/diff failed: ${String(e).slice(0, 250)}. Do not infer Success.` });
            }
        }
    }));
    ctx.tools.register(defineTool({
        name: 'audit_read_range',
        description: '只读指定相对路径与行号，最多160行和12000字符，并提供整个文件的 SHA-256。行号从1开始。',
        parameters: {
            file_path: { type: 'string', required: true },
            start_line: { type: 'number', required: true },
            end_line: { type: 'number' }
        }, output,
        async execute(args, exec) {
            const p = await readSmallFile(args.file_path, exec.signal);
            const start = args.start_line;
            const end = args.end_line ?? start + MAX_READ_LINES - 1;
            if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || end < start) {
                throw new Error('LINE_DENY: invalid 1-based line range');
            }
            const lines = p.content.split(/\r?\n/);
            if (start > lines.length)
                throw new Error('LINE_OUT_OF_RANGE');
            inspected.set(p.rel, p.sha256);
            const boundedEnd = Math.min(end, start + MAX_READ_LINES - 1, lines.length);
            const raw = lines.slice(start - 1, boundedEnd).map((line, i) => `${start + i}: ${line}`).join('\n');
            const clipped = capString(raw);
            return asText({ path: p.rel, sha256: p.sha256,
                start_line: start, end_line: boundedEnd, total_lines: lines.length,
                content: clipped.value, truncated: boundedEnd < end || clipped.truncated,
                note: 'sha256 is of the FULL file, not the visible excerpt.' });
        }
    }));
    ctx.tools.register(defineTool({
        name: 'audit_search',
        description: '仅在授权工作区内按文本关键字搜索指定文件或子目录；至多160文件与20处命中。',
        parameters: {
            query: { type: 'string', required: true },
            file_path: { type: 'string', description: '文件或子目录相对路径；默认整个工作区' }
        }, output,
        async execute(args, exec) {
            const needle = args.query.trim();
            if (!needle || needle.length > 100)
                throw new Error('SEARCH_DENY: query length must be 1..100');
            const rootTarget = await existingPath(args.file_path || '.', true);
            const queue = [rootTarget.abs];
            const matches = [];
            let scanned = 0;
            let incomplete = false;
            while (queue.length && scanned < SEARCH_FILES_LIMIT && matches.length < SEARCH_MATCHES_LIMIT) {
                if (exec.signal.aborted)
                    throw new Error('ABORTED');
                const current = queue.shift();
                const st = await fs.lstat(current);
                if (st.isSymbolicLink())
                    continue;
                if (st.isDirectory()) {
                    const entries = await fs.readdir(current, { withFileTypes: true });
                    for (const ent of entries) {
                        if (ent.isSymbolicLink() || SKIP_DIRS.has(ent.name.toLowerCase()))
                            continue;
                        if (!(ent.isFile() || ent.isDirectory()))
                            continue;
                        if (queue.length >= 500) {
                            incomplete = true;
                            break;
                        }
                        queue.push(path.join(current, ent.name));
                    }
                    continue;
                }
                if (!st.isFile() || !TEXT_EXT.has(path.extname(current).toLowerCase()))
                    continue;
                scanned += 1;
                if (st.size > MAX_FILE_BYTES) {
                    incomplete = true;
                    continue;
                }
                const relative = path.relative(WORKSPACE, current).replace(/\\/g, '/');
                let file;
                try {
                    file = await readSmallFile(relative, exec.signal);
                }
                catch {
                    incomplete = true;
                    continue;
                }
                const lines = file.content.split(/\r?\n/);
                for (let i = 0; i < lines.length && matches.length < SEARCH_MATCHES_LIMIT; i++) {
                    if (lines[i].toLowerCase().includes(needle.toLowerCase())) {
                        matches.push({ file: file.rel, line: i + 1, excerpt: lines[i].slice(0, 180) });
                    }
                }
            }
            if (queue.length || scanned >= SEARCH_FILES_LIMIT || matches.length >= SEARCH_MATCHES_LIMIT)
                incomplete = true;
            return asText({ matches, files_scanned: scanned, incomplete,
                note: incomplete ? 'SEARCH_INCOMPLETE: narrow the path before making a final judgment.' : 'Search complete within selected supported text files.' });
        }
    }));
    ctx.tools.register(defineTool({
        name: 'submit_review',
        description: '只在 conclusion 阶段提交一次结构化候选审查意见；验证完整文件 SHA-256 后写入 .audit/reviews。',
        parameters: {
            check_id: { type: 'string', required: true },
            file_path: { type: 'string', required: true },
            expected_sha256: { type: 'string', required: true },
            verdict: { type: 'string', required: true, description: 'Success / Fail / Unknown（候选结论）' },
            finding: { type: 'string', required: true },
            suggestion: { type: 'string', required: true }
        }, output,
        async execute(args, exec) {
            if (process.env.DSH_AUDIT_STAGE !== 'conclusion')
                throw new Error('STAGE_DENY');
            if (!/^[A-Za-z0-9_.-]{1,80}$/.test(args.check_id))
                throw new Error('INVALID_CHECK_ID');
            if (!/^[a-f0-9]{64}$/i.test(args.expected_sha256))
                throw new Error('INVALID_SHA256');
            if (!['Success', 'Fail', 'Unknown'].includes(args.verdict))
                throw new Error('INVALID_VERDICT');
            if (typeof args.finding !== 'string' || !args.finding.trim() || args.finding.length > 3000 ||
                typeof args.suggestion !== 'string' || args.suggestion.length > 3000) {
                throw new Error('INVALID_REVIEW_TEXT');
            }
            // Synchronous, mandatory budget check plus per-process submission lock.
            // A model request for Success/Fail cannot override an exhausted budget.
            const budget = beginAuditReview(args.verdict);
            let saved = false;
            try {
                const file = await readSmallFile(args.file_path, exec.signal);
                if (inspected.get(file.rel) !== args.expected_sha256.toLowerCase()) {
                    throw new Error('EVIDENCE_NOT_READ: use audit_read_range to inspect this exact file version first');
                }
                if (file.sha256.toLowerCase() !== args.expected_sha256.toLowerCase()) {
                    throw new Error('EVIDENCE_INVALID: file hash changed; re-audit before submitting');
                }
                const directory = await safeReviewDirectory();
                const id = crypto.randomUUID();
                const record = {
                    review_id: id, created_at: new Date().toISOString(),
                    run_id: process.env.DSH_AUDIT_RUN_ID || 'manual-run',
                    check_id: args.check_id, path: file.rel, sha256: file.sha256,
                    candidate_verdict: args.verdict, finding: args.finding, suggestion: args.suggestion,
                    verification: 'file_sha256_matches_at_submission',
                    final_verdict_authoritative: false
                };
                const filename = `review-${id}.json`;
                const outputPath = path.join(directory, filename);
                let handle;
                let created = false;
                try {
                    handle = await fs.open(outputPath, 'wx', 0o600);
                    created = true;
                    await handle.writeFile(JSON.stringify(record, null, 2), 'utf8');
                    await handle.close();
                    handle = undefined;
                }
                catch (error) {
                    if (handle) {
                        try { await handle.close(); } catch { /* preserve the original error */ }
                    }
                    if (created) {
                        try { await fs.unlink(outputPath); } catch { /* report write failure */ }
                    }
                    throw error;
                }
                saved = true;
                return asText({ submitted: true, file: path.join('.audit', 'reviews', filename),
                    review_id: id, candidate_verdict: args.verdict, verified_sha256: file.sha256,
                    evidence_calls_used: budget.evidenceCalls,
                    evidence_call_limit: budget.limit,
                    budget_exhausted_at_submission: budget.exhausted });
            }
            finally {
                // Failed validations/writes release the slot for a legitimate retry.
                finishAuditReview(saved);
            }
        }
    }));
    console.log(`[audit-tools] ready; workspace=${WORKSPACE}`);
}
