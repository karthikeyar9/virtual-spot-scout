import React, { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSocket } from "@/hooks/useSocket";
import { cn } from "@/lib/utils";
import Timer from "@/components/Timer";
import PlayerList from "@/components/PlayerList";
import { GameComponentProps } from "@/games/types";
import { ThumbsUp, Users } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface Prompt {
  question: string;
  optionA: string;
  optionB: string;
}

const HotTakesGame: React.FC<GameComponentProps> = ({
  roomId,
  playerId,
  players,
  isHost,
  timeLimit,
  rounds: totalRounds,
  onGameComplete,
  setPlayers,
}) => {
  const { toast } = useToast();
  const { socket, isConnected } = useSocket();

  const [currentPrompt, setCurrentPrompt] = useState<Prompt | null>(null);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<'A' | 'B' | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showFinalResults, setShowFinalResults] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [roundResults, setRoundResults] = useState<{
    votesA: number;
    votesB: number;
    totalVotes: number;
    playerVotes: Record<string, 'A' | 'B'>;
  } | null>(null);

  // Request first prompt on mount
  useEffect(() => {
    if (socket && isConnected && roomId) {
      socket.emit('hot-takes:requestPrompt', { roomId });
    }
  }, [socket, isConnected, roomId]);

  // Socket listeners
  useEffect(() => {
    if (!socket || !isConnected || !roomId) return;

    const handleNewPrompt = ({ prompt, roundIndex }: { prompt: Prompt; roundIndex: number }) => {
      setCurrentPrompt(prompt);
      setCurrentRoundIndex(roundIndex);
      setSelectedOption(null);
      setHasVoted(false);
      setShowResults(false);
      setRoundResults(null);
      setIsTimerRunning(true);
    };

    const handleVoteUpdate = ({ votedCount, totalPlayers }: any) => {
      // Just an update on how many voted
    };

    const handleRoundResults = (result: any) => {
      setRoundResults(result);
      setPlayers(result.players);
      setShowResults(true);
      setIsTimerRunning(false);
    };

    const handleGameComplete = ({ players: finalPlayers }: any) => {
      setPlayers(finalPlayers);
      setShowFinalResults(true);
      setIsTimerRunning(false);
    };

    socket.on('hot-takes:newPrompt', handleNewPrompt);
    socket.on('hot-takes:voteUpdate', handleVoteUpdate);
    socket.on('hot-takes:roundResults', handleRoundResults);
    socket.on('hot-takes:gameComplete', handleGameComplete);

    return () => {
      socket.off('hot-takes:newPrompt', handleNewPrompt);
      socket.off('hot-takes:voteUpdate', handleVoteUpdate);
      socket.off('hot-takes:roundResults', handleRoundResults);
      socket.off('hot-takes:gameComplete', handleGameComplete);
    };
  }, [socket, isConnected, roomId, setPlayers]);

  const handleVote = useCallback((option: 'A' | 'B') => {
    if (hasVoted || !socket || !roomId) return;
    setSelectedOption(option);
    setHasVoted(true);

    socket.emit('hot-takes:vote', {
      roomId,
      playerId,
      vote: option,
    });
  }, [hasVoted, socket, roomId, playerId]);

  const handleTimerComplete = useCallback(() => {
    if (!hasVoted && socket && roomId) {
      setHasVoted(true);
      socket.emit('hot-takes:vote', {
        roomId,
        playerId,
        vote: 'skip',
      });
    }
  }, [hasVoted, socket, roomId, playerId]);

  const handleNextRound = useCallback(() => {
    if (!socket || !roomId) return;
    socket.emit('hot-takes:nextPrompt', { roomId });
  }, [socket, roomId]);

  const handlePlayAgain = useCallback(() => {
    setShowFinalResults(false);
    onGameComplete();
  }, [onGameComplete]);

  const handleTimeUpdate = useCallback(() => {}, []);

  const percentA = roundResults ? Math.round((roundResults.votesA / Math.max(roundResults.totalVotes, 1)) * 100) : 0;
  const percentB = roundResults ? 100 - percentA : 0;

  return (
    <div className="container mx-auto p-4 flex flex-col flex-1 space-y-4">
      <div className="flex justify-between items-center flex-shrink-0">
        <Badge variant="outline" className="text-sm">
          Prompt {currentRoundIndex + 1} / {totalRounds}
        </Badge>
        <div className="flex items-center gap-4">
          <Timer
            key={`timer-${currentRoundIndex}-${timeLimit}`}
            duration={timeLimit}
            isRunning={isTimerRunning}
            onComplete={handleTimerComplete}
            onTimeUpdate={handleTimeUpdate}
            className="min-w-[200px]"
          />
          <PlayerList players={players} currentRound={currentRoundIndex} />
        </div>
      </div>

      {currentPrompt && (
        <Card className="flex-grow">
          <CardHeader>
            <CardTitle className="text-2xl text-center py-4">
              {currentPrompt.question}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {/* Option A */}
              <Button
                variant="outline"
                className={cn(
                  "h-auto min-h-[120px] text-lg p-6 whitespace-normal transition-all relative overflow-hidden",
                  selectedOption === 'A' && "border-orange-500 bg-orange-50",
                  showResults && "pointer-events-none"
                )}
                disabled={hasVoted && !showResults}
                onClick={() => handleVote('A')}
              >
                <div className="relative z-10">
                  <span className="font-bold text-orange-500 text-sm">Option A</span>
                  <p className="mt-2">{currentPrompt.optionA}</p>
                  {showResults && (
                    <Badge className="mt-3 bg-orange-500">{percentA}%</Badge>
                  )}
                </div>
                {showResults && (
                  <div
                    className="absolute inset-0 bg-orange-100 transition-all"
                    style={{ width: `${percentA}%`, opacity: 0.5 }}
                  />
                )}
              </Button>

              {/* Option B */}
              <Button
                variant="outline"
                className={cn(
                  "h-auto min-h-[120px] text-lg p-6 whitespace-normal transition-all relative overflow-hidden",
                  selectedOption === 'B' && "border-blue-500 bg-blue-50",
                  showResults && "pointer-events-none"
                )}
                disabled={hasVoted && !showResults}
                onClick={() => handleVote('B')}
              >
                <div className="relative z-10">
                  <span className="font-bold text-blue-500 text-sm">Option B</span>
                  <p className="mt-2">{currentPrompt.optionB}</p>
                  {showResults && (
                    <Badge className="mt-3 bg-blue-500">{percentB}%</Badge>
                  )}
                </div>
                {showResults && (
                  <div
                    className="absolute inset-0 bg-blue-100 transition-all"
                    style={{ width: `${percentB}%`, opacity: 0.5 }}
                  />
                )}
              </Button>
            </div>

            {hasVoted && !showResults && (
              <p className="text-center mt-6 text-muted-foreground">
                Waiting for other players to vote...
              </p>
            )}

            {showResults && roundResults && (
              <div className="mt-6 text-center space-y-4">
                <div className="flex items-center justify-center gap-2">
                  <Users className="h-5 w-5" />
                  <span className="text-muted-foreground">{roundResults.totalVotes} votes cast</span>
                </div>

                {/* Show who voted what */}
                <div className="flex flex-wrap justify-center gap-2">
                  {players.map(p => {
                    const vote = roundResults.playerVotes[p.id];
                    return (
                      <Badge
                        key={p.id}
                        variant="outline"
                        className={cn(
                          vote === 'A' && "border-orange-500 text-orange-600",
                          vote === 'B' && "border-blue-500 text-blue-600",
                          !vote && "border-gray-300 text-gray-400"
                        )}
                      >
                        {p.name}: {vote || 'skipped'}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

            {showResults && (
              <div className="mt-4 flex justify-center">
                <Button onClick={handleNextRound} size="lg">
                  {currentRoundIndex >= totalRounds - 1 ? "See Final Results" : "Next Prompt"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!currentPrompt && (
        <div className="flex items-center justify-center flex-1">
          <p>Loading prompt...</p>
        </div>
      )}

      {/* Final Results */}
      <Dialog open={showFinalResults} onOpenChange={setShowFinalResults}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hot Takes Complete!</DialogTitle>
            <DialogDescription>Thanks for sharing your hot takes!</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {[...players]
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
                  </div>
                  <span className="font-semibold">{player.score || 0} points</span>
                </div>
              ))}
          </div>
          <DialogFooter>
            <Button onClick={handlePlayAgain}>Play Again</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HotTakesGame;
