// Shuki, the animated mascot: an SVG puppet with separate eyes, mouth, antenna and afro.
// mount(el, mood, look) -> { setMood, react, blink, lookAt, setLook, destroy }. Pure DOM.
// look: a level (wears the newest item in each spot) or { level, wear: { slot: itemId } } from the closet.
import { ITEMS, autoOutfit } from './wardrobe.js';

const CSS = `
.shuki { width: 100%; height: 100%; overflow: visible; }
.shuki .rig { transform-box: fill-box; transform-origin: 50% 100%; animation: bob 3.2s ease-in-out infinite; }
.shuki .ant { transform-box: view-box; transform-origin: 100px 52px; animation: wob 2.6s ease-in-out infinite; }
.shuki .face > g { opacity: 0; transition: opacity .18s; }
.shuki[data-mood="happy"] .m-happy, .shuki[data-mood="neutral"] .m-neutral, .shuki[data-mood="ecstatic"] .m-ecstatic,
.shuki[data-mood="laughing"] .m-laughing, .shuki[data-mood="hungry"] .m-hungry, .shuki[data-mood="sad"] .m-sad,
.shuki[data-mood="sleepy"] .m-sleepy, .shuki[data-mood="confused"] .m-confused, .shuki[data-mood="excited"] .m-excited, .shuki[data-mood="scared"] .m-scared, .shuki[data-mood="yummy"] .m-yummy, .shuki[data-mood="strong"] .m-strong,
.shuki[data-mood="understanding"] .m-understanding, .shuki[data-mood="waking"] .m-waking,
.shuki[data-mood="hic"] .m-hic, .shuki[data-mood="achoo"] .m-achoo, .shuki[data-mood="yawn"] .m-yawn, .shuki[data-mood="hum"] .m-hum { opacity: 1; }
.shuki .eyes { transform-box: view-box; transform-origin: 100px 100px; }
.shuki.blink .eyes { animation: blink .16s ease-in-out; }
.shuki .afro { transform-box: view-box; transform-origin: 100px 78px; transform: scale(0); transition: transform .5s cubic-bezier(.34, 1.8, .5, 1); }
/* t7 (stage 10, decision 7): the afro by afro-on, not by the face: the full stock (the lasting ecstatic), a run of updates and a level-up (fx "afro") */
.shuki.afro-on .afro { transform: scale(1); }
.shuki .fx > g { opacity: 0; transition: opacity .25s; }
.shuki[data-mood="ecstatic"] .fx-spark, .shuki[data-mood="excited"] .fx-spark { opacity: 1; }
.shuki[data-mood="sleepy"] .fx-zzz, .shuki[data-mood="confused"] .fx-q,
.shuki[data-mood="hungry"] .fx-drool, .shuki[data-mood="laughing"] .fx-ha, .shuki[data-mood="scared"] .fx-sweat, .shuki[data-mood="strong"] .fx-sweat,
.shuki[data-mood="yummy"] .fx-drool, .shuki[data-mood="yummy"] .fx-blush { opacity: 1; }
.shuki[data-mood="yummy"] .rig { animation: sniff .9s ease-in-out infinite; }
.shuki .fx-spark path { transform-box: fill-box; transform-origin: center; animation: twinkle 1.2s ease-in-out infinite; }
.shuki .fx-spark path:nth-child(2) { animation-delay: .4s; } .shuki .fx-spark path:nth-child(3) { animation-delay: .8s; }
.shuki .fx-zzz text { animation: zzz 2.4s ease-in infinite; }
.shuki .fx-zzz text:nth-child(2) { animation-delay: .8s; } .shuki .fx-zzz text:nth-child(3) { animation-delay: 1.6s; }
.shuki .fx-drool path { transform-box: fill-box; transform-origin: top; animation: drool 1.6s ease-in-out infinite; }
.shuki .fx-q text { transform-box: fill-box; transform-origin: bottom; animation: tilt 1.4s ease-in-out infinite; }
.shuki[data-mood="laughing"] .rig { animation: shake .22s linear infinite; }
.shuki[data-mood="excited"] .rig { animation: hop .6s ease-in-out infinite; }
.shuki[data-mood="sleepy"] .rig { animation: bob 5s ease-in-out infinite; }
.shuki[data-mood="sleepy"] .ant { animation: droop 5s ease-in-out infinite; }
.shuki.pop .rig { animation: pop .35s cubic-bezier(.3, 1.6, .5, 1); }
/* momentary reactions (decision 130): an effect and a move for a few seconds, then back to the lasting mood */
${['cry', 'confetti', 'steam', 'heart', 'bulb', 'check', 'sweat', 'bang', 'dots', 'blush', 'hic', 'achoo', 'notes'].map((f) => `.shuki[data-fx~="${f}"] .fx-${f}`).join(', ')} { opacity: 1; }
.shuki .fx-cry path { animation: tear .9s ease-in infinite; } .shuki .fx-cry path:nth-child(2) { animation-delay: .45s; }
.shuki .fx-confetti rect { transform-box: fill-box; transform-origin: center; animation: confetti 1.6s ease-in infinite; }
.shuki .fx-confetti rect:nth-child(2n) { animation-delay: .35s; } .shuki .fx-confetti rect:nth-child(3n) { animation-delay: .7s; }
.shuki .fx-steam path { animation: steam 1.5s ease-out infinite; } .shuki .fx-steam path:nth-child(2) { animation-delay: .5s; } .shuki .fx-steam path:nth-child(3) { animation-delay: 1s; }
.shuki .fx-heart path { transform-box: fill-box; transform-origin: center; animation: floatUp 1.8s ease-out infinite; } .shuki .fx-heart path:nth-child(2) { animation-delay: .7s; }
.shuki .fx-bulb, .shuki .fx-check, .shuki .fx-bang { transform-box: fill-box; transform-origin: center bottom; }
.shuki[data-fx~="bulb"] .fx-bulb, .shuki[data-fx~="check"] .fx-check, .shuki[data-fx~="bang"] .fx-bang { animation: pop .45s cubic-bezier(.3, 1.8, .5, 1); }
.shuki .fx-sweat path { animation: tear 1.4s ease-in infinite; }
.shuki .fx-dots circle { animation: twinkle 1s ease-in-out infinite; } .shuki .fx-dots circle:nth-child(2) { animation-delay: .2s; } .shuki .fx-dots circle:nth-child(3) { animation-delay: .4s; }
.shuki.r-jump .rig { animation: jump .7s cubic-bezier(.3, 1.4, .5, 1) 3; }
.shuki.r-spin .rig { transform-origin: 50% 60%; animation: spinAll .9s cubic-bezier(.3, 1.3, .5, 1); }
.shuki.r-sniff .rig { animation: sniff .7s ease-in-out 3; }
.shuki.r-nod .rig { animation: nod .8s ease-in-out 2; }
.shuki.r-droop .rig { animation: droopAll 1.6s ease-in-out 2; }
.shuki.r-hop .rig { animation: hop .45s ease-in-out 3; }
.shuki.r-stretch .rig { animation: stretchUp 2.5s ease-in-out; } /* t3: waking up, a stretch with the yawn */
@keyframes stretchUp { 50% { transform: scale(.97, 1.04); } }
/* t5 (stage 10, decision 5): the random faces' moves, as in the mock-up's frames */
.shuki.f-hic .rig { animation: fHic .45s ease-out; }
.shuki.f-hic2 .rig { animation: fHic2 .45s ease-out; }
.shuki.f-achoo-in .rig { animation: fAchooIn .6s ease-in forwards; }
.shuki.f-achoo .rig { animation: fAchoo .5s ease-out; }
.shuki.f-yawn .rig { animation: fYawn 2.2s ease-in-out; }
.shuki.f-hum .rig { animation: fHum 3s ease-in-out; }
@keyframes fHic { 30% { transform: translateY(-7px); } }
@keyframes fHic2 { 30% { transform: translateY(-5px); } }
@keyframes fAchooIn { 100% { transform: rotate(-7deg); } }
@keyframes fAchoo { 0% { transform: rotate(-7deg); } 30% { transform: rotate(5deg) translateY(3px); } }
@keyframes fYawn { 55% { transform: scale(.96, 1.06); } }
@keyframes fHum { 15% { transform: rotate(-7deg); } 55% { transform: rotate(6deg); } }
@keyframes jump { 0%, 100% { transform: translateY(0) scale(1); } 20% { transform: translateY(2px) scale(1.06, .92); } 50% { transform: translateY(-22px) scale(.96, 1.05); } }
@keyframes spinAll { 100% { transform: rotate(360deg); } }
@keyframes sniff { 50% { transform: translateY(3px) rotate(-4deg) scale(1.03); } }
@keyframes droopAll { 50% { transform: translateY(4px) scaleY(.96); } }
@keyframes confetti { 0% { transform: translateY(-10px) rotate(0); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(70px) rotate(300deg); opacity: 0; } }
@keyframes steam { 0% { transform: translateY(8px); opacity: 0; } 30% { opacity: .9; } 100% { transform: translateY(-18px); opacity: 0; } }
@keyframes floatUp { 0% { transform: translateY(6px) scale(.6); opacity: 0; } 25% { opacity: 1; } 100% { transform: translateY(-26px) scale(1); opacity: 0; } }

@keyframes bob { 50% { transform: translateY(-3px) scaleY(1.015); } }
@keyframes wob { 25% { transform: rotate(7deg); } 75% { transform: rotate(-7deg); } }
@keyframes droop { 50% { transform: rotate(-22deg); } }
@keyframes blink { 50% { transform: scaleY(.08); } }
@keyframes twinkle { 50% { transform: scale(.4) rotate(20deg); opacity: .4; } }
@keyframes zzz { 0% { transform: translate(0, 0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translate(10px, -26px); opacity: 0; } }
@keyframes tear { 0% { transform: translateY(0); opacity: 1; } 80% { transform: translateY(26px); opacity: 1; } 100% { transform: translateY(30px); opacity: 0; } }
@keyframes drool { 50% { transform: scaleY(1.5); } }
@keyframes tilt { 50% { transform: rotate(12deg); } }
@keyframes shake { 25% { transform: rotate(-3deg) translateY(-2px); } 75% { transform: rotate(3deg) translateY(-2px); } }
@keyframes hop { 50% { transform: translateY(-9px); } }
@keyframes pop { 0% { transform: scale(.86, 1.12); } 60% { transform: scale(1.08, .94); } 100% { transform: scale(1); } }

/* idle life: small random actions while the page is open */
.shuki .look { transition: transform .35s cubic-bezier(.3, 1.4, .5, 1); }
.shuki.i-look-l .look { transform: translateX(-6px); }
.shuki.i-look-r .look { transform: translateX(6px); }
.shuki.i-look-up .look { transform: translateY(-4px); }
.shuki.i-look-down .look { transform: translate(-4px, 4px); }
.shuki.i-twitch .ant { animation: twitch .5s ease-in-out; }
.shuki.i-hop .rig { animation: hop .45s ease-in-out 2; }
.shuki.i-tilt .rig { animation: tiltHead 1.4s ease-in-out; }
.shuki.i-wiggle .rig { animation: shake .18s linear 4; }
.shuki.i-nod .rig { animation: nod 1.6s ease-in-out; }
.shuki.i-spin .ant { animation: spinAnt .9s cubic-bezier(.3, 1.4, .5, 1); }
.shuki.i-stretch .rig { animation: stretch 1.1s ease-in-out; }
.shuki.i-lean-l .rig { animation: leanL 1.6s ease-in-out; }
.shuki.i-lean-r .rig { animation: leanR 1.6s ease-in-out; }
.shuki.i-shiver .rig { animation: shake .12s linear 6; }
@keyframes spinAnt { 0% { transform: rotate(0); } 70% { transform: rotate(380deg); } 100% { transform: rotate(360deg); } }
@keyframes stretch { 30% { transform: scale(.94, 1.07); } 55% { transform: scale(1.04, .96); } }
@keyframes leanL { 25%, 75% { transform: translateX(-5px) rotate(-5deg); } }
@keyframes leanR { 25%, 75% { transform: translateX(5px) rotate(5deg); } }
@keyframes twitch { 20% { transform: rotate(-24deg); } 45% { transform: rotate(18deg); } 70% { transform: rotate(-8deg); } }
@keyframes tiltHead { 30%, 70% { transform: rotate(-7deg); } }
@keyframes nod { 40% { transform: translateY(4px) rotate(3deg); } 60% { transform: translateY(5px) rotate(3deg); } }

/* growth: what Shuki is wearing (chosen in the closet) */
.shuki .acc { display: none; }
${ITEMS.map((x) => `.shuki.w-${x.id} .acc-${x.id}`).join(', ')} { display: inline; }
/* ה1 (stage 8, approved r8p: א, without the arm; question 20): the sweatband for everyone while he's strong, the closet as it is */
.shuki[data-mood="strong"] .acc-band { display: inline; }
/* question 16 (the owner r10p, ג): while strong the hat comes off for a moment, and only the band shows */
.shuki[data-mood="strong"] .acc-chef, .shuki[data-mood="strong"] .acc-crown, .shuki[data-mood="strong"] .acc-cap { display: none; }
/* t9 (stage 10, decision 9): on the afro, the hats sit on top of it, rising with it, and the band is drawn above the hair */
.shuki .acc-chef, .shuki .acc-crown, .shuki .acc-cap { transform-box: view-box; transform-origin: 100px 60px; transition: transform .5s cubic-bezier(.34, 1.8, .5, 1); } /* the origin always, so they don't jump aside when the afro goes (the reviewer of 9b36cf8) */
.shuki.afro-on .acc-chef, .shuki.afro-on .acc-cap { transform: translateY(-30px) scale(1.12); }
.shuki.afro-on .acc-crown { transform: translateY(-32px); }
.shuki.afro-on.w-band .acc-band { display: none; }
.shuki.afro-on.w-band .acc-band-up { display: inline; }
.shuki.grow .rig { animation: pop .5s cubic-bezier(.3, 1.6, .5, 1) 2; }

@media (prefers-reduced-motion: reduce) {
  .shuki *, .shuki .rig { animation: none !important; transition: none !important; }
}

`;

