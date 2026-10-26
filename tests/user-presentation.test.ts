import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fullName, sortedUsers } from '../src/application/user-presentation.ts';

test('User display uses complete names and Spanish alphabetical order without mutating source or filtering roles', () => {
    const entries = [
        { profile: { mail: 'z@example.test', nombre: 'Zoe', apellidos: 'Largo', perfil: 'alumno' } },
        { profile: { mail: 'a2@example.test', nombre: 'Ana', apellidos: 'Zamora', perfil: 'entrenador' } },
        { profile: { mail: 'al@example.test', nombre: 'Álvaro', apellidos: 'García', perfil: 'alumno' } },
        { profile: { mail: 'a1@example.test', nombre: 'ana', apellidos: 'Álvarez', perfil: 'alumno' } }
    ];
    const original = structuredClone(entries), sorted = sortedUsers(entries);
    assert.deepEqual(sorted.map(u => u.profile.mail), ['al@example.test', 'a1@example.test', 'a2@example.test', 'z@example.test']);
    assert.deepEqual(entries, original); assert.equal(fullName(sorted[0].profile), 'Álvaro García');
    assert.equal(fullName({ mail: 'fallback@example.test', nombre: '', apellidos: '' }), 'fallback@example.test');
    assert.equal(sorted.length, entries.length);
});
