// Backend only: never import this module from the frontend or shared protocol.
export interface QuestionPair { id: string; questions: readonly [string, string] }

// Frozen Stage 1 index mapping. Never reorder/remove entries, even when retiring a pair.
export const LEGACY_QUESTION_IDS = [
  'film-patience', 'plants-and-mugs', 'imaginary-friends', 'pizza-party',
  'camera-roll', 'camping-dinners', 'alarms-and-chances', 'lateness-and-naps',
  'ducks-and-children', 'mental-tabs', 'cushions-and-bags', 'bull-and-jokes',
  'karaoke-memory', 'secrets-and-laughs', 'queues-and-books', 'hair-and-jackets',
  'train-snacks', 'age-and-frying-pans',
] as const;

// Stable IDs belong to the pair, not its position. Never reuse an ID for a different pair.
export const QUESTIONS: readonly QuestionPair[] = [
  { id: 'film-patience', questions: ['How many minutes could you convincingly pretend to enjoy a terrible film?', 'How many minutes do you spend choosing what to watch?'] },
  { id: 'plants-and-mugs', questions: ['How many houseplants would make someone a plant person?', 'How many mugs does one person really need?'] },
  { id: 'imaginary-friends', questions: ['What age is too old to blame a mess on your imaginary friend?', 'At what age did you stop believing you could become a superhero?'] },
  { id: 'pizza-party', questions: ['How many slices of pizza could you eat if nobody was watching?', 'How many people would you invite to a very small birthday dinner?'] },
  { id: 'camera-roll', questions: ['What percentage of your camera roll is completely useless?', 'What percentage of a group project do you secretly expect to do?'] },
  { id: 'camping-dinners', questions: ['How many days could you survive camping with no internet?', 'How many days could you eat the same dinner before complaining?'] },
  { id: 'alarms-and-chances', questions: ['How many alarms would it take to wake you for a sunrise hike?', 'How many chances should a terrible restaurant get?'] },
  { id: 'lateness-and-naps', questions: ['How many minutes late can a friend be before you order without them?', 'How many minutes should a perfect power nap last?'] },
  { id: 'ducks-and-children', questions: ['How many ducks could you confidently escort across a busy park?', 'How many children could you supervise at a birthday party?'] },
  { id: 'mental-tabs', questions: ['How many tabs are open in your brain right now?', 'How many unread messages start to feel stressful?'] },
  { id: 'cushions-and-bags', questions: ['What is the maximum number of cushions a sofa should have?', 'How many bags would you pack for a weekend away?'] },
  { id: 'bull-and-jokes', questions: ['How many seconds would you last on a mechanical bull?', 'How many seconds can you hold a serious face during a terrible joke?'] },
  { id: 'karaoke-memory', questions: ['How many songs could you perform at karaoke without seeing lyrics?', 'How many phone numbers do you know by heart?'] },
  { id: 'secrets-and-laughs', questions: ['Out of ten, how good would you be at keeping a surprise party secret?', 'Out of ten, how convincing is your fake laugh?'] },
  { id: 'queues-and-books', questions: ['How many hours would you queue for free concert tickets?', 'How many hours could you happily spend in a bookshop?'] },
  { id: 'hair-and-jackets', questions: ['How many people would you trust to cut your hair?', 'How many friends would you lend your favourite jacket to?'] },
  { id: 'train-snacks', questions: ['How many snacks should a person bring to a two-hour train ride?', 'How many items do you buy when you only went in for milk?'] },
  { id: 'age-and-frying-pans', questions: ['What age would you choose to be for a whole decade?', 'At what age should you finally own a decent frying pan?'] },
];