const INK = '#15110E', GLOW = '#3DB6FF', BLUE = '#1E6FE0';
// seeded curls for the afro, so every instance looks the same
function afroSVG() {
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const back = [], front = [];
  // back mass: rings of curls around the crown, centred above the head
  for (let ring = 0; ring < 3; ring++) {
    const rx = 80 - ring * 20, ry = 66 - ring * 16, n = 20 - ring * 5;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1)) * Math.PI; // upper half
      const x = 100 + Math.cos(a) * rx * (0.92 + r() * 0.12);
      const y = 84 + Math.sin(a) * ry * (0.92 + r() * 0.12);
      const rad = 15 - ring * 2 + r() * 5;
      back.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}"/>`);
    }
  }
  // side curls that hang past the ears
  for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
    back.push(`<circle cx="${(100 + side * (68 + r() * 6)).toFixed(1)}" cy="${(88 + k * 11).toFixed(1)}" r="${(12 + r() * 4).toFixed(1)}"/>`);
  }
  // fringe: small curls ON the forehead line, drawn in front of the head
  for (let i = 0; i < 9; i++) {
    const x = 52 + i * 12 + (r() - .5) * 4, y = 56 + Math.abs(i - 4) * 2.2 + r() * 3;
    front.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(9 + r() * 3).toFixed(1)}"/>`);
  }
  const hi = back.filter((_, i) => i % 3 === 0).map((c) => c.replace(/r="([\d.]+)"/, (_, v) => `r="${(v * 0.42).toFixed(1)}"`).replace('<circle', '<circle transform="translate(-3 -4)"'));
  return {
    back: `<g fill="#3A2214" stroke="${INK}" stroke-width="3">${back.join('')}</g><g fill="#6E3E1E">${hi.join('')}</g><g fill="#3A2214">${back.map((c) => c.replace(/r="([\d.]+)"/, (_, v) => `r="${(v - 1.6).toFixed(1)}"`)).join('')}</g><g fill="#7A4623" opacity=".9">${hi.join('')}</g>`,
    front: `<g fill="#3A2214" stroke="${INK}" stroke-width="2.6">${front.join('')}</g><g fill="#7A4623">${front.map((c) => c.replace(/r="([\d.]+)"/, (_, v) => `r="${(v * 0.38).toFixed(1)}"`).replace('<circle', '<circle transform="translate(-2 -3)"')).join('')}</g>`,
  };
}
const AFRO = afroSVG();
const eye = (d) => `<path d="${d}" fill="none" stroke="${GLOW}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
const star = (cx, cy, k = 1) => `<path d="M${cx} ${cy - 11 * k} Q${cx + 2 * k} ${cy - 2 * k} ${cx + 11 * k} ${cy} Q${cx + 2 * k} ${cy + 2 * k} ${cx} ${cy + 11 * k} Q${cx - 2 * k} ${cy + 2 * k} ${cx - 11 * k} ${cy} Q${cx - 2 * k} ${cy - 2 * k} ${cx} ${cy - 11 * k}Z" fill="#FFD21A" stroke="${INK}" stroke-width="1.5"/>`;
const ring = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="12" fill="#0B2E55" stroke="${GLOW}" stroke-width="3.5"/>`;
const mouth = (d, open) => open
  ? `<path d="${d}" fill="#9B1B18" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M92 141 Q100 136 108 141 Q100 146 92 141Z" fill="#F07C8A"/>`
  : `<path d="${d}" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>`;
