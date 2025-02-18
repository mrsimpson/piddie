/**
 * List of simple, memorable adjectives
 */
const adjectives = [
  "happy",
  "clever",
  "swift",
  "bright",
  "calm",
  "gentle",
  "bold",
  "kind",
  "wise",
  "quick",
  "fair",
  "brave",
  "proud",
  "warm",
  "cool",
  "eager",
  "keen",
  "glad",
  "fresh",
  "light"
];

/**
 * List of simple, memorable nouns
 */
const nouns = [
  "river",
  "mountain",
  "forest",
  "ocean",
  "star",
  "moon",
  "sun",
  "wind",
  "cloud",
  "tree",
  "flower",
  "bird",
  "wolf",
  "bear",
  "fox",
  "deer",
  "eagle",
  "hawk",
  "owl",
  "dove"
];

/**
 * List of simple, memorable verbs
 */
const verbs = [
  "runs",
  "jumps",
  "flies",
  "swims",
  "dances",
  "sings",
  "glows",
  "flows",
  "grows",
  "shines",
  "soars",
  "leaps",
  "walks",
  "moves",
  "plays",
  "dreams",
  "thinks",
  "speaks",
  "learns",
  "sees"
];

/**
 * Get a random item from an array
 */
function getRandomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)]!;
}

/**
 * Generate a unique project ID using three random words
 * Format: adjective-noun-verb
 * Example: clever-fox-runs
 */
export function generateProjectId(): string {
  const adjective = getRandomItem(adjectives);
  const noun = getRandomItem(nouns);
  const verb = getRandomItem(verbs);

  return `${adjective}-${noun}-${verb}`;
}
