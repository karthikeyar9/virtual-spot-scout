import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Hash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSocket } from "@/hooks/useSocket";
import { v4 as uuidv4 } from 'uuid';

const JoinRoom = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { socket, isConnected, error } = useSocket();
  const [playerName, setPlayerName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  // Show connection error toast when socket connection fails
  useEffect(() => {
    if (error) {
      toast({
        title: "Connection Error",
        description: "Could not connect to the game server. Please try again later.",
        variant: "destructive",
      });
    }
  }, [error, toast]);

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!playerName.trim() || !roomId.trim()) {
      return;
    }
    
    setIsJoining(true);
    
    // Use socket connection to join the room
    if (socket && isConnected) {
      // Generate a unique player ID
      const playerId = uuidv4();
      
      console.log('Emitting joinRoom event:', { roomId, playerName, playerId });
      socket.emit('joinRoom', { 
        roomId, 
        playerName, 
        playerId,
        isHost: false 
      });
      
      // Navigate to the room with playerId as a parameter
      navigate(`/game/${roomId}?name=${encodeURIComponent(playerName)}&playerId=${playerId}`);
    } else {
      toast({
        title: "Connection Error",
        description: "Could not connect to the game server. Please check your connection and try again.",
        variant: "destructive",
      });
      setIsJoining(false);
    }
  };

  return (
    <form onSubmit={handleJoinRoom} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="playerName">Your Name</Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="playerName"
            placeholder="Enter your name"
            className="pl-9"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            required
          />
        </div>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="roomId">Room ID</Label>
        <div className="relative">
          <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="roomId"
            placeholder="Enter room ID"
            className="pl-9"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            required
          />
        </div>
      </div>
      
      <Button 
        type="submit" 
        className="w-full" 
        disabled={isJoining || !playerName.trim() || !roomId.trim()}
      >
        {isJoining ? "Joining Room..." : "Join Room"}
      </Button>
    </form>
  );
};

export default JoinRoom;
