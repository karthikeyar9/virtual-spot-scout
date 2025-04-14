import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Share2, PlayCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Navbar from './Navbar';

interface Player {
  id: string;
  name: string;
  isReady: boolean;
  isHost: boolean;
}

interface GameLobbyProps {
  roomId: string;
  players: Player[];
  isHost: boolean;
  currentPlayer: Player | null;
  onStartGame: () => void;
  onToggleReady: () => void;
}

const GameLobby = ({ 
  roomId, 
  players, 
  isHost, 
  currentPlayer, 
  onStartGame, 
  onToggleReady 
}: GameLobbyProps) => {
  const { toast } = useToast();
  const [isCopied, setIsCopied] = useState(false);

  const copyInviteLink = () => {
    const url = `${window.location.origin}/game/${roomId}`;
    navigator.clipboard.writeText(url);
    setIsCopied(true);
    toast({
      title: "Copied!",
      description: "Game invite link copied to clipboard",
    });
    setTimeout(() => setIsCopied(false), 2000);
  };

  const allPlayersReady = players.length > 0 && players.every(player => player.isReady);
  const canStartGame = allPlayersReady;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar roomId={roomId} />
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-center">
              Game Lobby
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
            
            {currentPlayer?.isReady && (
              <Button
                disabled={!canStartGame}
                onClick={onStartGame}
                className="w-full sm:w-40"
                variant="default"
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                {!allPlayersReady ? "Waiting..." : "Start Game"}
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};

export default GameLobby;
