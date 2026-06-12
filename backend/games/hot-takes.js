// Hot Takes / Would You Rather game handler — prompts come from the SQLite bank.

const { getRandomHotTakesPrompts } = require('../db');

function onStart(room) {
  const totalRounds = room.totalRounds || 10;
  room.gameState = {
    prompts: getRandomHotTakesPrompts(totalRounds),
    currentPromptIndex: 0,
    votes: {},
  };
}

function registerEvents(socket, io, rooms) {
  socket.on('hot-takes:requestPrompt', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    const prompt = gs.prompts[gs.currentPromptIndex];
    if (!prompt) return;

    gs.votes = {};

    io.to(roomId).emit('hot-takes:newPrompt', {
      prompt,
      roundIndex: gs.currentPromptIndex,
    });
  });

  socket.on('hot-takes:vote', ({ roomId, playerId, vote }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.votes[playerId]) return; // Already voted

    gs.votes[playerId] = vote;

    // Score: voting with majority gives points
    io.to(roomId).emit('hot-takes:voteUpdate', {
      votedCount: Object.keys(gs.votes).length,
      totalPlayers: room.players.length,
    });

    // Check if all players voted
    const allVoted = room.players.every(p => gs.votes[p.id]);

    if (allVoted) {
      const votesA = Object.values(gs.votes).filter(v => v === 'A').length;
      const votesB = Object.values(gs.votes).filter(v => v === 'B').length;
      const totalVotes = votesA + votesB;
      const majority = votesA >= votesB ? 'A' : 'B';

      // Award points for voting with majority
      room.players.forEach(player => {
        const playerVote = gs.votes[player.id];
        if (playerVote === majority) {
          player.score = (player.score || 0) + 50;
          player.roundScore = 50;
        } else if (playerVote === 'A' || playerVote === 'B') {
          player.roundScore = 0;
        } else {
          player.roundScore = 0; // skipped
        }
      });

      io.to(roomId).emit('hot-takes:roundResults', {
        votesA,
        votesB,
        totalVotes,
        playerVotes: gs.votes,
        players: room.players,
      });
    }
  });

  socket.on('hot-takes:nextPrompt', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    gs.currentPromptIndex++;

    if (gs.currentPromptIndex >= gs.prompts.length) {
      io.to(roomId).emit('hot-takes:gameComplete', { players: room.players });
      return;
    }

    gs.votes = {};
    const prompt = gs.prompts[gs.currentPromptIndex];
    io.to(roomId).emit('hot-takes:newPrompt', {
      prompt,
      roundIndex: gs.currentPromptIndex,
    });
  });
}

module.exports = { onStart, registerEvents };
