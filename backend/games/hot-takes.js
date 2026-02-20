// Hot Takes / Would You Rather game handler

const prompts = [
  { question: "Would you rather...", optionA: "Be able to fly", optionB: "Be able to read minds" },
  { question: "Would you rather...", optionA: "Live without music", optionB: "Live without movies" },
  { question: "Would you rather...", optionA: "Always be 10 minutes late", optionB: "Always be 20 minutes early" },
  { question: "Would you rather...", optionA: "Have unlimited money", optionB: "Have unlimited time" },
  { question: "Would you rather...", optionA: "Live in the mountains", optionB: "Live by the beach" },
  { question: "Would you rather...", optionA: "Be famous", optionB: "Be the best friend of someone famous" },
  { question: "Would you rather...", optionA: "Travel to the past", optionB: "Travel to the future" },
  { question: "Would you rather...", optionA: "Only eat pizza forever", optionB: "Never eat pizza again" },
  { question: "Would you rather...", optionA: "Have super strength", optionB: "Have super speed" },
  { question: "Would you rather...", optionA: "Know every language", optionB: "Play every instrument" },
  { question: "Would you rather...", optionA: "Never use social media again", optionB: "Never watch a movie again" },
  { question: "Would you rather...", optionA: "Be the funniest person in the room", optionB: "Be the smartest person in the room" },
  { question: "Would you rather...", optionA: "Have a personal chef", optionB: "Have a personal trainer" },
  { question: "Would you rather...", optionA: "Always know the truth", optionB: "Always get away with lying" },
  { question: "Would you rather...", optionA: "Live in a tiny home", optionB: "Live in a mansion you must clean yourself" },
  { question: "Hot take:", optionA: "Pineapple belongs on pizza", optionB: "Pineapple does NOT belong on pizza" },
  { question: "Hot take:", optionA: "Cats are better than dogs", optionB: "Dogs are better than cats" },
  { question: "Hot take:", optionA: "Morning person", optionB: "Night owl" },
  { question: "Hot take:", optionA: "Books are better than movies", optionB: "Movies are better than books" },
  { question: "Hot take:", optionA: "Summer is the best season", optionB: "Winter is the best season" },
];

function shuffle(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function onStart(room) {
  const totalRounds = room.totalRounds || 10;
  const shuffled = shuffle(prompts);
  room.gameState = {
    prompts: shuffled.slice(0, totalRounds),
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
