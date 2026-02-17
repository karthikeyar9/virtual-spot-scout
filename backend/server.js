const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Create Express app
const app = express();

console.log('🚀 Initializing server...');

// Allow production frontend URL and localhost
const allowedOrigins = [
  'https://virtual-city-guesser.vercel.app', // Vercel frontend
  'http://localhost:8080',
  'http://localhost:3000',
  'https://virtual-city-guess-backend.onrender.com',
  // For local testing of the Render deployment
  'http://localhost:10000'
];

// Enable CORS with specific options
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, etc)
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

console.log('🔒 CORS configuration:', corsOptions);

app.use(cors(corsOptions));

// Create HTTP server and Socket.IO instance
const server = http.createServer(app);

// Configure Socket.IO
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  pingTimeout: 20000,        // Reduced to 20s for faster detection of stale connections
  pingInterval: 5000,        // Reduced to 5s for more frequent health checks
  connectTimeout: 20000,     // Increased to 20s to give more time for initial connection
  maxHttpBufferSize: 1e6,    // 1 MB - Reasonable buffer size
  path: '/socket.io',
  // Handle serverless environments
  adapter: process.env.VERCEL ? {
    name: 'vercel-adapter',
    // On Vercel, every instance is a separate function
    // so we need to make sure this works without Redis
    rooms: new Map(),
    sids: new Map(),
    emit(packet, opts) {
      // Default emit behavior
      return false;
    }
  } : undefined
});

console.log('🔌 Socket.IO configuration:', {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  pingTimeout: 20000,
  pingInterval: 5000,
  path: '/socket.io'
});

// Add a simple endpoint to test server connectivity
app.get('/', (req, res) => {
  console.log('📥 Received request to root endpoint');
  res.send('Virtual City Guesser server is running!');
});

// Health check endpoint for Vercel
app.get('/api/health', (req, res) => {
  res.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
});

// Define the port
const PORT = process.env.PORT || 3001;

// Store rooms and their players
const rooms = {};

// Helper: Haversine distance calculation (returns km)
function calculateDistance(point1, point2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(point2.lat - point1.lat);
  const dLon = toRad(point2.lng - point1.lng);
  const lat1 = toRad(point1.lat);
  const lat2 = toRad(point2.lat);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees) {
  return degrees * Math.PI / 180;
}

function calculateScore(distance) {
  if (distance < 1) return 5000;
  if (distance < 5) return 4000;
  if (distance < 10) return 3000;
  if (distance < 50) return 2000;
  if (distance < 100) return 1000;
  if (distance < 500) return 500;
  if (distance < 1000) return 250;
  if (distance < 5000) return 100;
  if (distance < 10000) return 50;
  return 0;
}

