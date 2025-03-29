
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Hash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const JoinRoom = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [playerName, setPlayerName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!playerName.trim() || !roomId.trim()) {
      return;
    }
    
    setIsJoining(true);
    
    // In a real app, we would verify the room exists on a backend here
    // For now, we'll just navigate to the room with a small delay
    setTimeout(() => {
      // Here we would check if the room exists
      // For demo purposes, we'll just simulate success
      
      // Simulating room existence check
      const roomExists = true; // This would be a backend check
      
      if (roomExists) {
        navigate(`/game/${roomId}?name=${encodeURIComponent(playerName)}`);
      } else {
        toast({
          title: "Room Not Found",
          description: "The room ID you entered doesn't exist",
          variant: "destructive",
        });
        setIsJoining(false);
      }
    }, 1000);
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
