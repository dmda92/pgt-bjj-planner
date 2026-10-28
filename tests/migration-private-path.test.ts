import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { privateLocation } from '../tools/migration/private-path.ts';

test('private migration locations reject this checkout and the shared Git checkout of a linked worktree', () => {
    const workspace = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
    const git = spawnSync('git', ['-c', 'safe.directory=' + workspace, '-C', workspace,
        'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', windowsHide: true });
    assert.equal(git.status, 0);
    assert.throws(() => privateLocation(join(workspace, 'private-key-test.bin'), workspace), /OUTSIDE_REPOSITORY/);
    assert.throws(() => privateLocation(join(dirname(git.stdout.trim()), 'private-key-test.bin'), workspace), /OUTSIDE_REPOSITORY/);
    const temp = mkdtempSync(join(tmpdir(), 'pgt-private-path-'));
    try {
        mkdirSync(join(temp, 'capture'));
        assert.equal(privateLocation(join(temp, 'capture', 'key.bin'), workspace), join(realpathSync(temp), 'capture', 'key.bin'));
    } finally { rmSync(temp, { recursive: true, force: true }); }
});
