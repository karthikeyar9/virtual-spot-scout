import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Share2, PlayCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getGame } from "@/games/registry";
import Navbar from './Navbar';

interface Player {
  id: string;
  name: string;
  isReady: boolean;
  isHost: boolean;
}

interface GameLobbyProps {
  roomId: string;
  gameType: string;
  players: Player[];
  isHost: boolean;
  currentPlayer: Player | null;
  onStartGame: () => void;
  onToggleReady: () => void;
  gameName?: string;
}

const GameLobby = ({
  roomId,
  gameType,
  players,
  isHost,
  currentPlayer,
  onStartGame,
  onToggleReady,
  gameName
}: GameLobbyProps) => {
  const { toast } = useToast();
  const [isCopied, setIsCopied] = useState(false);

  const copyInviteLink = () => {
    // Use the full game path including gameType so the link routes correctly
    const url = `${window.location.origin}/game/${gameType}/${roomId}`;
    navigator.clipboard.writeText(url);
    setIsCopied(true);
    toast({
      title: "Copied!",
      description: "Game invite link copied to clipboard",
    });
    setTimeout(() => setIsCopied(false), 2000);
  };

  const minPlayers = getGame(gameType)?.minPlayers ?? 1;
  const allPlayersReady = players.length > 0 && players.every(player => player.isReady);
  const hasEnoughPlayers = players.length >= minPlayers;
  const canStartGame = allPlayersReady && hasEnoughPlayers;

  return (
    <div className="min-h-screen flex flex-col bg-aurora">
      <Navbar roomId={roomId} gameName={gameName} />
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl mx-auto bg-white/70 backdrop-blur-md border-white/60 shadow-lg animate-appear">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center">
              {gameName ? `${gameName} - Lobby` : 'Game Lobby'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Room Code: {roomId}</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyInviteLink}
                  className="flex items-center gap-2"
                >
                  {isCopied ? <Copy className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                  {isCopied ? "Copied!" : "Share"}
                </Button>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Players ({players.length})</h3>
                <div className="grid gap-2">
                  {players.map((player) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between p-3 bg-secondary rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
                          {player.name.charAt(0).toUpperCase()}
                        </span>
                        <span>{player.name}</span>
                        {player.isHost && (
                          <Badge variant="outline">Host</Badge>
                        )}
                      </div>
                      <Badge
                        variant={player.isReady ? "default" : "outline"}
                        className={player.isReady ? "bg-green-500" : ""}
                      >
                        {player.isReady ? "Ready" : "Not Ready"}
                      </Badge>
                    </div>
                  ))}
                  {players.length === 0 && (
                    <div className="text-center py-4 text-muted-foreground">
                      Waiting for players to join...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row justify-center gap-4">
            <Button
              onClick={onToggleReady}
              variant={currentPlayer?.isReady ? "outline" : "default"}
              className="w-full sm:w-40"
            >
              {currentPlayer?.isReady ? "Not Ready" : "Ready"}
            </Button>

            {isHost && currentPlayer?.isReady && (
              <Button
                disabled={!canStartGame}
                onClick={onStartGame}
                className="w-full sm:w-40"
                variant="default"
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                {!hasEnoughPlayers
                  ? `Need ${minPlayers} players`
                  : !allPlayersReady ? "Waiting..." : "Start Game"}
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};

export default GameLobby;
