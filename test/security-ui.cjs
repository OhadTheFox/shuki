// The security review's fixes that live in the app (30/09): a store name with HTML shows as text (A-3), "#__proto__"
// isn't a blank screen (Q-6), and a phone that was unpaired keeps nothing of the house (A-7, Q-4).
// Run: test/ui-qa.sh test/security-ui.cjs
const { chromium } = require(process.env.PW);
const { check, ok, phone, finish, d1 } = require('./sweep-lib.cjs');

(async () => {
  const b = await chromium.launch();
  const p = await phone(b, { w: 390, h: 844 });

  await check('X1', 'A-3: שם חנות עם HTML מוצג כטקסט, בלי קישור ובלי תגית', async () => {
    d1(`INSERT OR REPLACE INTO settings (key, value) VALUES ('stores', '[{"id":"s1","name":"<a href=//evil.tld>X"},{"id":"s2","name":"<style>*{opacity:0}</style>"}]')`);
    await p.reload2(); await p.go('#list');
    ok(!(await p.$('a[href*="evil"]')), 'a link'); ok(!(await p.$('.flaps style')), 'a style tag');
    ok((await p.textContent('.flaps')).includes('<a href=//evil.tld>X'), await p.textContent('.flaps'));
    d1("DELETE FROM settings WHERE key = 'stores'");
  });

  await check('X2', 'Q-6: "#__proto__" בכתובת פותח את הצ\'אט, לא מסך ריק', async () => {
    await p.go('#__proto__'); await p.waitForTimeout(300);
    ok(await p.$('#say'), 'the chat'); ok(!p.errors.length, p.errors.join(' | '));
  });

  await check('X3', 'A-7, Q-4: טלפון שנותק מרחוק לא שומר כלום מהבית', async () => {
    await p.go('#list');
    ok(await p.evaluate(() => !!localStorage.getItem('shuki.state')), 'had the house');
    await p.evaluate(() => localStorage.setItem('shuki.queue', JSON.stringify([{ op_id: 'x', actions: [{ kind: 'list_add', text: 'במבה' }], by: 1 }])));
    d1('DELETE FROM devices');
    await p.reload2();
    const left = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('shuki.')));
    ok(!left.some((k) => /^shuki\.(state|chat|queue|token)$/.test(k)), left.join(', '));
    ok(await p.$('#code'), 'back to the pairing screen');
  });

  await finish(b, 'test/security-ui-results.json');
})();
