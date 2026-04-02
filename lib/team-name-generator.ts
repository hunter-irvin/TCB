type WeightedTeamWord = {
  word: string;
  weight: number;
};

type TeamNameGeneratorOptions = {
  playerNames: readonly string[];
  existingNames: readonly string[];
  random?: () => number;
};

const TEAM_NAME_WORD_BANK: Record<string, readonly WeightedTeamWord[]> = {
  a: [
    { word: "Aces", weight: 6 },
    { word: "Admirals", weight: 5 },
    { word: "All-Stars", weight: 5 },
    { word: "Alliance", weight: 4 },
    { word: "Ambassadors", weight: 4 },
    { word: "Anchors", weight: 3 },
    { word: "Archons", weight: 3 },
    { word: "A-Listers", weight: 5 },
    { word: "Attackers", weight: 3 },
    { word: "Aviary", weight: 2 },
    { word: "Argonauts", weight: 4 },
    { word: "Anacondas", weight: 3 },
    { word: "Ascendancy", weight: 4 },
    { word: "Alphas", weight: 5 },
    { word: "Avatars", weight: 3 },
    { word: "Agents", weight: 3 },
    { word: "Athenians", weight: 3 },
    { word: "Aardwolves", weight: 2 },
    { word: "Airborne", weight: 4 },
    { word: "Apostles", weight: 2 },
    { word: "Avalanche", weight: 3 },
    { word: "Arsenal", weight: 5 },
    { word: "Apex", weight: 4 },
    { word: "Avengers", weight: 4 },
    { word: "Aviators", weight: 4 },
    { word: "Armada", weight: 4 },
    { word: "Archers", weight: 3 },
    { word: "Ancients", weight: 2 },
    { word: "Ace Squad", weight: 3 }
  ],
  b: [
    { word: "Ballers", weight: 7 },
    { word: "Brigade", weight: 5 },
    { word: "Barons", weight: 4 },
    { word: "Bruins", weight: 3 },
    { word: "Blaze", weight: 2 }
  ],
  c: [
    { word: "Commanders", weight: 6 },
    { word: "Captains", weight: 5 },
    { word: "Cavaliers", weight: 4 },
    { word: "Centurions", weight: 4 },
    { word: "Champions", weight: 4 },
    { word: "Chargers", weight: 3 },
    { word: "Chiefs", weight: 3 },
    { word: "Crushers", weight: 3 },
    { word: "Cobras", weight: 3 },
    { word: "Crusaders", weight: 3 }
  ],
  d: [
    { word: "Dawgs", weight: 6 },
    { word: "Dynasty", weight: 5 },
    { word: "Defenders", weight: 5 },
    { word: "Dreadnoughts", weight: 4 },
    { word: "Destroyers", weight: 4 },
    { word: "Dominion", weight: 4 },
    { word: "Dynamos", weight: 4 },
    { word: "Dark Horses", weight: 4 },
    { word: "Deadshots", weight: 3 },
    { word: "Diamondbacks", weight: 3 },
    { word: "Disciplined", weight: 2 },
    { word: "Drifters", weight: 2 },
    { word: "Depth Charge", weight: 2 },
    { word: "Dream Team", weight: 4 },
    { word: "Desperados", weight: 4 },
    { word: "Division", weight: 2 },
    { word: "Decimators", weight: 3 },
    { word: "Dons", weight: 3 },
    { word: "Duelists", weight: 3 },
    { word: "Defiance", weight: 4 },
    { word: "Dragoons", weight: 4 },
    { word: "Dragons", weight: 3 },
    { word: "Dukes", weight: 4 },
    { word: "Diesels", weight: 3 },
    { word: "Demons", weight: 2 },
    { word: "Dashers", weight: 2 },
    { word: "Dominators", weight: 4 },
    { word: "Dragonfire", weight: 2 }
  ],
  e: [
    { word: "Elite", weight: 7 },
    { word: "Empire", weight: 6 },
    { word: "Enforcers", weight: 5 },
    { word: "Emperors", weight: 4 },
    { word: "Eagles", weight: 3 }
  ],
  f: [
    { word: "Frontline", weight: 5 },
    { word: "Force", weight: 4 },
    { word: "Firebrands", weight: 4 },
    { word: "Falcons", weight: 3 },
    { word: "Fury", weight: 3 }
  ],
  g: [
    { word: "Generals", weight: 6 },
    { word: "Guardians", weight: 5 },
    { word: "Gladiators", weight: 4 },
    { word: "Griffins", weight: 3 },
    { word: "Gold", weight: 4 }
  ],
  h: [
    { word: "Hustlers", weight: 7 },
    { word: "Headliners", weight: 6 },
    { word: "Highlanders", weight: 4 },
    { word: "Heroes", weight: 4 },
    { word: "Hawks", weight: 3 }
  ],
  i: [
    { word: "Icons", weight: 7 },
    { word: "Invincibles", weight: 5 },
    { word: "Imperials", weight: 4 },
    { word: "Ironclads", weight: 3 }
  ],
  j: [
    { word: "Jackets", weight: 5 },
    { word: "Jackals", weight: 4 },
    { word: "Jackhammers", weight: 3 },
    { word: "Jackrabbits", weight: 4 },
    { word: "Jaguars", weight: 4 },
    { word: "Jammers", weight: 2 },
    { word: "Janissaries", weight: 3 },
    { word: "Jaegers", weight: 3 },
    { word: "Javelins", weight: 3 },
    { word: "Javelineers", weight: 3 },
    { word: "Jayhawks", weight: 3 },
    { word: "Jets", weight: 3 },
    { word: "Jetstream", weight: 2 },
    { word: "Jetsetters", weight: 3 },
    { word: "Jesters", weight: 2 },
    { word: "Jockeys", weight: 2 },
    { word: "Joint Chiefs", weight: 3 },
    { word: "Judges", weight: 3 },
    { word: "Judicators", weight: 3 },
    { word: "Junction Crew", weight: 2 },
    { word: "Junkyard Dawgs", weight: 2 },
    { word: "Jurors", weight: 2 },
    { word: "Justiciars", weight: 4 },
    { word: "Juggernauts", weight: 4 },
    { word: "Justice", weight: 3 },
    { word: "Journeymen", weight: 2 },
    { word: "Joyriders", weight: 2 },
    { word: "Jubilee", weight: 2 },
    { word: "Javelin Guard", weight: 2 }
  ],
  k: [
    { word: "Krew", weight: 7 },
    { word: "Kings", weight: 5 },
    { word: "Knights", weight: 4 },
    { word: "Kingdom", weight: 4 },
    { word: "Kodiaks", weight: 3 }
  ],
  l: [
    { word: "Legends", weight: 6 },
    { word: "Lords", weight: 5 },
    { word: "Lancers", weight: 4 },
    { word: "Legion", weight: 5 },
    { word: "Legionnaires", weight: 4 },
    { word: "Lawmen", weight: 3 },
    { word: "Legacy", weight: 4 },
    { word: "Liftoff", weight: 2 },
    { word: "Liberators", weight: 4 },
    { word: "Lightning", weight: 3 },
    { word: "Lightning Strike", weight: 2 },
    { word: "Lions", weight: 3 },
    { word: "Lobos", weight: 3 },
    { word: "Locomotives", weight: 3 },
    { word: "Longshots", weight: 3 },
    { word: "Longhorns", weight: 3 },
    { word: "Lookouts", weight: 2 },
    { word: "Lowriders", weight: 3 },
    { word: "Luminaries", weight: 4 },
    { word: "Lynx", weight: 3 },
    { word: "Leaders", weight: 3 },
    { word: "Lionhearts", weight: 4 },
    { word: "Leviathans", weight: 3 },
    { word: "Livewires", weight: 2 },
    { word: "Landlords", weight: 2 },
    { word: "Leopards", weight: 2 },
    { word: "Landsharks", weight: 2 },
    { word: "Lockdown", weight: 3 }
  ],
  m: [
    { word: "Mavericks", weight: 7 },
    { word: "Marauders", weight: 5 },
    { word: "Monarchs", weight: 5 },
    { word: "Majestics", weight: 4 },
    { word: "Mustangs", weight: 3 }
  ],
  n: [
    { word: "Nomads", weight: 6 },
    { word: "Nightwatch", weight: 5 },
    { word: "Navigators", weight: 4 },
    { word: "Nobles", weight: 4 },
    { word: "Nighthawks", weight: 4 },
    { word: "Nightfall", weight: 3 },
    { word: "Night Owls", weight: 2 },
    { word: "Night Shift", weight: 3 },
    { word: "Nationals", weight: 3 },
    { word: "Nation", weight: 2 },
    { word: "Navy", weight: 3 },
    { word: "Narwhals", weight: 2 },
    { word: "Netbreakers", weight: 3 },
    { word: "Netminders", weight: 3 },
    { word: "New Guard", weight: 3 },
    { word: "Neon Knights", weight: 2 },
    { word: "Nerve", weight: 2 },
    { word: "Northmen", weight: 3 },
    { word: "North Stars", weight: 4 },
    { word: "Ninjas", weight: 3 },
    { word: "Night Riders", weight: 3 },
    { word: "Neptunes", weight: 2 },
    { word: "Norsemen", weight: 4 },
    { word: "Nucleus", weight: 2 },
    { word: "Notables", weight: 2 },
    { word: "Nitros", weight: 3 },
    { word: "Northwind", weight: 2 },
    { word: "Neutron Stars", weight: 2 }
  ],
  o: [
    { word: "Outlaws", weight: 7 },
    { word: "Olympians", weight: 4 },
    { word: "Onslaught", weight: 4 },
    { word: "Overlords", weight: 4 },
    { word: "Owls", weight: 2 }
  ],
  p: [
    { word: "Pioneers", weight: 6 },
    { word: "Patriots", weight: 5 },
    { word: "Paladins", weight: 4 },
    { word: "Phantoms", weight: 4 },
    { word: "Panthers", weight: 3 }
  ],
  q: [
    { word: "Quartermasters", weight: 6 },
    { word: "Queens", weight: 4 },
    { word: "Quasars", weight: 3 }
  ],
  r: [
    { word: "Renegades", weight: 7 },
    { word: "Royals", weight: 5 },
    { word: "Rangers", weight: 4 },
    { word: "Reckoning", weight: 3 },
    { word: "Reapers", weight: 3 },
    { word: "Rockets", weight: 2 },
    { word: "Rebels", weight: 4 },
    { word: "Roadrunners", weight: 3 },
    { word: "Roughriders", weight: 3 }
  ],
  s: [
    { word: "Superstars", weight: 7 },
    { word: "Sentinels", weight: 5 },
    { word: "Shoguns", weight: 5 },
    { word: "Spartans", weight: 4 },
    { word: "Stallions", weight: 3 }
  ],
  t: [
    { word: "Trailblazers", weight: 6 },
    { word: "Tacticians", weight: 5 },
    { word: "Task Force", weight: 4 },
    { word: "Taskmasters", weight: 4 },
    { word: "Tempest", weight: 3 },
    { word: "Templars", weight: 4 },
    { word: "Terminators", weight: 3 },
    { word: "Terriers", weight: 2 },
    { word: "Tigers", weight: 3 },
    { word: "Titans", weight: 4 },
    { word: "Trail Crew", weight: 2 },
    { word: "Trail Masters", weight: 3 },
    { word: "Trendsetters", weight: 4 },
    { word: "Torchbearers", weight: 4 },
    { word: "Top Dawgs", weight: 3 },
    { word: "Top Shelf", weight: 3 },
    { word: "Tower", weight: 2 },
    { word: "Townies", weight: 2 },
    { word: "Triumph", weight: 4 },
    { word: "Tridents", weight: 3 },
    { word: "Trojans", weight: 4 },
    { word: "Thunder", weight: 3 },
    { word: "Thunderhawks", weight: 3 },
    { word: "Thunderbolts", weight: 3 },
    { word: "Trailhawks", weight: 2 },
    { word: "Trail Kings", weight: 2 },
    { word: "Top Guns", weight: 3 },
    { word: "Trail Guards", weight: 2 },
    { word: "Tempo", weight: 2 }
  ],
  u: [
    { word: "Uprising", weight: 6 },
    { word: "Union", weight: 4 },
    { word: "Usurpers", weight: 4 },
    { word: "Undertakers", weight: 3 },
    { word: "Unicorns", weight: 2 }
  ],
  v: [
    { word: "Vanguards", weight: 6 },
    { word: "Victors", weight: 6 },
    { word: "Voyagers", weight: 4 },
    { word: "Vipers", weight: 3 },
    { word: "Vandals", weight: 2 }
  ],
  w: [
    { word: "Watchmen", weight: 6 },
    { word: "Wardens", weight: 5 },
    { word: "Warriors", weight: 4 },
    { word: "Wolves", weight: 3 },
    { word: "Wildcats", weight: 3 }
  ],
  x: [
    { word: "X-Factors", weight: 7 },
    { word: "Xecutors", weight: 5 },
    { word: "Xpress", weight: 4 }
  ],
  y: [
    { word: "Youngbloods", weight: 6 },
    { word: "Yard Dawgs", weight: 5 },
    { word: "Yardbirds", weight: 4 },
    { word: "Yetis", weight: 3 }
  ],
  z: [
    { word: "Zeniths", weight: 6 },
    { word: "Zealots", weight: 4 },
    { word: "Zodiacs", weight: 3 },
    { word: "Zephyrs", weight: 2 }
  ]
};

