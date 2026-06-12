// City Guesser game handler

// Locations data (same as frontend)
const streetViewLocations = [
  { lat: 34.134117, lng: -118.321495 },
  { lat: 38.889805, lng: -77.009056 },
  { lat: 38.889484, lng: -77.035279 },
  { lat: 25.761681, lng: -80.191788 },
  { lat: 36.169941, lng: -115.139832 },
  { lat: 44.427963, lng: -110.588455 },
  { lat: 35.360556, lng: -111.411667 },
  { lat: 47.620506, lng: -122.349277 },
  { lat: 39.949610, lng: -75.150282 },
  { lat: 41.878113, lng: -87.629799 },
  { lat: 29.760427, lng: -95.369804 },
  { lat: 41.902784, lng: 12.496366 },
  { lat: 55.676098, lng: 12.568337 },
  { lat: 48.135125, lng: 11.581981 },
  { lat: 50.075538, lng: 14.437800 },
  { lat: 59.329323, lng: 18.068581 },
  { lat: 41.385064, lng: 2.173404 },
  { lat: 52.367573, lng: 4.904139 },
  { lat: 47.497912, lng: 19.040235 },
  { lat: 35.689487, lng: 139.691711 },
  { lat: -33.868820, lng: 151.209290 },
  { lat: 22.396428, lng: 114.109497 },
  { lat: 1.352083, lng: 103.819836 },
  { lat: 37.566536, lng: 126.977966 },
  { lat: 13.756331, lng: 100.501762 },
  { lat: -22.906847, lng: -43.172896 },
  { lat: 19.432608, lng: -99.133209 },
  { lat: -13.163136, lng: -72.544963 },
  { lat: 37.971532, lng: 23.726731 },
  { lat: -34.603722, lng: -58.381592 },
  { lat: 25.197197, lng: 55.274376 },
  { lat: 64.135482, lng: -21.895412 },
  { lat: 39.904202, lng: 116.407394 },
];

const reliableLocations = [
  { lat: 40.755603, lng: -73.984931 },
  { lat: 34.050536, lng: -118.249851 },
  { lat: 41.878440, lng: -87.629976 },
  { lat: 37.786695, lng: -122.404849 },
  { lat: 29.760118, lng: -95.369728 },
  { lat: 33.760142, lng: -84.390363 },
  { lat: 25.773874, lng: -80.193291 },
  { lat: 32.781078, lng: -96.797221 },
  { lat: 39.952464, lng: -75.164106 },
  { lat: 47.605237, lng: -122.330833 },
  { lat: 48.856663, lng: 2.351556 },
  { lat: 51.507322, lng: -0.127647 },
  { lat: 41.890209, lng: 12.492231 },
  { lat: 52.520008, lng: 13.404954 },
  { lat: 40.416705, lng: -3.703582 },
  { lat: 48.208727, lng: 16.372356 },
  { lat: 52.372166, lng: 4.891565 },
  { lat: 41.385063, lng: 2.173404 },
  { lat: 59.329323, lng: 18.068581 },
  { lat: 50.075539, lng: 14.437800 },
  { lat: 21.281624, lng: -157.837222 },
  { lat: 36.115643, lng: -115.172829 },
  { lat: 35.446404, lng: 139.642538 },
  { lat: -33.856784, lng: 151.215297 },
];

function shuffle(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getRandomLocations(count) {
  const combined = [...reliableLocations, ...streetViewLocations];
  const unique = [...new Map(combined.map(item => [JSON.stringify(item), item])).values()];
  return shuffle(unique).slice(0, count);
}

function calculateDistance(point1, point2) {
  const R = 6371;
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

function onStart(room) {
  const totalRounds = room.totalRounds || 5;
  // Generate locations server-side so all players get the same ones
  const locations = getRandomLocations(totalRounds + 5);
  room.gameState = {
    locations: locations.slice(0, totalRounds),
    backupLocations: locations.slice(totalRounds),
    currentRoundIndex: 0,
    guesses: {},
    currentTarget: null,
  };
  // Set the first target
  room.gameState.currentTarget = room.gameState.locations[0];
}

// Data sent alongside gameStarted/roomState so (re)joining clients can render the round
function getGameData(room) {
  if (!room.gameState || !room.gameState.locations) return null;
  return {
    locations: room.gameState.locations,
    backupLocations: room.gameState.backupLocations,
  };
}

// Called by the shared nextRound event after room.currentRound is incremented
function onNextRound(room) {
  const gs = room.gameState;
  if (!gs) return;
  gs.currentRoundIndex = room.currentRound;
  gs.currentTarget = gs.locations[gs.currentRoundIndex] || null;
}

function registerEvents(socket, io, rooms) {
  // Client requests current round location (for late joiners or reconnects)
  socket.on('city-guesser:getLocation', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;
    const gs = room.gameState;
    const location = gs.locations[gs.currentRoundIndex];
    if (location) {
      socket.emit('city-guesser:roundLocation', {
        location,
        roundIndex: gs.currentRoundIndex,
        totalRounds: gs.locations.length,
      });
    }
  });

  socket.on('submitGuess', ({ roomId, playerId, guess, target }) => {
    if (!rooms[roomId]) return;
    const room = rooms[roomId];

    if (!room.gameState) {
      room.gameState = { guesses: {}, currentTarget: null, locations: [], backupLocations: [], currentRoundIndex: 0 };
    }

    // Use server-authoritative target location
    const roundTarget = room.gameState.currentTarget || target;

    let distance = guess.distance;
    let score = guess.score;

    if ((distance === undefined || score === undefined) && roundTarget) {
      distance = calculateDistance(
        { lat: guess.lat, lng: guess.lng },
        roundTarget
      );
      score = calculateScore(distance);
    }

    room.gameState.guesses[playerId] = {
      lat: guess.lat,
      lng: guess.lng,
      distance: distance || 0,
      score: score || 0
    };

    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
      room.players[playerIndex].score = (room.players[playerIndex].score || 0) + (score || 0);
      room.players[playerIndex].roundScore = score || 0;
      room.players[playerIndex].distanceToTarget = distance || 0;
    }

    const allPlayersGuessed = room.players.every(player =>
      room.gameState.guesses[player.id]
    );

    if (allPlayersGuessed) {
      io.to(roomId).emit('roundComplete', {
        guesses: room.gameState.guesses,
        players: room.players
      });
      room.gameState.guesses = {};
    } else {
      io.to(roomId).emit('guessSubmitted', {
        players: room.players,
        guesses: room.gameState.guesses
      });
    }
  });

  socket.on('updateScores', ({ roomId, playerScores }) => {
    if (!rooms[roomId]) return;
    for (const [playerId, score] of Object.entries(playerScores)) {
      const playerIndex = rooms[roomId].players.findIndex(p => p.id === playerId);
      if (playerIndex >= 0) {
        rooms[roomId].players[playerIndex].score = score;
      }
    }
    io.to(roomId).emit('playersUpdated', { players: rooms[roomId].players });
  });
}

module.exports = { onStart, registerEvents, getGameData, onNextRound };