// Socket.IO connection handlers
io.on('connection', (socket) => {
  console.log('✨ New connection established:', {
    id: socket.id,
    transport: socket.conn.transport.name,
    address: socket.handshake.address,
    headers: socket.handshake.headers
  });
  
  // Handle errors
  socket.on('error', (err) => {
    console.error('❌ Socket error:', {
      socketId: socket.id,
      error: err
    });
  });

  // Handle room state request
  socket.on('getRoomState', ({ roomId }) => {
    console.log(`📝 Room state requested for room ${roomId}`);
    
    if (rooms[roomId]) {
      // Send the current room state
      socket.emit('roomState', {
        hasStarted: rooms[roomId].hasStarted,
        players: rooms[roomId].players,
        currentRound: rooms[roomId].currentRound,
        totalRounds: rooms[roomId].totalRounds
      });
    } else {
      // If room doesn't exist, create it
      rooms[roomId] = {
        hasStarted: false,
        players: [],
        currentRound: 0,
        totalRounds: 5,
        guesses: {}
      };
      socket.emit('roomState', rooms[roomId]);
    }
  });

  // Handle player joining room
  socket.on('joinRoom', ({ roomId, playerName, playerId, isHost }) => {
    console.log(`👋 Player ${playerName} (${playerId}) joining room ${roomId}`);
    
    // Create room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        hasStarted: false,
        players: [],
        currentRound: 0,
        totalRounds: 5,
        guesses: {}
      };
    }

    // Join the socket room
    socket.join(roomId);

    // Store player data on socket for disconnect handling
    socket.data = { roomId, playerId, playerName };

    // Check if player already exists (reconnection)
    const existingPlayerIndex = rooms[roomId].players.findIndex(p => p.id === playerId);
    
    if (existingPlayerIndex === -1) {
      // Add new player
      rooms[roomId].players.push({
        id: playerId,
        name: playerName,
        score: 0,
        isHost,
        isReady: isHost
      });
    } else {
      // Update existing player's connection
      rooms[roomId].players[existingPlayerIndex].name = playerName;
      rooms[roomId].players[existingPlayerIndex].isHost = isHost;
    }
    
    // Broadcast updated player list
    io.to(roomId).emit('playersUpdated', {
      players: rooms[roomId].players
    });
    
    // Send current room state to the joining player
    socket.emit('roomState', {
      hasStarted: rooms[roomId].hasStarted,
      players: rooms[roomId].players,
      currentRound: rooms[roomId].currentRound,
      totalRounds: rooms[roomId].totalRounds
    });
  });

  // Handle player ready status
  socket.on('playerReady', ({ roomId, playerId, isReady }) => {
    if (rooms[roomId]) {
      // Update player ready status
      const playerIndex = rooms[roomId].players.findIndex(p => p.id === playerId);
      if (playerIndex !== -1) {
        rooms[roomId].players[playerIndex].isReady = isReady;
        console.log(`Player ${playerId} in room ${roomId} is now ${isReady ? 'ready' : 'not ready'}`);
        
        // Broadcast updated player list
        io.to(roomId).emit('playersUpdated', { players: rooms[roomId].players });
      }
    }
  });

  // Start game
  socket.on('startGame', ({ roomId, rounds = 5 }) => {
    if (rooms[roomId]) {
      // Check if all players are ready
      const allPlayersReady = rooms[roomId].players.every(player => 
        player.isReady || player.isHost // Host is always considered ready
      );
      
      if (!allPlayersReady) {
        console.log(`❌ Attempted to start game in room ${roomId} but not all players are ready`);
        socket.emit('errorMessage', { 
          message: 'Cannot start game until all players are ready' 
        });
        return;
      }
      
      // Reset game state
      rooms[roomId].hasStarted = true;
      rooms[roomId].currentRound = 0;
      rooms[roomId].totalRounds = rounds;
      rooms[roomId].guesses = {};
      
      // Reset player scores
      rooms[roomId].players = rooms[roomId].players.map(player => ({
        ...player,
        score: 0
      }));
      
      console.log(`🎮 Game in room ${roomId} is starting with ${rounds} rounds`);
      
      // Broadcast game start to all players in the room
      io.to(roomId).emit('gameStarted');
      
      // Also send updated player list with reset scores
      io.to(roomId).emit('playersUpdated', {
        players: rooms[roomId].players
      });
    }
  });

  // Update player scores
  socket.on('updateScores', ({ roomId, playerScores }) => {
    if (rooms[roomId]) {
      // Update player scores in room state
      for (const [playerId, score] of Object.entries(playerScores)) {
        const playerIndex = rooms[roomId].players.findIndex(p => p.id === playerId);
        if (playerIndex >= 0) {
          rooms[roomId].players[playerIndex].score = score;
        }
      }
      
      console.log('💯 Updated player scores:', {
        roomId,
        players: rooms[roomId].players.map(p => ({ name: p.name, score: p.score }))
      });
      
      // Broadcast updated player list with scores to all players in the room
      io.to(roomId).emit('playersUpdated', { players: rooms[roomId].players });
    }
  });

  // Handle guess submission
  socket.on('submitGuess', ({ roomId, playerId, guess, target }) => {
    if (rooms[roomId]) {
      console.log(`📍 Player ${playerId} submitted guess in room ${roomId}`, { guess, target });

      // Store the guess with distance and score
      if (!rooms[roomId].guesses) {
        rooms[roomId].guesses = {};
      }

      // Store the target location for this round (from the first guess that includes it)
      if (target && !rooms[roomId].currentTarget) {
        rooms[roomId].currentTarget = target;
      }

      // Use client-sent distance/score if available, otherwise calculate server-side
      let distance = guess.distance;
      let score = guess.score;
      const roundTarget = target || rooms[roomId].currentTarget;

      if ((distance === undefined || score === undefined) && roundTarget) {
        distance = calculateDistance(
          { lat: guess.lat, lng: guess.lng },
          roundTarget
        );
        score = calculateScore(distance);
      }

      // Store the complete guess data
      rooms[roomId].guesses[playerId] = {
        lat: guess.lat,
        lng: guess.lng,
        distance: distance || 0,
        score: score || 0
      };

      // Update player score on the server
      const playerIndex = rooms[roomId].players.findIndex(p => p.id === playerId);
      if (playerIndex !== -1) {
        rooms[roomId].players[playerIndex].score = (rooms[roomId].players[playerIndex].score || 0) + (score || 0);
        rooms[roomId].players[playerIndex].roundScore = score || 0;
        rooms[roomId].players[playerIndex].distanceToTarget = distance || 0;
      }

      // Check if all players have guessed
      const allPlayersGuessed = rooms[roomId].players.every(player =>
        rooms[roomId].guesses[player.id]
      );

      if (allPlayersGuessed) {
        console.log('🎯 All players have guessed, broadcasting results...');

        // Broadcast round completion with server-authoritative scores
        io.to(roomId).emit('roundComplete', {
          guesses: rooms[roomId].guesses,
          players: rooms[roomId].players
        });

        // Clear guesses and currentTarget for next round
        rooms[roomId].guesses = {};
        rooms[roomId].currentTarget = null;
      } else {
        // Broadcast the current guesses to keep all players in sync
        io.to(roomId).emit('guessSubmitted', {
          players: rooms[roomId].players,
          guesses: rooms[roomId].guesses
        });
      }
    }
  });

  // Handle next round
  socket.on('nextRound', ({ roomId }) => {
    if (rooms[roomId]) {
      // Reset guesses for next round
      rooms[roomId].guesses = {};
      
      // Increment round counter
      if (!rooms[roomId].currentRound) {
        rooms[roomId].currentRound = 0;
      }
      rooms[roomId].currentRound++;
      
      // Check if game is complete
      const isGameComplete = rooms[roomId].currentRound >= rooms[roomId].totalRounds;
      
      if (isGameComplete) {
        console.log('🏁 Game completed in room:', roomId);
        // Send final scores to all players
        io.to(roomId).emit('gameComplete', {
          players: rooms[roomId].players
        });
      } else {
        console.log(`🔄 Moving to next round in room ${roomId} (${rooms[roomId].currentRound}/${rooms[roomId].totalRounds})`);
        io.to(roomId).emit('roundAdvanced');
      }
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const { roomId, playerId, playerName } = socket.data || {};
    console.log('👋 User disconnected:', {
      socketId: socket.id,
      roomId,
      playerId,
      playerName
    });
    
    if (roomId && rooms[roomId]) {
      rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== playerId);
      
      console.log('🔄 Room status after disconnect:', {
        roomId,
        remainingPlayers: rooms[roomId].players.length
      });
      
      if (rooms[roomId].players.length === 0) {
        delete rooms[roomId];
        console.log('🗑️ Room deleted (empty):', roomId);
      } else {
        // If host left, assign a new host
        const hasHost = rooms[roomId].players.some(p => p.isHost);
        if (!hasHost && rooms[roomId].players.length > 0) {
          rooms[roomId].players[0].isHost = true;
          console.log('👑 New host assigned:', {
            roomId,
            newHost: rooms[roomId].players[0].name
          });
        }
        
        // Notify remaining players
        io.to(roomId).emit('playersUpdated', { players: rooms[roomId].players });
      }
    }
  });
});

// Add error handling middleware
io.engine.on("connection_error", (err) => {
  console.log('🔴 Socket.IO connection error:', {
    req: err.req,      // the request object
    code: err.code,    // the error code, for example 1
    message: err.message, // the error message, for example "Session ID unknown"
    context: err.context // some additional error context
  });
});

// For Vercel serverless environment, we need to check if the code is running in a serverless function
if (process.env.VERCEL) {
  // In Vercel, export the app instead of starting the server
  module.exports = app;
} else {
  // Start the server normally in development or on Render
  const serverPort = process.env.PORT || 3001;
  server.listen(serverPort, () => {
  console.log(`
🎮 Virtual Spot Scout Server
-----------------------------
✅ Server is running on port ${serverPort}
🌐 Visit http://localhost:${serverPort} to verify server is running
📡 WebSocket server is ready
🔒 CORS is configured for allowed origins
  `);
}); 
} 