// Trivia Blitz game handler

const questions = [
  { question: "What is the capital of Australia?", options: ["Sydney", "Melbourne", "Canberra", "Brisbane"], correctIndex: 2, category: "Geography" },
  { question: "Which planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Saturn"], correctIndex: 1, category: "Science" },
  { question: "Who painted the Mona Lisa?", options: ["Michelangelo", "Raphael", "Leonardo da Vinci", "Donatello"], correctIndex: 2, category: "Art" },
  { question: "What is the largest ocean on Earth?", options: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean", "Pacific Ocean"], correctIndex: 3, category: "Geography" },
  { question: "In what year did the Titanic sink?", options: ["1905", "1912", "1920", "1898"], correctIndex: 1, category: "History" },
  { question: "What element does 'O' represent on the periodic table?", options: ["Osmium", "Oxygen", "Gold", "Oganesson"], correctIndex: 1, category: "Science" },
  { question: "Which country has the most World Cup wins?", options: ["Germany", "Italy", "Argentina", "Brazil"], correctIndex: 3, category: "Sports" },
  { question: "What is the hardest natural substance on Earth?", options: ["Gold", "Iron", "Diamond", "Platinum"], correctIndex: 2, category: "Science" },
  { question: "Which language has the most native speakers?", options: ["English", "Spanish", "Hindi", "Mandarin Chinese"], correctIndex: 3, category: "Language" },
  { question: "What is the smallest country in the world?", options: ["Monaco", "Vatican City", "San Marino", "Liechtenstein"], correctIndex: 1, category: "Geography" },
  { question: "Who wrote 'Romeo and Juliet'?", options: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"], correctIndex: 1, category: "Literature" },
  { question: "What is the chemical formula for water?", options: ["CO2", "H2O", "NaCl", "O2"], correctIndex: 1, category: "Science" },
  { question: "Which animal is the tallest in the world?", options: ["Elephant", "Giraffe", "Blue Whale", "Ostrich"], correctIndex: 1, category: "Nature" },
  { question: "What year did the Berlin Wall fall?", options: ["1987", "1989", "1991", "1993"], correctIndex: 1, category: "History" },
  { question: "Which gas do plants absorb?", options: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"], correctIndex: 2, category: "Science" },
  { question: "What is the longest river in the world?", options: ["Amazon", "Nile", "Yangtze", "Mississippi"], correctIndex: 1, category: "Geography" },
  { question: "Who developed the theory of relativity?", options: ["Isaac Newton", "Niels Bohr", "Albert Einstein", "Stephen Hawking"], correctIndex: 2, category: "Science" },
  { question: "What is the currency of Japan?", options: ["Yuan", "Won", "Yen", "Ringgit"], correctIndex: 2, category: "Geography" },
  { question: "Which planet has the most moons?", options: ["Jupiter", "Saturn", "Uranus", "Neptune"], correctIndex: 1, category: "Science" },
  { question: "What is the main ingredient in guacamole?", options: ["Tomato", "Avocado", "Lime", "Onion"], correctIndex: 1, category: "Food" },
  { question: "Which continent is the Sahara Desert on?", options: ["Asia", "South America", "Africa", "Australia"], correctIndex: 2, category: "Geography" },
  { question: "How many bones in the adult human body?", options: ["186", "206", "226", "246"], correctIndex: 1, category: "Science" },
  { question: "Who was the first person on the Moon?", options: ["Buzz Aldrin", "Yuri Gagarin", "Neil Armstrong", "John Glenn"], correctIndex: 2, category: "History" },
  { question: "What is the largest mammal?", options: ["African Elephant", "Blue Whale", "Giraffe", "Hippopotamus"], correctIndex: 1, category: "Nature" },
  { question: "Which country has the Great Barrier Reef?", options: ["Indonesia", "Philippines", "Australia", "Thailand"], correctIndex: 2, category: "Geography" },
  { question: "What does DNA stand for?", options: ["Deoxyribonucleic Acid", "Dinitrogen Acid", "Dynamic Nuclear Acid", "Dioxin Nucleic Acid"], correctIndex: 0, category: "Science" },
  { question: "Which instrument has 88 keys?", options: ["Guitar", "Violin", "Piano", "Harp"], correctIndex: 2, category: "Music" },
  { question: "What is the speed of light approximately?", options: ["300,000 km/s", "150,000 km/s", "500,000 km/s", "100,000 km/s"], correctIndex: 0, category: "Science" },
  { question: "Which ancient wonder was in Alexandria?", options: ["Hanging Gardens", "Lighthouse", "Colossus", "Temple of Artemis"], correctIndex: 1, category: "History" },
  { question: "What is the boiling point of water in Celsius?", options: ["90°C", "100°C", "110°C", "120°C"], correctIndex: 1, category: "Science" },
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
  const shuffled = shuffle(questions);
  room.gameState = {
    questions: shuffled.slice(0, totalRounds),
    currentQuestionIndex: 0,
    answers: {},
    firstCorrectPlayer: null,
    questionStartTime: null,
  };
}

function registerEvents(socket, io, rooms) {
  socket.on('trivia:requestQuestion', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    const question = gs.questions[gs.currentQuestionIndex];
    if (!question) return;

    gs.answers = {};
    gs.firstCorrectPlayer = null;
    gs.questionStartTime = Date.now();

    // Send question without correctIndex to prevent cheating
    io.to(roomId).emit('trivia:newQuestion', {
      question: {
        question: question.question,
        options: question.options,
        category: question.category,
      },
      roundIndex: gs.currentQuestionIndex,
    });
  });

  socket.on('trivia:submitAnswer', ({ roomId, playerId, answerIndex }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.answers[playerId] !== undefined) return; // Already answered

    const question = gs.questions[gs.currentQuestionIndex];
    if (!question) return;

    const isCorrect = answerIndex === question.correctIndex;
    const isFirst = isCorrect && !gs.firstCorrectPlayer;

    if (isFirst) {
      gs.firstCorrectPlayer = playerId;
    }

    let score = 0;
    if (isCorrect) {
      score = 100;
      if (isFirst) {
        score += 50; // Speed bonus
      }
    }

    gs.answers[playerId] = { answerIndex, score, timeBonus: isFirst };

    // Update player score
    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
      room.players[playerIndex].score = (room.players[playerIndex].score || 0) + score;
      room.players[playerIndex].roundScore = score;
    }

    // Notify all about update
    io.to(roomId).emit('trivia:answerResult', {
      players: room.players,
      answeredCount: Object.keys(gs.answers).length,
      totalPlayers: room.players.length,
    });

    // Check if all players answered
    const allAnswered = room.players.every(p => gs.answers[p.id] !== undefined);

    if (allAnswered) {
      io.to(roomId).emit('trivia:roundResults', {
        correctIndex: question.correctIndex,
        playerAnswers: gs.answers,
        players: room.players,
      });
    }
  });

  socket.on('trivia:nextQuestion', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    gs.currentQuestionIndex++;

    if (gs.currentQuestionIndex >= gs.questions.length) {
      io.to(roomId).emit('trivia:gameComplete', { players: room.players });
      return;
    }

    // Send next question
    gs.answers = {};
    gs.firstCorrectPlayer = null;
    gs.questionStartTime = Date.now();

    const question = gs.questions[gs.currentQuestionIndex];
    io.to(roomId).emit('trivia:newQuestion', {
      question: {
        question: question.question,
        options: question.options,
        category: question.category,
      },
      roundIndex: gs.currentQuestionIndex,
    });
  });
}

module.exports = { onStart, registerEvents };