const GENERIC_FALLBACK_FIRST_NAMES = [
  "Ace",
  "Blake",
  "Chris",
  "Drew",
  "Eric",
  "Flynn",
  "Grant",
  "Hayes",
  "Isaiah",
  "Juwan",
  "Kai",
  "Logan",
  "Malik",
  "Nico",
  "Owen",
  "Parker",
  "Quinn",
  "Rome",
  "Shawn",
  "Trey",
  "Uriah",
  "Vince",
  "Wes",
  "Xavier",
  "Yuri",
  "Zane"
] as const;

const UNIQUE_SUFFIXES = ["II", "III", "IV", "V", "VI", "VII", "VIII"] as const;

function normalizeNameKey(name: string) {
  return name.trim().toLowerCase();
}

function getLeadingLetter(value: string) {
  const match = value.match(/[A-Za-z]/);
  return match ? match[0].toLowerCase() : null;
}

function shuffle<T>(items: readonly T[], random: () => number) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function pickWeightedIndex(items: readonly WeightedTeamWord[], random: () => number) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let threshold = random() * totalWeight;

  for (let index = 0; index < items.length; index += 1) {
    threshold -= items[index].weight;
    if (threshold < 0) {
      return index;
    }
  }

  return items.length - 1;
}

function buildWordCandidates(letter: string, random: () => number) {
  const words = TEAM_NAME_WORD_BANK[letter] ?? [];
  const weightedPool = [...words];
  const ordered: string[] = [];

  while (weightedPool.length > 0) {
    const index = pickWeightedIndex(weightedPool, random);
    ordered.push(weightedPool[index].word);
    weightedPool.splice(index, 1);
  }

  return ordered;
}

