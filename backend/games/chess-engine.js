// A small, fast chess engine for the computer opponent.
//
// chess.js is great for rules but far too slow to search with (it rebuilds
// move lists and boards on every call), so the bot used to see only 2-3
// moves ahead and blundered pieces to simple captures. This engine keeps its
// own 0x88 board with make/unmake and searches with:
//   - iterative deepening alpha-beta (principal variation search)
//   - quiescence search, so it never stops thinking in the middle of a trade
//   - a transposition table, killer/history move ordering, check extensions,
//     null-move pruning, reverse futility pruning and late move reductions
//   - repetition and fifty-move draw detection, including the game's history
// The evaluation is material + piece-square tables tapered between middle
// game and endgame, pawn structure, rook files, king shelter and mop-up.
//
// Squares are 0x88: sq = rank * 16 + file, rank 0 is white's back rank.

'use strict';

const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
const WHITE = 0, BLACK = 8;
const INF = 32000;
const MATE = 30000;
const MATE_BOUND = 29000;
const MAX_PLY = 96;
const MAX_GAME_PLY = 2048;

const KNIGHT_DIRS = [33, 31, 18, 14, -33, -31, -18, -14];
const BISHOP_DIRS = [17, 15, -17, -15];
const ROOK_DIRS = [16, -16, 1, -1];
const KING_DIRS = [17, 15, -17, -15, 16, -16, 1, -1];

// Move encoding: from | to << 7 | promotion type << 14 | flag << 17
const FLAG_DOUBLE = 1, FLAG_EP = 2, FLAG_CASTLE = 3;
const moveFrom = (m) => m & 127;
const moveTo = (m) => (m >> 7) & 127;
const movePromo = (m) => (m >> 14) & 7;
const moveFlag = (m) => (m >> 17) & 3;

// Castling rights: 1 white king side, 2 white queen side, 4 black king side, 8 black queen side
const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[4] = 12; CASTLE_MASK[0] = 13; CASTLE_MASK[7] = 14;
CASTLE_MASK[116] = 3; CASTLE_MASK[112] = 7; CASTLE_MASK[119] = 11;

// ---- Zobrist keys (two 32-bit halves) ----

let seed = 0x2545f491;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
const Z_PIECE_LO = new Int32Array(16 * 128), Z_PIECE_HI = new Int32Array(16 * 128);
for (let i = 0; i < Z_PIECE_LO.length; i++) { Z_PIECE_LO[i] = rnd(); Z_PIECE_HI[i] = rnd(); }
const Z_CASTLE_LO = new Int32Array(16), Z_CASTLE_HI = new Int32Array(16);
for (let i = 0; i < 16; i++) { Z_CASTLE_LO[i] = rnd(); Z_CASTLE_HI[i] = rnd(); }
const Z_EP_LO = new Int32Array(128), Z_EP_HI = new Int32Array(128);
for (let i = 0; i < 128; i++) { Z_EP_LO[i] = rnd(); Z_EP_HI[i] = rnd(); }
const Z_SIDE_LO = rnd(), Z_SIDE_HI = rnd();

// ---- Evaluation tables ----

const MG_VALUE = [0, 100, 320, 330, 500, 900, 0];
const EG_VALUE = [0, 120, 300, 320, 530, 950, 0];
const PHASE = [0, 0, 1, 1, 2, 4, 0];

// From white's point of view, rows are rank 8 down to rank 1, columns a..h.
const PST_ROWS = {
  [PAWN]: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  [KNIGHT]: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  [BISHOP]: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  [ROOK]: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  [QUEEN]: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  [KING]: [
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
// In the endgame the king should walk to the centre
const KING_EG_ROWS = [
  [-50, -40, -30, -20, -20, -30, -40, -50],
  [-30, -20, -10, 0, 0, -10, -20, -30],
  [-30, -10, 20, 30, 30, 20, -10, -30],
  [-30, -10, 30, 40, 40, 30, -10, -30],
  [-30, -10, 30, 40, 40, 30, -10, -30],
  [-30, -10, 20, 30, 30, 20, -10, -30],
  [-30, -30, 0, 0, 0, 0, -30, -30],
  [-50, -30, -30, -30, -30, -30, -30, -50],
];

// PST_MG[piece code * 128 + sq] includes material, from white's point of view (black pieces negative)
const PST_MG = new Int16Array(16 * 128), PST_EG = new Int16Array(16 * 128);
for (let type = PAWN; type <= KING; type++) {
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const sq = rank * 16 + file;
      const whiteRow = 7 - rank, blackRow = rank;
      const mg = (row) => MG_VALUE[type] + PST_ROWS[type][row][file];
      const eg = (row) => EG_VALUE[type] + (type === KING ? KING_EG_ROWS[row][file] : PST_ROWS[type][row][file]);
      PST_MG[(WHITE | type) * 128 + sq] = mg(whiteRow);
      PST_EG[(WHITE | type) * 128 + sq] = eg(whiteRow);
      PST_MG[(BLACK | type) * 128 + sq] = -mg(blackRow);
      PST_EG[(BLACK | type) * 128 + sq] = -eg(blackRow);
    }
  }
}
const PASSED_MG = [0, 5, 10, 15, 25, 40, 60, 0];
const PASSED_EG = [0, 10, 20, 35, 60, 90, 140, 0];