const MOODS = {
  happy:    [eye('M70 104 Q80 91 90 104') + eye('M110 104 Q120 91 130 104'), mouth('M84 131 Q100 150 116 131 Q100 138 84 131Z', true)],
  neutral:  [`<ellipse cx="80" cy="100" rx="7" ry="9" fill="${GLOW}"/><ellipse cx="120" cy="100" rx="7" ry="9" fill="${GLOW}"/><circle cx="82.5" cy="96" r="2.4" fill="#fff"/><circle cx="122.5" cy="96" r="2.4" fill="#fff"/>`, mouth('M90 136 Q100 142 110 136')],
  ecstatic: [ring(80, 100) + ring(120, 100) + star(80, 100, .9) + star(120, 100, .9), mouth('M80 129 Q100 156 120 129 Q100 137 80 129Z', true)],
  laughing: [eye('M72 94 L86 101 L72 108') + eye('M128 94 L114 101 L128 108'), mouth('M80 129 Q100 158 120 129 Q100 137 80 129Z', true)],
  hungry:   [`<circle cx="80" cy="100" r="11" fill="${GLOW}"/><circle cx="120" cy="100" r="11" fill="${GLOW}"/><circle cx="84" cy="95" r="4" fill="#fff"/><circle cx="124" cy="95" r="4" fill="#fff"/><circle cx="76" cy="104" r="1.8" fill="#fff"/><circle cx="116" cy="104" r="1.8" fill="#fff"/>`, mouth('M88 131 Q100 150 112 131 Q100 135 88 131Z', true)],
  sad:      [eye('M70 97 Q80 107 90 101') + eye('M110 101 Q120 107 130 97'), mouth('M90 140 Q100 132 110 140')],
  sleepy:   [eye('M71 102 L89 102') + eye('M111 102 L129 102'), `<ellipse cx="100" cy="138" rx="4" ry="5" fill="#9B1B18" stroke="${INK}" stroke-width="2.5"/>`],
  confused: [`<ellipse cx="80" cy="100" rx="7" ry="9" fill="${GLOW}"/>` + eye('M112 101 Q120 93 128 101'), mouth('M90 138 Q95 134 100 138 Q105 142 110 137')],
  scared:   [`<circle cx="80" cy="100" r="12" fill="#fff" stroke="${INK}" stroke-width="2.5"/><circle cx="120" cy="100" r="12" fill="#fff" stroke="${INK}" stroke-width="2.5"/><circle cx="80" cy="101" r="3.6" fill="${INK}"/><circle cx="120" cy="101" r="3.6" fill="${INK}"/>`, `<path d="M88 140 Q92 133 96 140 Q100 147 104 140 Q108 133 112 140" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`],
  // round 21 ("הכנו את זה"): enjoying the food, eyes shut with pleasure, licking his lips, drooling
  yummy:    [eye('M70 100 Q80 110 90 100') + eye('M110 100 Q120 110 130 100'), `<path d="M84 131 Q100 150 116 131 Q100 138 84 131Z" fill="#9B1B18" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M104 136 Q116 134 121 143 Q119 152 110 149 Q104 146 104 136Z" fill="#F07C8A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M112 140 L114 147" stroke="#C94A5C" stroke-width="2" stroke-linecap="round"/>`],
  // ה1 (stage 8, approved r8p, א): after a workout; brows up toward the middle, happy eyes, a big smile with teeth (and sweat, above)
  strong:   [eye('M70 108 Q80 98 90 108') + eye('M110 108 Q120 98 130 108') + `<path d="M69 85 L88 91" stroke="${GLOW}" stroke-width="5" stroke-linecap="round"/><path d="M131 85 L112 91" stroke="${GLOW}" stroke-width="5" stroke-linecap="round"/>`,
    `<path d="M78 128 Q100 160 122 128 Q100 134 78 128Z" fill="#9B1B18" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M83 130 Q100 135 117 130 L115 136 Q100 140 85 136 Z" fill="#fff"/>`],
  // t1 (stage 10, decision 1): in distress. The inner ends of the brows raised (a line in the eyes' colour), big shining
  // eyes, a straight mouth; no tear, no effect, no pop
  understanding: [`<circle cx="80" cy="101" r="11" fill="${GLOW}"/><circle cx="120" cy="101" r="11" fill="${GLOW}"/><circle cx="84" cy="96.5" r="4" fill="#fff"/><circle cx="124" cy="96.5" r="4" fill="#fff"/><circle cx="76.5" cy="105.5" r="1.8" fill="#fff"/><circle cx="116.5" cy="105.5" r="1.8" fill="#fff"/>`,
  // the brows with the mouth, outside .eyes, so they stay when he blinks (the reviewer of 67f9002)
  `<path d="M67 87 Q78 86 90 79" fill="none" stroke="${GLOW}" stroke-width="5" stroke-linecap="round"/><path d="M133 87 Q122 86 110 79" fill="none" stroke="${GLOW}" stroke-width="5" stroke-linecap="round"/><path d="M90 138 L110 138" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>`],
  // t3 (stage 10, decision 3): waking up at night: one eye shut, one half open, a yawn; no "z" (so it isn't sleepy)
  waking:   [eye('M71 102 L89 102') + `<path d="M111 99 L129 99" fill="none" stroke="${GLOW}" stroke-width="5" stroke-linecap="round"/><path d="M112 100 Q120 109 128 100 Z" fill="${GLOW}"/>`,
    `<ellipse cx="100" cy="139" rx="8" ry="11" fill="#9B1B18" stroke="${INK}" stroke-width="3"/><ellipse cx="100" cy="144.5" rx="4.4" ry="3.3" fill="#F07C8A"/>`],
  // t5 (stage 10, decision 5): the random faces, now and then instead of an ordinary move
  hic:      [`<ellipse cx="80" cy="99" rx="7" ry="10" fill="${GLOW}"/><ellipse cx="120" cy="99" rx="7" ry="10" fill="${GLOW}"/><circle cx="82.5" cy="95" r="2.4" fill="#fff"/><circle cx="122.5" cy="95" r="2.4" fill="#fff"/>`,
    `<circle cx="100" cy="138" r="4.5" fill="#9B1B18" stroke="${INK}" stroke-width="2.5"/>`],
  achoo:    [eye('M71 95 L87 101 L71 107') + eye('M129 95 L113 101 L129 107'), `<path d="M84 132 Q100 152 116 132 Q100 128 84 132Z" fill="#9B1B18" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`],
  yawn:     [eye('M70 102 Q80 107 90 102') + eye('M110 102 Q120 107 130 102'), `<ellipse cx="100" cy="139" rx="10" ry="13" fill="#9B1B18" stroke="${INK}" stroke-width="3"/><ellipse cx="100" cy="145.5" rx="5.5" ry="3.9" fill="#F07C8A"/>`],
  hum:      [eye('M70 103 Q80 96 90 103') + eye('M110 103 Q120 96 130 103'), `<ellipse cx="100" cy="138" rx="4" ry="4.5" fill="#9B1B18" stroke="${INK}" stroke-width="2.5"/>`],
  excited:  [ring(80, 99) + ring(120, 99) + `<circle cx="80" cy="99" r="7" fill="${GLOW}"/><circle cx="120" cy="99" r="7" fill="${GLOW}"/>` + star(84, 94, .45) + star(124, 94, .45), mouth('M82 129 Q100 154 118 129 Q100 136 82 129Z', true)],
};
const FX = `
  <g class="fx-spark">${star(22, 60, 1)}${star(178, 52, .8)}${star(168, 132, .65)}</g>
  <g class="fx-zzz" font-family="Karantina, Arial" font-weight="700" fill="${BLUE}" stroke="${INK}" stroke-width="1.2"><text x="150" y="58" font-size="22">z</text><text x="160" y="46" font-size="18">z</text><text x="168" y="36" font-size="14">z</text></g>
  <g class="fx-q"><text x="160" y="62" font-family="Secular One, Arial" font-size="40" fill="#FFD21A" stroke="${INK}" stroke-width="2.5" paint-order="stroke">?</text></g>
  <!-- t2 (stage 10, decision 2): sad has no tear; the tears are only the toss's cry (fx-cry) -->
  <g class="fx-drool"><path d="M109 139 Q111 150 108 153 Q105 150 107 139Z" fill="#BFE6FF" stroke="${INK}" stroke-width="1.5"/></g>
  <g class="fx-cry"><path d="M76 110 Q81 119 76 123 Q71 119 76 110Z" fill="${GLOW}" stroke="${INK}" stroke-width="1.5"/><path d="M124 110 Q129 119 124 123 Q119 119 124 110Z" fill="${GLOW}" stroke="${INK}" stroke-width="1.5"/></g>
  <g class="fx-confetti">${[[30, 20, '#E2261C'], [60, 8, '#FFD21A'], [150, 14, '#1E6FE0'], [172, 30, '#FFD21A'], [44, 44, '#1E6FE0'], [120, 4, '#E2261C'], [164, 60, '#E2261C'], [18, 70, '#FFD21A']].map(([x, y, c]) => `<rect x="${x}" y="${y}" width="7" height="11" rx="1.5" fill="${c}" stroke="${INK}" stroke-width="1.2"/>`).join('')}</g>
  <g class="fx-steam" fill="none" stroke="#8A97AC" stroke-width="4.5" stroke-linecap="round"><path d="M20 150 Q14 140 20 130 Q26 120 20 110"/><path d="M180 146 Q174 136 180 126 Q186 116 180 106"/><path d="M166 170 Q160 160 166 150 Q172 140 166 130"/></g>
  <g class="fx-heart" fill="#E2261C" stroke="${INK}" stroke-width="1.5"><path d="M160 64 C156 58 148 60 150 67 C151 71 160 76 160 76 C160 76 169 71 170 67 C172 60 164 58 160 64Z"/><path d="M36 52 C33 47 27 49 28 54 C29 58 36 62 36 62 C36 62 43 58 44 54 C45 49 39 47 36 52Z"/></g>
  <g class="fx-bulb"><circle cx="152" cy="30" r="12" fill="#FFD21A" stroke="${INK}" stroke-width="2.5"/><rect x="147" y="41" width="10" height="7" rx="2" fill="#C9D2E0" stroke="${INK}" stroke-width="2"/><path d="M138 18 L133 13 M152 12 L152 5 M166 18 L171 13" stroke="#FFD21A" stroke-width="3" stroke-linecap="round"/></g>
  <g class="fx-check"><circle cx="160" cy="44" r="15" fill="#2BA84A" stroke="${INK}" stroke-width="2.5"/><path d="M152 44 L158 50 L169 37" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>
  <g class="fx-sweat"><path d="M150 62 Q156 71 150 76 Q144 71 150 62Z" fill="#BFE6FF" stroke="${INK}" stroke-width="1.5"/></g>
  <g class="fx-bang"><text x="156" y="56" font-family="Secular One, Arial" font-size="40" fill="#E2261C" stroke="${INK}" stroke-width="2.5" paint-order="stroke">!</text></g>
  <g class="fx-dots" fill="${BLUE}" stroke="${INK}" stroke-width="1.5"><circle cx="148" cy="40" r="4.5"/><circle cx="162" cy="34" r="5.5"/><circle cx="178" cy="26" r="6.5"/></g>
  <g class="fx-blush" fill="#F07C8A" opacity=".75"><ellipse cx="66" cy="126" rx="8" ry="4.5"/><ellipse cx="134" cy="126" rx="8" ry="4.5"/></g>
  <g class="fx-hic" font-family="Karantina, Arial" font-weight="700" fill="#FFD21A" stroke="${INK}" stroke-width="3.5" paint-order="stroke"><text x="132" y="44" font-size="30" transform="rotate(-8 132 44)" direction="ltr">HIC!</text></g>
  <g class="fx-achoo" font-family="Karantina, Arial" font-weight="700" fill="#FFD21A" stroke="${INK}" stroke-width="3.5" paint-order="stroke"><text x="112" y="40" font-size="30" transform="rotate(8 112 40)" direction="ltr">ACHOO!</text><g fill="#BFE6FF" stroke="${INK}" stroke-width="1.2"><circle cx="100" cy="166" r="2.6"/><circle cx="90" cy="172" r="2"/><circle cx="110" cy="173" r="2.2"/><circle cx="100" cy="179" r="1.7"/></g></g>
  <g class="fx-notes" font-family="Arial" font-weight="700" fill="${BLUE}" stroke="${INK}" stroke-width="1.2"><text x="146" y="64" font-size="22">♪</text><text x="160" y="46" font-size="18">♫</text><text x="172" y="30" font-size="16">♪</text></g>
  <g class="fx-ha" font-family="Karantina, Arial" font-weight="700" fill="#FFD21A" stroke="${INK}" stroke-width="3.5" paint-order="stroke"><text x="128" y="30" font-size="30" transform="rotate(10 128 30)" direction="ltr">LOL</text></g>`;

