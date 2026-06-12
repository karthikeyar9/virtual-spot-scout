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

  room.gameState = {
    fen: new Chess().fen(),
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

function finishGame(io, roomId, room, status, winnerId) {
  const gs = room.gameState;
  gs.status = status;
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

  let move;
  try {
    move = game.move({ from, to, promotion: promotion || 'q' });
  } catch (e) {
    return false;
  }

  gs.fen = game.fen();
  gs.moves.push(move.san);
  gs.lastMove = { from: move.from, to: move.to };
  gs.drawOfferBy = null; // any move cancels a pending draw offer

  if (game.isCheckmate()) {
    finishGame(io, roomId, room, 'checkmate', playerId);
  } else if (game.isDraw() || game.isStalemate()) {
    finishGame(io, roomId, room, 'draw', null);
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

  const fenAtSchedule = gs.fen;
  setTimeout(() => {
    // Room may have been torn down or the game ended while we waited
    const current = rooms[roomId];
    if (!current || !current.gameState || current.gameState.status !== 'active') return;
    if (current.gameState.fen !== fenAtSchedule) return;

    const move = pickMove(current.gameState.fen, current.difficulty);
    if (move) applyMove(io, roomId, current, BOT_ID, move);
  }, BOT_MOVE_DELAY_MS);
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
      finishGame(io, roomId, room, 'draw', null);
    } else {
      gs.drawOfferBy = null;
      io.to(roomId).emit('chess:state', statePayload(room));
    }
  });
}

module.exports = { onStart, registerEvents, getGameData, minPlayers: 2 };