// ---- Transposition table (shared by every search in this process) ----

const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;
const ttKey = new Int32Array(TT_SIZE);
const ttMove = new Int32Array(TT_SIZE);
const ttScore = new Int16Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE);
const ttFlag = new Uint8Array(TT_SIZE);

class StopSearch extends Error {}

class Engine {
  constructor(fen) {
    this.board = new Int8Array(128);
    this.kings = new Int32Array(2); // [white, black]
    this.side = WHITE;
    this.castle = 0;
    this.ep = -1;
    this.halfmove = 0;
    this.lo = 0; this.hi = 0;
    // Undo stack, one entry per move made from the starting position
    this.hply = 0;
    this.uMove = new Int32Array(MAX_GAME_PLY);
    this.uCapt = new Int8Array(MAX_GAME_PLY);
    this.uCastle = new Int8Array(MAX_GAME_PLY);
    this.uEp = new Int16Array(MAX_GAME_PLY);
    this.uHalf = new Int16Array(MAX_GAME_PLY);
    this.uLo = new Int32Array(MAX_GAME_PLY);
    this.uHi = new Int32Array(MAX_GAME_PLY);
    // Search scratch
    this.moveBuf = new Int32Array(MAX_PLY * 256);
    this.scoreBuf = new Int32Array(MAX_PLY * 256);
    this.killers = new Int32Array(MAX_PLY * 2);
    this.history = new Int32Array(16 * 128);
    this.prior = new Map(); // hash lo -> hi of positions seen earlier in the real game
    this.nodes = 0;
    this.deadline = Infinity;
    this.load(fen);
  }

  // ---- Setup ----

