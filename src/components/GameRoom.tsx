import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { 
  Card, CardContent, CardFooter, CardHeader, CardTitle 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription 
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Globe, Send, Copy, Share2, AlertCircle } from "lucide-react";
import { useGameState } from "@/hooks/useGameState";
import { cn } from "@/lib/utils";
import StreetView from "./StreetView";
import GuessMap from "./GuessMap";
import Timer from "./Timer";
import PlayerList from "./PlayerList";
import ResultsDisplay from "./ResultsDisplay";
import GameLobby from "./GameLobby";
import { Badge } from "@/components/ui/badge";
import { useJsApiLoader } from '@react-google-maps/api';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const GameRoom = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const playerName = searchParams.get("name") || "Player";
  const isHost = searchParams.get("host") === "true";
  const rounds = parseInt(searchParams.get("rounds") || "5");
  const timeLimit = parseInt(searchParams.get("time") || "60");
  
  const {
    gameState,
    addPlayer,
    startGame,
    submitGuess,
    nextRound,
    resetGame,
    updatePlayerReadyStatus,
  } = useGameState(roomId, rounds, timeLimit);
  
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [hasGuessed, setHasGuessed] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showFinalResults, setShowFinalResults] = useState(false);
  const [tempGuessLocation, setTempGuessLocation] = useState<{lat: number, lng: number} | null>(null);
  const [pendingGuessLocation, setPendingGuessLocation] = useState<{lat: number, lng: number} | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  
  const {
    players,
    rounds: gameRounds,
    currentRound: currentRoundIndex,
    hasStarted,
    isActive,
    timeLimit: gameStateTimeLimit
  } = gameState;
  
  const currentRound = gameRounds[currentRoundIndex];
  
  const currentPlayer = playerId 
    ? players.find(p => p.id === playerId)
    : null;

  // Load Google Maps API here
  const { isLoaded: isMapApiLoaded, loadError: mapApiLoadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    libraries: ['places', 'geometry'], // Include ALL needed libraries
    version: "weekly"
  });

  // Initialize player
  useEffect(() => {
    if (!playerId) {
      const id = addPlayer(playerName, isHost);
      setPlayerId(id);
    }
  }, [playerId, playerName, isHost, addPlayer]);

  // Handle ready status
  const handleToggleReady = useCallback(() => {
    const newReadyStatus = !isReady;
    setIsReady(newReadyStatus);
    if (playerId) {
      console.log('Updating ready status:', playerId, newReadyStatus);
      updatePlayerReadyStatus(playerId, newReadyStatus);
    }
  }, [isReady, playerId, updatePlayerReadyStatus]);

  // Debug logging
  useEffect(() => {
    console.log('Game State:', {
      hasStarted,
      players,
      isHost,
      currentPlayer
    });
  }, [gameState, isHost, currentPlayer]);

  // Handle round completion
  useEffect(() => {
    if (currentRound?.isComplete && !showResults && isActive) {
      setShowResults(true);
    }
  }, [currentRound?.isComplete, showResults, isActive]);

  // Update the useEffect to start timer when game starts
  useEffect(() => {
    if (hasStarted && isActive && !hasGuessed) {
      setIsTimerRunning(true);
    } else {
      setIsTimerRunning(false);
    }
  }, [hasStarted, isActive, hasGuessed]);

  const handleGuessSubmit = useCallback(() => {
    if (playerId && tempGuessLocation) {
      submitGuess(playerId, tempGuessLocation);
      setHasGuessed(true);
    } else {
      console.warn("Attempted to submit guess without player ID or location");
    }
  }, [playerId, tempGuessLocation, submitGuess]);

  const handleNextRound = useCallback(() => {
    setShowResults(false);
    setHasGuessed(false);
    nextRound();
  }, [nextRound]);

  const handlePlayAgain = useCallback(() => {
    setShowFinalResults(false);
    resetGame();
  }, [resetGame]);

  // Render lobby if game hasn't started
  if (!hasStarted) {
    return (
      <GameLobby
        roomId={roomId || ''}
        players={players}
        isHost={isHost}
        currentPlayer={currentPlayer}
        onStartGame={() => {
          console.log('Starting game...');
          startGame();
        }}
        onToggleReady={handleToggleReady}
      />
    );
  }

  // Loading state for API
  if (mapApiLoadError) {
    return (
      <div className="container mx-auto p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Map API Load Error</AlertTitle>
          <AlertDescription>
            Failed to load Google Maps essentials. Check your API key, network connection, and browser console.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!isMapApiLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading Map Essentials...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="container mx-auto p-4 flex flex-col flex-1 space-y-4">
        <div className="flex justify-between items-center">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-4">
            <Timer
              duration={timeLimit}
              isRunning={isTimerRunning}
              onComplete={handleGuessSubmit}
            />
            <PlayerList 
              players={players} 
              currentRound={currentRoundIndex}
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 flex-grow">
          <Card className="md:col-span-1 md:row-span-2 order-1 md:order-1">
            <CardContent className="p-0 h-[60vh] md:h-full">
              <StreetView
                position={currentRound?.target}
                onLoad={() => console.log('Street view loaded')}
                isLoaded={isMapApiLoaded}
                loadError={mapApiLoadError}
              />
            </CardContent>
          </Card>

          <Card className="md:col-span-1 md:row-span-2 order-2 md:order-2 flex flex-col">
            <GuessMap
              onLocationSelect={setTempGuessLocation}
              selectedLocation={tempGuessLocation}
              disabled={hasGuessed || showResults || !isActive}
              onSubmitGuess={handleGuessSubmit}
              isRevealed={showResults}
              actualLocation={currentRound?.target}
              className="flex-grow"
              isLoaded={isMapApiLoaded}
              loadError={mapApiLoadError}
            />
          </Card>

          {showResults && currentRound && (
            <Dialog open={showResults} onOpenChange={setShowResults}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Round {currentRoundIndex + 1} Results</DialogTitle>
                </DialogHeader>
                <ResultsDisplay
                  location={currentRound.target}
                  players={players}
                  guesses={currentRound.guesses}
                  onNextRound={handleNextRound}
                  isLastRound={currentRoundIndex >= gameState.rounds.length - 1}
                />
              </DialogContent>
            </Dialog>
          )}

          {!isActive && hasStarted && (
            <Dialog open={!isActive} onOpenChange={() => {}}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Game Complete!</DialogTitle>
                  <DialogDescription>
                    Here are the final results
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {players
                    .sort((a, b) => b.score - a.score)
                    .map((player, index) => (
                      <div
                        key={player.id}
                        className="flex items-center justify-between p-4 bg-secondary rounded-lg"
                      >
                        <div className="flex items-center gap-2">
                          <span>{index + 1}.</span>
                          <span>{player.name}</span>
                          {index === 0 && (
                            <Badge variant="outline">Winner!</Badge>
                          )}
                        </div>
                        <span>{player.score} points</span>
                      </div>
                    ))}
                </div>
                <DialogFooter>
                  <Button onClick={handlePlayAgain}>
                    Play Again
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
    </div>
  );
};

export default GameRoom;
