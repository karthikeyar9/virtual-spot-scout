import React, { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Send, CheckCircle, XCircle, Smile } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface EmojiPuzzle {
  emojis: string;
  category: string;
  hint?: string;
}

interface ChatMessage {
  playerId: string;
  playerName: string;
  text: string;
  isCorrect: boolean;
  timestamp: number;
}

const EmojiDecoderGame: React.FC<GameComponentProps> = ({
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
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [currentPuzzle, setCurrentPuzzle] = useState<EmojiPuzzle | null>(null);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [guessInput, setGuessInput] = useState("");
  const [hasGuessedCorrectly, setHasGuessedCorrectly] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showFinalResults, setShowFinalResults] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);

  // Request first puzzle on mount
  useEffect(() => {
    if (socket && isConnected && roomId) {
      socket.emit('emoji-decoder:requestPuzzle', { roomId });
    }
  }, [socket, isConnected, roomId]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Socket listeners
  useEffect(() => {
    if (!socket || !isConnected || !roomId) return;

    const handleNewPuzzle = ({ puzzle, roundIndex }: { puzzle: EmojiPuzzle; roundIndex: number }) => {
      setCurrentPuzzle(puzzle);
      setCurrentRoundIndex(roundIndex);
      setGuessInput("");
      setHasGuessedCorrectly(false);
      setShowResults(false);
      setAnswer(null);
      setShowHint(false);
      setChatMessages([]);
      setIsTimerRunning(true);
    };

    const handleGuessResult = ({ playerId: guesser, playerName, text, isCorrect, players: updatedPlayers }: any) => {
      setChatMessages(prev => [...prev, {
        playerId: guesser,
        playerName,
        text,
        isCorrect,
        timestamp: Date.now(),
      }]);
      if (updatedPlayers) setPlayers(updatedPlayers);
      if (isCorrect && guesser === playerId) {
        setHasGuessedCorrectly(true);
      }
    };

    const handlePuzzleSolved = ({ answer: correctAnswer, players: updatedPlayers }: any) => {
      setAnswer(correctAnswer);
      setPlayers(updatedPlayers);
      setShowResults(true);
      setIsTimerRunning(false);
    };

    const handleTimeUp = ({ answer: correctAnswer, players: updatedPlayers }: any) => {
      setAnswer(correctAnswer);
      setPlayers(updatedPlayers);
      setShowResults(true);
      setIsTimerRunning(false);
    };

    const handleGameComplete = ({ players: finalPlayers }: any) => {
      setPlayers(finalPlayers);
      setShowFinalResults(true);
      setIsTimerRunning(false);
    };

    socket.on('emoji-decoder:newPuzzle', handleNewPuzzle);
    socket.on('emoji-decoder:guessResult', handleGuessResult);
    socket.on('emoji-decoder:puzzleSolved', handlePuzzleSolved);
    socket.on('emoji-decoder:timeUp', handleTimeUp);
    socket.on('emoji-decoder:gameComplete', handleGameComplete);

    return () => {
      socket.off('emoji-decoder:newPuzzle', handleNewPuzzle);
      socket.off('emoji-decoder:guessResult', handleGuessResult);
      socket.off('emoji-decoder:puzzleSolved', handlePuzzleSolved);
      socket.off('emoji-decoder:timeUp', handleTimeUp);
      socket.off('emoji-decoder:gameComplete', handleGameComplete);
    };
  }, [socket, isConnected, roomId, playerId, setPlayers]);

  const handleSubmitGuess = useCallback(() => {
    if (!guessInput.trim() || !socket || !roomId || hasGuessedCorrectly) return;

    socket.emit('emoji-decoder:submitGuess', {
      roomId,
      playerId,
      guess: guessInput.trim(),
    });

    setGuessInput("");
  }, [guessInput, socket, roomId, playerId, hasGuessedCorrectly]);

  const handleTimerComplete = useCallback(() => {
    if (socket && roomId) {
      socket.emit('emoji-decoder:timeUp', { roomId });
    }
  }, [socket, roomId]);

  const handleNextRound = useCallback(() => {
    if (!socket || !roomId) return;
    socket.emit('emoji-decoder:nextPuzzle', { roomId });
  }, [socket, roomId]);

  const handlePlayAgain = useCallback(() => {
    setShowFinalResults(false);
    onGameComplete();
  }, [onGameComplete]);

  const handleTimeUpdate = useCallback(() => {}, []);

  return (
    <div className="container mx-auto p-4 flex flex-col flex-1 space-y-4">
      <div className="flex justify-between items-center flex-shrink-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm">
            Puzzle {currentRoundIndex + 1} / {totalRounds}
          </Badge>
          {currentPuzzle?.category && (
            <Badge className="bg-yellow-500">{currentPuzzle.category}</Badge>
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

      <div className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Emoji Display */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Smile className="h-5 w-5" />
              Decode the Emoji!
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-grow flex flex-col items-center justify-center">
            {currentPuzzle ? (
              <>
                <div className="text-6xl md:text-8xl mb-6 text-center leading-relaxed">
                  {currentPuzzle.emojis}
                </div>
                {showHint && currentPuzzle.hint && (
                  <Badge variant="outline" className="text-sm">
                    Hint: {currentPuzzle.hint}
                  </Badge>
                )}
                {!showHint && currentPuzzle.hint && !showResults && (
                  <Button variant="ghost" size="sm" onClick={() => setShowHint(true)}>
                    Show Hint
                  </Button>
                )}
                {showResults && answer && (
                  <div className="mt-4 text-center">
                    <p className="text-sm text-muted-foreground mb-1">The answer was:</p>
                    <p className="text-2xl font-bold text-green-600">{answer}</p>
                  </div>
                )}
              </>
            ) : (
              <p>Loading puzzle...</p>
            )}
          </CardContent>
        </Card>

        {/* Chat / Guesses */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Guesses</CardTitle>
          </CardHeader>
          <CardContent className="flex-grow flex flex-col p-3">
            <ScrollArea className="flex-grow mb-3 max-h-[400px]">
              <div className="space-y-2 p-2">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-2 p-2 rounded-md text-sm",
                      msg.isCorrect ? "bg-green-50 border border-green-200" : "bg-muted"
                    )}
                  >
                    {msg.isCorrect ? (
                      <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                    )}
                    <div>
                      <span className="font-medium">{msg.playerName}: </span>
                      <span>{msg.text}</span>
                    </div>
                  </div>
                ))}
                {chatMessages.length === 0 && (
                  <p className="text-center text-muted-foreground text-sm py-4">
                    Type your guesses below!
                  </p>
                )}
                <div ref={chatEndRef} />
              </div>
            </ScrollArea>

            <div className="flex gap-2">
              <Input
                placeholder={hasGuessedCorrectly ? "You got it!" : showResults ? "Round over" : "Type your guess..."}
                value={guessInput}
                onChange={(e) => setGuessInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitGuess(); }}
                disabled={hasGuessedCorrectly || showResults}
              />
              <Button
                onClick={handleSubmitGuess}
                disabled={!guessInput.trim() || hasGuessedCorrectly || showResults}
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>

            {showResults && (
              <Button onClick={handleNextRound} className="mt-3 w-full">
                {currentRoundIndex >= totalRounds - 1 ? "See Final Results" : "Next Puzzle"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Final Results */}
      <Dialog open={showFinalResults} onOpenChange={setShowFinalResults}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Emoji Decoder Complete!</DialogTitle>
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

export default EmojiDecoderGame;
