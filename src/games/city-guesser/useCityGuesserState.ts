import { useState, useCallback, useEffect, useRef } from 'react';

export interface RoundGuess {
  playerId: string;
  location: { lat: number; lng: number };
  score: number;
  distance: number;
}

export interface Round {
  target: { lat: number; lng: number };
  guesses: RoundGuess[];
  isComplete: boolean;
}

interface ServerLocations {
  locations?: { lat: number; lng: number }[];
  backupLocations?: { lat: number; lng: number }[];
}

export const useCityGuesserState = (totalRounds: number = 5, serverData?: ServerLocations) => {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [backupLocations, setBackupLocations] = useState<{ lat: number; lng: number }[]>([]);
  const hasInitializedRef = useRef(false);

  // Initialize or update rounds when server data arrives
  useEffect(() => {
    const locations = serverData?.locations;
    if (!locations || locations.length === 0) return;

    // Only initialize once from server data (avoid re-init on re-renders)
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    console.log('📍 useCityGuesserState: Initializing with server locations', locations.length);
    setRounds(
      locations.slice(0, totalRounds).map(location => ({
        target: location,
        guesses: [],
        isComplete: false,
      }))
    );
    setBackupLocations(serverData?.backupLocations || []);
  }, [serverData, totalRounds]);

  const currentRound = rounds[currentRoundIndex] ?? null;

  const startGame = useCallback(() => {
    setIsActive(true);
    setCurrentRoundIndex(0);
  }, []);

  const nextRound = useCallback(() => {
    const next = currentRoundIndex + 1;
    const isComplete = next >= rounds.length;
    setCurrentRoundIndex(next);
    setIsActive(!isComplete);
    return isComplete;
  }, [currentRoundIndex, rounds.length]);

  const resetGame = useCallback(() => {
    hasInitializedRef.current = false;
    setRounds([]);
    setCurrentRoundIndex(0);
    setIsActive(false);
  }, []);

  const skipToBackupLocation = useCallback((roundIndex: number) => {
    if (backupLocations.length === 0) return false;
    setRounds(prev => {
      const updated = [...prev];
      updated[roundIndex] = {
        ...updated[roundIndex],
        target: backupLocations[0],
        guesses: [],
      };
      return updated;
    });
    setBackupLocations(prev => prev.slice(1));
    return true;
  }, [backupLocations]);

  return {
    rounds,
    currentRound,
    currentRoundIndex,
    isActive,
    startGame,
    nextRound,
    resetGame,
    skipToBackupLocation,
  };
};
