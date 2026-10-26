import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractLocalSnapshot } from '../tools/migration/github-local.ts';

test('Private bare extraction preserves exact blobs and refs and rejects other repositories', () => {
    const root = mkdtempSync(join(tmpdir(), 'pgt-source-')), work = join(root, 'fixture'), bare = join(root, 'source.git');
    const git = (cwd: string, ...args: string[]) => {
        const r = spawnSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.test', '-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
        assert.equal(r.status, 0); return r.stdout.trim();
    };
    try {
        mkdirSync(work); git(work, 'init', '-b', 'main');
        mkdirSync(join(work, 'PGT', 'master_data'), { recursive: true });
        const content = '{"unicode":"á ñ","test":true}\n';
        writeFileSync(join(work, 'PGT', 'master_data', 'plans.json'), content);
        git(work, 'add', '.'); git(work, 'commit', '-m', 'Synthetic extraction fixture');
        git(root, 'clone', '--bare', work, bare);
        git(bare, 'remote', 'set-url', 'origin', 'https://github.com/dmda92/pgt-bjj-data.git');
        const head = git(bare, 'rev-parse', 'HEAD'), refs = git(bare, 'show-ref');
        const captured = extractLocalSnapshot(bare, head);
        assert.equal(captured.commit, head); assert.equal(captured.files.length, 1);
        assert.equal(captured.files[0].content, content);
        assert.equal(git(bare, 'show-ref'), refs);
        git(bare, 'remote', 'set-url', 'origin', 'https://github.com/other/repository.git');
        assert.throws(() => extractLocalSnapshot(bare, head), /REPOSITORY_INVALID/);
    } finally { rmSync(root, { recursive: true }); }
});
