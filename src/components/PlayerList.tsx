
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trophy, MapPin, Users } from "lucide-react";
import { Player } from "@/hooks/useGameState";
import { cn } from "@/lib/utils";

interface PlayerListProps {
  players: Player[];
  currentRound: number;
  className?: string;
}

const PlayerList = ({ players, currentRound, className }: PlayerListProps) => {
  // Sort players by score (highest first)
  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader className="pb-2 pt-2">
        <CardTitle className="text-lg flex items-center">
          <Users className="mr-2 h-5 w-5" />
          Players ({players.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        <ScrollArea className="h-[calc(100%-40px)] pr-3">
          <div className="px-4 pb-1 space-y-2">
            {sortedPlayers.map((player, index) => (
              <div 
                key={player.id}
                className={cn(
                  "flex items-center justify-between p-2 rounded-md transition-colors",
                  index === 0 ? "bg-yellow-50 border border-yellow-200" : "bg-background border border-border"
                )}
              >
                <div className="flex items-center gap-2">
                  {index === 0 && (
                    <Trophy className="h-4 w-4 text-yellow-500" />
                  )}
                  <div>
                    <div className="font-medium flex items-center">
                      {player.name}
                      {player.guessLocation && (
                        <MapPin className="ml-2 h-3 w-3 text-green-500" />
                      )}
                    </div>
                    {player.roundScore !== undefined && (
                      <div className="text-xs text-muted-foreground">
                        +{player.roundScore} points this round
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {player.distanceToTarget !== undefined && (
                    <Badge variant="outline" className="text-xs">
                      {player.distanceToTarget.toFixed(0)} km
                    </Badge>
                  )}
                  <Badge 
                    className={cn(
                      "font-mono",
                      index === 0 ? "bg-yellow-500" : "bg-primary"
                    )}
                  >
                    {player.score}
                  </Badge>
                </div>
              </div>
            ))}
            
            {players.length === 0 && (
              <div className="text-center py-4 text-muted-foreground">
                <Users className="mx-auto h-6 w-6 mb-2 opacity-50" />
                <p>Waiting for players to join...</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default PlayerList;
