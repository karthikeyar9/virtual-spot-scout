import React from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Player } from "@/hooks/useGameState";
import { Trophy, MapPin, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Define structure for a single guess within the round
interface RoundGuess {
  playerId: string;
  location: { lat: number; lng: number };
  score: number;
  distance: number;
}

interface ResultsDisplayProps {
  players: Player[];
  guesses: RoundGuess[]; // Expect the array of guesses for this round
  location: { lat: number; lng: number }; // Expecting target location coordinates
  onNextRound: () => void;
  isLastRound: boolean;
}

const ResultsDisplay = ({ players, guesses, location, onNextRound, isLastRound }: ResultsDisplayProps) => {
  // Create a map of player ID to player name for easy lookup
  const playerMap = new Map(players.map(p => [p.id, p.name]));

  // Sort guesses by score (descending)
  const sortedGuesses = [...guesses].sort((a, b) => b.score - a.score);

  return (
    <Card className="w-full max-w-md animate-appear">
      <CardHeader className="pb-2">
        <CardTitle className="text-xl text-center">
          Round Results
        </CardTitle>
        <div className="text-center text-sm text-muted-foreground">
          Target Location: {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 max-h-[60vh] overflow-y-auto">
        {sortedGuesses.length > 0 ? (
          <div className="space-y-3">
            {sortedGuesses.map((guess, index) => {
              const playerName = playerMap.get(guess.playerId) || 'Unknown Player';
              return (
                <div 
                  key={guess.playerId}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-md",
                    index === 0 ? "bg-yellow-50 border border-yellow-200" : "bg-background border border-border"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {index === 0 && (
                      <Trophy className="h-5 w-5 text-yellow-500" />
                    )}
                    <div>
                      <div className="font-medium">{playerName}</div>
                      <div className="text-xs text-muted-foreground">
                        {guess.distance?.toFixed(0)} km away
                      </div>
                    </div>
                  </div>
                  <div>
                    <Badge 
                      className={cn(
                        "font-mono text-md",
                        index === 0 ? "bg-yellow-500" : "bg-primary"
                      )}
                    >
                      +{guess.score}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <MapPin className="mx-auto h-8 w-8 mb-2 opacity-50" />
            <p>No guesses were made</p>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button className="w-full" onClick={onNextRound}>
          {isLastRound ? "See Final Results" : "Next Round"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
};

// Adding Badge component inline since we're using it in this file
const Badge = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-primary text-primary-foreground", className)}>
      {children}
    </span>
  );
};

export default ResultsDisplay;
