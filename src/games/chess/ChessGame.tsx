import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Chess, Square } from "chess.js";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSocket } from "@/hooks/useSocket";
import { cn } from "@/lib/utils";
import { GameComponentProps } from "@/games/types";
import { Flag, Handshake, Crown, Eye, Bot } from "lucide-react";

interface ChessState {
  fen: string;
  turn: 'w' | 'b';
  whiteId: string | null;
  blackId: string | null;
  moves: string[];
  lastMove: { from: string; to: string } | null;
  status: 'active' | 'checkmate' | 'draw' | 'resigned';
  winnerId: string | null;
  check: boolean;
  drawOfferBy: string | null;
}

// ︎ forces text presentation — without it Chrome renders ♟ as an emoji
// and ignores the CSS color used to distinguish white from black pieces.
const PIECE_GLYPHS: Record<string, string> = {
  k: "♚︎", q: "♛︎", r: "♜︎", b: "♝︎", n: "♞︎", p: "♟︎",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

const ChessGame: React.FC<GameComponentProps> = ({
  roomId,
  playerId,
  players,
  onGameComplete,
  setPlayers,
  gameData,
}) => {
  const { toast } = useToast();
  const { socket, isConnected } = useSocket();

  const [state, setState] = useState<ChessState | null>(gameData?.chess ?? null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [showGameOver, setShowGameOver] = useState(false);

  const chess = useMemo(() => (state ? new Chess(state.fen) : null), [state]);

  const myColor: 'w' | 'b' | null =
    state?.whiteId === playerId ? 'w' : state?.blackId === playerId ? 'b' : null;
  const isMyTurn = !!state && state.status === 'active' && myColor === state.turn;
  const flipped = myColor === 'b';

  const playerName = useCallback(
    (id: string | null) => players.find(p => p.id === id)?.name ?? "—",
    [players]
  );

  // Request authoritative state on mount / reconnect
  useEffect(() => {
    if (socket && isConnected && roomId) {
      socket.emit('chess:requestState', { roomId });
    }
  }, [socket, isConnected, roomId]);

  useEffect(() => {
    if (!socket || !isConnected || !roomId) return;

    const handleState = (next: ChessState) => {
      setState(next);
      setSelected(null);
      setLegalTargets([]);
    };

    const handleGameOver = ({ players: finalPlayers }: { players: GameComponentProps['players'] }) => {
      setPlayers(finalPlayers);
      setShowGameOver(true);
    };

    const handleInvalidMove = () => {
      toast({ title: "Invalid move", variant: "destructive" });
      setSelected(null);
      setLegalTargets([]);
    };

    socket.on('chess:state', handleState);
    socket.on('chess:gameOver', handleGameOver);
    socket.on('chess:invalidMove', handleInvalidMove);

    return () => {
      socket.off('chess:state', handleState);
      socket.off('chess:gameOver', handleGameOver);
      socket.off('chess:invalidMove', handleInvalidMove);
    };
  }, [socket, isConnected, roomId, setPlayers, toast]);

  const handleSquareClick = useCallback((square: Square) => {
    if (!chess || !state || state.status !== 'active' || !isMyTurn || !socket) return;

    // Complete a move if the square is a legal target of the selection
    if (selected && legalTargets.includes(square)) {
      socket.emit('chess:move', {
        roomId,
        playerId,
        from: selected,
        to: square,
        promotion: 'q', // auto-queen
      });
      setSelected(null);
      setLegalTargets([]);
      return;
    }

    // Otherwise (re)select one of my pieces
    const piece = chess.get(square);
    if (piece && piece.color === myColor) {
      setSelected(square);
      setLegalTargets(chess.moves({ square, verbose: true }).map(m => m.to as Square));
    } else {
      setSelected(null);
      setLegalTargets([]);
    }
  }, [chess, state, isMyTurn, socket, selected, legalTargets, roomId, playerId, myColor]);

  const handleResign = useCallback(() => {
    socket?.emit('chess:resign', { roomId, playerId });
  }, [socket, roomId, playerId]);

  const handleOfferDraw = useCallback(() => {
    socket?.emit('chess:offerDraw', { roomId, playerId });
    toast({ title: "Draw offered", description: "Waiting for your opponent's response." });
  }, [socket, roomId, playerId, toast]);

  const handleRespondDraw = useCallback((accept: boolean) => {
    socket?.emit('chess:respondDraw', { roomId, playerId, accept });
  }, [socket, roomId, playerId]);

  const handlePlayAgain = useCallback(() => {
    setShowGameOver(false);
    onGameComplete();
  }, [onGameComplete]);

  if (!state || !chess) {
    return (
      <div className="flex items-center justify-center flex-1">
        <p className="text-muted-foreground animate-pulse">Setting up the board...</p>
      </div>
    );
  }

  const board = chess.board(); // ranks 8 → 1
  const ranks = flipped ? [...board].reverse() : board;

  const resultText = (() => {
    if (state.status === 'checkmate') return `Checkmate — ${playerName(state.winnerId)} wins!`;
    if (state.status === 'resigned') return `${playerName(state.winnerId)} wins by resignation`;
    if (state.status === 'draw') return "Draw";
    return "";
  })();

  const opponentIsBot = players.some(p => p.isBot);

  const seatBadge = (color: 'w' | 'b') => {
    const id = color === 'w' ? state.whiteId : state.blackId;
    const isBot = players.find(p => p.id === id)?.isBot;
    const active = state.status === 'active' && state.turn === color;
    return (
      <div className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all",
        active ? "border-primary bg-primary/10 shadow-sm" : "border-transparent bg-secondary/60"
      )}>
        <span className={cn(
          "inline-block w-3 h-3 rounded-full border",
          color === 'w' ? "bg-white border-gray-400" : "bg-gray-900 border-gray-900"
        )} />
        {isBot && <Bot className="h-4 w-4 text-muted-foreground" />}
        <span className="font-medium">{playerName(id)}</span>
        {id === playerId && <Badge variant="outline" className="text-xs">You</Badge>}
        {active && <span className="text-xs text-primary font-semibold">{isBot ? "thinking..." : "to move"}</span>}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 flex flex-col lg:flex-row gap-6 flex-1 items-start justify-center">
      <div className="flex flex-col gap-3 w-full max-w-[560px] mx-auto lg:mx-0">
        {/* Opponent seat (top) */}
        {seatBadge(flipped ? 'w' : 'b')}

        {/* Board */}
        <div className="relative rounded-xl overflow-hidden shadow-xl border border-black/10 select-none">
          {ranks.map((row, r) => {
            const cells = flipped ? [...row].reverse() : row;
            return (
              <div key={r} className="grid grid-cols-8">
                {cells.map((cell, c) => {
                  const file = flipped ? 7 - c : c;
                  const rank = flipped ? r + 1 : 8 - r;
                  const square = `${FILES[file]}${rank}` as Square;
                  const isDark = (file + rank) % 2 === 0;
                  const isSelected = selected === square;
                  const isTarget = legalTargets.includes(square);
                  const isLastMove = state.lastMove?.from === square || state.lastMove?.to === square;

                  return (
                    <button
                      key={square}
                      aria-label={square}
                      onClick={() => handleSquareClick(square)}
                      className={cn(
                        "relative aspect-square flex items-center justify-center text-4xl sm:text-5xl leading-none",
                        isDark ? "bg-[#b58863]" : "bg-[#f0d9b5]",
                        isLastMove && "after:absolute after:inset-0 after:bg-yellow-400/30",
                        isSelected && "after:absolute after:inset-0 after:bg-emerald-500/40",
                        isMyTurn && "cursor-pointer"
                      )}
                    >
                      {cell && (
                        <span
                          className={cn(
                            "relative z-10 drop-shadow",
                            cell.color === 'w' ? "text-white" : "text-gray-900"
                          )}
                          style={{ textShadow: cell.color === 'w' ? "0 0 2px rgba(0,0,0,0.7)" : "0 0 2px rgba(255,255,255,0.3)" }}
                        >
                          {PIECE_GLYPHS[cell.type]}
                        </span>
                      )}
                      {isTarget && (
                        <span className={cn(
                          "absolute z-20 rounded-full",
                          cell ? "inset-1 border-4 border-emerald-500/70" : "w-1/4 h-1/4 bg-emerald-500/70"
                        )} />
                      )}
                      {/* Coordinates */}
                      {c === 0 && (
                        <span className="absolute left-0.5 top-0.5 text-[10px] font-bold opacity-50 z-10">{rank}</span>
                      )}
                      {r === 7 && (
                        <span className="absolute right-0.5 bottom-0 text-[10px] font-bold opacity-50 z-10">{FILES[file]}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* My seat (bottom) */}
        {seatBadge(flipped ? 'b' : 'w')}
      </div>

      {/* Side panel */}
      <Card className="w-full lg:w-72 lg:sticky lg:top-20">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Game</h3>
            {state.status === 'active' && state.check && (
              <Badge variant="destructive">Check!</Badge>
            )}
            {state.status !== 'active' && <Badge>{resultText}</Badge>}
            {!myColor && (
              <Badge variant="outline"><Eye className="h-3 w-3 mr-1" /> Spectating</Badge>
            )}
          </div>

          {/* Draw offer banner */}
          {state.status === 'active' && state.drawOfferBy && state.drawOfferBy !== playerId && myColor && (
            <div className="p-3 rounded-lg bg-amber-100 border border-amber-300 space-y-2">
              <p className="text-sm font-medium text-amber-900">
                {playerName(state.drawOfferBy)} offers a draw
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleRespondDraw(true)}>Accept</Button>
                <Button size="sm" variant="outline" onClick={() => handleRespondDraw(false)}>Decline</Button>
              </div>
            </div>
          )}

          {/* Move list */}
          <div className="max-h-64 overflow-y-auto rounded-md border bg-secondary/30 p-2 text-sm font-mono">
            {state.moves.length === 0 && (
              <p className="text-muted-foreground font-sans">No moves yet. {isMyTurn ? "Your move!" : ""}</p>
            )}
            <ol className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5">
              {Array.from({ length: Math.ceil(state.moves.length / 2) }, (_, i) => (
                <React.Fragment key={i}>
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span>{state.moves[i * 2]}</span>
                  <span>{state.moves[i * 2 + 1] ?? ""}</span>
                </React.Fragment>
              ))}
            </ol>
          </div>

          {state.status === 'active' && myColor && (
            <div className="flex gap-2">
              {!opponentIsBot && (
                <Button variant="outline" size="sm" className="flex-1" onClick={handleOfferDraw}
                  disabled={state.drawOfferBy === playerId}>
                  <Handshake className="h-4 w-4 mr-1" />
                  {state.drawOfferBy === playerId ? "Offered" : "Draw"}
                </Button>
              )}
              <Button variant="destructive" size="sm" className="flex-1" onClick={handleResign}>
                <Flag className="h-4 w-4 mr-1" /> Resign
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">Pawns promote to queens automatically.</p>
        </CardContent>
      </Card>

      {/* Game over dialog */}
      <Dialog open={showGameOver} onOpenChange={setShowGameOver}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-yellow-500" /> Game Over
            </DialogTitle>
            <DialogDescription>{resultText}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {[...players]
              .sort((a, b) => (b.score || 0) - (a.score || 0))
              .map(player => (
                <div key={player.id} className="flex justify-between p-3 rounded-md bg-secondary/80">
                  <span>{player.name}</span>
                  <span className="font-semibold">{player.score ?? 0} points</span>
                </div>
              ))}
          </div>
          <DialogFooter>
            <Button onClick={handlePlayAgain}>Back to Lobby</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChessGame;
