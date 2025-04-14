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
import { ArrowLeft, Globe, Send, Copy, Share2, AlertCircle, User } from "lucide-react";
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
import { useSocket } from "@/hooks/useSocket";
import { v4 as uuidv4 } from 'uuid';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Navbar from './Navbar';

const GameRoom = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // Get player name from URL params or use default "Player"
  const urlPlayerName = searchParams.get("name");
  // Decode URL parameter in case it contains encoded spaces or special characters
  const decodedName = urlPlayerName ? decodeURIComponent(urlPlayerName) : "";
  const [playerName, setPlayerName] = useState<string>(decodedName || "");
  const [showNamePrompt, setShowNamePrompt] = useState<boolean>(!decodedName);
  
  const isHost = searchParams.get("host") === "true";
  const rounds = parseInt(searchParams.get("rounds") || "5");
  const timeLimit = parseInt(searchParams.get("time") || "60");
  // Use the playerId from URL if available (for direct links)
  const urlPlayerId = searchParams.get("playerId");
  
  const {
    gameState,
    addPlayer,
    startGame,
    submitGuess,
    nextRound,
    resetGame,
    updatePlayerReadyStatus,
    setPlayers,
    skipToBackupLocation
  } = useGameState(roomId, rounds, timeLimit);
  
  const [playerId, setPlayerId] = useState<string | null>(urlPlayerId);
  const [hasGuessed, setHasGuessed] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showFinalResults, setShowFinalResults] = useState(false);
  const [tempGuessLocation, setTempGuessLocation] = useState<{lat: number, lng: number} | null>(null);
  const [pendingGuessLocation, setPendingGuessLocation] = useState<{lat: number, lng: number} | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [tempName, setTempName] = useState<string>("");
  
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

  // Socket connection
  const { socket, isConnected, error: socketError } = useSocket();
  
  // Show connection error toast when socket connection fails
  useEffect(() => {
    if (socketError) {
      toast({
        title: "Connection Error",
        description: "Lost connection to the game server. Reconnecting...",
        variant: "destructive",
      });
    }
  }, [socketError, toast]);
  
  // Get room state when component mounts
  useEffect(() => {
    if (socket && isConnected && roomId) {
      // Request current room state
      socket.emit('getRoomState', { roomId });
      
      // Listen for room state response
      socket.on('roomState', (roomState) => {
        console.log('Received room state:', roomState);
        if (roomState.hasStarted) {
          startGame();
        }
      });
      
      return () => {
        socket.off('roomState');
      };
    }
  }, [socket, isConnected, roomId, startGame]);

  // Handle name submission
  const handleNameSubmit = useCallback(() => {
    if (tempName.trim()) {
      setPlayerName(tempName.trim());
      
      // Update URL with the new name
      const newParams = new URLSearchParams(searchParams);
      newParams.set("name", tempName.trim());
      setSearchParams(newParams);
      
      setShowNamePrompt(false);
      
      toast({
        title: "Welcome!",
        description: `You've joined as ${tempName.trim()}`,
        variant: "default",
      });
    } else {
      toast({
        title: "Name Required",
        description: "Please enter a name to continue",
        variant: "destructive",
      });
    }
  }, [tempName, searchParams, setSearchParams, toast]);

  // Initialize player and join room
  useEffect(() => {
    // Only proceed if we have a player name (either from URL or from the prompt)
    if (!playerName) return;
    
    // If we have a socket connection and either:
    // 1. No player ID yet, or
    // 2. We have saved player info from local storage
    // Then we should join the room
    if (socket && isConnected && roomId && (!playerId || gameState.savedPlayerInfo)) {
      console.log('🔄 Checking if we should join or rejoin the room');
      console.log('Current player name:', playerName);
      
      // If we have saved player info, attempt to rejoin with the same ID
      if (gameState.savedPlayerInfo) {
        const { playerName: savedName, playerId: savedId, isHost: savedIsHost } = gameState.savedPlayerInfo;
        console.log('🔄 Rejoining room with saved player info:', {
          roomId,
          playerName: savedName,
          playerId: savedId,
          isHost: savedIsHost
        });
        
        // Set the player ID in our state
        setPlayerId(savedId);
        
        // Add the player with the existing ID
        addPlayer(savedName, savedIsHost, savedId);
        
        // Join room via socket
        socket.emit('joinRoom', { 
          roomId, 
          playerName: savedName, 
          playerId: savedId,
          isHost: savedIsHost
        });
        
        // Request room state to sync with server
        socket.emit('getRoomState', { roomId });
      } 
      // If we don't have saved info but also don't have a playerId yet, join as a new player
      else if (!playerId && playerName) {
        // Generate a new player ID
        const newPlayerId = uuidv4();
        console.log('🆕 Joining room as a new player:', {
          roomId,
          playerName,
          playerId: newPlayerId,
          isHost
        });
        
        // Set the player ID in our state
        setPlayerId(newPlayerId);
        
        // Add the player locally with the correct name
        addPlayer(playerName, isHost, newPlayerId);
        
        // Join room via socket
        socket.emit('joinRoom', { 
          roomId, 
          playerName, 
          playerId: newPlayerId,
          isHost 
        });
        
        // Request room state
        socket.emit('getRoomState', { roomId });
      }
    }
  }, [
    playerId, 
    playerName, 
    isHost, 
    addPlayer, 
    socket, 
    isConnected, 
    roomId, 
    urlPlayerId, 
    gameState.savedPlayerInfo
  ]);

  // Listen for socket events
  useEffect(() => {
    if (socket && isConnected && roomId) {
      // Listen for player updates
      socket.on('playersUpdated', ({ players: serverPlayers }) => {
        console.log('Players updated:', serverPlayers);
        // Update local player list from server
        setPlayers(serverPlayers);
      });

      // Listen for game start
      socket.on('gameStarted', () => {
        console.log('Game started via socket');
        startGame();
      });

      // Listen for room state
      socket.on('roomState', (roomState) => {
        console.log('Received room state:', roomState);
        if (roomState.hasStarted) {
          startGame();
        }
        if (roomState.players) {
          setPlayers(roomState.players);
        }
      });

      // Listen for error messages from server
      socket.on('errorMessage', ({ message }) => {
        console.error('Server error:', message);
        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        });
      });

      // Listen for round completion from server
      socket.on('roundComplete', ({ guesses }) => {
        console.log('📊 Round completed! Showing results');
        console.log('All guesses:', guesses);
        setShowResults(true);
      });

      // Listen for round advancement
      socket.on('roundAdvanced', () => {
        console.log('🔄 Advancing to next round');
        setHasGuessed(false);
        setTempGuessLocation(null);
      });
      
      // Listen for game completion
      socket.on('gameComplete', ({ players: finalPlayers }) => {
        console.log('🏁 Game completed! Final results:', finalPlayers);
        // Use the players from the server for final results
        setPlayers(finalPlayers);
        // Show final results dialog
        setShowFinalResults(true);
      });

      // Clean up socket listeners on unmount
      return () => {
        socket.off('playersUpdated');
        socket.off('gameStarted');
        socket.off('roomState');
        socket.off('errorMessage');
        socket.off('roundComplete');
        socket.off('roundAdvanced');
        socket.off('gameComplete');
      };
    }
  }, [socket, isConnected, roomId, setPlayers, startGame, toast]);

  // Handle ready status
  const handleToggleReady = useCallback(() => {
    const newReadyStatus = !isReady;
    setIsReady(newReadyStatus);
    if (playerId && socket && isConnected && roomId) {
      console.log('Updating ready status:', playerId, newReadyStatus);
      updatePlayerReadyStatus(playerId, newReadyStatus);
      
      // Send ready status to socket server
      socket.emit('playerReady', { roomId, playerId, isReady: newReadyStatus });
    }
  }, [isReady, playerId, updatePlayerReadyStatus, socket, isConnected, roomId]);

  // Debug logging
  useEffect(() => {
    console.log('Game State:', {
      hasStarted,
      players,
      isHost,
      currentPlayer
    });
  }, [gameState, isHost, currentPlayer, hasStarted, players]);

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
      console.log('📝 Submitting guess:', {
        playerId,
        location: tempGuessLocation
      });
      submitGuess(playerId, tempGuessLocation);
      setHasGuessed(true);
      
      // Sync with server that player has guessed
      if (socket && isConnected && roomId) {
        socket.emit('playerGuessed', { 
          roomId, 
          playerId, 
          location: tempGuessLocation 
        });
      }
      
      // Force show results after a short delay if the round doesn't complete automatically
      setTimeout(() => {
        if (!showResults) {
          console.log('⏱️ Forcing results display after timeout');
          setShowResults(true);
        }
      }, 1000);
    } else {
      console.warn("Attempted to submit guess without player ID or location");
    }
  }, [playerId, tempGuessLocation, submitGuess, socket, isConnected, roomId, showResults]);

  const handleNextRound = useCallback(() => {
    setShowResults(false);
    setHasGuessed(false);
    setTempGuessLocation(null);
    
    // Sync player scores with server before advancing to the next round
    if (socket && isConnected && roomId) {
      const playerScores = {};
      players.forEach(player => {
        playerScores[player.id] = player.score || 0;
      });
      
      // Send player scores to server to sync
      socket.emit('updateScores', { 
        roomId,
        playerScores
      });
    }
    
    nextRound();

    // Notify server about round advancement
    if (socket && isConnected && roomId) {
      socket.emit('nextRound', { 
        roomId,
        rounds: gameRounds.length 
      });
    }
  }, [nextRound, socket, isConnected, roomId, players, gameRounds.length]);

  const handlePlayAgain = useCallback(() => {
    setShowFinalResults(false);
    resetGame();
  }, [resetGame]);

  // useEffect hook to show final results when game becomes inactive
  useEffect(() => {
    if (!isActive && hasStarted) {
      setShowFinalResults(true);
    }
  }, [isActive, hasStarted]);

  // In the GameRoom component, add the handleStreetViewError function

  const handleStreetViewError = useCallback((error: Error) => {
    console.error('StreetView error in GameRoom:', error.message);
    
    // If the error is to skip to the next location
    if (error.message === "SKIP_TO_NEXT_LOCATION") {
      // Try using a backup location first
      const success = skipToBackupLocation(currentRoundIndex);
      
      if (success) {
        toast({
          title: "Location Changed",
          description: "Trying an alternative location with better Street View coverage",
          variant: "default",
        });
      } else {
        // If no backup location is available, skip to the next round
        toast({
          title: "Location Skipped",
          description: "Moving to the next round due to Street View unavailability",
          variant: "default",
        });
        
        // Skip to the next round
        setShowResults(false);
        setHasGuessed(false);
        setTempGuessLocation(null);
        nextRound();
        
        // Notify server about round advancement
        if (socket && isConnected && roomId) {
          socket.emit('nextRound', { 
            roomId,
            rounds: gameRounds.length 
          });
        }
      }
    }
  }, [nextRound, socket, isConnected, roomId, gameRounds.length, toast, skipToBackupLocation, currentRoundIndex]);

  // Add a function to handle game restart
  const handleRestartGame = useCallback(() => {
    // Reset game
    resetGame();
    
    // Clear any active results displays
    setShowResults(false);
    setShowFinalResults(false);
    setHasGuessed(false);
    setTempGuessLocation(null);
    
    // Notify server about game restart if we're connected
    if (socket && isConnected && roomId) {
      socket.emit('startGame', { 
        roomId,
        rounds: rounds 
      });
    }

    toast({
      title: "Game Restarted",
      description: "Starting a new game with fresh locations",
    });
  }, [resetGame, socket, isConnected, roomId, rounds, toast]);

  // If we need to show the name prompt, show that first
  if (showNamePrompt) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar roomId={roomId} />
        <div className="flex items-center justify-center flex-1 bg-gradient-to-b from-gray-50 to-gray-100">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl text-center">Welcome to Room {roomId}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Enter your name to join</Label>
                <Input 
                  id="name" 
                  placeholder="Your name"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleNameSubmit();
                    }
                  }}
                  autoFocus
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full"
                onClick={handleNameSubmit}
              >
                <User className="mr-2 h-4 w-4" />
                Join Game
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

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
          
          // Notify socket server that the game has started
          if (socket && roomId) {
            socket.emit('startGame', { 
              roomId,
              rounds: rounds 
            });
          }
        }}
        onToggleReady={handleToggleReady}
      />
    );
  }

  // Loading state for API
  if (mapApiLoadError) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar roomId={roomId} />
        <div className="container mx-auto p-4 flex-1">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Map API Load Error</AlertTitle>
            <AlertDescription>
              Failed to load Google Maps essentials. Check your API key, network connection, and browser console.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (!isMapApiLoaded) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar roomId={roomId} />
        <div className="flex items-center justify-center flex-1">
          <p>Loading Map Essentials...</p>
        </div>
      </div>
    );
  }

  // Add this at the end where the return statements are
  // Add a "Return to Home" button in the lobby when no valid player exists
  if (!hasStarted && (!playerId || players.length === 0)) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar roomId={roomId} />
        <div className="flex flex-col items-center justify-center flex-1 p-4 bg-gradient-to-b from-gray-50 to-gray-100">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl">Game Lobby</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <Alert className="mb-6 bg-yellow-50">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Connection Issue</AlertTitle>
                <AlertDescription>
                  Unable to rejoin the game room. The game may have ended or there was a connection error.
                </AlertDescription>
              </Alert>
              <Button
                onClick={() => navigate('/')}
                className="w-full"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Return to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar onRestartGame={hasStarted ? handleRestartGame : undefined} roomId={roomId} />
      
      <div className="container mx-auto p-4 flex flex-col flex-1 space-y-4">
        <div className="flex justify-end items-center flex-shrink-0">
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

        <div className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="md:col-span-1 md:row-span-2 order-1 flex flex-col">
            <CardContent className="p-0 flex-grow min-h-[40vh] md:min-h-0">
              <StreetView
                position={currentRound?.target}
                onLoad={() => console.log('Street view loaded')}
                isLoaded={isMapApiLoaded}
                loadError={mapApiLoadError}
                onError={handleStreetViewError}
              />
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

          {hasStarted && (
            <Dialog open={showFinalResults} onOpenChange={setShowFinalResults}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Game Complete!</DialogTitle>
                  <DialogDescription>
                    Here are the final results
                  </DialogDescription>
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
