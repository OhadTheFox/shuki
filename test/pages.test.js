// Recipe links (decision 139) and the monthly "I learned" line (decision 128). Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, isPrivateIp, pageText, firstUrl, CLOSED_SITES } from '../worker/pages.js';
import { digestMessages } from '../worker/domain.js';
import { REACTIONS, reaction } from '../public/reactions.js';

test('links: only public https pages', () => {
  assert.ok(checkUrl('https://www.example.co.il/recipe/shakshuka'));
  for (const bad of ['http://example.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://printer.local/', 'https://example.com:8443/', 'https://user:pw@example.com/', 'https://intranet/', 'javascript:alert(1)', 'file:///etc/passwd']) assert.equal(checkUrl(bad), null, bad);
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:172.16.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '64:ff9b::7f00:1', 'nonsense']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2a00:1450::1', '::ffff:8.8.8.8']) assert.ok(!isPrivateIp(ip), ip);
  assert.ok(CLOSED_SITES.test('www.tiktok.com') && CLOSED_SITES.test('instagram.com') && !CLOSED_SITES.test('notiktok.com'));
  assert.equal(firstUrl('תשמור https://a.co/x?y=1 בבקשה'), 'https://a.co/x?y=1');
});

test('links: the recipe from a page, without scripts, menus or markup', () => {
  const html = `<html><head><script>steal()</script><style>p{}</style><script type="application/ld+json">{"@type":"Recipe","name":"שקשוקה","recipeIngredient":["4 ביצים"]}</script></head>
    <body><nav>תפריט</nav><h1>שקשוקה</h1><p>מטגנים בצל&nbsp;ופלפל</p><footer>זכויות</footer></body></html>`;
  const t = pageText(html);
  assert.match(t, /"@type":"Recipe"/); assert.match(t, /שקשוקה/); assert.match(t, /מטגנים בצל ופלפל/);
  assert.doesNotMatch(t, /steal|תפריט|זכויות|<p>/);
});

test('monthly summary: one line on what Shuki learned', () => {
  const [m] = digestMessages({ day: 1, offListLastMonth: 0, wasted: [], taught: ['לא להציע מלח לרשימה'], month: 'ספטמבר' });
  assert.equal(m.body, 'בספטמבר כל מה שקניתם היה ברשימה ולא נזרק כלום. וגם למדתי משהו חדש: לא להציע מלח לרשימה.');
  assert.doesNotMatch(digestMessages({ day: 1, offListLastMonth: 1, wasted: [], month: 'ספטמבר' })[0].body, /למדתי/);
});

test('reactions: every moment is a known face, a few seconds, and back', () => {
  const faces = ['happy', 'neutral', 'confused', 'excited', 'sad', 'hungry', 'sleepy', 'ecstatic', 'laughing', 'scared', 'yummy', 'strong', 'waking']; // strong: ה1 (stage 8); waking: t3 (stage 10)
  const fx = ['', 'cry', 'confetti', 'steam', 'heart', 'bulb', 'check', 'sweat', 'bang', 'dots', 'blush', 'afro']; // afro: t7 (stage 10)
  assert.ok(Object.keys(REACTIONS).length >= 25);
  for (const [name, [mood, ms, f, move]] of Object.entries(REACTIONS)) {
    assert.ok(faces.includes(mood), name); assert.ok(f.split(' ').every((x) => fx.includes(x)), name);
    assert.ok(['', 'jump', 'spin', 'sniff', 'nod', 'droop', 'hop', 'stretch'].includes(move), name);
    assert.ok(name === 'thinking' ? ms >= 30000 : ms <= 3500, name);
  }
  assert.deepEqual(reaction('toss'), { mood: 'sad', ms: 3000, fx: 'cry', move: 'droop' });
  // t7 (stage 10, decision 7): the afro only in the full stock and a level-up (the run of updates is in app.js); ecstatic only there
  const withAfro = Object.entries(REACTIONS).filter(([, r]) => r[2].split(' ').includes('afro')).map(([n]) => n).sort();
  assert.deepEqual(withAfro, ['allStocked', 'levelUp']);
  assert.deepEqual(Object.entries(REACTIONS).filter(([, r]) => r[0] === 'ecstatic').map(([n]) => n), ['allStocked']);
  for (const n of ['shopDone', 'listEmpty', 'learned', 'settled', 'skipped', 'poke']) assert.equal(REACTIONS[n][0], 'excited', n);
});

test('t5 (stage 10): every random face is a face Shuki can draw, and every effect of it is drawn', async () => {
  const { FUNNY, FACES_KNOWN } = await import('../public/shuki.js');
  const src = (await import('node:fs')).readFileSync(new URL('../public/shuki.js', import.meta.url), 'utf8');
  assert.deepEqual(Object.keys(FUNNY).sort(), ['achoo', 'hic', 'hum', 'yawn']);
  for (const [name, steps] of Object.entries(FUNNY)) {
    for (const [ms, face, fx, cls] of steps.slice(0, -1)) {
      assert.ok(FACES_KNOWN.includes(face), `${name}: ${face}`);
      const fxList = src.split('\n').find((l) => l.includes('.map((f) => `.shuki[data-fx~=')) || ''; // the effects shown by data-fx (the reviewer of 0b81632)
      if (fx) assert.ok(src.includes(`class="fx-${fx}"`) && fxList.includes(`'${fx}'`), `${name}: fx ${fx}`);
      if (cls) assert.ok(src.includes(`.shuki.${cls} .rig`), `${name}: move ${cls}`);
      assert.ok(ms < steps.at(-1)[0], `${name}: a step after the end`);
    }
  }
  assert.ok(src.includes('>HIC!<') && src.includes('>ACHOO!<'));
});
