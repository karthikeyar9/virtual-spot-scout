// Chess game handler — server-authoritative via chess.js.
// The first two players in the room are seated; host plays white.

const { Chess } = require('chess.js');

const WIN_SCORE = 1000;
const DRAW_SCORE = 500;

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
  const seated = room.players.slice(0, 2);
  const host = seated.find(p => p.isHost) || seated[0];
  const other = seated.find(p => p !== host) || null;

  room.gameState = {
    fen: new Chess().fen(),
    whiteId: host ? host.id : null,
    blackId: other ? other.id : null,
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

function registerEvents(socket, io, rooms) {
  socket.on('chess:requestState', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState || !room.gameState.fen) return;
    socket.emit('chess:state', statePayload(room));
  });

  socket.on('chess:move', ({ roomId, playerId, from, to, promotion }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState || room.gameState.status !== 'active') return;

    const gs = room.gameState;
    const game = new Chess(gs.fen);
    const myColor = playerId === gs.whiteId ? 'w' : playerId === gs.blackId ? 'b' : null;
    if (!myColor || game.turn() !== myColor) return;

    let move;
    try {
      move = game.move({ from, to, promotion: promotion || 'q' });
    } catch (e) {
      socket.emit('chess:invalidMove', { from, to });
      return;
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
