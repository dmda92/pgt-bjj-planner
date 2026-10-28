import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Linked worktrees must not accept the main checkout as "outside the repo".
 * Resolve existing parents/symlinks before checking either code checkout. */
export function privateLocation(value: string, workspace: string): string {
    const checkout = realpathSync(workspace), requested = resolve(value);
    const actual = existsSync(requested) ? realpathSync(requested) : resolve(realpathSync(dirname(requested)), basename(requested));
    const git = spawnSync('git', ['-c', 'safe.directory=' + checkout, '-C', checkout,
        'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', windowsHide: true });
    if (git.error || git.status !== 0 || !git.stdout.trim()) throw Error('MIGRATION_WORKSPACE_ROOT_UNAVAILABLE');
    const commonRoot = dirname(realpathSync(git.stdout.trim()));
    for (const root of [checkout, commonRoot]) {
        const rel = relative(root, actual);
        if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'))
            throw Error('MIGRATION_PRIVATE_PATH_MUST_BE_OUTSIDE_REPOSITORY');
    }
    return actual;
}
