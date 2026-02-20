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
import { CheckCircle, XCircle, Zap } from "lucide-react";

interface TriviaQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  category: string;
}

const TriviaGame: React.FC<GameComponentProps> = ({
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

  const [currentQuestion, setCurrentQuestion] = useState<TriviaQuestion | null>(null);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showFinalResults, setShowFinalResults] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [roundResults, setRoundResults] = useState<{
    correctIndex: number;
    playerAnswers: Record<string, { answerIndex: number; score: number; timeBonus: boolean }>;
  } | null>(null);

  // Request first question on mount
  useEffect(() => {
    if (socket && isConnected && roomId) {
      socket.emit('trivia:requestQuestion', { roomId });
    }
  }, [socket, isConnected, roomId]);

  // Socket listeners
  useEffect(() => {
    if (!socket || !isConnected || !roomId) return;

    const handleNewQuestion = ({ question, roundIndex }: { question: TriviaQuestion; roundIndex: number }) => {
      setCurrentQuestion(question);
      setCurrentRoundIndex(roundIndex);
      setSelectedAnswer(null);
      setHasAnswered(false);
      setShowResults(false);
      setRoundResults(null);
      setIsTimerRunning(true);
    };

    const handleAnswerResult = (result: any) => {
      setPlayers(result.players);
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

    socket.on('trivia:newQuestion', handleNewQuestion);
    socket.on('trivia:answerResult', handleAnswerResult);
    socket.on('trivia:roundResults', handleRoundResults);
    socket.on('trivia:gameComplete', handleGameComplete);

    return () => {
      socket.off('trivia:newQuestion', handleNewQuestion);
      socket.off('trivia:answerResult', handleAnswerResult);
      socket.off('trivia:roundResults', handleRoundResults);
      socket.off('trivia:gameComplete', handleGameComplete);
    };
  }, [socket, isConnected, roomId, setPlayers]);

  const handleAnswer = useCallback((answerIndex: number) => {
    if (hasAnswered || !socket || !roomId) return;
    setSelectedAnswer(answerIndex);
    setHasAnswered(true);

    socket.emit('trivia:submitAnswer', {
      roomId,
      playerId,
      answerIndex,
    });
  }, [hasAnswered, socket, roomId, playerId]);

  const handleTimerComplete = useCallback(() => {
    if (!hasAnswered && socket && roomId) {
      setHasAnswered(true);
      socket.emit('trivia:submitAnswer', {
        roomId,
        playerId,
        answerIndex: -1, // No answer
      });
    }
  }, [hasAnswered, socket, roomId, playerId]);

  const handleNextRound = useCallback(() => {
    if (!socket || !roomId) return;
    socket.emit('trivia:nextQuestion', { roomId });
  }, [socket, roomId]);

  const handlePlayAgain = useCallback(() => {
    setShowFinalResults(false);
    onGameComplete();
  }, [onGameComplete]);

  const handleTimeUpdate = useCallback(() => {}, []);

  const myAnswer = roundResults?.playerAnswers[playerId];

  return (
    <div className="container mx-auto p-4 flex flex-col flex-1 space-y-4">
      <div className="flex justify-between items-center flex-shrink-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm">
            Question {currentRoundIndex + 1} / {totalRounds}
          </Badge>
          {currentQuestion?.category && (
            <Badge className="bg-purple-500">{currentQuestion.category}</Badge>
          )}
        </div>
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

      {/* Question Card */}
      {currentQuestion && (
        <Card className="flex-grow">
          <CardHeader>
            <CardTitle className="text-2xl text-center py-4">
              {currentQuestion.question}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
              {currentQuestion.options.map((option, index) => {
                const isCorrect = showResults && index === roundResults?.correctIndex;
                const isWrong = showResults && index === selectedAnswer && index !== roundResults?.correctIndex;
                const isSelected = index === selectedAnswer;

                return (
                  <Button
                    key={index}
                    variant="outline"
                    className={cn(
                      "h-auto min-h-[60px] text-lg p-4 whitespace-normal transition-all",
                      isSelected && !showResults && "border-primary bg-primary/10",
                      isCorrect && "border-green-500 bg-green-50 text-green-700",
                      isWrong && "border-red-500 bg-red-50 text-red-700",
                      !hasAnswered && "hover:bg-primary/5 hover:border-primary"
                    )}
                    disabled={hasAnswered}
                    onClick={() => handleAnswer(index)}
                  >
                    <span className="flex items-center gap-2">
                      {isCorrect && <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />}
                      {isWrong && <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />}
                      <span className="font-bold mr-2">{String.fromCharCode(65 + index)}.</span>
                      {option}
                    </span>
                  </Button>
                );
              })}
            </div>

            {hasAnswered && !showResults && (
              <p className="text-center mt-6 text-muted-foreground">
                Waiting for other players...
              </p>
            )}

            {showResults && myAnswer && (
              <div className="mt-6 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  {myAnswer.score > 0 ? (
                    <>
                      <CheckCircle className="h-6 w-6 text-green-500" />
                      <span className="text-lg font-bold text-green-600">
                        +{myAnswer.score} points
                      </span>
                      {myAnswer.timeBonus && (
                        <Badge className="bg-yellow-500">
                          <Zap className="h-3 w-3 mr-1" /> Speed Bonus!
                        </Badge>
                      )}
                    </>
                  ) : (
                    <>
                      <XCircle className="h-6 w-6 text-red-500" />
                      <span className="text-lg font-bold text-red-600">Incorrect</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {showResults && (
              <div className="mt-4 flex justify-center">
                <Button onClick={handleNextRound} size="lg">
                  {currentRoundIndex >= totalRounds - 1 ? "See Final Results" : "Next Question"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!currentQuestion && (
        <div className="flex items-center justify-center flex-1">
          <p>Loading question...</p>
        </div>
      )}

      {/* Final Results Dialog */}
      <Dialog open={showFinalResults} onOpenChange={setShowFinalResults}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trivia Complete!</DialogTitle>
            <DialogDescription>Here are the final results</DialogDescription>
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
                    {index === 0 && (
                      <Badge variant="outline" className="border-yellow-600 text-yellow-700">Winner!</Badge>
                    )}
                  </div>
                  <span className="font-semibold">{player.score ? player.score.toLocaleString() : 0} points</span>
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

export default TriviaGame;
