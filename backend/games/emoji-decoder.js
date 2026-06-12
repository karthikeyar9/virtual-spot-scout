// Emoji Decoder game handler — puzzles come from the SQLite bank.

const { getRandomEmojiPuzzles } = require('../db');

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function onStart(room) {
  const totalRounds = room.totalRounds || 10;
  room.gameState = {
    puzzles: getRandomEmojiPuzzles(totalRounds),
    currentPuzzleIndex: 0,
    solved: false,
    guessedCorrectly: {},
  };
}

function registerEvents(socket, io, rooms) {
  socket.on('emoji-decoder:requestPuzzle', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    const puzzle = gs.puzzles[gs.currentPuzzleIndex];
    if (!puzzle) return;

    gs.solved = false;
    gs.guessedCorrectly = {};

    // Send puzzle without answer
    io.to(roomId).emit('emoji-decoder:newPuzzle', {
      puzzle: {
        emojis: puzzle.emojis,
        category: puzzle.category,
        hint: puzzle.hint,
      },
      roundIndex: gs.currentPuzzleIndex,
    });
  });

  socket.on('emoji-decoder:submitGuess', ({ roomId, playerId, guess }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.solved) return; // Puzzle already solved
    if (gs.guessedCorrectly[playerId]) return; // Already guessed correctly

    const puzzle = gs.puzzles[gs.currentPuzzleIndex];
    if (!puzzle) return;

    const isCorrect = normalize(guess) === normalize(puzzle.answer);
    const player = room.players.find(p => p.id === playerId);
    const playerName = player ? player.name : 'Unknown';

    if (isCorrect) {
      gs.guessedCorrectly[playerId] = true;
      const alreadySolved = Object.keys(gs.guessedCorrectly).length;

      // First to guess gets most points, decreasing for subsequent
      let score = 0;
      if (alreadySolved === 1) score = 150;
      else if (alreadySolved === 2) score = 100;
      else score = 50;

      if (player) {
        player.score = (player.score || 0) + score;
        player.roundScore = score;
      }
    }

    // Broadcast the guess to everyone
    io.to(roomId).emit('emoji-decoder:guessResult', {
      playerId,
      playerName,
      text: guess,
      isCorrect,
      players: room.players,
    });

    // Check if all players guessed correctly or if first person solved it
    // End round after first correct guess to keep it fast-paced
    if (isCorrect && Object.keys(gs.guessedCorrectly).length === 1) {
      gs.solved = true;
      // Give a short delay before showing the answer
      setTimeout(() => {
        io.to(roomId).emit('emoji-decoder:puzzleSolved', {
          answer: puzzle.answer,
          players: room.players,
        });
      }, 1000);
    }
  });

  socket.on('emoji-decoder:timeUp', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.solved) return;

    gs.solved = true;
    const puzzle = gs.puzzles[gs.currentPuzzleIndex];

    io.to(roomId).emit('emoji-decoder:timeUp', {
      answer: puzzle ? puzzle.answer : 'Unknown',
      players: room.players,
    });
  });

  socket.on('emoji-decoder:nextPuzzle', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    gs.currentPuzzleIndex++;

    if (gs.currentPuzzleIndex >= gs.puzzles.length) {
      io.to(roomId).emit('emoji-decoder:gameComplete', { players: room.players });
      return;
    }

    gs.solved = false;
    gs.guessedCorrectly = {};

    const puzzle = gs.puzzles[gs.currentPuzzleIndex];
    io.to(roomId).emit('emoji-decoder:newPuzzle', {
      puzzle: {
        emojis: puzzle.emojis,
        category: puzzle.category,
        hint: puzzle.hint,
      },
      roundIndex: gs.currentPuzzleIndex,
    });
  });
}

module.exports = { onStart, registerEvents };