  load(fen) {
    const [placement, side, castling, ep, half] = fen.trim().split(/\s+/);
    this.board.fill(0);
    const rows = placement.split('/');
    for (let r = 0; r < 8; r++) {
      let file = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') { file += Number(ch); continue; }
        const type = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1;
        const color = ch === ch.toLowerCase() ? BLACK : WHITE;
        const sq = (7 - r) * 16 + file;
        this.board[sq] = color | type;
        if (type === KING) this.kings[color ? 1 : 0] = sq;
        file++;
      }
    }
    this.side = side === 'b' ? BLACK : WHITE;
    this.castle = 0;
    if (castling && castling !== '-') {
      if (castling.includes('K')) this.castle |= 1;
      if (castling.includes('Q')) this.castle |= 2;
      if (castling.includes('k')) this.castle |= 4;
      if (castling.includes('q')) this.castle |= 8;
    }
    this.ep = ep && ep !== '-' ? squareIndex(ep) : -1;
    this.halfmove = Number(half) || 0;
    this.hply = 0;
    this.computeHash();
  }

  computeHash() {
    let lo = 0, hi = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (p) { lo ^= Z_PIECE_LO[p * 128 + sq]; hi ^= Z_PIECE_HI[p * 128 + sq]; }
    }
    lo ^= Z_CASTLE_LO[this.castle]; hi ^= Z_CASTLE_HI[this.castle];
    if (this.ep >= 0) { lo ^= Z_EP_LO[this.ep]; hi ^= Z_EP_HI[this.ep]; }
    if (this.side === BLACK) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    this.lo = lo; this.hi = hi;
  }

  /** Earlier positions of the real game (FENs), so the bot can steer into or away from repetitions. */
  setPrior(fens) {
    this.prior.clear();
    for (const fen of fens) {
      const other = new Engine(`${fen} 0 1`.split(' ').slice(0, 6).join(' '));
      this.prior.set(other.lo, other.hi);
    }
  }

  // ---- Attacks and move generation ----

  attacked(sq, by) {
    const b = this.board;
    if (by === WHITE) {
      if (!((sq - 15) & 0x88) && b[sq - 15] === (WHITE | PAWN)) return true;
      if (!((sq - 17) & 0x88) && b[sq - 17] === (WHITE | PAWN)) return true;
    } else {
      if (!((sq + 15) & 0x88) && b[sq + 15] === (BLACK | PAWN)) return true;
      if (!((sq + 17) & 0x88) && b[sq + 17] === (BLACK | PAWN)) return true;
    }
    for (let i = 0; i < 8; i++) {
      const t = sq + KNIGHT_DIRS[i];
      if (!(t & 0x88) && b[t] === (by | KNIGHT)) return true;
    }
    for (let i = 0; i < 8; i++) {
      const t = sq + KING_DIRS[i];
      if (!(t & 0x88) && b[t] === (by | KING)) return true;
    }
    for (let i = 0; i < 4; i++) {
      const d = ROOK_DIRS[i];
      for (let t = sq + d; !(t & 0x88); t += d) {
        const p = b[t];
        if (!p) continue;
        if (p === (by | ROOK) || p === (by | QUEEN)) return true;
        break;
      }
    }
    for (let i = 0; i < 4; i++) {
      const d = BISHOP_DIRS[i];
      for (let t = sq + d; !(t & 0x88); t += d) {
        const p = b[t];
        if (!p) continue;
        if (p === (by | BISHOP) || p === (by | QUEEN)) return true;
        break;
      }
    }
    return false;
  }

  inCheck() {
    return this.attacked(this.kings[this.side ? 1 : 0], this.side ^ 8);
  }

  /** Pseudo-legal moves into moveBuf from `start`; returns the end index. `noisy` keeps captures and queen promotions only. */
  generate(start, noisy) {
    const b = this.board, buf = this.moveBuf, us = this.side, them = us ^ 8;
    let n = start;
    const pawnDir = us === WHITE ? 16 : -16;
    const startRank = us === WHITE ? 1 : 6;
    const promoRank = us === WHITE ? 7 : 0;

    for (let from = 0; from < 128; from++) {
      if (from & 0x88) { from += 7; continue; }
      const p = b[from];
      if (!p || (p & 8) !== us) continue;
      const type = p & 7;

      if (type === PAWN) {
        const one = from + pawnDir;
        const promotes = (one >> 4) === promoRank;
        if (!b[one]) {
          if (promotes) {
            buf[n++] = from | (one << 7) | (QUEEN << 14);
            if (!noisy) {
              buf[n++] = from | (one << 7) | (KNIGHT << 14);
              buf[n++] = from | (one << 7) | (ROOK << 14);
              buf[n++] = from | (one << 7) | (BISHOP << 14);
            }
          } else if (!noisy) {
            buf[n++] = from | (one << 7);
            if ((from >> 4) === startRank && !b[one + pawnDir]) buf[n++] = from | ((one + pawnDir) << 7) | (FLAG_DOUBLE << 17);
          }
        }
        for (const side of [-1, 1]) {
          const to = one + side;
          if (to & 0x88) continue;
          const target = b[to];
          if (target && (target & 8) === them) {
            if (promotes) {
              buf[n++] = from | (to << 7) | (QUEEN << 14);
              if (!noisy) {
                buf[n++] = from | (to << 7) | (KNIGHT << 14);
                buf[n++] = from | (to << 7) | (ROOK << 14);
                buf[n++] = from | (to << 7) | (BISHOP << 14);
              }
            } else {
              buf[n++] = from | (to << 7);
            }
          } else if (to === this.ep) {
            buf[n++] = from | (to << 7) | (FLAG_EP << 17);
          }
        }
        continue;
      }

      if (type === KNIGHT || type === KING) {
        const dirs = type === KNIGHT ? KNIGHT_DIRS : KING_DIRS;
        for (let i = 0; i < 8; i++) {
          const to = from + dirs[i];
          if (to & 0x88) continue;
          const target = b[to];
          if (target ? (target & 8) === them : !noisy) buf[n++] = from | (to << 7);
        }
        continue;
      }

      const lines = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : KING_DIRS;
      for (let i = 0; i < lines.length; i++) {
        const d = lines[i];
        for (let to = from + d; !(to & 0x88); to += d) {
          const target = b[to];
          if (!target) { if (!noisy) buf[n++] = from | (to << 7); continue; }
          if ((target & 8) === them) buf[n++] = from | (to << 7);
          break;
        }
      }
    }

    if (!noisy) {
      if (us === WHITE) {
        if ((this.castle & 1) && !b[5] && !b[6] && b[7] === (WHITE | ROOK)
          && !this.attacked(4, BLACK) && !this.attacked(5, BLACK) && !this.attacked(6, BLACK)) buf[n++] = 4 | (6 << 7) | (FLAG_CASTLE << 17);
        if ((this.castle & 2) && !b[3] && !b[2] && !b[1] && b[0] === (WHITE | ROOK)
          && !this.attacked(4, BLACK) && !this.attacked(3, BLACK) && !this.attacked(2, BLACK)) buf[n++] = 4 | (2 << 7) | (FLAG_CASTLE << 17);
      } else {
        if ((this.castle & 4) && !b[117] && !b[118] && b[119] === (BLACK | ROOK)
          && !this.attacked(116, WHITE) && !this.attacked(117, WHITE) && !this.attacked(118, WHITE)) buf[n++] = 116 | (118 << 7) | (FLAG_CASTLE << 17);
        if ((this.castle & 8) && !b[115] && !b[114] && !b[113] && b[112] === (BLACK | ROOK)
          && !this.attacked(116, WHITE) && !this.attacked(115, WHITE) && !this.attacked(114, WHITE)) buf[n++] = 116 | (114 << 7) | (FLAG_CASTLE << 17);
      }
    }
    return n;
  }

  // ---- Make / unmake ----

  /** Plays a pseudo-legal move. Returns false (and takes it back) if it leaves the mover's king in check. */
  make(m) {
    const b = this.board, from = moveFrom(m), to = moveTo(m), promo = movePromo(m), flag = moveFlag(m);
    const piece = b[from], us = this.side, them = us ^ 8;
    let captured = b[to];
    const h = this.hply;
    this.uMove[h] = m; this.uCastle[h] = this.castle; this.uEp[h] = this.ep;
    this.uHalf[h] = this.halfmove; this.uLo[h] = this.lo; this.uHi[h] = this.hi;

    let lo = this.lo ^ Z_PIECE_LO[piece * 128 + from], hi = this.hi ^ Z_PIECE_HI[piece * 128 + from];
    if (flag === FLAG_EP) {
      const capSq = us === WHITE ? to - 16 : to + 16;
      captured = b[capSq];
      b[capSq] = 0;
      lo ^= Z_PIECE_LO[captured * 128 + capSq]; hi ^= Z_PIECE_HI[captured * 128 + capSq];
    } else if (captured) {
      lo ^= Z_PIECE_LO[captured * 128 + to]; hi ^= Z_PIECE_HI[captured * 128 + to];
    }
    this.uCapt[h] = captured;
    const placed = promo ? (us | promo) : piece;
    b[to] = placed; b[from] = 0;
    lo ^= Z_PIECE_LO[placed * 128 + to]; hi ^= Z_PIECE_HI[placed * 128 + to];

    if (flag === FLAG_CASTLE) {
      let rf, rt;
      if (to === 6) { rf = 7; rt = 5; } else if (to === 2) { rf = 0; rt = 3; } else if (to === 118) { rf = 119; rt = 117; } else { rf = 112; rt = 115; }
      const rook = b[rf];
      b[rt] = rook; b[rf] = 0;
      lo ^= Z_PIECE_LO[rook * 128 + rf] ^ Z_PIECE_LO[rook * 128 + rt];
      hi ^= Z_PIECE_HI[rook * 128 + rf] ^ Z_PIECE_HI[rook * 128 + rt];
    }
    if ((piece & 7) === KING) this.kings[us ? 1 : 0] = to;

    if (this.ep >= 0) { lo ^= Z_EP_LO[this.ep]; hi ^= Z_EP_HI[this.ep]; }
    this.ep = flag === FLAG_DOUBLE ? (from + to) >> 1 : -1;
    if (this.ep >= 0) { lo ^= Z_EP_LO[this.ep]; hi ^= Z_EP_HI[this.ep]; }

    lo ^= Z_CASTLE_LO[this.castle]; hi ^= Z_CASTLE_HI[this.castle];
    this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    lo ^= Z_CASTLE_LO[this.castle]; hi ^= Z_CASTLE_HI[this.castle];

    this.halfmove = (piece & 7) === PAWN || captured ? 0 : this.halfmove + 1;
    this.side = them;
    lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI;
    this.lo = lo; this.hi = hi;
    this.hply = h + 1;

    if (this.attacked(this.kings[us ? 1 : 0], them)) { this.unmake(); return false; }
    return true;
  }

  unmake() {
    const h = --this.hply;
    const m = this.uMove[h], b = this.board;
    this.side ^= 8;
    const us = this.side;
    this.castle = this.uCastle[h]; this.ep = this.uEp[h]; this.halfmove = this.uHalf[h];
    this.lo = this.uLo[h]; this.hi = this.uHi[h];
    if (m === 0) return; // null move

    const from = moveFrom(m), to = moveTo(m), promo = movePromo(m), flag = moveFlag(m);
    const piece = promo ? (us | PAWN) : b[to];
    b[from] = piece;
    if (flag === FLAG_EP) {
      b[to] = 0;
      b[us === WHITE ? to - 16 : to + 16] = this.uCapt[h];
    } else {
      b[to] = this.uCapt[h];
    }
    if (flag === FLAG_CASTLE) {
      let rf, rt;
      if (to === 6) { rf = 7; rt = 5; } else if (to === 2) { rf = 0; rt = 3; } else if (to === 118) { rf = 119; rt = 117; } else { rf = 112; rt = 115; }
      b[rf] = b[rt]; b[rt] = 0;
    }
    if ((piece & 7) === KING) this.kings[us ? 1 : 0] = from;
  }

  makeNull() {
    const h = this.hply;
    this.uMove[h] = 0; this.uCastle[h] = this.castle; this.uEp[h] = this.ep;
    this.uHalf[h] = this.halfmove; this.uLo[h] = this.lo; this.uHi[h] = this.hi;
    if (this.ep >= 0) { this.lo ^= Z_EP_LO[this.ep]; this.hi ^= Z_EP_HI[this.ep]; this.ep = -1; }
    this.lo ^= Z_SIDE_LO; this.hi ^= Z_SIDE_HI;
    this.side ^= 8;
    this.halfmove++;
    this.hply = h + 1;
  }

  /** Legal moves in this position, as encoded ints. */
  legalMoves() {
    const end = this.generate(0, false);
    const out = [];
    for (let i = 0; i < end; i++) {
      const m = this.moveBuf[i];
      if (this.make(m)) { this.unmake(); out.push(m); }
    }
    return out;
  }

  // ---- Evaluation ----

  /** Static evaluation in centipawns from the side to move's point of view. */
  evaluate() {
    const b = this.board;
    let mg = 0, eg = 0, phase = 0;
    let wBishops = 0, bBishops = 0, wMinor = 0, bMinor = 0, majors = 0, pawns = 0;
    // Per file: pawn counts, white's most and least advanced pawn, black's likewise
    const wCount = [0, 0, 0, 0, 0, 0, 0, 0], bCount = [0, 0, 0, 0, 0, 0, 0, 0];
    const wMin = [8, 8, 8, 8, 8, 8, 8, 8], bMax = [-1, -1, -1, -1, -1, -1, -1, -1];
    const rooks = [];
    const pawnSquares = [];

    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if (!p) continue;
      mg += PST_MG[p * 128 + sq];
      eg += PST_EG[p * 128 + sq];
      const type = p & 7;
      phase += PHASE[type];
      if (type === PAWN) {
        pawns++;
        pawnSquares.push(sq);
        const file = sq & 7, rank = sq >> 4;
        if (p & 8) { bCount[file]++; if (rank > bMax[file]) bMax[file] = rank; }
        else { wCount[file]++; if (rank < wMin[file]) wMin[file] = rank; }
      } else if (type === BISHOP) {
        if (p & 8) { bBishops++; bMinor++; } else { wBishops++; wMinor++; }
      } else if (type === KNIGHT) {
        if (p & 8) bMinor++; else wMinor++;
      } else if (type === ROOK || type === QUEEN) {
        majors++;
        if (type === ROOK) rooks.push(sq);
      }
    }

    // Bare kings and lone minor pieces can't win
    if (!pawns && !majors && wMinor <= 1 && bMinor <= 1) return 0;

    if (wBishops >= 2) { mg += 30; eg += 50; }
    if (bBishops >= 2) { mg -= 30; eg -= 50; }

    // Pawn structure
    for (const sq of pawnSquares) {
      const p = b[sq], file = sq & 7, rank = sq >> 4;
      const left = file > 0 ? file - 1 : file, right = file < 7 ? file + 1 : file;
      if (p & 8) {
        const isolated = (file === 0 || !bCount[file - 1]) && (file === 7 || !bCount[file + 1]);
        if (isolated) { mg += 12; eg += 15; }
        if (bCount[file] > 1) { mg += 8; eg += 15; }
        let passed = true;
        for (let f = left; f <= right; f++) if (wMin[f] < rank) { passed = false; break; }
        if (passed) { mg -= PASSED_MG[7 - rank]; eg -= PASSED_EG[7 - rank]; }
      } else {
        const isolated = (file === 0 || !wCount[file - 1]) && (file === 7 || !wCount[file + 1]);
        if (isolated) { mg -= 12; eg -= 15; }
        if (wCount[file] > 1) { mg -= 8; eg -= 15; }
        let passed = true;
        for (let f = left; f <= right; f++) if (bMax[f] > rank) { passed = false; break; }
        if (passed) { mg += PASSED_MG[rank]; eg += PASSED_EG[rank]; }
      }
    }

    // Rooks like open files
    for (const sq of rooks) {
      const file = sq & 7, black = b[sq] & 8;
      const own = black ? bCount[file] : wCount[file], other = black ? wCount[file] : bCount[file];
      let bonus = 0;
      if (!own && !other) bonus = 20; else if (!own) bonus = 10;
      mg += black ? -bonus : bonus; eg += black ? -bonus / 2 : bonus / 2;
    }

    // King shelter: pawns in front of a castled king (middle game only)
    const shelter = (king, color) => {
      const file = king & 7, rank = king >> 4;
      const home = color === WHITE ? rank <= 1 : rank >= 6;
      if (!home) return -20;
      const dir = color === WHITE ? 16 : -16;
      let score = 0;
      for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
        const near = king - file + f + dir, far = near + dir;
        if (b[near] === (color | PAWN)) score += 12;
        else if (!(far & 0x88) && b[far] === (color | PAWN)) score += 6;
        else score -= 12;
      }
      return score;
    };
    mg += shelter(this.kings[0], WHITE) - shelter(this.kings[1], BLACK);

    if (phase > 24) phase = 24;
    let score = (mg * phase + eg * (24 - phase)) / 24;

    // Mop-up: with a winning endgame, drive the enemy king to the edge and walk ours over
    if (phase <= 10 && Math.abs(score) > 250) {
      const winner = score > 0 ? 0 : 1;
      const k = this.kings[winner], e = this.kings[1 - winner];
      const ef = e & 7, er = e >> 4;
      const centre = Math.max(3 - ef, ef - 4) + Math.max(3 - er, er - 4);
      const distance = Math.abs((k & 7) - ef) + Math.abs((k >> 4) - er);
      const mop = (centre * 10 + (14 - distance) * 4) * (24 - phase) / 24;
      score += winner === 0 ? mop : -mop;
    }

    score = Math.round(score);
    return (this.side === WHITE ? score : -score) + 10; // small bonus for having the move
  }

  hasNonPawnMaterial() {
    const b = this.board, us = this.side;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if (p && (p & 8) === us) { const t = p & 7; if (t !== PAWN && t !== KING) return true; }
    }
    return false;
  }

  isRepetition() {
    if (this.prior.get(this.lo) === this.hi) return true;
    const stop = Math.max(0, this.hply - this.halfmove);
    for (let i = this.hply - 2; i >= stop; i -= 2) {
      if (this.uLo[i] === this.lo && this.uHi[i] === this.hi) return true;
    }
    return false;
  }

  // ---- Search ----

  checkTime() {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) throw new StopSearch();
  }

  /** Scores and sorts moves[start, end) in place for searching: hash move, captures, promotions, killers, history. */
  scoreMoves(start, end, ply, hashMove) {
    const b = this.board, buf = this.moveBuf, scores = this.scoreBuf;
    const k0 = this.killers[ply * 2], k1 = this.killers[ply * 2 + 1];
    for (let i = start; i < end; i++) {
      const m = buf[i];
      const from = moveFrom(m), to = moveTo(m);
      let victim = b[to] & 7;
      if (moveFlag(m) === FLAG_EP) victim = PAWN;
      let s;
      if (m === hashMove) s = 3000000;
      else if (victim) s = 2000000 + victim * 16 - (b[from] & 7);
      else if (movePromo(m) === QUEEN) s = 1900000;
      else if (m === k0) s = 1800000;
      else if (m === k1) s = 1700000;
      else if (movePromo(m)) s = -100000; // under-promotions last
      else s = this.history[b[from] * 128 + to];
      scores[i] = s;
    }
  }

  /** Swaps the best remaining move into position i and returns it. */
  pick(i, end) {
    const buf = this.moveBuf, scores = this.scoreBuf;
    let best = i;
    for (let j = i + 1; j < end; j++) if (scores[j] > scores[best]) best = j;
    if (best !== i) {
      const m = buf[i]; buf[i] = buf[best]; buf[best] = m;
      const s = scores[i]; scores[i] = scores[best]; scores[best] = s;
    }
    return buf[i];
  }

  quiesce(alpha, beta, ply) {
    this.checkTime();
    const standPat = this.evaluate();
    if (ply >= MAX_PLY - 1) return standPat;
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;

    const start = ply * 256;
    const end = this.generate(start, true);
    this.scoreMoves(start, end, ply, 0);
    for (let i = start; i < end; i++) {
      const m = this.pick(i, end);
      // Delta pruning: even winning this piece outright wouldn't lift us to alpha
      if (!movePromo(m)) {
        const victim = moveFlag(m) === FLAG_EP ? PAWN : this.board[moveTo(m)] & 7;
        if (standPat + MG_VALUE[victim] + 200 < alpha) continue;
      }
      if (!this.make(m)) continue;
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      this.unmake();
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  search(depth, alpha, beta, ply, allowNull) {
    this.checkTime();
    const pvNode = beta - alpha > 1;

    if (ply > 0) {
      if (this.halfmove >= 100 || this.isRepetition()) return 0;
      // Mate distance pruning
      const matedScore = -MATE + ply;
      if (alpha < matedScore) alpha = matedScore;
      if (beta > MATE - ply - 1) beta = MATE - ply - 1;
      if (alpha >= beta) return alpha;
    }
    if (ply >= MAX_PLY - 1) return this.evaluate();

    const inCheck = this.inCheck();
    if (inCheck) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply);

    // Transposition table
    const idx = this.lo & TT_MASK;
    let hashMove = 0;
    if (ttFlag[idx] && ttKey[idx] === this.hi) {
      hashMove = ttMove[idx];
      if (!pvNode && ttDepth[idx] >= depth) {
        let s = ttScore[idx];
        if (s > MATE_BOUND) s -= ply; else if (s < -MATE_BOUND) s += ply;
        const flag = ttFlag[idx];
        if (flag === TT_EXACT || (flag === TT_LOWER && s >= beta) || (flag === TT_UPPER && s <= alpha)) return s;
      }
    }

    if (!pvNode && !inCheck) {
      const staticEval = this.evaluate();
      // Reverse futility: far enough above beta that a shallow search won't change the verdict
      if (depth <= 3 && staticEval - 120 * depth >= beta && Math.abs(beta) < MATE_BOUND) return staticEval;
      // Null move: if passing still beats beta, the position is good enough to cut
      if (allowNull && depth >= 3 && staticEval >= beta && this.hasNonPawnMaterial()) {
        const r = depth > 6 ? 3 : 2;
        this.makeNull();
        const score = -this.search(depth - 1 - r, -beta, -beta + 1, ply + 1, false);
        this.unmake();
        if (score >= beta) return Math.abs(score) > MATE_BOUND ? beta : score;
      }
    }

    const start = ply * 256;
    const end = this.generate(start, false);
    this.scoreMoves(start, end, ply, hashMove);

    const alphaStart = alpha;
    let best = -INF, bestMove = 0, legal = 0;
    for (let i = start; i < end; i++) {
      const m = this.pick(i, end);
      const quiet = !this.board[moveTo(m)] && !movePromo(m) && moveFlag(m) !== FLAG_EP;
      if (!this.make(m)) continue;
      legal++;
      let score;
      if (legal === 1) {
        score = -this.search(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        // Late quiet moves get a shallower look first
        let reduction = 0;
        if (quiet && depth >= 3 && legal > 3 && !inCheck && m !== this.killers[ply * 2] && m !== this.killers[ply * 2 + 1]) {
          reduction = legal > 10 ? 2 : 1;
          if (this.inCheck()) reduction = 0; // the move gives check
        }
        score = -this.search(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && reduction) score = -this.search(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && score < beta) score = -this.search(depth - 1, -beta, -alpha, ply + 1, true);
      }
      this.unmake();

      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            if (quiet) {
              if (this.killers[ply * 2] !== m) { this.killers[ply * 2 + 1] = this.killers[ply * 2]; this.killers[ply * 2] = m; }
              const h = this.board[moveFrom(m)] * 128 + moveTo(m);
              this.history[h] += depth * depth;
              if (this.history[h] > 1000000) for (let j = 0; j < this.history.length; j++) this.history[j] >>= 1;
            }
            break;
          }
        }
      }
    }

    if (!legal) return inCheck ? -MATE + ply : 0;

    let stored = best;
    if (stored > MATE_BOUND) stored += ply; else if (stored < -MATE_BOUND) stored -= ply;
    ttKey[idx] = this.hi;
    ttMove[idx] = bestMove;
    ttScore[idx] = stored;
    ttDepth[idx] = depth;
    ttFlag[idx] = best >= beta ? TT_LOWER : best > alphaStart ? TT_EXACT : TT_UPPER;
    return best;
  }

  /**
   * Iterative deepening from the current position. Returns
   * { move, score, depth, nodes, scores } where scores lists every legal root
   * move's score from the last completed depth when `allScores` is set
   * (slower: every move gets a full window).
   */
  think({ timeMs = 1000, maxDepth = 64, allScores = false } = {}) {
    const started = Date.now();
    this.deadline = started + timeMs;
    this.nodes = 0;
    this.killers.fill(0);
    this.history.fill(0);
    ttFlag.fill(0);

    const root = this.legalMoves();
    if (!root.length) return null;
    if (root.length === 1 && !allScores) return { move: root[0], score: 0, depth: 0, nodes: 0, scores: null };

    let best = { move: root[0], score: 0, depth: 0, nodes: 0, scores: null };
    let order = root.map(move => ({ move, score: -INF }));

    for (let depth = 1; depth <= maxDepth; depth++) {
      let alpha = -INF;
      const beta = INF;
      let iterMove = 0, iterScore = -INF;
      let finished = true;
      try {
        for (let i = 0; i < order.length; i++) {
          const entry = order[i];
          this.make(entry.move);
          let score;
          try {
            if (i === 0 || allScores) {
              score = -this.search(depth - 1, allScores ? -INF : -beta, allScores ? INF : -alpha, 1, true);
            } else {
              score = -this.search(depth - 1, -alpha - 1, -alpha, 1, true);
              if (score > alpha) score = -this.search(depth - 1, -beta, -alpha, 1, true);
            }
          } finally {
            this.unmake();
          }
          entry.score = score;
          if (score > iterScore) { iterScore = score; iterMove = entry.move; }
          if (score > alpha) alpha = score;
        }
      } catch (e) {
        if (!(e instanceof StopSearch)) throw e;
        finished = false;
      }

      // A move that fully beat the previous best in an unfinished pass is still a sound choice
      if (finished || (iterMove && iterMove !== order[0].move && !allScores)) {
        best = {
          move: iterMove, score: iterScore, depth: finished ? depth : depth - 1, nodes: this.nodes,
          scores: finished && allScores ? order.map(e => ({ move: e.move, score: e.score })) : best.scores,
        };
      }
      if (!finished) break;

      // Best move first next time; the rest by this pass's scores (exact for allScores, bounds otherwise)
      order.sort((a, b) => (a.move === iterMove ? -1 : b.move === iterMove ? 1 : b.score - a.score));
      if (Math.abs(iterScore) > MATE_BOUND && !allScores) break;
      if (Date.now() - started > timeMs * 0.5) break; // the next pass would likely not finish
    }
    best.nodes = this.nodes;
    return best;
  }
}

