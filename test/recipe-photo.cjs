// Makes /tmp/shuki-test/recipe-photo.jpg: a printed Hebrew recipe card, photographed slightly crooked, for the
// real-model photo scenario (test/real-r21.eval.js). Run: PW=$(npm root -g)/playwright node test/recipe-photo.cjs
const { chromium } = require(process.env.PW);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 700, height: 900 } });
  await p.setContent(`<body style="margin:0;background:#cbb89a;display:grid;place-items:center;height:100vh">
  <div dir="rtl" style="font-family:serif;background:#fffdf5;width:520px;padding:28px 34px;transform:rotate(-3deg);box-shadow:4px 6px 12px #0006;line-height:1.5">
  <h1 style="margin:0 0 6px;font-size:34px">עוגת שוקולד בחושה</h1><div style="color:#555">תבנית 24, 10 פרוסות</div>
  <h3>מצרכים</h3><ul style="margin:0;padding-inline-start:20px"><li>3 ביצים</li><li>כוס וחצי סוכר</li><li>כוס שמן</li><li>כוס מים רותחים</li><li>2 כוסות קמח תופח</li><li>חצי כוס קקאו</li><li>כפית תמצית וניל</li></ul>
  <h3>אופן ההכנה</h3><p style="margin:0">מערבבים את כל המצרכים בקערה אחת עד שאין גושים. יוצקים לתבנית משומנת ואופים 35 דקות ב-180 מעלות.</p></div></body>`);
  await p.screenshot({ path: '/tmp/shuki-test/recipe-photo.jpg', type: 'jpeg', quality: 80 });
  await b.close(); console.log('ok');
})();
