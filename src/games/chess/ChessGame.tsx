import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
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
  drawReason?: string | null;
  winnerId: string | null;
  check: boolean;
  drawOfferBy: string | null;
}

type PromotionPiece = 'q' | 'r' | 'b' | 'n';

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNTS: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
// Small text glyphs for the captured-pieces strip only (the board uses SVG pieces).
const CAPTURE_GLYPHS: Record<string, string> = { q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

const LAST_MOVE_STYLE: React.CSSProperties = { backgroundColor: "rgba(250, 204, 21, 0.45)" };
const SELECTED_STYLE: React.CSSProperties = { backgroundColor: "rgba(16, 185, 129, 0.5)" };
const TARGET_STYLE: React.CSSProperties = {
  backgroundImage: "radial-gradient(circle, rgba(16,185,129,0.75) 22%, transparent 24%)",
  cursor: "pointer",
};
const CAPTURE_TARGET_STYLE: React.CSSProperties = {
  backgroundImage: "radial-gradient(circle, transparent 62%, rgba(16,185,129,0.75) 64%)",
  cursor: "pointer",
};
const CHECK_STYLE: React.CSSProperties = {
  backgroundImage: "radial-gradient(circle, rgba(239,68,68,0.9) 0%, rgba(239,68,68,0.45) 45%, transparent 75%)",
};

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
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);

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
      setPendingPromotion(null);
    };

    const handleGameOver = ({ players: finalPlayers }: { players: GameComponentProps['players'] }) => {
      setPlayers(finalPlayers);
      setShowGameOver(true);
    };

    const handleInvalidMove = () => {
      toast({ title: "Invalid move", variant: "destructive" });
      setSelected(null);
      setLegalTargets([]);
      // Roll back the optimistic board update
      socket.emit('chess:requestState', { roomId });
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

  const clearSelection = useCallback(() => {
    setSelected(null);
    setLegalTargets([]);
  }, []);

  // Sends a move and applies it locally right away so the piece doesn't snap
  // back while waiting for the server's authoritative state.
  const sendMove = useCallback((from: Square, to: Square, promotion: PromotionPiece = 'q') => {
    if (!state || !socket) return false;
    const game = new Chess(state.fen);
    let san: string;
    try {
      san = game.move({ from, to, promotion }).san;
    } catch {
      return false;
    }
    setState({
      ...state,
      fen: game.fen(),
      turn: game.turn(),
      lastMove: { from, to },
      moves: [...state.moves, san],
      check: game.inCheck(),
      drawOfferBy: null,
    });
    socket.emit('chess:move', { roomId, playerId, from, to, promotion });
    clearSelection();
    return true;
  }, [state, socket, roomId, playerId, clearSelection]);

  // Returns true if the move was played; promotions open the piece picker instead.
  const tryMove = useCallback((from: Square, to: Square) => {
    if (!chess || !isMyTurn) return false;
    const move = chess.moves({ square: from, verbose: true }).find(m => m.to === to);
    if (!move) return false;
    if (move.promotion) {
      setPendingPromotion({ from, to });
      clearSelection();
      return false;
    }
    return sendMove(from, to);
  }, [chess, isMyTurn, sendMove, clearSelection]);

  const selectSquare = useCallback((square: Square) => {
    if (!chess) return;
    setSelected(square);
    setLegalTargets(chess.moves({ square, verbose: true }).map(m => m.to as Square));
  }, [chess]);

  const handleSquareClick = useCallback((square: Square) => {
    if (!chess || !isMyTurn) return;
    setPendingPromotion(null);

    if (selected && legalTargets.includes(square)) {
      tryMove(selected, square);
      return;
    }

    // Otherwise (re)select one of my pieces
    const piece = chess.get(square);
    if (piece && piece.color === myColor && square !== selected) {
      selectSquare(square);
    } else {
      clearSelection();
    }
  }, [chess, isMyTurn, selected, legalTargets, myColor, tryMove, selectSquare, clearSelection]);

  const handlePromotionSelect = useCallback((piece?: string) => {
    if (piece && pendingPromotion) {
      sendMove(pendingPromotion.from, pendingPromotion.to, piece[1].toLowerCase() as PromotionPiece);
    }
    setPendingPromotion(null);
    return false; // we already applied the move ourselves
  }, [pendingPromotion, sendMove]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (!state || !chess) return styles;
    if (state.lastMove) {
      styles[state.lastMove.from] = LAST_MOVE_STYLE;
      styles[state.lastMove.to] = LAST_MOVE_STYLE;
    }
    if (state.check && state.status === 'active') {
      for (const row of chess.board()) {
        for (const cell of row) {
          if (cell && cell.type === 'k' && cell.color === state.turn) {
            styles[cell.square] = CHECK_STYLE;
          }
        }
      }
    }
    if (selected) styles[selected] = SELECTED_STYLE;
    for (const target of legalTargets) {
      styles[target] = { ...styles[target], ...(chess.get(target) ? CAPTURE_TARGET_STYLE : TARGET_STYLE) };
    }
    return styles;
  }, [state, chess, selected, legalTargets]);

  // Pieces each side has lost, plus the material balance from white's view
  const material = useMemo(() => {
    const counts: Record<'w' | 'b', Record<string, number>> = { w: {}, b: {} };
    let balance = 0;
    if (chess) {
      for (const row of chess.board()) {
        for (const cell of row) {
          if (!cell) continue;
          counts[cell.color][cell.type] = (counts[cell.color][cell.type] || 0) + 1;
          balance += PIECE_VALUES[cell.type] * (cell.color === 'w' ? 1 : -1);
        }
      }
    }
    const lost = (color: 'w' | 'b') =>
      Object.keys(START_COUNTS)
        .map(type => CAPTURE_GLYPHS[type].repeat(Math.max(0, START_COUNTS[type] - (counts[color][type] || 0))))
        .join("");
    return { lostWhite: lost('w'), lostBlack: lost('b'), balance };
  }, [chess]);

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

  const resultText = (() => {
    if (state.status === 'checkmate') return `Checkmate — ${playerName(state.winnerId)} wins!`;
    if (state.status === 'resigned') return `${playerName(state.winnerId)} wins by resignation`;
    if (state.status === 'draw') return state.drawReason ? `Draw by ${state.drawReason}` : "Draw";
    return "";
  })();

  const opponentIsBot = players.some(p => p.isBot);

  const seatBadge = (color: 'w' | 'b') => {
    const id = color === 'w' ? state.whiteId : state.blackId;
    const isBot = players.find(p => p.id === id)?.isBot;
    const active = state.status === 'active' && state.turn === color;
    const advantage = color === 'w' ? material.balance : -material.balance;
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
        <span className="ml-auto flex items-center gap-1 text-sm text-muted-foreground leading-none">
          <span className="tracking-tighter">{color === 'w' ? material.lostBlack : material.lostWhite}</span>
          {advantage > 0 && <span className="text-xs font-semibold">+{advantage}</span>}
        </span>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 flex flex-col lg:flex-row gap-6 flex-1 items-start justify-center">
      <div className="flex flex-col gap-3 w-full mx-auto lg:mx-0" style={{ maxWidth: "min(560px, calc(100dvh - 200px))", minWidth: "min(100%, 280px)" }}>
        {/* Opponent seat (top) */}
        {seatBadge(flipped ? 'w' : 'b')}

        {/* Board */}
        <div className="rounded-xl overflow-hidden shadow-xl border border-black/10 select-none touch-none">
          <Chessboard
            id="chess-board"
            position={state.fen}
            boardOrientation={flipped ? "black" : "white"}
            animationDuration={200}
            arePiecesDraggable={isMyTurn}
            isDraggablePiece={({ piece }) => isMyTurn && piece[0] === myColor}
            onPieceDragBegin={(_piece, square) => selectSquare(square as Square)}
            onPieceDragEnd={clearSelection}
            onPieceDrop={(from, to) => tryMove(from as Square, to as Square)}
            onSquareClick={(square) => handleSquareClick(square as Square)}
            onPromotionCheck={() => false}
            showPromotionDialog={!!pendingPromotion}
            promotionToSquare={pendingPromotion?.to ?? null}
            onPromotionPieceSelect={handlePromotionSelect}
            customSquareStyles={squareStyles}
            customDarkSquareStyle={{ backgroundColor: "#b58863" }}
            customLightSquareStyle={{ backgroundColor: "#f0d9b5" }}
          />
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

          <p className="text-xs text-muted-foreground">Drag a piece or tap it, then tap a highlighted square.</p>
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