// ---- Helpers ----

function squareIndex(name) {
  return (Number(name[1]) - 1) * 16 + (name.charCodeAt(0) - 97);
}
function squareName(sq) {
  return String.fromCharCode(97 + (sq & 7)) + ((sq >> 4) + 1);
}
const PROMO_CHAR = { [KNIGHT]: 'n', [BISHOP]: 'b', [ROOK]: 'r', [QUEEN]: 'q' };
function moveToObject(m) {
  const promo = movePromo(m);
  return { from: squareName(moveFrom(m)), to: squareName(moveTo(m)), ...(promo ? { promotion: PROMO_CHAR[promo] } : {}) };
}
function moveToUci(m) {
  const o = moveToObject(m);
  return o.from + o.to + (o.promotion || '');
}

/** Counts leaf nodes to a depth; used to check move generation against known values. */
function perft(engine, depth) {
  if (depth === 0) return 1;
  const start = (MAX_PLY - 1 - depth) * 256; // keep each depth's moves in its own slice
  const end = engine.generate(start, false);
  const moves = engine.moveBuf.slice(start, end);
  let total = 0;
  for (const m of moves) {
    if (!engine.make(m)) continue;
    total += perft(engine, depth - 1);
    engine.unmake();
  }
  return total;
}

module.exports = { Engine, moveToObject, moveToUci, perft, MATE, MATE_BOUND };
