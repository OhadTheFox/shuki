// Shuki's momentary reactions (decisions 130-133): a face, an effect and a move for a few seconds,
// then back to the lasting mood, which comes from the state of the house. Shared by the app and the server.
// [mood, ms, fx, move]
export const REACTIONS = {
  toss:        ['sad', 3000, 'cry', 'droop'],          // something was thrown away: a quick cry, no sad day
  cooked:      ['excited', 3200, 'steam', 'sniff'],    // "I made shakshuka"
  recipeSaved: ['excited', 2400, 'heart', 'hop'],
  // t7 (stage 10, decision 7): the afro only in the full stock, a run of updates and a level-up (fx "afro"); the rest are excited
  shopDone:    ['excited', 3200, 'confetti', 'jump'],  // the trip is closed
  listEmpty:   ['excited', 3000, 'confetti', 'spin'],  // the last line on the list was bought
  tick:        ['happy', 700, '', 'nod'],              // one line ticked in the cart
  shopStart:   ['excited', 2400, 'bang', 'hop'],
  othersAdded: ['excited', 2000, 'bang', ''],          // in the store, and someone at home added a line
  delivery:    ['excited', 2400, 'check', 'jump'],
  learned:     ['excited', 2600, 'bulb', 'jump'],      // a rule or something Shuki noticed was approved
  mapped:      ['excited', 2400, 'check', 'hop'],      // a place in the house was mapped
  settled:     ['excited', 3400, 'confetti', 'spin'],  // the first mapping is done
  levelUp:     ['laughing', 3200, 'confetti afro', 'jump'],
  thanks:      ['happy', 2400, 'blush heart', ''],
  thumbsUp:    ['happy', 1600, 'heart', 'nod'],
  thumbsDown:  ['sad', 1800, 'sweat', 'nod'],        // got it, no crying
  oops:        ['confused', 1800, 'sweat', ''],        // undo, a card that expired
  rejected:    ['neutral', 1200, '', 'nod'],
  approved:    ['happy', 1400, 'check', 'nod'],
  receipt:     ['excited', 2000, 'bang', 'hop'],
  thinking:    ['neutral', 60000, 'dots', ''],         // waiting for the model
  error:       ['confused', 2000, 'sweat', ''],
  scared:      ['scared', 2400, 'bang', ''],        // before deleting, a warning
  yum:         ['hungry', 2200, '', 'sniff'],
  cookedCard:  ['yummy', 3500, 'steam', 'sniff'],    // "הכנו את זה": enjoying the food, drooling
  bonAppetit:  ['happy', 2400, 'heart', 'hop'],      // "בתיאבון!", after hungry          // the leftovers were eaten
  noDouble:    ['happy', 1600, 'check', 'nod'],        // "we have it" saved a double buy
  skipped:     ['excited', 2000, 'check', 'hop'],      // "we'll think about it" → didn't buy
  newMember:   ['excited', 2600, 'heart', 'jump'],
  welcomeBack: ['excited', 2400, 'heart', 'hop'],
  away:        ['sleepy', 2400, '', ''],
  allStocked:  ['ecstatic', 2600, 'confetti afro', 'jump'], // every regular thing is in the house
  poke:        ['excited', 2200, '', ''],              // someone tapped him
  love:        ['happy', 2600, 'heart blush', 'hop'],  // "I love being taken care of"
  workout:     ['strong', 2600, 'sweat', 'jump'],      // ה1 (stage 8): after a workout, the sweatband for a moment
  wake:        ['waking', 2500, '', 'stretch'],        // t3 (stage 10): the first message at night; then the answer's face
};

export function reaction(name) {
  const r = REACTIONS[name];
  return r && { mood: r[0], ms: r[1], fx: r[2], move: r[3] };
}
