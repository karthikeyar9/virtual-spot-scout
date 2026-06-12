// SQLite question database. Seeded from backend/db/seed/* on startup;
// re-seeds a table whenever its seed bank changes size so new content ships
// with a deploy (the DB file is treated as a disposable cache of the seeds).

const path = require('path');
const Database = require('better-sqlite3');

const triviaSeed = require('./seed/trivia');
const hotTakesSeed = require('./seed/hot-takes');
const emojiSeed = require('./seed/emoji-decoder');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'games.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS trivia_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hot_takes_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS emoji_puzzles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emojis TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT NOT NULL,
    hint TEXT NOT NULL
  );
`);

function syncTable(table, seed, insertSql, toRow) {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  if (count === seed.length) return;

  const insert = db.prepare(insertSql);
  db.transaction(() => {
    db.prepare(`DELETE FROM ${table}`).run();
    seed.forEach(item => insert.run(...toRow(item)));
  })();
  console.log(`🗄️  Seeded ${seed.length} rows into ${table}`);
}

syncTable(
  'trivia_questions',
  triviaSeed,
  'INSERT INTO trivia_questions (question, options, correct_index, category) VALUES (?, ?, ?, ?)',
  q => [q.question, JSON.stringify(q.options), q.correctIndex, q.category]
);

syncTable(
  'hot_takes_prompts',
  hotTakesSeed,
  'INSERT INTO hot_takes_prompts (question, option_a, option_b) VALUES (?, ?, ?)',
  p => [p.question, p.optionA, p.optionB]
);

syncTable(
  'emoji_puzzles',
  emojiSeed,
  'INSERT INTO emoji_puzzles (emojis, answer, category, hint) VALUES (?, ?, ?, ?)',
  p => [p.emojis, p.answer, p.category, p.hint]
);

function getRandomTriviaQuestions(limit) {
  return db
    .prepare('SELECT question, options, correct_index, category FROM trivia_questions ORDER BY RANDOM() LIMIT ?')
    .all(limit)
    .map(row => ({
      question: row.question,
      options: JSON.parse(row.options),
      correctIndex: row.correct_index,
      category: row.category,
    }));
}

function getRandomHotTakesPrompts(limit) {
  return db
    .prepare('SELECT question, option_a, option_b FROM hot_takes_prompts ORDER BY RANDOM() LIMIT ?')
    .all(limit)
    .map(row => ({
      question: row.question,
      optionA: row.option_a,
      optionB: row.option_b,
    }));
}

function getRandomEmojiPuzzles(limit) {
  return db
    .prepare('SELECT emojis, answer, category, hint FROM emoji_puzzles ORDER BY RANDOM() LIMIT ?')
    .all(limit);
}

module.exports = {
  db,
  getRandomTriviaQuestions,
  getRandomHotTakesPrompts,
  getRandomEmojiPuzzles,
};
