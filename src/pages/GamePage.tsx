import React, { Suspense, useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useSocket } from "@/hooks/useSocket";
import { useLobby } from "@/hooks/useLobby";
import { getGame } from "@/games/registry";
import Navbar from "@/components/Navbar";
import GameLobby from "@/components/GameLobby";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, ArrowLeft, User } from "lucide-react";
import { v4 as uuidv4 } from 'uuid';

const GamePage: React.FC = () => {
  const { gameType, roomId } = useParams<{ gameType: string; roomId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { socket, isConnected, error: socketError } = useSocket();

  const game = gameType ? getGame(gameType) : undefined;

  const {
    players,
    setPlayers,
    playerId,
    setPlayerId,
    hasStarted,
    setHasStarted,
    gameData,
    currentPlayer,
    isHost,
    savedPlayerInfo,
    joinRoom,
    rejoinWithSavedInfo,
    toggleReady,
    startGame: lobbyStartGame,
  } = useLobby(roomId, gameType || '');

  // URL params
  const urlPlayerName = searchParams.get("name");
  const decodedName = urlPlayerName ? decodeURIComponent(urlPlayerName) : "";
  const [playerName, setPlayerName] = useState(decodedName || "");
  const [showNamePrompt, setShowNamePrompt] = useState(!decodedName);
  const [tempName, setTempName] = useState("");
  const urlIsHost = searchParams.get("host") === "true";
  const rounds = parseInt(searchParams.get("rounds") || "5");
  const timeLimit = parseInt(searchParams.get("time") || "60");
  const urlPlayerId = searchParams.get("playerId");

  // Show connection error
  useEffect(() => {
    if (socketError) {
      toast({
        title: "Connection Error",
        description: "Lost connection to the game server. Reconnecting...",
        variant: "destructive",
      });
    }
  }, [socketError, toast]);

  // Handle name submission for joiners via share link (no name in URL)
  const handleNameSubmit = useCallback(() => {
    if (tempName.trim()) {
      setPlayerName(tempName.trim());
      const newParams = new URLSearchParams(searchParams);
      newParams.set("name", tempName.trim());
      setSearchParams(newParams);
      setShowNamePrompt(false);
      toast({ title: "Welcome!", description: `You've joined as ${tempName.trim()}` });
    } else {
      toast({ title: "Name Required", description: "Please enter a name to continue", variant: "destructive" });
    }
  }, [tempName, searchParams, setSearchParams, toast]);

  // Join room when we have a name and socket is connected
  useEffect(() => {
    if (!playerName || !socket || !isConnected || !roomId) return;

    // Already joined (useLobby guards against double-join internally)
    if (playerId) return;

    if (savedPlayerInfo) {
      // Rejoin with saved info from localStorage
      console.log('🔄 GamePage: Rejoining with saved info');
      rejoinWithSavedInfo();
    } else {
      // New join
      const pid = urlPlayerId || uuidv4();
      console.log('🆕 GamePage: Joining as new player', { playerName, pid, urlIsHost });
      joinRoom(playerName, urlIsHost, pid);
    }
  }, [playerName, socket, isConnected, roomId, playerId, savedPlayerInfo, urlPlayerId, urlIsHost, joinRoom, rejoinWithSavedInfo]);

  // Handle ready toggle - use server-authoritative state
  const handleToggleReady = useCallback(() => {
    // Pass the CURRENT server-side ready state so useLobby can invert it
    const currentIsReady = currentPlayer?.isReady ?? false;
    toggleReady(currentIsReady);
  }, [toggleReady, currentPlayer?.isReady]);

  // Handle start game
  const handleStartGame = useCallback(() => {
    lobbyStartGame(rounds);
  }, [lobbyStartGame, rounds]);

  // Handle game complete (return to lobby)
  const handleGameComplete = useCallback(() => {
    setHasStarted(false);
  }, [setHasStarted]);

  // Invalid game type
  if (!game || !gameType) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex items-center justify-center flex-1">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
              <h2 className="text-xl font-bold mb-2">Game Not Found</h2>
              <p className="text-muted-foreground mb-4">The game type "{gameType}" doesn't exist.</p>
              <Button onClick={() => navigate('/')}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Name prompt for joiners arriving via share link with no name param
  if (showNamePrompt) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar roomId={roomId} gameName={game.name} />
        <div className="flex items-center justify-center flex-1 bg-gradient-to-b from-gray-50 to-gray-100">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl text-center">Join {game.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Enter your name to join</Label>
                <Input
                  id="name"
                  placeholder="Your name"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleNameSubmit(); }}
                  autoFocus
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button className="w-full" onClick={handleNameSubmit}>
                <User className="mr-2 h-4 w-4" /> Join Game
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  // Lobby - use server-derived isHost (falls back to URL param until server state arrives)
  if (!hasStarted) {
    const effectiveIsHost = currentPlayer ? currentPlayer.isHost : urlIsHost;

    return (
      <GameLobby
        roomId={roomId || ''}
        gameType={gameType}
        players={players}
        isHost={effectiveIsHost}
        currentPlayer={currentPlayer}
        onStartGame={handleStartGame}
        onToggleReady={handleToggleReady}
        gameName={game.name}
      />
    );
  }

  // Active game
  const GameComponent = game.component;

  return (
    <div className="min-h-screen flex flex-col bg-aurora">
      <Navbar roomId={roomId} gameName={game.name} />
      <Suspense fallback={
        <div className="flex items-center justify-center flex-1">
          <p>Loading {game.name}...</p>
        </div>
      }>
        <GameComponent
          roomId={roomId || ''}
          playerId={playerId || ''}
          players={players}
          isHost={isHost}
          timeLimit={timeLimit}
          rounds={rounds}
          onGameComplete={handleGameComplete}
          setPlayers={setPlayers}
          gameData={gameData}
        />
      </Suspense>
    </div>
  );
};

export default GamePage;