function shukiSVG(m) {
  const faces = Object.entries(MOODS).map(([k, [e, mo]]) => `<g class="m-${k}"><g class="eyes">${e}</g>${mo}</g>`).join('');
  return `<svg class="shuki" data-mood="${m}" viewBox="0 0 200 200" role="img" aria-label="שוקי">
    <g class="rig">
      <g class="afro">${AFRO.back}</g>
      <!-- shoulders -->
      <path d="M46 200 Q48 162 76 156 L124 156 Q152 162 154 200Z" fill="#FBF7EE" stroke="${INK}" stroke-width="3.5"/>
      <path d="M60 178 Q66 166 78 163" fill="none" stroke="${BLUE}" stroke-width="6" stroke-linecap="round"/>
      <path d="M140 178 Q134 166 122 163" fill="none" stroke="${BLUE}" stroke-width="6" stroke-linecap="round"/>
      <rect x="88" y="148" width="24" height="12" rx="3" fill="${BLUE}" stroke="${INK}" stroke-width="3"/>
      <circle cx="100" cy="182" r="8" fill="${BLUE}" stroke="${INK}" stroke-width="3"/><circle cx="97.5" cy="179.5" r="2.4" fill="#fff"/>
      <!-- tie -->
      <clipPath id="shuki-tie"><path d="M95.5 167 L104.5 167 L111 190 L100 200 L89 190 Z"/></clipPath>
      <g class="acc acc-tie"><path d="M93 157 L107 157 L104.5 167 L95.5 167 Z" fill="#E2261C" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M95.5 167 L104.5 167 L111 190 L100 200 L89 190 Z" fill="#E2261C"/><g clip-path="url(#shuki-tie)" stroke="#FFD21A" stroke-width="3.2"><path d="M86 180 L114 170 M86 190 L114 180 M86 200 L114 190"/></g><path d="M95.5 167 L104.5 167 L111 190 L100 200 L89 190 Z" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/></g>
      <!-- bow tie -->
      <g class="acc acc-bow"><path d="M100 165 L79 155 Q74 165 79 175 Z M100 165 L121 155 Q126 165 121 175 Z" fill="#E2261C" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M84 159 L84 171 M116 159 L116 171" stroke="#FFD21A" stroke-width="2.5" stroke-linecap="round"/><rect x="94" y="159" width="12" height="12" rx="3" fill="#A8150F" stroke="${INK}" stroke-width="2.5"/></g>
      <!-- gold medal: small, on the side of the chest, like a pin (t10, stage 10); its ribbon stays blue (question 9) -->
      <g class="acc acc-medal"><path d="M124 166 L128 176 M134 166 L130 176" stroke="${BLUE}" stroke-width="4"/><path d="M124 166 L128 176 M134 166 L130 176" stroke="${INK}" stroke-width="1" fill="none"/><circle cx="129" cy="180" r="6.5" fill="#FFD21A" stroke="${INK}" stroke-width="2.2"/><path d="M129 175.5 L130.3 179 L133.8 179.2 L131 181.3 L132 184.6 L129 182.6 L126 184.6 L127 181.3 L124.2 179.2 L127.7 179 Z" fill="#fff" opacity=".8"/></g>
      <!-- pencil behind the ear -->
      <g class="acc acc-pencil"><path d="M146 70 L174 36" stroke="${INK}" stroke-width="11" stroke-linecap="round"/><path d="M146 70 L171 40" stroke="#FFD21A" stroke-width="6"/><path d="M169 42 L174 36" stroke="#F07C8A" stroke-width="6" stroke-linecap="round"/></g>
      <!-- antenna -->
      <g class="ant"><path d="M100 52 L100 26" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M100 52 L100 26" stroke="#D8DEE8" stroke-width="4" stroke-linecap="round"/><circle cx="100" cy="21" r="8.5" fill="${BLUE}" stroke="${INK}" stroke-width="3"/><circle cx="97" cy="18" r="2.6" fill="#fff"/></g>
      <!-- headphones -->
      <rect x="30" y="80" width="20" height="44" rx="10" fill="${BLUE}" stroke="${INK}" stroke-width="3.5"/>
      <rect x="150" y="80" width="20" height="44" rx="10" fill="${BLUE}" stroke="${INK}" stroke-width="3.5"/>
      <g class="acc acc-earrings"><path d="M40 123 L40 129" stroke="${INK}" stroke-width="3"/><circle cx="40" cy="137" r="8" fill="none" stroke="${INK}" stroke-width="7.5"/><circle cx="40" cy="137" r="8" fill="none" stroke="#FFD21A" stroke-width="3.5"/><circle cx="37" cy="131" r="1.6" fill="#fff"/><path d="M160 123 L160 129" stroke="${INK}" stroke-width="3"/><circle cx="160" cy="137" r="8" fill="none" stroke="${INK}" stroke-width="7.5"/><circle cx="160" cy="137" r="8" fill="none" stroke="#FFD21A" stroke-width="3.5"/><circle cx="157" cy="131" r="1.6" fill="#fff"/></g>
      <!-- head -->
      <rect x="42" y="48" width="116" height="104" rx="44" fill="#FBF7EE" stroke="${INK}" stroke-width="4"/>
      <path d="M58 70 Q66 56 86 54" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".9"/>
      <!-- sweatband -->
      <clipPath id="shuki-head"><rect x="42" y="48" width="116" height="104" rx="44"/></clipPath><g class="acc acc-band" clip-path="url(#shuki-head)"><path d="M40 66 Q100 50 160 66 L160 78 Q100 62 40 78 Z" fill="#E2261C" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M40 72 Q100 56 160 72" fill="none" stroke="#fff" stroke-width="2.5"/></g>
      <!-- scarf, wrapped in front of the neck -->
      <g class="acc acc-scarf"><path d="M56 146 Q100 170 144 146 L148 160 Q100 186 52 160 Z" fill="#1E6FE0" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M66 155 L69 166 M82 161 L84 172 M118 161 L116 172 M134 155 L131 166" stroke="#FFD21A" stroke-width="4.5" stroke-linecap="round"/><path d="M108 170 L130 197 L114 204 L98 174 Z" fill="#1E6FE0" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M106 182 L119 177 M113 191 L125 186" stroke="#FFD21A" stroke-width="4" stroke-linecap="round"/></g>
      <!-- chef's hat -->
      <g class="acc acc-chef"><g fill="#fff" stroke="${INK}" stroke-width="3.5"><circle cx="70" cy="34" r="16"/><circle cx="130" cy="34" r="16"/><circle cx="88" cy="20" r="18"/><circle cx="112" cy="20" r="18"/><circle cx="100" cy="28" r="17"/></g><path d="M60 36 L140 36 L138 60 Q100 51 62 60 Z" fill="#fff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M80 41 L81 54 M100 40 L100 52 M120 41 L119 54" stroke="#C9D2E0" stroke-width="3" stroke-linecap="round"/></g>
      <!-- crown: the top prize, on the head, the antenna through its middle -->
      <g class="acc acc-crown"><path d="M58 56 L62 20 L80 38 L100 8 L120 38 L138 20 L142 56 Q100 46 58 56 Z" fill="#FFD21A" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M60 50 Q100 40 140 50" fill="none" stroke="#C99A00" stroke-width="3"/><circle cx="62" cy="20" r="4.5" fill="#E2261C" stroke="${INK}" stroke-width="2.5"/><circle cx="138" cy="20" r="4.5" fill="#E2261C" stroke="${INK}" stroke-width="2.5"/><circle cx="100" cy="8" r="5.5" fill="#1E6FE0" stroke="${INK}" stroke-width="2.5"/><path d="M92 36 L100 28 L108 36 L100 44 Z" fill="#E2261C" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M70 30 L73 44" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".7"/></g>
      <!-- cap -->
      <g class="acc acc-cap"><path d="M50 64 Q50 24 100 22 Q150 24 150 64 Q100 52 50 64 Z" fill="#E2261C" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M100 24 L100 56 M76 29 Q67 43 67 60 M124 29 Q133 43 133 60" stroke="#A8150F" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M40 66 Q100 50 160 66 Q166 76 150 78 Q100 66 50 78 Q34 76 40 66 Z" fill="#1E6FE0" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><circle cx="100" cy="23" r="5" fill="#FFD21A" stroke="${INK}" stroke-width="2.5"/></g>
      <!-- visor -->
      <rect x="56" y="78" width="88" height="46" rx="20" fill="#0E1016" stroke="${INK}" stroke-width="3"/>
      <path d="M64 86 Q70 81 80 81" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".35"/>
      <g class="look"><g class="face">${faces}</g></g>
      <!-- round glasses -->
      <g class="acc acc-glasses"><g fill="#BFE6FF" fill-opacity=".14" stroke="${INK}" stroke-width="7"><circle cx="80" cy="101" r="17"/><circle cx="120" cy="101" r="17"/></g><g fill="none" stroke="#FFD21A" stroke-width="3"><circle cx="80" cy="101" r="17"/><circle cx="120" cy="101" r="17"/></g><path d="M96 97 Q100 92 104 97" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M63 97 L51 93 M137 97 L149 93" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M70 92 Q74 88 79 88" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/></g>
      <!-- sunglasses: clear lenses, the eyes show through (t8, stage 10) -->
      <g class="acc acc-shades"><g fill="#2B3445" fill-opacity=".22" stroke="${INK}" stroke-width="6" stroke-linejoin="round"><path d="M60 92 Q60 87 66 87 L93 87 Q97 87 96 92 L94 105 Q93 114 84 114 L71 114 Q62 114 61 105 Z"/><path d="M140 92 Q140 87 134 87 L107 87 Q103 87 104 92 L106 105 Q107 114 116 114 L129 114 Q138 114 139 105 Z"/></g><g fill="none" stroke="#E2261C" stroke-width="2.5" stroke-linejoin="round"><path d="M60 92 Q60 87 66 87 L93 87 Q97 87 96 92 L94 105 Q93 114 84 114 L71 114 Q62 114 61 105 Z"/><path d="M140 92 Q140 87 134 87 L107 87 Q103 87 104 92 L106 105 Q107 114 116 114 L129 114 Q138 114 139 105 Z"/></g><path d="M96 91 L104 91" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M60 91 L50 89 M140 91 L150 89" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M67 93 L78 93 M109 93 L120 93" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/></g>
      <!-- beard (the mouth shows through) -->
      <g class="acc acc-beard"><path fill-rule="evenodd" d="M56 118 Q56 162 100 170 Q144 162 144 118 Q138 128 124 128 Q100 122 76 128 Q62 128 56 118 Z M79 142 a21 13 0 1 0 42 0 a21 13 0 1 0 -42 0 Z" fill="#3A2214" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M68 142 Q72 150 70 157 M131 142 Q128 150 130 157 M86 159 Q88 163 86 167 M114 159 Q112 163 114 167 M100 161 Q101 165 100 168" fill="none" stroke="#7A4623" stroke-width="2.5" stroke-linecap="round"/></g>
      <!-- mustache -->
      <g class="acc acc-mustache"><path d="M100 128 C94 121 84 121 78 126 C74 129 69 128 66 123 C66 132 74 137 83 135 C91 133 96 131 100 131 C104 131 109 133 117 135 C126 137 134 132 134 123 C131 128 126 129 122 126 C116 121 106 121 100 128 Z" fill="#3A2214" stroke="${INK}" stroke-width="2.8" stroke-linejoin="round"/><path d="M80 127 Q86 124 92 127" fill="none" stroke="#7A4623" stroke-width="2" stroke-linecap="round"/></g>
      <g class="afro">${AFRO.front}</g>
      <!-- the sweatband on the afro: above the hair (t9, stage 10) -->
      <g class="acc acc-band-up"><path d="M34 52 Q100 26 166 52 L166 66 Q100 40 34 66 Z" fill="#E2261C" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M34 59 Q100 33 166 59" fill="none" stroke="#fff" stroke-width="2.5"/></g>
    </g>
    <g class="fx">${FX}</g>
  </svg>`;
}


