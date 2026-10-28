import {test, expect} from '@playwright/test';
import {createLocalAcademy} from '../playwright/helpers/local-academy.mjs';

test('QA fixture: missing static asset returns a single error response and leaves server usable', async ({request}) => {
  const a = await createLocalAcademy();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const missing = await request.get(a.origin + '/__qa_missing_static_asset__.png');
      expect(missing.status()).toBe(500);
      expect(await missing.text()).toBe('Synthetic fixture error');
      const valid = await request.get(a.origin + '/');
      expect(valid.status()).toBe(200);
      expect(await valid.text()).toContain('<html lang="es">');
    }
    const roster = await a.call('roster', undefined, a.trainer.token);
    expect(roster.data.users.some(user => user.mail === a.trainer.profile.mail)).toBe(true);
  } finally {await a.close();}
});
