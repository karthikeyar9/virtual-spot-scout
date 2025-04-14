import React from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Player } from "@/hooks/useGameState";
import { Trophy, MapPin, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { GoogleMap, Marker, Polyline } from "@react-google-maps/api";

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

  // Map configuration
  const mapContainerStyle = {
    width: '100%',
    height: '300px',
    marginBottom: '1rem',
    borderRadius: '0.5rem'
  };

  const getBounds = () => {
    const bounds = new google.maps.LatLngBounds();
    // Add target location to bounds
    bounds.extend({ lat: location.lat, lng: location.lng });
    // Add all guesses to bounds
    guesses.forEach(guess => {
      bounds.extend({ lat: guess.location.lat, lng: guess.location.lng });
    });
    return bounds;
  };

  return (
    <Card className="w-full max-w-2xl animate-appear">
      <CardHeader className="pb-2">
        <CardTitle className="text-xl text-center">
          Round Results
        </CardTitle>
        <div className="text-center text-sm text-muted-foreground">
          Target Location: {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            zoom={2}
            options={{
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false
            }}
            onLoad={(map) => {
              const bounds = getBounds();
              map.fitBounds(bounds, { 
                top: 50, 
                right: 50, 
                bottom: 50, 
                left: 50 
              });
            }}
          >
            {/* Target location marker */}
            <Marker
              position={location}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: "#22c55e",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              }}
            />

            {/* Player guess markers and lines */}
            {sortedGuesses.map((guess, index) => (
              <React.Fragment key={`${guess.playerId}-marker-${index}`}>
                <Marker
                  position={guess.location}
                  label={{
                    text: playerMap.get(guess.playerId) || '',
                    color: '#ffffff',
                    fontWeight: 'bold',
                  }}
                />
                <Polyline
                  key={`${guess.playerId}-line-${index}`}
                  path={[location, guess.location]}
                  options={{
                    strokeColor: index === 0 ? "#eab308" : "#6b7280",
                    strokeOpacity: 0.8,
                    strokeWeight: 2,
                  }}
                />
              </React.Fragment>
            ))}
          </GoogleMap>
        </div>

        <div className="space-y-3 max-h-[200px] overflow-y-auto">
          {sortedGuesses.map((guess, index) => {
            const playerName = playerMap.get(guess.playerId) || 'Unknown Player';
            return (
              <div 
                key={`${guess.playerId}-${index}`}
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

export default ResultsDisplay;
