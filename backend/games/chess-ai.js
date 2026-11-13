// The computer opponent: an opening book plus the search in chess-engine.js.
//
// pickMove() is async: the search runs in a worker thread (chess-ai-worker.js)
// so a few seconds of thinking never freezes the server for other rooms
// (Auto Rush ticks 10 times a second). If the worker can't start, the search
// runs inline instead.
//
// Difficulty:
//   easy   – looks one move ahead (plus captures) and picks loosely among the
//            decent moves, so it hangs pieces now and then
//   medium – a few moves deep, picks among moves within a pawn-third of best
//   hard   – full-strength search for ~2.5 s with an opening book

const path = require('path');
const { Chess } = require('chess.js');
const { Engine, moveToObject } = require('./chess-engine');

const DIFFICULTY = {
  easy: { timeMs: 300, maxDepth: 1, margin: 140, book: false },
  medium: { timeMs: 900, maxDepth: 3, margin: 30, book: true },
  hard: { timeMs: 2500, maxDepth: 64, margin: 0, book: true },
};

// ---- Opening book: a few sound mainlines, so hard games start well and vary ----

const BOOK_LINES = [
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7',
  'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6',
  'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Be7',
  'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6',
  'e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4',
  'e4 e5 Nc3 Nf6 Nf3 Nc6',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6',
  'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5',
  'e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7',
  'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7',
  'e4 e6 d4 d5 e5 c5 c3 Nc6',
  'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6',
  'e4 c6 d4 d5 e5 Bf5 Nf3 e6',
  'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6',
  'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O',
  'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4',
  'd4 d5 Nf3 Nf6 c4 e6 Nc3 Be7',
  'd4 d5 Bf4 Nf6 e3 c5 c3 Nc6',
  'd4 d5 e3 Nf6 Nf3 e6 Bd3 c5',
  'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O',
  'd4 Nf6 c4 e6 Nf3 d5 Nc3 Be7',
  'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O',
  'd4 Nf6 Nf3 d5 c4 e6',
  'd4 Nf6 Bf4 d5 e3 c5',
  'c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5',
  'c4 Nf6 Nc3 e6 Nf3 d5',
  'Nf3 d5 d4 Nf6 c4 e6',
  'Nf3 Nf6 c4 e6 Nc3 d5',
  'Nf3 d5 g3 Nf6 Bg2 c6',
  'g3 d5 Bg2 Nf6 Nf3 c6',
  'b3 e5 Bb2 Nc6 e3 Nf6',
  'f4 d5 Nf3 Nf6 e3 g6',
  'e3 e5 d4 exd4 exd4 d5',
  'd3 e5 Nf3 Nc6 e4 Nf6',
  'Nc3 d5 e4 d4 Nce2 e5',
  'a3 e5 e4 Nf6 Nc3 Bc5',
  'h3 e5 e4 Nf6 Nc3 d5',
];

const positionKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
const BOOK = new Map(); // position key -> Set of SAN replies
for (const line of BOOK_LINES) {
  const game = new Chess();
  for (const san of line.split(' ')) {
    const key = positionKey(game.fen());
    if (!BOOK.has(key)) BOOK.set(key, new Set());
    BOOK.get(key).add(san);
    game.move(san);
  }
}

function bookMove(fen) {
  const replies = BOOK.get(positionKey(fen));
  if (!replies) return null;
  const options = [...replies];
  const game = new Chess(fen);
  const move = game.move(options[Math.floor(Math.random() * options.length)]);
  return { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) };
}

// ---- Search ----

/** Synchronous move choice; `prior` lists FENs of earlier positions in the game (for repetition). */
function chooseMove(fen, difficulty = 'medium', prior = []) {
  const level = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  if (level.book) {
    const fromBook = bookMove(fen);
    if (fromBook) return fromBook;
  }

  const engine = new Engine(fen);
  engine.setPrior(prior);
  if (!level.margin) {
    const result = engine.think({ timeMs: level.timeMs, maxDepth: level.maxDepth });
    return result ? moveToObject(result.move) : null;
  }

  // Weaker levels: score every move, then pick at random among those close to the best
  const result = engine.think({ timeMs: level.timeMs, maxDepth: level.maxDepth, allScores: true });
  if (!result) return null;
  const scores = result.scores || [{ move: result.move, score: result.score }];
  const top = Math.max(...scores.map(s => s.score));
  const close = scores.filter(s => s.score >= top - level.margin);
  const pick = close[Math.floor(Math.random() * close.length)];
  return moveToObject(pick.move);
}

// ---- Worker thread ----

let worker = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    const { Worker } = require('worker_threads');
    worker = new Worker(path.join(__dirname, 'chess-ai-worker.js'));
    worker.on('message', ({ id, move, error }) => {
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      if (!pending.size && worker) worker.unref();
      if (error) job.reject(new Error(error)); else job.resolve(move);
    });
    worker.on('error', (err) => {
      console.error('Chess worker failed, thinking inline from now on:', err);
      workerFailed = true;
      worker = null;
      for (const [id, job] of pending) { pending.delete(id); job.retryInline(); }
    });
    worker.unref(); // only kept alive while a search is pending (see pickMove)
  } catch (err) {
    console.error('Chess worker unavailable, thinking inline:', err);
    workerFailed = true;
    worker = null;
  }
  return worker;
}

/** Resolves to { from, to, promotion? } or null when there are no legal moves. */
function pickMove(fen, difficulty = 'medium', prior = []) {
  return new Promise((resolve, reject) => {
    const inline = () => {
      try { resolve(chooseMove(fen, difficulty, prior)); } catch (err) { reject(err); }
    };
    const w = getWorker();
    if (!w) { inline(); return; }
    const id = nextId++;
    pending.set(id, { resolve, reject, retryInline: inline });
    w.ref();
    w.postMessage({ id, fen, difficulty, prior });
  });
}

module.exports = { pickMove, chooseMove, positionKey };
