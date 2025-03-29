
import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { 
  Card, CardContent, CardFooter, CardHeader, CardTitle 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter 
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Globe, Send, Copy, Share2 } from "lucide-react";
import { useGameState } from "@/hooks/useGameState";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import StreetView from "./StreetView";
import GuessMap from "./GuessMap";
import Timer from "./Timer";
import PlayerList from "./PlayerList";
import ResultsDisplay from "./ResultsDisplay";

const GameRoom = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // Get params from URL
  const playerName = searchParams.get("name") || "Player";
  const isHost = searchParams.get("host") === "true";
  const rounds = parseInt(searchParams.get("rounds") || "5");
  const timeLimit = parseInt(searchParams.get("time") || "60");
  
  // Game state
  const {
    gameState,
    addPlayer,
    startGame,
    submitGuess,
    nextRound,
    resetGame,
  } = useGameState(roomId, rounds, timeLimit);
  
  // Local state
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [hasGuessed, setHasGuessed] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showFinalResults, setShowFinalResults] = useState(false);
  
  // Get current player
  const currentPlayer = playerId 
    ? gameState.players.find(p => p.id === playerId)
    : null;
  
  // Get current round
  const currentRound = gameState.rounds[gameState.currentRound];
  
  // Add player on mount
  useEffect(() => {
    if (!playerId && playerName) {
      const id = addPlayer(playerName);
      setPlayerId(id);
      
      // If host, start the game
      if (isHost && gameState.players.length === 0) {
        setTimeout(() => {
          startGame();
        }, 1000);
      }
    }
  }, [playerName, isHost, gameState.players.length]);
  
  // Watch for round completion
  useEffect(() => {
    if (currentRound?.isComplete && !showResults && gameState.isActive) {
      setShowResults(true);
    }
  }, [currentRound?.isComplete, gameState.isActive]);
  
  // Handle guess submission
  const handleGuess = (lat: number, lng: number) => {
    if (!playerId || hasGuessed) return;
    submitGuess(playerId, lat, lng);
    setHasGuessed(true);
    
    toast({
      title: "Guess Submitted",
      description: "Your guess has been recorded",
    });
  };
  
  // Handle moving to next round
  const handleNextRound = () => {
    setShowResults(false);
    setHasGuessed(false);
    
    if (gameState.currentRound >= gameState.totalRounds - 1) {
      setShowFinalResults(true);
    } else {
      nextRound();
    }
  };
  
  // Handle copying room link
  const copyRoomLink = () => {
    const baseUrl = window.location.origin;
    const link = `${baseUrl}/game/${roomId}?name=`;
    
    navigator.clipboard.writeText(link);
    
    toast({
      title: "Link Copied",
      description: "Room link copied to clipboard",
    });
  };
  
  // Handle leaving the game
  const handleLeaveGame = () => {
    navigate("/");
  };
  
  // Handle starting a new game
  const handleNewGame = () => {
    resetGame();
    setShowFinalResults(false);
    setHasGuessed(false);
    
    toast({
      title: "New Game Started",
      description: "Starting a fresh game with the same players",
    });
  };
  
  if (!roomId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid Room</CardTitle>
          </CardHeader>
          <CardContent>
            <p>No room ID provided. Please go back and create or join a room.</p>
          </CardContent>
          <CardFooter>
            <Button onClick={() => navigate("/")} className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }
  
  // Render waiting screen if game not active
  if (!gameState.isActive) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-accent to-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Waiting Room</span>
              <Badge className="bg-primary text-xs">
                Room: {roomId}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <h3 className="font-medium">Players ({gameState.players.length})</h3>
              <div className="space-y-2">
                {gameState.players.map(player => (
                  <div key={player.id} className="p-3 bg-muted rounded-md flex items-center">
                    <span>{player.name}</span>
                    {player.id === playerId && (
                      <Badge variant="outline" className="ml-2 text-xs">You</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="p-4 border rounded-md text-center space-y-2">
              <h3 className="font-medium">Invite Friends</h3>
              <p className="text-sm text-muted-foreground">
                Share this room code or copy the link
              </p>
              <div className="flex justify-center gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={copyRoomLink}>
                  <Copy className="mr-2 h-4 w-4" /> Copy Link
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: 'Join my Virtual City Guesser game!',
                      text: `Join my game with room code: ${roomId}`,
                      url: window.location.href.split('?')[0]
                    });
                  } else {
                    copyRoomLink();
                  }
                }}>
                  <Share2 className="mr-2 h-4 w-4" /> Share
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={handleLeaveGame}>
              Leave Room
            </Button>
            
            {isHost && (
              <Button onClick={startGame} disabled={gameState.players.length < 1}>
                Start Game
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    );
  }
  
  // Render final results
  if (showFinalResults) {
    const sortedPlayers = [...gameState.players].sort((a, b) => b.score - a.score);
    const winner = sortedPlayers[0];
    
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-accent to-background">
        <Card className="w-full max-w-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl">Game Complete!</CardTitle>
            {winner && (
              <div className="mt-2">
                <Badge className="bg-yellow-500 text-white">
                  {winner.name} wins with {winner.score} points!
                </Badge>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="font-medium text-lg mb-3">Final Standings</h3>
              <div className="space-y-2">
                {sortedPlayers.map((player, index) => (
                  <div 
                    key={player.id} 
                    className={cn(
                      "p-4 rounded-md flex items-center justify-between",
                      index === 0 ? "bg-yellow-50 border border-yellow-200" : "bg-muted"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
                        {index + 1}
                      </div>
                      <span className="font-medium">{player.name}</span>
                      {player.id === playerId && (
                        <Badge variant="outline" className="text-xs">You</Badge>
                      )}
                    </div>
                    <Badge className={cn(
                      "font-mono text-lg",
                      index === 0 ? "bg-yellow-500" : "bg-primary"
                    )}>
                      {player.score}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={handleLeaveGame}>
              Exit to Menu
            </Button>
            
            {isHost && (
              <Button onClick={handleNewGame}>
                New Game
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-cyan-50 map-pattern">
      {/* Header */}
      <header className="bg-background border-b p-3 shadow-sm">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center">
            <Globe className="mr-2 h-5 w-5 text-primary" />
            <h1 className="font-bold">Virtual City Guesser</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              Round {gameState.currentRound + 1}/{gameState.totalRounds}
            </Badge>
            <Badge variant="outline" className="text-xs">
              Room: {roomId}
            </Badge>
            <Button variant="ghost" size="sm" onClick={handleLeaveGame}>
              Exit
            </Button>
          </div>
        </div>
      </header>
      
      {/* Main content */}
      <main className="flex-1 container mx-auto py-4 px-4 lg:px-8 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 items-start">
        {/* Left column - Street View */}
        <div className="md:col-span-2 h-[50vh] md:h-[calc(100vh-8rem)]">
          <StreetView 
            position={currentRound?.location.position}
            panoId={currentRound?.location.panoId}
          />
        </div>
        
        {/* Right column - Map and Players */}
        <div className="space-y-4 md:h-[calc(100vh-8rem)] flex flex-col">
          {/* Timer */}
          <Timer 
            seconds={currentRound?.timeRemaining || 0}
            maxTime={currentRound?.timeLimit || 60}
          />
          
          {/* Map */}
          <div className="flex-1">
            <GuessMap 
              onGuess={!hasGuessed ? handleGuess : undefined}
              guessLocation={currentPlayer?.guessLocation}
              actualLocation={currentRound?.isComplete ? currentRound.location.position : undefined}
              isRevealed={currentRound?.isComplete || false}
              disabled={hasGuessed || !gameState.isActive}
              className="h-full"
            />
          </div>
          
          {/* Players */}
          <div className="h-64">
            <PlayerList 
              players={gameState.players}
              currentRound={gameState.currentRound}
              className="h-full"
            />
          </div>
          
          {/* Guess button */}
          {!hasGuessed && !currentRound?.isComplete && (
            <Button 
              disabled={!currentPlayer?.guessLocation}
              className="w-full"
              onClick={() => {
                setHasGuessed(true);
                toast({
                  title: "Guess Submitted",
                  description: "Waiting for other players to finish",
                });
              }}
            >
              <Send className="mr-2 h-4 w-4" /> Submit Guess
            </Button>
          )}
        </div>
      </main>
      
      {/* Results dialog */}
      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent>
          <ResultsDisplay 
            players={gameState.players}
            location={currentRound?.location}
            onNextRound={handleNextRound}
            isLastRound={gameState.currentRound >= gameState.totalRounds - 1}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Adding Badge component inline since we're using it in this file
const Badge = ({ children, className, variant }: { children: React.ReactNode; className?: string; variant?: "default" | "outline" }) => {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
      variant !== "outline" ? "bg-primary text-primary-foreground" : "border border-border bg-background",
      className
    )}>
      {children}
    </span>
  );
};

export default GameRoom;
