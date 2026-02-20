import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSocket } from "@/hooks/useSocket";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useJsApiLoader } from '@react-google-maps/api';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import StreetView from "./StreetView";
import { GuessMap } from "./GuessMap";
import Timer from "@/components/Timer";
import PlayerList from "@/components/PlayerList";
import ResultsDisplay from "./ResultsDisplay";
import { useCityGuesserState } from "./useCityGuesserState";
import { GameComponentProps } from "@/games/types";

const GOOGLE_MAPS_LIBRARIES: ("places" | "geometry")[] = ["places", "geometry"];

const CityGuesserGame: React.FC<GameComponentProps> = ({
  roomId,
  playerId,
  players,
  isHost,
  timeLimit,
  rounds: totalRounds,
  onGameComplete,
  setPlayers,
  gameData,
}) => {
  const { toast } = useToast();
  const { socket, isConnected } = useSocket();

  const {
    rounds: gameRounds,
    currentRound,
    currentRoundIndex,
    isActive,
    startGame,
    nextRound,
    resetGame,
    skipToBackupLocation,
  } = useCityGuesserState(totalRounds, gameData);

  const [hasGuessed, setHasGuessed] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showFinalResults, setShowFinalResults] = useState(false);
  const [tempGuessLocation, setTempGuessLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(timeLimit);
  const [mapCenter, setMapCenter] = useState({ lat: 0, lng: 0 });

  const mapsApiConfig = useMemo(() => ({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    libraries: GOOGLE_MAPS_LIBRARIES,
    version: "weekly"
  }), []);

  const { isLoaded: isMapApiLoaded, loadError: mapApiLoadError } = useJsApiLoader(mapsApiConfig);

  // Start game on mount
  useEffect(() => {
    startGame();
    setIsTimerRunning(true);
  }, [startGame]);

  const calculateScore = (distanceInKm: number): number => {
    if (distanceInKm < 1) return 5000;
    if (distanceInKm < 5) return 4000;
    if (distanceInKm < 10) return 3000;
    if (distanceInKm < 50) return 2000;
    if (distanceInKm < 100) return 1000;
    if (distanceInKm < 500) return 500;
    if (distanceInKm < 1000) return 250;
    if (distanceInKm < 5000) return 100;
    if (distanceInKm < 10000) return 50;
    return 0;
  };

  // Handle guess submission
  const handleGuessSubmit = useCallback(() => {
    if (!tempGuessLocation || !socket || !roomId || !playerId || !currentRound?.target) return;

    const guess = {
      lat: tempGuessLocation.lat,
      lng: tempGuessLocation.lng,
      timestamp: Date.now()
    };

    const distance = google.maps.geometry.spherical.computeDistanceBetween(
      new google.maps.LatLng(guess.lat, guess.lng),
      new google.maps.LatLng(currentRound.target.lat, currentRound.target.lng)
    ) / 1000;

    const score = calculateScore(distance);

    setHasGuessed(true);
    setIsTimerRunning(false);

    const guessData = { ...guess, distance, score };

    const updatedPlayers = players.map(player => {
      if (player.id === playerId) {
        return {
          ...player,
          guessLocation: { lat: guessData.lat, lng: guessData.lng },
          distanceToTarget: distance,
          roundScore: score
        };
      }
      return player;
    });
    setPlayers(updatedPlayers);

    socket.emit('submitGuess', {
      roomId,
      playerId,
      guess: guessData,
      target: currentRound.target
    });
  }, [tempGuessLocation, socket, roomId, playerId, currentRound?.target, players, setPlayers]);

  // Socket event listeners for game-specific events
  useEffect(() => {
    if (!socket || !isConnected || !roomId) return;

    const handleGuessSubmitted = ({ players: updatedPlayers, guesses }: any) => {
      const playersWithGuesses = updatedPlayers.map((player: any) => {
        const playerGuess = guesses[player.id];
        if (playerGuess) {
          return {
            ...player,
            guessLocation: { lat: playerGuess.lat, lng: playerGuess.lng },
            distanceToTarget: playerGuess.distance,
            roundScore: playerGuess.score
          };
        }
        return player;
      });
      setPlayers(playersWithGuesses);
    };

    const handleRoundComplete = ({ guesses, players: updatedPlayers }: any) => {
      if (!guesses) return;
      const playersWithGuesses = updatedPlayers.map((player: any) => {
        const playerGuess = guesses[player.id];
        if (!playerGuess) return player;
        return {
          ...player,
          guessLocation: { lat: playerGuess.lat, lng: playerGuess.lng },
          roundScore: playerGuess.score,
          distanceToTarget: playerGuess.distance,
          score: player.score
        };
      });
      setPlayers(playersWithGuesses);
      setShowResults(true);
      setIsTimerRunning(false);
    };

    const handleRoundAdvanced = () => {
      // Advance local round index so all players move to the next location
      nextRound();
      setHasGuessed(false);
      setTempGuessLocation(null);
      setShowResults(false);
      setIsTimerRunning(true);
    };

    const handleGameCompleteEvent = ({ players: finalPlayers }: any) => {
      setPlayers(finalPlayers);
      setShowFinalResults(true);
    };

    socket.on('guessSubmitted', handleGuessSubmitted);
    socket.on('roundComplete', handleRoundComplete);
    socket.on('roundAdvanced', handleRoundAdvanced);
    socket.on('gameComplete', handleGameCompleteEvent);

    return () => {
      socket.off('guessSubmitted', handleGuessSubmitted);
      socket.off('roundComplete', handleRoundComplete);
      socket.off('roundAdvanced', handleRoundAdvanced);
      socket.off('gameComplete', handleGameCompleteEvent);
    };
  }, [socket, isConnected, roomId, setPlayers, nextRound]);

  const handleTimeUpdate = useCallback((time: number) => {
    setTimeRemaining(time);
  }, []);

  const handleNextRound = useCallback(() => {
    if (!socket || !roomId) return;
    // Only emit to server — the roundAdvanced event will advance all clients (including host)
    socket.emit('nextRound', { roomId, rounds: gameRounds.length });
  }, [socket, roomId, gameRounds.length]);

  const handlePlayAgain = useCallback(() => {
    setShowFinalResults(false);
    resetGame();
    onGameComplete();
  }, [resetGame, onGameComplete]);

  // Timer management
  useEffect(() => {
    if (isActive && !hasGuessed && !showResults) {
      setTimeRemaining(timeLimit);
      setIsTimerRunning(true);
    } else {
      setIsTimerRunning(false);
    }
  }, [isActive, hasGuessed, showResults, timeLimit, currentRoundIndex]);

  const handleTimerComplete = useCallback(() => {
    if (hasGuessed || showResults) return;
    if (tempGuessLocation) {
      handleGuessSubmit();
    } else if (socket && roomId && playerId && currentRound?.target) {
      setHasGuessed(true);
      setIsTimerRunning(false);
      socket.emit('submitGuess', {
        roomId,
        playerId,
        guess: { lat: 0, lng: 0, distance: 99999, score: 0 },
        target: currentRound.target
      });
      const updatedPlayers = players.map(player => {
        if (player.id === playerId) {
          return { ...player, roundScore: 0, distanceToTarget: 99999 };
        }
        return player;
      });
      setPlayers(updatedPlayers);
    }
  }, [hasGuessed, showResults, tempGuessLocation, handleGuessSubmit, socket, roomId, playerId, currentRound?.target, players, setPlayers]);

  const handleStreetViewError = useCallback((error: Error) => {
    if (error.message === "SKIP_TO_NEXT_LOCATION") {
      const success = skipToBackupLocation(currentRoundIndex);
      if (success) {
        toast({ title: "Location Changed", description: "Trying an alternative location" });
      } else {
        toast({ title: "Location Skipped", description: "Moving to the next round" });
        setShowResults(false);
        setHasGuessed(false);
        setTempGuessLocation(null);
        nextRound();
        if (socket && isConnected && roomId) {
          socket.emit('nextRound', { roomId, rounds: gameRounds.length });
        }
      }
    }
  }, [nextRound, socket, isConnected, roomId, gameRounds.length, toast, skipToBackupLocation, currentRoundIndex]);

  const streetViewProps = useMemo(() => ({
    position: currentRound?.target,
    onLoad: () => {},
    isLoaded: isMapApiLoaded,
    loadError: mapApiLoadError,
    onError: handleStreetViewError,
    className: "h-full w-full"
  }), [currentRound?.target, isMapApiLoaded, mapApiLoadError, handleStreetViewError]);

  if (mapApiLoadError) {
    return (
      <div className="container mx-auto p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Map API Load Error</AlertTitle>
          <AlertDescription>Failed to load Google Maps. Check your API key and network.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!isMapApiLoaded) {
    return (
      <div className="flex items-center justify-center flex-1">
        <p>Loading Map Essentials...</p>
      </div>
    );
  }

  const renderResultsDisplay = () => {
    if (!showResults || !currentRound?.target) return null;

    const validGuesses = players
      .filter(p => p.guessLocation && typeof p.distanceToTarget === 'number' && typeof p.roundScore === 'number')
      .map(player => ({
        playerId: player.id,
        location: player.guessLocation!,
        score: player.roundScore!,
        distance: player.distanceToTarget!
      }));

    return (
      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Round {currentRoundIndex + 1} Results</DialogTitle>
          </DialogHeader>
          <ResultsDisplay
            location={currentRound.target}
            players={players}
            guesses={validGuesses}
            onNextRound={handleNextRound}
            isLastRound={currentRoundIndex >= gameRounds.length - 1}
          />
        </DialogContent>
      </Dialog>
    );
  };

  return (
    <div className="container mx-auto p-4 flex flex-col flex-1 space-y-4">
      <div className="flex justify-end items-center flex-shrink-0">
        <div className="flex items-center gap-4">
          <Timer
            key={`timer-${currentRoundIndex}-${timeLimit}`}
            duration={timeLimit}
            isRunning={isTimerRunning}
            onComplete={handleTimerComplete}
            onTimeUpdate={handleTimeUpdate}
            className="min-w-[200px]"
          />
          <PlayerList players={players} currentRound={currentRoundIndex} />
        </div>
      </div>

      <div className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="md:col-span-1 md:row-span-2 order-1 flex flex-col">
          <CardContent className="p-0 flex-grow min-h-[40vh] md:min-h-[60vh] relative">
            {currentRound?.target ? (
              <div className="absolute inset-0">
                <StreetView {...streetViewProps} />
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-gray-500">Waiting for location...</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-1 md:row-span-2 order-2 flex flex-col">
          <GuessMap
            onLocationSelect={setTempGuessLocation}
            selectedLocation={tempGuessLocation}
            disabled={hasGuessed || showResults || !isActive}
            onSubmitGuess={handleGuessSubmit}
            isRevealed={showResults}
            actualLocation={currentRound?.target}
            className="flex-grow min-h-[40vh] md:min-h-0"
            isLoaded={isMapApiLoaded}
            loadError={mapApiLoadError}
            onCenterChange={setMapCenter}
          />
        </Card>

        {renderResultsDisplay()}

        <Dialog open={showFinalResults} onOpenChange={setShowFinalResults}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Game Complete!</DialogTitle>
              <DialogDescription>Here are the final results</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {players
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .map((player, index) => (
                  <div
                    key={player.id}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-md",
                      index === 0 ? "bg-yellow-100 border border-yellow-300" : "bg-secondary/80"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold w-5 text-center">{index + 1}.</span>
                      <span>{player.name}</span>
                      {index === 0 && (
                        <Badge variant="outline" className="border-yellow-600 text-yellow-700">Winner!</Badge>
                      )}
                    </div>
                    <span className="font-semibold">{player.score ? player.score.toLocaleString() : 0} points</span>
                  </div>
                ))}
            </div>
            <DialogFooter>
              <Button onClick={handlePlayAgain}>Play Again</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default CityGuesserGame;
