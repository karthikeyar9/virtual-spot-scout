import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Gamepad2, Users, Hash, User } from "lucide-react";
import { gameList } from "@/games/registry";
import Navbar from "@/components/Navbar";
import { useSocket } from "@/hooks/useSocket";
import { useToast } from "@/hooks/use-toast";
import { v4 as uuidv4 } from 'uuid';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { socket, isConnected } = useSocket();
  const { toast } = useToast();
  const [joinName, setJoinName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinName.trim() || !joinRoomId.trim()) return;
    setIsJoining(true);

    if (socket && isConnected) {
      const playerId = uuidv4();
      socket.emit('joinRoom', {
        roomId: joinRoomId,
        playerName: joinName,
        playerId,
        isHost: false,
      });
      // Auto-detect game type via redirect - server will tell us
      // For now navigate to a join route
      navigate(`/join/${joinRoomId}?name=${encodeURIComponent(joinName)}&playerId=${playerId}`);
    } else {
      toast({
        title: "Connection Error",
        description: "Could not connect to the game server.",
        variant: "destructive",
      });
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-cyan-50">
      <Navbar />
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-6xl w-full mx-auto flex flex-col items-center">
          <div className="text-center mb-10 animate-appear">
            <h1 className="text-5xl font-bold text-primary mb-4 flex items-center justify-center">
              <Gamepad2 className="mr-3 h-10 w-10" />
              Virtual Spot Scout
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Pick a game, create a room, and play with friends! A party game platform for everyone.
            </p>
          </div>

          {/* Game Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-5xl mb-10 animate-appear" style={{ animationDelay: "0.1s" }}>
            {gameList.map((game) => {
              const Icon = game.icon;
              return (
                <Card
                  key={game.id}
                  className="bg-white/80 backdrop-blur-sm hover:shadow-lg transition-all cursor-pointer group hover:scale-[1.02]"
                  onClick={() => navigate(`/game/${game.id}/create`)}
                >
                  <CardHeader className="pb-3">
                    <div className={`w-12 h-12 rounded-lg ${game.color} flex items-center justify-center mb-2 group-hover:scale-110 transition-transform`}>
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <CardTitle className="text-lg">{game.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm">
                      {game.description}
                    </CardDescription>
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      <span>{game.minPlayers}-{game.maxPlayers} players</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Join Existing Room */}
          <Card className="w-full max-w-md animate-appear" style={{ animationDelay: "0.2s" }}>
            <CardHeader>
              <CardTitle className="text-lg">Join an Existing Room</CardTitle>
              <CardDescription>Enter a room code to join a game in progress</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleJoinRoom} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="joinName">Your Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="joinName"
                      placeholder="Enter your name"
                      className="pl-9"
                      value={joinName}
                      onChange={(e) => setJoinName(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="joinRoomId">Room Code</Label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="joinRoomId"
                      placeholder="Enter room code"
                      className="pl-9"
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isJoining || !joinName.trim() || !joinRoomId.trim()}
                >
                  {isJoining ? "Joining..." : "Join Room"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      <footer className="mt-16 text-center text-sm text-muted-foreground pb-4">
        <p>Virtual Spot Scout &copy; {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
};

export default Home;
