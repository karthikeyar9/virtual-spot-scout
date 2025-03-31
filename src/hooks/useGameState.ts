import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getRandomLocations } from '@/utils/locations';

export interface Player {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  isReady: boolean;
  roundScore?: number;
  distanceToTarget?: number;
}

export interface RoundGuess {
  playerId: string;
  location: { lat: number; lng: number };
  score: number;
  distance: number;
}

export interface Round {
  target: {
    lat: number;
    lng: number;
  };
  guesses: RoundGuess[];
  isComplete: boolean;
}

export interface GameState {
  players: Player[];
  rounds: Round[];
  currentRound: number;
  hasStarted: boolean;
  isActive: boolean;
  timeLimit: number;
}

export const useGameState = (roomId: string | undefined, totalRounds: number = 5, timeLimit: number = 60) => {
  const [gameState, setGameState] = useState<GameState>({
    players: [],
    rounds: getRandomLocations(totalRounds).map(location => ({
      target: location,
      guesses: [],
      isComplete: false
    })),
    currentRound: 0,
    hasStarted: false,
    isActive: false,
    timeLimit
  });

  const addPlayer = useCallback((name: string, isHost: boolean = false) => {
    const playerId = uuidv4();
    setGameState(prev => ({
      ...prev,
      players: [...prev.players, { 
        id: playerId, 
        name, 
        score: 0, 
        isHost,
        isReady: isHost
      }]
    }));
    return playerId;
  }, []);

  const updatePlayerReadyStatus = useCallback((playerId: string, isReady: boolean) => {
    setGameState(prev => ({
      ...prev,
      players: prev.players.map(player => 
        player.id === playerId ? { ...player, isReady } : player
      )
    }));
  }, []);

  const startGame = useCallback(() => {
    setGameState(prev => {
      // Make sure we have valid rounds data
      const rounds = prev.rounds.length > 0 ? prev.rounds : getRandomLocations(totalRounds).map(location => ({
        target: location,
        guesses: [],
        isComplete: false
      }));

      return {
        ...prev,
        hasStarted: true,
        isActive: true,
        rounds
      };
    });
  }, [totalRounds]);

  const submitGuess = useCallback((playerId: string, location: { lat: number; lng: number }) => {
    setGameState(prev => {
      if (prev.currentRound >= prev.rounds.length) return prev; // Avoid index out of bounds

      const currentRound = prev.rounds[prev.currentRound];
      const target = currentRound.target;
      
      const distance = calculateDistance(target, location);
      const score = calculateScore(distance);

      // Add guess with score and distance to current round
      const updatedRounds = [...prev.rounds];
      const roundGuesses = [...currentRound.guesses, { playerId, location, score, distance }];
      updatedRounds[prev.currentRound] = {
        ...currentRound,
        guesses: roundGuesses,
        // Mark round complete if all players have guessed
        isComplete: roundGuesses.length === prev.players.length 
      };

      // Update player's TOTAL score
      const updatedPlayers = prev.players.map(player => 
        player.id === playerId 
          ? { ...player, score: player.score + score } // Update total score
          : player
      );

      return {
        ...prev,
        rounds: updatedRounds,
        players: updatedPlayers
      };
    });
  }, []);

  const nextRound = useCallback(() => {
    setGameState(prev => {
      const nextRoundIndex = prev.currentRound + 1;
      const isGameComplete = nextRoundIndex >= prev.rounds.length;

      return {
        ...prev,
        currentRound: nextRoundIndex,
        isActive: !isGameComplete,
        // Reset temporary round-specific player data (important for the OLD approach, safe to keep for now)
        players: prev.players.map(p => ({ ...p, roundScore: undefined, distanceToTarget: undefined }))
      };
    });
  }, []);

  const resetGame = useCallback(() => {
    setGameState(prev => ({
      ...prev,
      rounds: getRandomLocations(totalRounds).map(location => ({
        target: location,
        guesses: [],
        isComplete: false
      })),
      currentRound: 0,
      hasStarted: false,
      isActive: false,
      players: prev.players.map(player => ({ ...player, score: 0, isReady: false }))
    }));
  }, [totalRounds]);

  return {
    gameState,
    addPlayer,
    updatePlayerReadyStatus,
    startGame,
    submitGuess,
    nextRound,
    resetGame
  };
};

// Helper functions
function calculateDistance(point1: { lat: number; lng: number }, point2: { lat: number; lng: number }): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(point2.lat - point1.lat);
  const dLon = toRad(point2.lng - point1.lng);
  const lat1 = toRad(point1.lat);
  const lat2 = toRad(point2.lat);

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function toRad(degrees: number): number {
  return degrees * Math.PI / 180;
}

function calculateScore(distance: number): number {
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
