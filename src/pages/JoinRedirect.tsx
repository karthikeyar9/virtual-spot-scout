import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useSocket } from "@/hooks/useSocket";
import Navbar from "@/components/Navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const JoinRedirect: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { socket, isConnected } = useSocket();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!socket || !isConnected || !roomId) return;

    socket.emit('getRoomState', { roomId });

    const handleRoomState = (roomState: any) => {
      const gameType = roomState.gameType || 'city-guesser';
      // Preserve query params when redirecting
      const params = searchParams.toString();
      navigate(`/game/${gameType}/${roomId}${params ? `?${params}` : ''}`, { replace: true });
    };

    const timeout = setTimeout(() => {
      setError(true);
    }, 5000);

    socket.on('roomState', handleRoomState);

    return () => {
      socket.off('roomState', handleRoomState);
      clearTimeout(timeout);
    };
  }, [socket, isConnected, roomId, navigate, searchParams]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex items-center justify-center flex-1">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground mb-4">Room not found or connection failed.</p>
              <Button onClick={() => navigate('/')}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className="flex items-center justify-center flex-1">
        <p>Joining room {roomId}...</p>
      </div>
    </div>
  );
};

export default JoinRedirect;
