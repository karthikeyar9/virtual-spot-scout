const cityGuesser = require('./city-guesser');
const trivia = require('./trivia');
const hotTakes = require('./hot-takes');
const emojiDecoder = require('./emoji-decoder');
const chess = require('./chess');

const gameHandlers = {
  'city-guesser': cityGuesser,
  'trivia': trivia,
  'hot-takes': hotTakes,
  'emoji-decoder': emojiDecoder,
  'chess': chess,
};

function getGameHandler(gameType) {
  return gameHandlers[gameType] || null;
}

function registerAllGameEvents(socket, io, rooms) {
  Object.values(gameHandlers).forEach(handler => {
    if (handler.registerEvents) {
      handler.registerEvents(socket, io, rooms);
    }
  });
}

module.exports = { getGameHandler, registerAllGameEvents };