export function extractFirstName(name: string) {
  const match = name.trim().match(/[A-Za-z][A-Za-z'-]*/);
  return match ? match[0] : null;
}

export function formatGeneratedTeamName(firstName: string, mascotWord: string) {
  return `${firstName}'s ${mascotWord}`;
}

function withUniqueSuffix(baseName: string, disallowedNames: ReadonlySet<string>) {
  if (!disallowedNames.has(normalizeNameKey(baseName))) {
    return baseName;
  }

  for (const suffix of UNIQUE_SUFFIXES) {
    const nextName = `${baseName} ${suffix}`;
    if (!disallowedNames.has(normalizeNameKey(nextName))) {
      return nextName;
    }
  }

  let counter = UNIQUE_SUFFIXES.length + 2;
  while (counter < 1000) {
    const nextName = `${baseName} ${counter}`;
    if (!disallowedNames.has(normalizeNameKey(nextName))) {
      return nextName;
    }
    counter += 1;
  }

  return `${baseName} Alt`;
}

function buildNameFromFirstName(
  firstName: string,
  disallowedNames: ReadonlySet<string>,
  random: () => number
) {
  const letter = getLeadingLetter(firstName);
  if (!letter) {
    return null;
  }

  const candidates = buildWordCandidates(letter, random);
  for (const mascotWord of candidates) {
    const teamName = formatGeneratedTeamName(firstName, mascotWord);
    if (!disallowedNames.has(normalizeNameKey(teamName))) {
      return teamName;
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return withUniqueSuffix(formatGeneratedTeamName(firstName, candidates[0]), disallowedNames);
}

export function generateScenarioTeamName({
  playerNames,
  existingNames,
  random = Math.random
}: TeamNameGeneratorOptions) {
  const disallowedNames = new Set(
    existingNames
      .map((name) => normalizeNameKey(name))
      .filter(Boolean)
  );

  const candidateFirstNames = shuffle(
    playerNames
      .map((name) => extractFirstName(name))
      .filter((name): name is string => Boolean(name)),
    random
  );

  for (const firstName of candidateFirstNames) {
    const nextName = buildNameFromFirstName(firstName, disallowedNames, random);
    if (nextName) {
      return nextName;
    }
  }

  const fallbackFirstNames = shuffle(GENERIC_FALLBACK_FIRST_NAMES, random);
  for (const firstName of fallbackFirstNames) {
    const nextName = buildNameFromFirstName(firstName, disallowedNames, random);
    if (nextName) {
      return nextName;
    }
  }

  return withUniqueSuffix("Team Legends", disallowedNames);
}