/** The faces this app can draw (question 17: one it can't is shown as sad). */
export const FACES_KNOWN = Object.keys(MOODS);
export const MOOD_NAMES = { ecstatic: 'אפרו', laughing: 'צוחק', happy: 'שמח', neutral: 'רגיל', hungry: 'רעב', sad: 'עצוב', sleepy: 'ישנוני', confused: 'מבולבל', excited: 'נלהב', scared: 'מבוהל', strong: 'שרירי', understanding: 'מבין' };

const MOVES = ['r-jump', 'r-spin', 'r-sniff', 'r-nod', 'r-droop', 'r-hop', 'r-stretch'];
let styled = false;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// [class, ms, weight]; 'scan' is a sequence (look one way, then the other)
const IDLE = [
  ['i-look-l', 900, 3], ['i-look-r', 900, 3], ['i-look-up', 800, 2], ['i-look-down', 900, 1], ['scan', 0, 2],
  ['i-twitch', 520, 2], ['i-spin', 950, 1], ['i-hop', 950, 1], ['i-tilt', 1450, 2], ['i-wiggle', 760, 1],
  ['i-stretch', 1150, 1], ['i-lean-l', 1650, 1], ['i-lean-r', 1650, 1], ['i-shiver', 760, 1], ['blink2', 0, 2],
];
// t5 (stage 10, decision 5; question 7): a random face every 3–6 minutes, instead of an ordinary move; never in distress or
// sadness, after a fault (setCalm), while thinking or in any passing expression, nor with Reduce Motion; the yawn only at
// night (setNight) or when he is sleepy. Steps: [ms from the start, face, fx, move class]; the last is the end.
export const FUNNY = {
  hic: [[0, 'hic', 'hic', 'f-hic'], [650, 'hic', '', ''], [800, 'hic', 'hic', 'f-hic2'], [1600]],
  achoo: [[0, 'hic', '', 'f-achoo-in'], [600, 'achoo', '', ''], [800, 'achoo', 'achoo', 'f-achoo'], [1800]],
  yawn: [[0, 'yawn', '', 'f-yawn'], [2200]],
  hum: [[0, 'hum', 'notes', 'f-hum'], [3000]],
};
const FUNNY_MOVES = ['f-hic', 'f-hic2', 'f-achoo-in', 'f-achoo', 'f-yawn', 'f-hum'];
const FUNNY_EVERY = [3 * 60e3, 6 * 60e3];
const pick = (list, not = []) => { const pool = list.filter((x) => !not.includes(x[0])); const total = pool.reduce((a, x) => a + x[2], 0); let r = Math.random() * total; for (const x of pool) { if ((r -= x[2]) < 0) return x; } return pool[0]; };

