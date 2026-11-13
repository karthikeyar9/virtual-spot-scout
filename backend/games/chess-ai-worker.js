// Runs the chess bot's search off the main thread (see chess-ai.js).

const { parentPort } = require('worker_threads');
const { chooseMove } = require('./chess-ai');

parentPort.on('message', ({ id, fen, difficulty, prior }) => {
  try {
    parentPort.postMessage({ id, move: chooseMove(fen, difficulty, prior) });
  } catch (err) {
    parentPort.postMessage({ id, error: String(err && err.stack || err) });
  }
});
