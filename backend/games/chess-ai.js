// Chess engine for the computer opponent.
// Minimax with alpha-beta pruning over chess.js; difficulty maps to search
// depth (easy additionally picks randomly among the top moves).

const { Chess } = require('chess.js');

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables from white's perspective, indexed [rank8..rank1][a..h].
const PST = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  k: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20],
  ],
};

// budgetMs caps total search time: the search runs depth 1..maxDepth
// iteratively and aborts mid-depth when over budget, keeping the best
// move from the last completed depth. This matters on Render's free
// tier (0.1 CPU), where a fixed depth-3 search could take many seconds
// and block the (shared, single-threaded) event loop.
const DIFFICULTY = {
  easy: { maxDepth: 1, randomTop: 3, budgetMs: 500 },
  medium: { maxDepth: 2, randomTop: 1, budgetMs: 1200 },
  hard: { maxDepth: 3, randomTop: 1, budgetMs: 2200 },
};

class SearchTimeout extends Error {}

// Static evaluation in centipawns from white's perspective
function evaluate(game) {
  const board = game.board();
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (!piece) continue;
      const value = PIECE_VALUES[piece.type];
      const pst = piece.color === 'w' ? PST[piece.type][r][f] : PST[piece.type][7 - r][f];
      score += piece.color === 'w' ? value + pst : -(value + pst);
    }
  }
  return score;
}

// Order captures first (highest victim) so alpha-beta prunes more
function orderedMoves(game) {
  return game.moves({ verbose: true }).sort((a, b) => {
    const av = a.captured ? PIECE_VALUES[a.captured] : 0;
    const bv = b.captured ? PIECE_VALUES[b.captured] : 0;
    return bv - av;
  });
}

function minimax(game, depth, alpha, beta, maximizing, ctx) {
  if (++ctx.nodes % 512 === 0 && Date.now() > ctx.deadline) throw new SearchTimeout();
  if (depth <= 0) return evaluate(game);

  const moves = orderedMoves(game);
  if (moves.length === 0) {
    if (game.inCheck()) return maximizing ? -100000 - depth : 100000 + depth;
    return 0; // stalemate
  }

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      game.move(move);
      best = Math.max(best, minimax(game, depth - 1, alpha, beta, false, ctx));
      game.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of moves) {
      game.move(move);
      best = Math.min(best, minimax(game, depth - 1, alpha, beta, true, ctx));
      game.undo();
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function searchAtDepth(game, depth, maximizing, ctx) {
  const scored = [];
  for (const move of orderedMoves(game)) {
    game.move(move);
    let score;
    try {
      score = minimax(game, depth - 1, -Infinity, Infinity, !maximizing, ctx);
    } finally {
      game.undo();
    }
    scored.push({ move, score });
  }
  scored.sort((a, b) => (maximizing ? b.score - a.score : a.score - b.score));
  return scored;
}

// Returns { from, to, promotion } or null if no legal moves
function pickMove(fen, difficulty = 'medium') {
  const { maxDepth, randomTop, budgetMs } = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const game = new Chess(fen);
  const maximizing = game.turn() === 'w';
  if (game.moves().length === 0) return null;

  const ctx = { nodes: 0, deadline: Date.now() + budgetMs };

  // Iterative deepening: keep the deepest fully-completed result
  let best = null;
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      best = searchAtDepth(game, depth, maximizing, ctx);
    } catch (e) {
      if (e instanceof SearchTimeout) break;
      throw e;
    }
    if (Date.now() > ctx.deadline) break;
  }
  // If even depth 1 timed out, redo it without a deadline (it's ~30 evals)
  if (!best) best = searchAtDepth(game, 1, maximizing, { nodes: 0, deadline: Infinity });

  const pool = best.slice(0, Math.max(1, Math.min(randomTop, best.length)));
  const { move } = pool[Math.floor(Math.random() * pool.length)];
  return { from: move.from, to: move.to, promotion: move.promotion || 'q' };
}

module.exports = { pickMove };
