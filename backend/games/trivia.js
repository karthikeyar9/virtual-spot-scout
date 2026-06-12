// Trivia Blitz game handler — questions come from the SQLite question bank.

const { getRandomTriviaQuestions } = require('../db');

function onStart(room) {
  const totalRounds = room.totalRounds || 10;
  room.gameState = {
    questions: getRandomTriviaQuestions(totalRounds),
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
