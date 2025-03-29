
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Clock, User } from "lucide-react";

const RoomCreation = () => {
  const navigate = useNavigate();
  const [playerName, setPlayerName] = useState("");
  const [rounds, setRounds] = useState(5);
  const [timeLimit, setTimeLimit] = useState(60);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!playerName.trim()) {
      return;
    }
    
    setIsCreating(true);
    
    // Generate a room ID
    const roomId = `room-${Math.floor(Math.random() * 10000)}`;
    
    // In a real app, we would create the room on a backend here
    // For now, we'll just navigate to the game room with params
    setTimeout(() => {
      navigate(`/game/${roomId}?name=${encodeURIComponent(playerName)}&rounds=${rounds}&time=${timeLimit}&host=true`);
    }, 1000);
  };

  return (
    <form onSubmit={handleCreateRoom} className="space-y-6">
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
        <div className="flex justify-between">
          <Label htmlFor="rounds">Number of Rounds</Label>
          <span className="text-sm text-muted-foreground">{rounds}</span>
        </div>
        <Select 
          value={rounds.toString()} 
          onValueChange={(value) => setRounds(parseInt(value))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Number of rounds" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">3 Rounds</SelectItem>
            <SelectItem value="5">5 Rounds</SelectItem>
            <SelectItem value="7">7 Rounds</SelectItem>
            <SelectItem value="10">10 Rounds</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label htmlFor="timeLimit">Time Limit per Round</Label>
          <span className="text-sm text-muted-foreground">{timeLimit} seconds</span>
        </div>
        <div className="flex items-center gap-3">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <Slider 
            id="timeLimit"
            min={30}
            max={120}
            step={15}
            value={[timeLimit]}
            onValueChange={(value) => setTimeLimit(value[0])}
          />
        </div>
      </div>
      
      <Button 
        type="submit" 
        className="w-full" 
        disabled={isCreating || !playerName.trim()}
      >
        {isCreating ? "Creating Room..." : "Create Room"}
      </Button>
    </form>
  );
};

export default RoomCreation;
