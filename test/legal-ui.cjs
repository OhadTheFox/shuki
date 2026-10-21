// The legal package (r13l, 15/10) on screen: the privacy link in settings and in the recording answer, and leaving the
// house by oneself, with its question in each way of address. Run under tools/runall.sh (UIS="test/legal-ui.cjs").
const browser = require(process.env.PW)[process.env.PW_BROWSER || 'chromium'];
const { check, ok, phone, finish, d1, d1q } = require('./sweep-lib.cjs');

const URL_ = 'https://github.com/OhadTheFox/shuki#privacy';
const ASK = {
  m: 'האם אתה בטוח שאתה רוצה לצאת מהבית? אמחק את הצ\'אט שלך, את מה שהיה פרטי לך ואת מה שלמדתי עליך.',
  f: 'האם את בטוחה שאת רוצה לצאת מהבית? אמחק את הצ\'אט שלך, את מה שהיה פרטי לך ואת מה שלמדתי עלייך.',
  p: 'האם אתם בטוחים שאתם רוצים לצאת מהבית? אמחק את הצ\'אט שלכם, את מה שהיה פרטי לכם ואת מה שלמדתי עליכם.',
};
const openMine = async (p, id) => { await p.go('#settings'); await p.click(`[data-mem="${id}"]`); await p.waitForSelector('.scrim'); };

(async () => {
  const b = await browser.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  d1("INSERT OR IGNORE INTO users (id, name, gender, role, active, created) VALUES (4, 'רון', 'm', 'member', 1, 0), (5, 'הזוג', 'p', 'member', 1, 0)");
  const avi = await phone(b);

  await check('LU-1', 'בהגדרות: "פרטיות: מה נשמר ומה נשלח", קישור ל-README, בחלון חדש', async () => {
    await avi.go('#settings');
    const a = avi.locator('a', { hasText: 'פרטיות: מה נשמר ומה נשלח' });
    ok(await a.count() === 1, 'no link');
    ok(await a.getAttribute('href') === URL_, await a.getAttribute('href')); ok(await a.getAttribute('target') === '_blank', 'not in a new window');
  });
  await check('LU-2', 'בצ\'אט: "כאן" בתשובה על ההקלטה הוא הקישור, ושאר המילים כמו שהן', async () => {
    const reply = 'אני שומע רק מה שכותבים לי. את הצ\'אט אני שומר עד 90 יום. הפירוט המלא כאן.';
    d1(`INSERT INTO chat (ts, user_id, role, content, thread) VALUES (${Date.now()}, NULL, 'shuki', '${JSON.stringify({ reply, face: 'neutral', link: 'privacy', for: 1 }).replace(/'/g, "''")}', 1)`);
    await avi.go('#chat'); await avi.reload2();
    const a = avi.locator('.msg.bot a', { hasText: 'כאן' }).last();
    ok(await a.count() === 1, 'no link in the chat');
    ok(await a.getAttribute('href') === URL_, await a.getAttribute('href'));
    ok((await avi.locator('.msg.bot').last().innerText()).startsWith(reply), await avi.locator('.msg.bot').last().innerText());
  });
  await check('LU-3', 'המנהל היחיד: בלי "לצאת מהבית" בדף שלו', async () => {
    await openMine(avi, 1);
    ok(await avi.locator('#e-remove').count() === 0, 'the button is there');
    await avi.keyboard.press('Escape');
  });
  for (const [id, g] of [[4, 'm'], [5, 'p']]) {
    await check(`LU-4${g}`, `השאלה של היציאה (${g}): הנוסח והכפתורים, ו"ביטול" סוגר בלי לצאת`, async () => {
      const p = await phone(b, { user: id });
      await openMine(p, id); await p.click('#e-remove');
      ok((await p.locator('.sheet p').first().innerText()) === ASK[g], await p.locator('.sheet p').first().innerText());
      ok((await p.locator('#l-yes').innerText()) === 'לצאת מהבית' && (await p.locator('#l-no').innerText()) === 'ביטול', 'the buttons');
      await p.click('#l-no'); await p.waitForTimeout(200);
      ok(await p.locator('.scrim').count() === 0, 'still open');
      ok(d1q(`SELECT active FROM users WHERE id = ${id}`)[0].active === 1, 'left');
      ok(!p.errors.length, p.errors.join(' | '));
      await p.ctx.close();
    });
  }
  await check('LU-5', 'מיכל יוצאת בעצמה: השאלה בלשון נקבה, "לצאת מהבית" מחזיר את מסך החיבור, והיא כבר לא בבית', async () => {
    const p = await phone(b, { user: 2 });
    await openMine(p, 2); await p.click('#e-remove');
    ok((await p.locator('.sheet p').first().innerText()) === ASK.f, await p.locator('.sheet p').first().innerText());
    await p.click('#l-yes');
    await p.waitForSelector('#code', { timeout: 5000 });
    ok(d1q('SELECT active FROM users WHERE id = 2')[0].active === 0, 'still in the house');
    ok(await p.evaluate(() => !localStorage.getItem('shuki.token')), 'the token stayed');
    ok(!p.errors.length, p.errors.join(' | '));
    await p.ctx.close();
  });
  await finish(b, '/tmp/shuki-test/legal-ui.json');
})();
