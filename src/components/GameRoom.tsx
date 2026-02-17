import React, { useEffect, useState, useCallback, useMemo } from "react";
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
import { GuessMap } from "./GuessMap";
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

// Define libraries array outside component to prevent recreation
const GOOGLE_MAPS_LIBRARIES: ("places" | "geometry")[] = ["places", "geometry"];

const GameRoom = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // Add missing state variables
  const [timeRemaining, setTimeRemaining] = useState<number>(60);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({
    lat: 0,
    lng: 0
  });
  
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

  // Memoize the loader configuration
  const mapsApiConfig = useMemo(() => ({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    libraries: GOOGLE_MAPS_LIBRARIES,
    version: "weekly"
  }), []); // Empty dependency array since none of these values change

  // Load Google Maps API here
  const { isLoaded: isMapApiLoaded, loadError: mapApiLoadError } = useJsApiLoader(mapsApiConfig);

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
        if (roomState.players) {
          setPlayers(roomState.players);
        }
      });
      
      // Request room state immediately after connection
      socket.emit('getRoomState', { roomId });
      
      return () => {
        socket.off('roomState');
      };
    }
  }, [socket, isConnected, roomId, startGame, setPlayers]);

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
    // 2. We have saved player info
    // Then we should join the room
    if (socket && isConnected && roomId) {
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
        // Reset any existing game state
        setHasGuessed(false);
        setShowResults(false);
        setShowFinalResults(false);
        setTempGuessLocation(null);
        
        // Start the game for this player
        startGame();
        
        // Start the timer
        setIsTimerRunning(true);
        
        toast({
          title: "Game Started!",
          description: "The game has begun. Good luck!",
        });
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

      // Listen for score updates
      socket.on('scoresUpdated', ({ players: updatedPlayers, guesses }) => {
        console.log('📊 Scores updated:', { players: updatedPlayers, guesses });
        setPlayers(updatedPlayers);
      });

      // Listen for guess submissions
      socket.on('guessSubmitted', ({ players: updatedPlayers, guesses }) => {
        console.log('🎯 New guess submitted:', { players: updatedPlayers, guesses });
        
        // Update players with their guesses
        const playersWithGuesses = updatedPlayers.map(player => {
          const playerGuess = guesses[player.id];
          if (playerGuess) {
            return {
              ...player,
              guessLocation: {
                lat: playerGuess.lat,
                lng: playerGuess.lng
              },
              distanceToTarget: playerGuess.distance,
              roundScore: playerGuess.score
            };
          }
          return player;
        });
        
        setPlayers(playersWithGuesses);
      });

      // Listen for round completion from server
      socket.on('roundComplete', ({ guesses, players: updatedPlayers }) => {
        console.log('📊 Round completed! Showing results:', { guesses, players: updatedPlayers });

        if (!guesses) {
          console.error('No guesses data received from server');
          return;
        }

        // Use server-authoritative scores (server already calculated totals)
        const playersWithGuesses = updatedPlayers.map(player => {
          const playerGuess = guesses[player.id];
          if (!playerGuess) {
            console.log(`No guess found for player ${player.id}`);
            return player;
          }
          return {
            ...player,
            guessLocation: {
              lat: playerGuess.lat,
              lng: playerGuess.lng
            },
            roundScore: playerGuess.score,
            distanceToTarget: playerGuess.distance,
            // Use server score directly - don't add again (server already added it)
            score: player.score
          };
        });

        console.log('Updated players with guesses and scores:', playersWithGuesses);
        setPlayers(playersWithGuesses);
        setShowResults(true);
        setIsTimerRunning(false);
      });

      // Listen for round advancement
      socket.on('roundAdvanced', () => {
        console.log('🔄 Advancing to next round');
        setHasGuessed(false);
        setTempGuessLocation(null);
        setShowResults(false);
        setIsTimerRunning(true);
      });
      
      // Listen for game completion
      socket.on('gameComplete', ({ players: finalPlayers }) => {
        console.log('🏁 Game completed! Final results:', finalPlayers);
        setPlayers(finalPlayers);
        setShowFinalResults(true);
      });

      // Listen for next round
      socket.on('nextRound', () => {
        console.log('🔄 Server confirmed next round');
        setTimeRemaining(timeLimit);
        setIsTimerRunning(true);
      });

      // Clean up socket listeners on unmount
      return () => {
        socket.off('playersUpdated');
        socket.off('gameStarted');
        socket.off('roomState');
        socket.off('errorMessage');
        socket.off('scoresUpdated');
        socket.off('guessSubmitted');
        socket.off('roundComplete');
        socket.off('roundAdvanced');
        socket.off('gameComplete');
        socket.off('nextRound');
      };
    }
  }, [socket, isConnected, roomId, setPlayers, startGame, toast, currentRound, timeLimit]);

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

  // Calculate score based on distance (tiered system matching backend)
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
    if (!tempGuessLocation || !socket || !roomId || !playerId || !currentRound?.target) {
      console.error('Missing required data for guess submission:', {
        hasLocation: !!tempGuessLocation,
        hasSocket: !!socket,
        hasRoomId: !!roomId,
        hasPlayerId: !!playerId,
        hasTarget: !!currentRound?.target
      });
      return;
    }

    // Create the guess object
    const guess = {
      lat: tempGuessLocation.lat,
      lng: tempGuessLocation.lng,
      timestamp: Date.now()
    };

    // Calculate distance and score locally
    const distance = google.maps.geometry.spherical.computeDistanceBetween(
      new google.maps.LatLng(guess.lat, guess.lng),
      new google.maps.LatLng(currentRound.target.lat, currentRound.target.lng)
    ) / 1000; // Convert to kilometers

    const score = calculateScore(distance);
    
    console.log('🎯 Submitting guess with calculated data:', { guess, distance, score });

    // Update local state
    setHasGuessed(true);
    setIsTimerRunning(false);
    setPendingGuessLocation(tempGuessLocation);

    // Create the complete guess data
    const guessData = {
      ...guess,
      distance,
      score
    };

    // Update local player state immediately for responsiveness
    // Server roundComplete will overwrite with authoritative scores
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

    // Emit to server with complete guess data
    socket.emit('submitGuess', {
      roomId,
      playerId,
      guess: guessData,
      target: currentRound.target
    });
  }, [tempGuessLocation, socket, roomId, playerId, currentRound?.target, players]);

  // Timer management
  useEffect(() => {
    if (hasStarted && isActive && !hasGuessed && !showResults) {
      setTimeRemaining(timeLimit);
      setIsTimerRunning(true);
    } else {
      setIsTimerRunning(false);
    }
  }, [hasStarted, isActive, hasGuessed, showResults, timeLimit]);

  // Handle time update
  const handleTimeUpdate = useCallback((time: number) => {
    setTimeRemaining(time);
  }, []);

  const handleNextRound = useCallback(() => {
    if (!socket || !roomId) {
      console.error('Missing required data for advancing round');
      return;
    }

    // Close the results modal and reset states
    setShowResults(false);
    setHasGuessed(false);
    setTempGuessLocation(null);
    
    // Advance to next round
    nextRound();
    
    // Notify server
    socket.emit('nextRound', { 
      roomId,
      rounds: gameRounds.length 
    });
  }, [socket, roomId, nextRound, gameRounds?.length]);

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

  // Handle timer expiration - submit guess or mark as no-guess with 0 points
  const handleTimerComplete = useCallback(() => {
    if (hasGuessed || showResults) return;

    console.log('⏰ Timer expired');

    if (tempGuessLocation) {
      // Player placed a pin but didn't submit - auto-submit it
      handleGuessSubmit();
    } else if (socket && roomId && playerId && currentRound?.target) {
      // No guess placed - submit a dummy guess with 0 score
      console.log('⏰ No guess placed, submitting with 0 points');
      setHasGuessed(true);
      setIsTimerRunning(false);

      const noGuessData = {
        lat: 0,
        lng: 0,
        distance: 99999,
        score: 0
      };

      socket.emit('submitGuess', {
        roomId,
        playerId,
        guess: noGuessData,
        target: currentRound.target
      });

      // Update local state
      const updatedPlayers = players.map(player => {
        if (player.id === playerId) {
          return {
            ...player,
            roundScore: 0,
            distanceToTarget: 99999
          };
        }
        return player;
      });
      setPlayers(updatedPlayers);
    }
  }, [hasGuessed, showResults, tempGuessLocation, handleGuessSubmit, socket, roomId, playerId, currentRound?.target, players, setPlayers]);

  // Memoize the StreetView component props
  const streetViewProps = useMemo(() => ({
    position: currentRound?.target,
    onLoad: () => console.log('Street view loaded'),
    isLoaded: isMapApiLoaded,
    loadError: mapApiLoadError,
    onError: handleStreetViewError,
    className: "h-full w-full"
  }), [currentRound?.target, isMapApiLoaded, mapApiLoadError, handleStreetViewError]);

  // Add a new effect to handle time remaining updates
  useEffect(() => {
    if (hasStarted && currentRound && !hasGuessed && !showResults) {
      setTimeRemaining(timeLimit);
    }
  }, [hasStarted, currentRound, hasGuessed, showResults, timeLimit]);

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
          console.log('🎮 Host is starting the game for all players...');
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

  // Results display component
  const renderResultsDisplay = () => {
    if (!showResults || !currentRound?.target) {
      return null;
    }

    // Get valid guesses with complete data
    const validGuesses = players
      .filter(p => {
        const hasValidGuess = p.guessLocation && 
                            typeof p.distanceToTarget === 'number' && 
                            typeof p.roundScore === 'number';
        
        if (!hasValidGuess) {
          console.log(`Invalid guess data for player ${p.id}:`, {
            hasLocation: !!p.guessLocation,
            hasDistance: typeof p.distanceToTarget === 'number',
            hasScore: typeof p.roundScore === 'number',
            player: p
          });
        }
        return hasValidGuess;
      })
      .map(player => {
        const guessData = {
          playerId: player.id,
          location: player.guessLocation!,
          score: player.roundScore!,
          distance: player.distanceToTarget!
        };
        console.log(`Mapped guess data for player ${player.id}:`, guessData);
        return guessData;
      });

    console.log('Final valid guesses for results:', validGuesses);

    return (
      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {currentRound.isComplete ? `Round ${currentRoundIndex + 1} Results` : 'Round Results'}
            </DialogTitle>
          </DialogHeader>
          <ResultsDisplay
            location={currentRound.target}
            players={players}
            guesses={validGuesses}
            onNextRound={handleNextRound}
            isLastRound={currentRoundIndex >= gameState.rounds.length - 1}
          />
        </DialogContent>
      </Dialog>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar onRestartGame={hasStarted ? handleRestartGame : undefined} roomId={roomId} />
      
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
            <PlayerList 
              players={players} 
              currentRound={currentRoundIndex}
            />
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
