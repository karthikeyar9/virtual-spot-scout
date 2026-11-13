// Chess game handler — server-authoritative via chess.js.
// The first two players in the room are seated; host plays white.
// In vs-computer mode a bot player is seated as black and the engine
// (chess-ai.js) replies after each human move.

const { Chess } = require('chess.js');
const { pickMove } = require('./chess-ai');

const WIN_SCORE = 1000;
const DRAW_SCORE = 500;
const BOT_ID = 'bot';
const BOT_NAMES = { easy: 'Computer (Easy)', medium: 'Computer (Medium)', hard: 'Computer (Hard)' };
const BOT_MOVE_DELAY_MS = 700;
const PROMOTION_PIECES = ['q', 'r', 'b', 'n'];

// Repetition key: piece placement, side to move, castling rights, en passant.
// State is stored as a FEN (which carries no history), so chess.js alone
// can't detect threefold repetition — we count positions ourselves.
function positionKey(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

function statePayload(room) {
  const gs = room.gameState;
  const game = new Chess(gs.fen);
  return {
    fen: gs.fen,
    turn: game.turn(), // 'w' | 'b'
    whiteId: gs.whiteId,
    blackId: gs.blackId,
    moves: gs.moves,
    lastMove: gs.lastMove,
    status: gs.status, // 'active' | 'checkmate' | 'draw' | 'resigned'
    drawReason: gs.drawReason || null,
    winnerId: gs.winnerId,
    check: gs.status === 'active' && game.inCheck(),
    drawOfferBy: gs.drawOfferBy,
  };
}

function onStart(room) {
  if (room.vsComputer) {
    const difficulty = BOT_NAMES[room.difficulty] ? room.difficulty : 'medium';
    room.difficulty = difficulty;
    let bot = room.players.find(p => p.id === BOT_ID);
    if (!bot) {
      bot = { id: BOT_ID, name: BOT_NAMES[difficulty], score: 0, isHost: false, isReady: true, isBot: true };
      room.players.push(bot);
    } else {
      bot.name = BOT_NAMES[difficulty];
      bot.score = 0;
    }
  }

  const humans = room.players.filter(p => !p.isBot);
  const host = humans.find(p => p.isHost) || humans[0];
  const opponent = room.vsComputer
    ? room.players.find(p => p.id === BOT_ID)
    : humans.find(p => p !== host) || null;

  const startFen = new Chess().fen();
  room.gameState = {
    fen: startFen,
    positionCounts: { [positionKey(startFen)]: 1 },
    drawReason: null,
    whiteId: host ? host.id : null,
    blackId: opponent ? opponent.id : null,
    moves: [],
    lastMove: null,
    status: 'active',
    winnerId: null,
    drawOfferBy: null,
  };
}

function getGameData(room) {
  if (!room.gameState || !room.gameState.fen) return null;
  return { chess: statePayload(room) };
}

function awardScores(room, winnerId) {
  room.players.forEach(player => {
    if (winnerId === null) {
      player.roundScore = DRAW_SCORE;
      player.score = (player.score || 0) + DRAW_SCORE;
    } else if (player.id === winnerId) {
      player.roundScore = WIN_SCORE;
      player.score = (player.score || 0) + WIN_SCORE;
    } else {
      player.roundScore = 0;
    }
  });
}

function finishGame(io, roomId, room, status, winnerId, drawReason = null) {
  const gs = room.gameState;
  gs.status = status;
  gs.drawReason = drawReason;
  gs.winnerId = winnerId;
  gs.drawOfferBy = null;
  awardScores(room, winnerId);
  io.to(roomId).emit('chess:state', statePayload(room));
  io.to(roomId).emit('playersUpdated', { players: room.players });
  io.to(roomId).emit('chess:gameOver', {
    status,
    winnerId,
    players: room.players,
  });
}

// Applies a validated move and broadcasts; returns false if illegal
function applyMove(io, roomId, room, playerId, { from, to, promotion }) {
  const gs = room.gameState;
  const game = new Chess(gs.fen);

  if (typeof from !== 'string' || typeof to !== 'string') return false;

  let move;
  try {
    move = game.move({ from, to, promotion: PROMOTION_PIECES.includes(promotion) ? promotion : 'q' });
  } catch (e) {
    return false;
  }

  gs.fen = game.fen();
  gs.moves.push(move.san);
  gs.lastMove = { from: move.from, to: move.to };
  gs.drawOfferBy = null; // any move cancels a pending draw offer

  const key = positionKey(gs.fen);
  gs.positionCounts = gs.positionCounts || {};
  gs.positionCounts[key] = (gs.positionCounts[key] || 0) + 1;

  if (game.isCheckmate()) {
    finishGame(io, roomId, room, 'checkmate', playerId);
  } else if (game.isStalemate()) {
    finishGame(io, roomId, room, 'draw', null, 'stalemate');
  } else if (game.isInsufficientMaterial()) {
    finishGame(io, roomId, room, 'draw', null, 'insufficient material');
  } else if (gs.positionCounts[key] >= 3) {
    finishGame(io, roomId, room, 'draw', null, 'threefold repetition');
  } else if (game.isDraw()) {
    finishGame(io, roomId, room, 'draw', null, 'fifty-move rule');
  } else {
    io.to(roomId).emit('chess:state', statePayload(room));
  }
  return true;
}

// If it's the bot's turn in an active vs-computer game, reply after a delay
function maybeBotMove(io, rooms, roomId) {
  const room = rooms[roomId];
  if (!room || !room.vsComputer || !room.gameState || room.gameState.status !== 'active') return;

  const gs = room.gameState;
  const botColor = gs.whiteId === BOT_ID ? 'w' : gs.blackId === BOT_ID ? 'b' : null;
  if (!botColor || new Chess(gs.fen).turn() !== botColor) return;

  // Think straight away (in a worker thread), but never answer faster than the usual delay
  const fenAtSchedule = gs.fen;
  if (gs.botThinkingFen === fenAtSchedule) return; // already on it (e.g. a client re-requested state)
  gs.botThinkingFen = fenAtSchedule;
  const started = Date.now();
  const stillCurrent = () => {
    const current = rooms[roomId];
    return current && current.gameState === gs && gs.status === 'active' && gs.fen === fenAtSchedule ? current : null;
  };

  pickMove(fenAtSchedule, room.difficulty, Object.keys(gs.positionCounts || {}))
    .then(move => {
      setTimeout(() => {
        if (gs.botThinkingFen === fenAtSchedule) gs.botThinkingFen = null;
        const current = stillCurrent();
        if (current && move) applyMove(io, roomId, current, BOT_ID, move);
      }, Math.max(0, BOT_MOVE_DELAY_MS - (Date.now() - started)));
    })
    .catch(err => {
      console.error('Chess bot failed to choose a move:', err);
      if (gs.botThinkingFen === fenAtSchedule) gs.botThinkingFen = null;
    });
}

function registerEvents(socket, io, rooms) {
  socket.on('chess:requestState', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState || !room.gameState.fen) return;
    socket.emit('chess:state', statePayload(room));
    maybeBotMove(io, rooms, roomId);
  });

  socket.on('chess:move', ({ roomId, playerId, from, to, promotion }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState || room.gameState.status !== 'active') return;

    const gs = room.gameState;
    const game = new Chess(gs.fen);
    const myColor = playerId === gs.whiteId ? 'w' : playerId === gs.blackId ? 'b' : null;
    if (!myColor || game.turn() !== myColor || playerId === BOT_ID) return;

    if (!applyMove(io, roomId, room, playerId, { from, to, promotion })) {
      socket.emit('chess:invalidMove', { from, to });
      return;
    }
    maybeBotMove(io, rooms, roomId);
  });

  socket.on('chess:resign', ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState || room.gameState.status !== 'active') return;

    const gs = room.gameState;
    if (playerId !== gs.whiteId && playerId !== gs.blackId) return;
    const winnerId = playerId === gs.whiteId ? gs.blackId : gs.whiteId;
    finishGame(io, roomId, room, 'resigned', winnerId);
  });

  socket.on('chess:offerDraw', ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState || room.gameState.status !== 'active') return;

    const gs = room.gameState;
    if (playerId !== gs.whiteId && playerId !== gs.blackId) return;

    // The bot never agrees to a draw — decline immediately
    if (room.vsComputer) {
      io.to(roomId).emit('chess:state', statePayload(room));
      return;
    }

    gs.drawOfferBy = playerId;
    io.to(roomId).emit('chess:state', statePayload(room));
  });

  socket.on('chess:respondDraw', ({ roomId, playerId, accept }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState || room.gameState.status !== 'active') return;

    const gs = room.gameState;
    if (!gs.drawOfferBy || gs.drawOfferBy === playerId) return;

    if (accept) {
      finishGame(io, roomId, room, 'draw', null, 'agreement');
    } else {
      gs.drawOfferBy = null;
      io.to(roomId).emit('chess:state', statePayload(room));
    }
  });
}

module.exports = { onStart, registerEvents, getGameData, minPlayers: 2 };
