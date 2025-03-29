
import { useState, useEffect } from "react";

// Types
export type Player = {
  id: string;
  name: string;
  score: number;
  guessLocation?: {
    lat: number;
    lng: number;
  };
  distanceToTarget?: number;
  roundScore?: number;
};

export type GameLocation = {
  city: string;
  country: string;
  position: {
    lat: number;
    lng: number;
  };
  panoId?: string;
};

export type GameRound = {
  location: GameLocation;
  timeLimit: number;
  timeRemaining: number;
  isComplete: boolean;
};

export type GameState = {
  roomId: string;
  players: Player[];
  currentRound: number;
  totalRounds: number;
  rounds: GameRound[];
  isActive: boolean;
  isComplete: boolean;
};

// Sample locations data (in a real app, this would come from a backend)
const sampleLocations: GameLocation[] = [
  {
    city: "Paris",
    country: "France",
    position: { lat: 48.856614, lng: 2.352222 },
    panoId: "FWxL6MaEy5sAAAQZLDwF7A"
  },
  {
    city: "Tokyo",
    country: "Japan",
    position: { lat: 35.689487, lng: 139.691706 },
    panoId: "dXMtRVRYdHlTMFVBQUFBQUFBQUFBQQ"
  },
  {
    city: "New York",
    country: "USA",
    position: { lat: 40.712776, lng: -74.005974 },
    panoId: "TFFkd1pvRWFjVlBvQUFBQUFBQUFBQQ"
  },
  {
    city: "London",
    country: "UK",
    position: { lat: 51.507351, lng: -0.127758 },
    panoId: "LHV1SlVTRHpaQVJVQUFBQUFBQUFBQQ"
  },
  {
    city: "Sydney",
    country: "Australia",
    position: { lat: -33.868820, lng: 151.209296 },
    panoId: "NnpUWHhXczVnNmhZQUFBQUFBQUFBQQ"
  }
];

// Helper to generate random locations
const getRandomLocations = (count: number): GameLocation[] => {
  const shuffled = [...sampleLocations].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
};

// Calculate distance between two points in km using Haversine formula
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Score calculation - max 5000 points, decreasing with distance
export const calculateScore = (distanceInKm: number): number => {
  if (distanceInKm < 1) return 5000;
  if (distanceInKm > 5000) return 0;
  
  return Math.round(5000 - (distanceInKm / 5000) * 5000);
};

export const useGameState = (
  initialRoomId: string = "",
  totalRounds: number = 5,
  timeLimit: number = 60
) => {
  const [gameState, setGameState] = useState<GameState>({
    roomId: initialRoomId || `room-${Math.floor(Math.random() * 10000)}`,
    players: [],
    currentRound: 0,
    totalRounds,
    rounds: [],
    isActive: false,
    isComplete: false,
  });

  // Initialize game
  useEffect(() => {
    const randomLocations = getRandomLocations(totalRounds);
    const initialRounds: GameRound[] = randomLocations.map((location) => ({
      location,
      timeLimit,
      timeRemaining: timeLimit,
      isComplete: false,
    }));

    setGameState((prev) => ({
      ...prev,
      rounds: initialRounds,
    }));
  }, [totalRounds, timeLimit]);

  // Timer effect for active rounds
  useEffect(() => {
    let timer: NodeJS.Timeout;
    
    if (gameState.isActive && !gameState.isComplete && 
        gameState.currentRound < gameState.totalRounds &&
        !gameState.rounds[gameState.currentRound]?.isComplete) {
      
      timer = setInterval(() => {
        setGameState((prev) => {
          const rounds = [...prev.rounds];
          const currentRound = rounds[prev.currentRound];
          
          if (currentRound.timeRemaining <= 0) {
            clearInterval(timer);
            rounds[prev.currentRound] = {
              ...currentRound,
              isComplete: true,
            };
            return { ...prev, rounds };
          }
          
          rounds[prev.currentRound] = {
            ...currentRound,
            timeRemaining: currentRound.timeRemaining - 1,
          };
          
          return { ...prev, rounds };
        });
      }, 1000);
    }

    return () => clearInterval(timer);
  }, [gameState.isActive, gameState.currentRound, gameState.isComplete, gameState.totalRounds, gameState.rounds]);

  // Add a player to the game
  const addPlayer = (name: string) => {
    const playerId = `player-${Date.now()}`;
    
    setGameState((prev) => ({
      ...prev,
      players: [
        ...prev.players,
        {
          id: playerId,
          name,
          score: 0,
        },
      ],
    }));
    
    return playerId;
  };

  // Start the game
  const startGame = () => {
    setGameState((prev) => ({
      ...prev,
      isActive: true,
      currentRound: 0,
    }));
  };

  // Submit a guess for a player
  const submitGuess = (playerId: string, lat: number, lng: number) => {
    setGameState((prev) => {
      const players = [...prev.players];
      const playerIndex = players.findIndex((p) => p.id === playerId);
      
      if (playerIndex === -1) return prev;
      
      const currentLocation = prev.rounds[prev.currentRound].location.position;
      const distance = calculateDistance(
        currentLocation.lat,
        currentLocation.lng,
        lat,
        lng
      );
      const roundScore = calculateScore(distance);
      
      players[playerIndex] = {
        ...players[playerIndex],
        guessLocation: { lat, lng },
        distanceToTarget: distance,
        roundScore,
        score: players[playerIndex].score + roundScore,
      };
      
      // Check if all players have submitted a guess
      const allPlayersGuessed = players.every((p) => p.guessLocation);
      const rounds = [...prev.rounds];
      
      if (allPlayersGuessed) {
        rounds[prev.currentRound] = {
          ...rounds[prev.currentRound],
          isComplete: true,
        };
      }
      
      return { ...prev, players, rounds };
    });
  };

  // Advance to the next round
  const nextRound = () => {
    setGameState((prev) => {
      if (prev.currentRound >= prev.totalRounds - 1) {
        return { ...prev, isComplete: true };
      }
      
      // Reset player guesses for the new round
      const players = prev.players.map((player) => ({
        ...player,
        guessLocation: undefined,
        distanceToTarget: undefined,
        roundScore: undefined,
      }));
      
      return {
        ...prev,
        currentRound: prev.currentRound + 1,
        players,
      };
    });
  };

  // Reset the game
  const resetGame = () => {
    const randomLocations = getRandomLocations(totalRounds);
    const initialRounds: GameRound[] = randomLocations.map((location) => ({
      location,
      timeLimit,
      timeRemaining: timeLimit,
      isComplete: false,
    }));

    setGameState({
      roomId: `room-${Math.floor(Math.random() * 10000)}`,
      players: [],
      currentRound: 0,
      totalRounds,
      rounds: initialRounds,
      isActive: false,
      isComplete: false,
    });
  };

  return {
    gameState,
    addPlayer,
    startGame,
    submitGuess,
    nextRound,
    resetGame,
  };
};
