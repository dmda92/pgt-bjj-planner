import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { snapshotFromFiles, classifySourcePath, blobSha } from './github-source.ts';

/** Reads a pinned commit from a private bare clone. No checkout, fetch, push or
 * credential extraction. Git handles authentication when the operator clones. */
export function extractLocalSnapshot(gitDirectory: string, commit: string) {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('SOURCE_COMMIT_OR_BLOB_INVALID');
    const directory = resolve(gitDirectory);
    const git = (...args: string[]) => {
        const result = spawnSync('git', ['-c', 'safe.directory=' + directory, '--git-dir=' + directory, ...args],
            { encoding: 'utf8', maxBuffer: 132 * 1024 * 1024, windowsHide: true });
        if (result.error || result.status !== 0) throw Error('SOURCE_LOCAL_GIT_READ_FAILED');
        return result.stdout;
    };
    if (!['https://github.com/dmda92/pgt-bjj-data.git', 'git@github.com:dmda92/pgt-bjj-data.git'].includes(git('remote', 'get-url', 'origin').trim()))
        throw Error('SOURCE_REPOSITORY_INVALID');
    if (git('rev-parse', '--is-bare-repository').trim() !== 'true') throw Error('SOURCE_PRIVATE_BARE_CLONE_REQUIRED');
    if (git('rev-parse', commit + '^{commit}').trim() !== commit) throw Error('SOURCE_COMMIT_MISMATCH');
    const tree = git('rev-parse', commit + '^{tree}').trim();
    const entries = git('ls-tree', '-rz', '--full-tree', commit, '--', 'PGT/').split('\0').filter(Boolean)
        .map(row => { const tab = row.indexOf('\t'); const [mode, type, sha] = row.slice(0, tab).split(' '); return { mode, type, sha, path: row.slice(tab + 1) }; })
        .filter(entry => entry.path.endsWith('.json'));
    if (entries.length > 1000) throw Error('SOURCE_EXTRACTION_BUDGET');
    let bytes = 0;
    const files = entries.map(entry => {
        classifySourcePath(entry.path);
        if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw Error('SOURCE_FILE_MODE_INVALID');
        const content = git('cat-file', 'blob', entry.sha);
        bytes += Buffer.byteLength(content, 'utf8');
        if (bytes > 128 * 1024 * 1024) throw Error('SOURCE_EXTRACTION_BUDGET');
        if (blobSha(content) !== entry.sha) throw Error('SOURCE_BLOB_INTEGRITY');
        return { path: entry.path, content };
    });
    return snapshotFromFiles(commit, tree, files);
}