/** opts (tests only): tick: [ms, ms] between idle moments, funnyEvery: [ms, ms] between random faces */
export function mount(el, mood = 'happy', look = 1, opts = {}) {
  if (!styled) { const st = document.createElement('style'); st.textContent = CSS; document.head.append(st); styled = true; }
  el.innerHTML = shukiSVG(mood);
  const svg = el.firstElementChild;
  const dress = (lk) => {
    const level = typeof lk === 'number' ? lk : lk?.level || 1;
    const wear = typeof lk === 'number' ? autoOutfit(lk) : lk?.wear || autoOutfit(level);
    const on = new Set(Object.values(wear));
    for (const x of ITEMS) svg.classList.toggle(`w-${x.id}`, on.has(x.id));
    const key = [...on].sort().join(',');
    const changed = svg.dataset.wear !== undefined && svg.dataset.wear !== key;
    svg.dataset.level = level; svg.dataset.wear = key;
    return changed;
  };
  dress(look);
  let base = mood, reactTimer = 0, alive = true, timers = [];
  let calm = false, night = () => false, funnyRun = 0, nth = 0;
  const every = opts.funnyEvery || FUNNY_EVERY, tick = opts.tick || [3500, 11000];
  let funnyAt = Date.now() + every[0] + Math.random() * (every[1] - every[0]);
  const later = (fn, ms) => { const t = setTimeout(() => { timers = timers.filter((x) => x !== t); if (alive) fn(); }, ms); timers.push(t); };

  const blink = () => {
    if (['sleepy', 'laughing', 'happy', 'strong', 'waking', 'hum', 'yawn', 'achoo'].includes(svg.dataset.mood)) return; // arcs (and a shut eye) don't blink
    svg.classList.add('blink'); later(() => svg.classList.remove('blink'), 170);
  };
  const recentActs = [];
  const act = (cls, ms) => {
    if (cls === 'blink2') { blink(); later(blink, 260); return; }
    if (cls === 'scan') { const [a, b] = Math.random() < .5 ? ['l', 'r'] : ['r', 'l']; act(`i-look-${a}`, 700); later(() => act(`i-look-${b}`, 800), 850); return; }
    svg.classList.add(cls); later(() => svg.classList.remove(cls), ms);
  };
  // "מבין" comes in still (t1): no squash and stretch
  // t7: the afro is on in the lasting full stock (ecstatic, with no passing expression) or when a moment brings it (fx "afro")
  const afro = () => svg.classList.toggle('afro-on', /(^| )afro( |$)/.test(svg.dataset.fx || '') || (!reactTimer && svg.dataset.mood === 'ecstatic'));
  const pop = () => { svg.classList.remove('pop'); if (svg.dataset.mood === 'understanding') return; void svg.getBBox(); svg.classList.add('pop'); };
  afro(); // mounted on the full stock: the afro is already on

  (function blinkLoop() { later(() => { if (!document.hidden) blink(); blinkLoop(); }, 1800 + Math.random() * 3200); })();
  (function idleLoop() {
    later(() => {
      if (!document.hidden && !reduced()) {
        const m = svg.dataset.mood;
        if (!reactTimer && !calm && Date.now() >= funnyAt && !['sad', 'understanding'].includes(m)) {
          const ok = (n) => n !== 'yawn' || night() || m === 'sleepy';
          // opts.funnyOrder (tests only): the faces in this order, skipping one not allowed now
          const order = opts.funnyOrder?.filter(ok), names = Object.keys(FUNNY).filter(ok);
          funny(order?.length ? order[nth++ % order.length] : names[Math.floor(Math.random() * names.length)]);
          funnyAt = Date.now() + every[0] + Math.random() * (every[1] - every[0]);
        }
        else if (m === 'understanding' || m === 'waking') { /* t1, question 4: no idle moves in distress; t3: none over the waking stretch */ }
        else if (m === 'sleepy') { if (Math.random() < .5) act('i-nod', 1650); }
        // not every pause gets a move, and never the same move as the last three
        else if (m !== 'laughing' && Math.random() < .7) { const [cls, ms] = pick(IDLE, recentActs); act(cls, ms); recentActs.push(cls); if (recentActs.length > 3) recentActs.shift(); }
      }
      idleLoop();
    }, tick[0] + Math.random() * (tick[1] - tick[0]));
  })();

  /** A random face (t5): its steps one after another, as a passing expression; any react() or settle() stops it. */
  function funny(name) {
    const steps = FUNNY[name], run = ++funnyRun;
    // a step with no move keeps the one before (the sneeze stays leaning back, the reviewer of 1ccb57c)
    const show = ([, m, fx, cls]) => { svg.dataset.mood = m; svg.dataset.fx = fx; if (cls) { svg.classList.remove(...FUNNY_MOVES); void svg.getBBox(); svg.classList.add(cls); } afro(); };
    reactTimer = setTimeout(() => { if (run !== funnyRun) return; reactTimer = 0; if (alive) { svg.dataset.mood = base; svg.dataset.fx = ''; svg.classList.remove(...FUNNY_MOVES); afro(); } }, steps.at(-1)[0]);
    show(steps[0]);
    for (const st of steps.slice(1, -1)) later(() => { if (run === funnyRun) show(st); }, st[0]);
  }
  const stopFunny = () => { funnyRun++; svg.classList.remove(...FUNNY_MOVES); };

  return {
    svg,
    get mood() { return base; },
    /** The lasting mood (from the state of the house). */
    setMood(m) { if (m === base) return; base = m; if (!reactTimer) { svg.dataset.mood = m; afro(); pop(); } },
    /** What a screen reader says: the lasting mood and why (פ25); a passing expression (react) doesn't change it. */
    setLabel(text) { svg.setAttribute('aria-label', text); },
    /** A passing expression (and an effect and a move: { fx: 'cry confetti', move: 'jump' }), then back to the lasting mood. */
    react(m, ms = 2200, { fx = '', move = '' } = {}) {
      clearTimeout(reactTimer); stopFunny(); reactTimer = -1; svg.dataset.mood = m; svg.dataset.fx = fx; afro(); pop();
      svg.classList.remove(...MOVES); if (move) { void svg.getBBox(); svg.classList.add(`r-${move}`); }
      reactTimer = setTimeout(() => { reactTimer = 0; if (alive) { svg.dataset.mood = base; svg.dataset.fx = ''; afro(); svg.classList.remove(...MOVES); pop(); } }, ms);
    },
    /** End a passing expression now and show the lasting mood (t1: a distress answer ends "thinking" at once). */
    settle() { clearTimeout(reactTimer); stopFunny(); if (!reactTimer) return; reactTimer = 0; svg.dataset.mood = base; svg.dataset.fx = ''; afro(); svg.classList.remove(...MOVES); pop(); },
    blink,
    /** t5: after a fault (no reception, no model) there are no random faces; at night the yawn is one of them. */
    setCalm(on) { calm = !!on; },
    setNight(on) { night = typeof on === 'function' ? on : () => !!on; }, // a function: asked each time (the night changes on a quiet evening too)
    /** What to wear: a level, or { level, wear } from the closet. A change gets a little hop. */
    setLook(lk) { if (dress(lk)) { svg.classList.remove('grow'); void svg.getBBox(); svg.classList.add('grow'); } },
    setLevel(n) { this.setLook(n); },
    /** Look toward something for a moment: 'l' | 'r' | 'up' | 'down'. */
    lookAt(dir, ms = 1200) { act(`i-look-${dir}`, ms); },
    destroy() { alive = false; timers.forEach(clearTimeout); clearTimeout(reactTimer); },
  };
}
