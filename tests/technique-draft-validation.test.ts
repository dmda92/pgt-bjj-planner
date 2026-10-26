import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneTemplate } from '../src/domain/models.ts';
import { template } from './template-fixture.ts';
import { techniqueDraftMessage, POSITION_NAME_REQUIRED, TECHNIQUE_NAME_REQUIRED } from '../src/application/technique-draft-validation.ts';

test('Technique draft validation distinguishes intermediate blank names without changing their content', () => {
    const data = cloneTemplate(template);
    assert.equal(techniqueDraftMessage(data), null);
    data.positions[0].posicion = '  ';
    assert.equal(techniqueDraftMessage(data), POSITION_NAME_REQUIRED);
    assert.equal(data.positions[0].posicion, '  ');
    data.positions[0].posicion = 'Synthetic position'; data.positions[0].tecnicas[0].tipo = '';
    assert.equal(techniqueDraftMessage(data), TECHNIQUE_NAME_REQUIRED);
    data.positions[0].tecnicas[0].tipo = 'Synthetic technique';
    assert.equal(techniqueDraftMessage(data), null);
    data.positions[0].tecnicas[0].tipo = 'a'.repeat(501);
    assert.ok(techniqueDraftMessage(data)); assert.equal(data.positions[0].tecnicas[0].tipo.length, 501);
});
