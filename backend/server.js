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
  pingTimeout: 60000, // Time to wait for a ping response before considering the connection dead
  pingInterval: 25000, // How often to send a ping to check connection health
  connectTimeout: 10000, // Time to wait for a connection to be established
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
  pingTimeout: 60000,
  pingInterval: 25000,
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

  // Get room state
  socket.on('getRoomState', ({ roomId }) => {
    console.log('📋 Room state requested:', {
      socketId: socket.id,
      roomId,
      existingRoom: !!rooms[roomId]
    });
    
    // If room exists, send complete state
    // If not, send empty state
    const roomState = rooms[roomId] || { players: [], hasStarted: false };
    
    console.log('📤 Sending room state:', {
      roomId,
      hasStarted: roomState.hasStarted,
      playerCount: roomState.players.length
    });
    
    socket.emit('roomState', roomState);
  });

  // Join room
  socket.on('joinRoom', ({ roomId, playerName, playerId, isHost }) => {
    console.log('🚪 Join room request:', {
      socketId: socket.id,
      roomId,
      playerName,
      playerId,
      isHost
    });
    
    // Initialize room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = { 
        players: [],
        hasStarted: false,
        currentRound: 0,
        totalRounds: 5,
        guesses: {}
      };
      console.log('🆕 Created new room:', roomId);
    }

    // Store socket and player info
    socket.data = socket.data || {};
    socket.data.roomId = roomId;
    socket.data.playerName = playerName;
    socket.data.playerId = playerId;
    
    // Add player to room if not already there
    const playerExists = rooms[roomId].players.some(p => p.id === playerId);
    if (!playerExists) {
      rooms[roomId].players.push({ 
        id: playerId, 
        name: playerName, 
        isHost: isHost || false,
        isReady: isHost || false,
        score: 0 // Initialize score for new players
      });
      console.log('👤 Added new player to room:', {
        roomId,
        playerName,
        playerId,
        totalPlayers: rooms[roomId].players.length
      });
    } else {
      // Player exists - update their socket association and mark them as reconnected
      console.log('🔄 Player reconnected to room:', {
        roomId,
        playerName,
        playerId
      });
      
      // Update player properties if needed (keeping their score intact)
      const playerIndex = rooms[roomId].players.findIndex(p => p.id === playerId);
      if (playerIndex !== -1) {
        // Keep the player's existing score and host status
        const existingScore = rooms[roomId].players[playerIndex].score || 0;
        const existingIsHost = rooms[roomId].players[playerIndex].isHost;
        
        rooms[roomId].players[playerIndex] = {
          ...rooms[roomId].players[playerIndex],
          name: playerName, // Update name in case it changed
          isHost: isHost || existingIsHost
        };
        
        console.log('✏️ Updated player name:', {
          roomId,
          playerName,
          playerId
        });
      }
    }
    
    // Join the socket room
    socket.join(roomId);
    console.log('✅ Player joined room successfully:', {
      roomId,
      playerName,
      playerId,
      currentPlayers: rooms[roomId].players.length
    });
    
    // Send updated player list to everyone in the room
    io.to(roomId).emit('playersUpdated', { players: rooms[roomId].players });
    
    // If game has already started, notify the reconnected player
    if (rooms[roomId].hasStarted) {
      console.log('🎮 Notifying reconnected player about active game:', {
        roomId,
        playerId
      });
      socket.emit('gameStarted');
    }
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
      const allPlayersReady = rooms[roomId].players.every(player => player.isReady);
      
      if (!allPlayersReady) {
        console.log(`❌ Attempted to start game in room ${roomId} but not all players are ready`);
        socket.emit('errorMessage', { 
          message: 'Cannot start game until all players are ready' 
        });
        return;
      }
      
      rooms[roomId].hasStarted = true;
      rooms[roomId].currentRound = 0;
      rooms[roomId].totalRounds = rounds;
      rooms[roomId].guesses = {};
      
      console.log(`🎮 Game in room ${roomId} is starting with ${rounds} rounds`);
      io.to(roomId).emit('gameStarted');
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

  // Track player guesses
  socket.on('playerGuessed', ({ roomId, playerId, location }) => {
    console.log('🎯 Player submitted guess:', {
      roomId,
      playerId,
      location
    });
    
    if (rooms[roomId]) {
      // Track that this player has guessed in the current round
      if (!rooms[roomId].guesses) {
        rooms[roomId].guesses = {};
      }
      
      rooms[roomId].guesses[playerId] = location;
      
      // Check if all players have guessed
      const totalPlayers = rooms[roomId].players.length;
      const totalGuesses = Object.keys(rooms[roomId].guesses).length;
      
      console.log(`👥 Guesses received: ${totalGuesses}/${totalPlayers}`);
      
      // If all players have guessed, notify everyone
      if (totalGuesses >= totalPlayers) {
        console.log('✅ All players have guessed! Notifying room to show results');
        io.to(roomId).emit('roundComplete', { 
          guesses: rooms[roomId].guesses,
          roundNumber: rooms[roomId].currentRound || 0
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