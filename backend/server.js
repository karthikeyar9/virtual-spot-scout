const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { getGameHandler, registerAllGameEvents } = require('./games/registry');

const app = express();

console.log('🚀 Initializing server...');

const allowedOrigins = [
  'https://virtual-city-guesser.vercel.app',
  'http://localhost:8080',
  'http://localhost:3000',
  'https://virtual-city-guess-backend.onrender.com',
  'http://localhost:10000'
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`🚫 CORS blocked request from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false
};

app.use(cors(corsOptions));

const server = http.createServer(app);

const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  pingTimeout: 20000,
  pingInterval: 5000,
  connectTimeout: 20000,
  maxHttpBufferSize: 1e6,
  path: '/socket.io',
});

app.get('/', (req, res) => {
  res.send('Virtual Spot Scout server is running!');
});

app.get('/api/health', (req, res) => {
  res.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;

// Store rooms
const rooms = {};

// Socket.IO connection handlers
io.on('connection', (socket) => {
  console.log('✨ New connection:', socket.id);

  socket.on('error', (err) => {
    console.error('❌ Socket error:', socket.id, err);
  });

  // Room state request
  socket.on('getRoomState', ({ roomId }) => {
    if (rooms[roomId]) {
      // Build gameData if game is active
      const gameData = {};
      if (rooms[roomId].hasStarted && rooms[roomId].gameState) {
        if (rooms[roomId].gameType === 'city-guesser' && rooms[roomId].gameState.locations) {
          gameData.locations = rooms[roomId].gameState.locations;
          gameData.backupLocations = rooms[roomId].gameState.backupLocations;
        }
      }

      socket.emit('roomState', {
        hasStarted: rooms[roomId].hasStarted,
        players: rooms[roomId].players,
        currentRound: rooms[roomId].currentRound,
        totalRounds: rooms[roomId].totalRounds,
        gameType: rooms[roomId].gameType,
        gameData: Object.keys(gameData).length > 0 ? gameData : undefined,
      });
    } else {
      rooms[roomId] = {
        gameType: 'city-guesser',
        hasStarted: false,
        players: [],
        currentRound: 0,
        totalRounds: 5,
        gameState: {},
      };
      socket.emit('roomState', {
        ...rooms[roomId],
        gameType: rooms[roomId].gameType,
      });
    }
  });

  // Player join
  socket.on('joinRoom', ({ roomId, playerName, playerId, isHost, gameType }) => {
    console.log(`👋 Player ${playerName} (${playerId}) joining room ${roomId} [${gameType || 'city-guesser'}]`);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        gameType: gameType || 'city-guesser',
        hasStarted: false,
        players: [],
        currentRound: 0,
        totalRounds: 5,
        gameState: {},
      };
    }

    // Update game type if provided
    if (gameType && !rooms[roomId].hasStarted) {
      rooms[roomId].gameType = gameType;
    }

    socket.join(roomId);
    socket.data = { roomId, playerId, playerName };

    const existingPlayerIndex = rooms[roomId].players.findIndex(p => p.id === playerId);

    if (existingPlayerIndex === -1) {
      rooms[roomId].players.push({
        id: playerId,
        name: playerName,
        score: 0,
        isHost,
        isReady: isHost
      });
    } else {
      // Player reconnecting - preserve score, clear disconnected flag
      rooms[roomId].players[existingPlayerIndex].name = playerName;
      rooms[roomId].players[existingPlayerIndex].isHost = isHost;
      rooms[roomId].players[existingPlayerIndex].disconnected = false;

      // Clear disconnect timeout if any
      if (rooms[roomId]._disconnectTimeouts && rooms[roomId]._disconnectTimeouts[playerId]) {
        clearTimeout(rooms[roomId]._disconnectTimeouts[playerId]);
        delete rooms[roomId]._disconnectTimeouts[playerId];
        console.log(`🔄 Player ${playerName} reconnected, score preserved: ${rooms[roomId].players[existingPlayerIndex].score}`);
      }
    }

    io.to(roomId).emit('playersUpdated', { players: rooms[roomId].players });

    // Build gameData for mid-game rejoins
    const gameData = {};
    if (rooms[roomId].hasStarted && rooms[roomId].gameState) {
      if (rooms[roomId].gameType === 'city-guesser' && rooms[roomId].gameState.locations) {
        gameData.locations = rooms[roomId].gameState.locations;
        gameData.backupLocations = rooms[roomId].gameState.backupLocations;
      }
    }

    socket.emit('roomState', {
      hasStarted: rooms[roomId].hasStarted,
      players: rooms[roomId].players,
      currentRound: rooms[roomId].currentRound,
      totalRounds: rooms[roomId].totalRounds,
      gameType: rooms[roomId].gameType,
      gameData: Object.keys(gameData).length > 0 ? gameData : undefined,
    });
  });

  // Player ready
  socket.on('playerReady', ({ roomId, playerId, isReady }) => {
    if (!rooms[roomId]) return;
    const playerIndex = rooms[roomId].players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
      rooms[roomId].players[playerIndex].isReady = isReady;
      io.to(roomId).emit('playersUpdated', { players: rooms[roomId].players });
    }
  });

  // Start game
  socket.on('startGame', ({ roomId, rounds = 5, gameType }) => {
    if (!rooms[roomId]) return;

    const allPlayersReady = rooms[roomId].players.every(player =>
      player.isReady || player.isHost
    );

    if (!allPlayersReady) {
      socket.emit('errorMessage', { message: 'Cannot start game until all players are ready' });
      return;
    }

    rooms[roomId].hasStarted = true;
    rooms[roomId].currentRound = 0;
    rooms[roomId].totalRounds = rounds;

    if (gameType) {
      rooms[roomId].gameType = gameType;
    }

    // Reset player scores
    rooms[roomId].players = rooms[roomId].players.map(player => ({
      ...player,
      score: 0
    }));

    // Initialize game-specific state
    const handler = getGameHandler(rooms[roomId].gameType);
    if (handler && handler.onStart) {
      handler.onStart(rooms[roomId]);
    }

    console.log(`🎮 Game started in room ${roomId} [${rooms[roomId].gameType}] with ${rounds} rounds`);

    // Send game-specific data with the gameStarted event
    const gameData = {};
    if (rooms[roomId].gameState) {
      if (rooms[roomId].gameType === 'city-guesser' && rooms[roomId].gameState.locations) {
        gameData.locations = rooms[roomId].gameState.locations;
        gameData.backupLocations = rooms[roomId].gameState.backupLocations;
      }
    }

    io.to(roomId).emit('gameStarted', { gameData });
    io.to(roomId).emit('playersUpdated', { players: rooms[roomId].players });
  });

  // Next round (shared across games)
  socket.on('nextRound', ({ roomId }) => {
    if (!rooms[roomId]) return;

    // Reset game state for next round
    if (rooms[roomId].gameState) {
      rooms[roomId].gameState.guesses = {};
    }

    if (!rooms[roomId].currentRound) rooms[roomId].currentRound = 0;
    rooms[roomId].currentRound++;

    // Advance city-guesser round index and target
    if (rooms[roomId].gameType === 'city-guesser' && rooms[roomId].gameState) {
      const gs = rooms[roomId].gameState;
      gs.currentRoundIndex = rooms[roomId].currentRound;
      gs.currentTarget = gs.locations[gs.currentRoundIndex] || null;
    }

    const isGameComplete = rooms[roomId].currentRound >= rooms[roomId].totalRounds;

    if (isGameComplete) {
      console.log('🏁 Game completed in room:', roomId);
      io.to(roomId).emit('gameComplete', { players: rooms[roomId].players });
    } else {
      console.log(`🔄 Round ${rooms[roomId].currentRound}/${rooms[roomId].totalRounds} in room ${roomId}`);
      io.to(roomId).emit('roundAdvanced');
    }
  });

  // Register all game-specific events
  registerAllGameEvents(socket, io, rooms);

  // Disconnect
  socket.on('disconnect', () => {
    const { roomId, playerId, playerName } = socket.data || {};
    console.log('👋 Disconnected:', socket.id, playerName);

    if (roomId && rooms[roomId]) {
      // During an active game, mark player as disconnected instead of removing
      // Give them 60 seconds to reconnect (page refresh)
      if (rooms[roomId].hasStarted) {
        const playerIndex = rooms[roomId].players.findIndex(p => p.id === playerId);
        if (playerIndex !== -1) {
          rooms[roomId].players[playerIndex].disconnected = true;
          console.log(`⏳ Player ${playerName} marked disconnected (game active), waiting for reconnect`);

          // Set a timeout to remove if they don't reconnect
          const timeoutId = setTimeout(() => {
            if (rooms[roomId] && rooms[roomId].players) {
              const pIdx = rooms[roomId].players.findIndex(p => p.id === playerId);
              if (pIdx !== -1 && rooms[roomId].players[pIdx].disconnected) {
                rooms[roomId].players.splice(pIdx, 1);
                console.log(`🗑️ Player ${playerName} removed after disconnect timeout`);
                if (rooms[roomId].players.length === 0) {
                  delete rooms[roomId];
                  console.log('🗑️ Room deleted (empty):', roomId);
                } else {
                  io.to(roomId).emit('playersUpdated', { players: rooms[roomId].players });
                }
              }
            }
          }, 60000);

          // Store timeout so we can clear it on reconnect
          if (!rooms[roomId]._disconnectTimeouts) rooms[roomId]._disconnectTimeouts = {};
          rooms[roomId]._disconnectTimeouts[playerId] = timeoutId;

          io.to(roomId).emit('playersUpdated', { players: rooms[roomId].players });
        }
      } else {
        // Game hasn't started - remove player immediately
        rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== playerId);

        if (rooms[roomId].players.length === 0) {
          delete rooms[roomId];
          console.log('🗑️ Room deleted (empty):', roomId);
        } else {
          const hasHost = rooms[roomId].players.some(p => p.isHost);
          if (!hasHost && rooms[roomId].players.length > 0) {
            rooms[roomId].players[0].isHost = true;
          }
          io.to(roomId).emit('playersUpdated', { players: rooms[roomId].players });
        }
      }
    }
  });
});

io.engine.on("connection_error", (err) => {
  console.log('🔴 Connection error:', err.message);
});

if (process.env.VERCEL) {
  module.exports = app;
} else {
  const serverPort = process.env.PORT || 3001;
  server.listen(serverPort, () => {
    console.log(`
🎮 Virtual Spot Scout Server
-----------------------------
✅ Running on port ${serverPort}
📡 WebSocket ready
🔒 CORS configured
    `);
  });
}
