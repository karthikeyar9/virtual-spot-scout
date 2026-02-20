// Emoji Decoder game handler

const puzzles = [
  { emojis: "🦁👑", answer: "The Lion King", category: "Movie", hint: "Disney classic" },
  { emojis: "⭐️⚔️", answer: "Star Wars", category: "Movie", hint: "A galaxy far far away" },
  { emojis: "🕷️🧑", answer: "Spider-Man", category: "Movie", hint: "Friendly neighborhood hero" },
  { emojis: "🧊❄️👸", answer: "Frozen", category: "Movie", hint: "Let it go" },
  { emojis: "🏠⬆️🎈", answer: "Up", category: "Movie", hint: "Pixar tearjerker" },
  { emojis: "🦈🌊", answer: "Jaws", category: "Movie", hint: "You're gonna need a bigger boat" },
  { emojis: "👻👻🔫", answer: "Ghostbusters", category: "Movie", hint: "Who you gonna call?" },
  { emojis: "🧙‍♂️💍", answer: "Lord of the Rings", category: "Movie", hint: "One ring to rule them all" },
  { emojis: "🦇🧑‍🦲", answer: "Batman", category: "Movie", hint: "Dark Knight" },
  { emojis: "🚢❄️💑", answer: "Titanic", category: "Movie", hint: "I'm the king of the world" },
  { emojis: "🎃🔪", answer: "Halloween", category: "Movie", hint: "Spooky slasher" },
  { emojis: "🐀👨‍🍳", answer: "Ratatouille", category: "Movie", hint: "Anyone can cook" },
  { emojis: "🏝️🦕", answer: "Jurassic Park", category: "Movie", hint: "Life finds a way" },
  { emojis: "🤖❤️🌱", answer: "Wall-E", category: "Movie", hint: "Lonely robot" },
  { emojis: "🎵🎤👩‍🎤⭐", answer: "A Star Is Born", category: "Movie", hint: "Musical drama" },
  { emojis: "🍕🐢🥷", answer: "Teenage Mutant Ninja Turtles", category: "Show", hint: "Cowabunga!" },
  { emojis: "🔴💊🔵💊", answer: "The Matrix", category: "Movie", hint: "Red pill or blue pill" },
  { emojis: "🧹⚡🏰", answer: "Harry Potter", category: "Movie", hint: "You're a wizard" },
  { emojis: "🐠🔍", answer: "Finding Nemo", category: "Movie", hint: "Just keep swimming" },
  { emojis: "👨‍🚀🌙", answer: "Apollo 13", category: "Movie", hint: "Houston we have a problem" },
  { emojis: "🎪🐘", answer: "Dumbo", category: "Movie", hint: "Flying elephant" },
  { emojis: "🧟‍♂️🌍", answer: "World War Z", category: "Movie", hint: "Zombie apocalypse" },
  { emojis: "🏎️💨", answer: "Fast and Furious", category: "Movie", hint: "Family" },
  { emojis: "🐒👑🌴", answer: "Tarzan", category: "Movie", hint: "Raised by apes" },
  { emojis: "🎭😂😭", answer: "Inside Out", category: "Movie", hint: "Emotions as characters" },
  { emojis: "☕️👫👫👫", answer: "Friends", category: "Show", hint: "I'll be there for you" },
  { emojis: "🧪💎👨‍🔬", answer: "Breaking Bad", category: "Show", hint: "Say my name" },
  { emojis: "👑🐉🏰⚔️", answer: "Game of Thrones", category: "Show", hint: "Winter is coming" },
  { emojis: "🍌💰🏗️", answer: "Arrested Development", category: "Show", hint: "There's always money in the..." },
  { emojis: "🧟‍♂️🚶‍♂️", answer: "The Walking Dead", category: "Show", hint: "Zombie survival" },
];

function shuffle(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function onStart(room) {
  const totalRounds = room.totalRounds || 10;
  const shuffled = shuffle(puzzles);
  room.gameState = {
    puzzles: shuffled.slice(0, totalRounds),
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
