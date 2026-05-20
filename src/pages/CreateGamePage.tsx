import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Clock, User, ArrowLeft, Loader2 } from "lucide-react";
import { getGame } from "@/games/registry";
import Navbar from "@/components/Navbar";
import { useSocket } from "@/hooks/useSocket";
import { v4 as uuidv4 } from 'uuid';

const CreateGamePage: React.FC = () => {
  const { gameType } = useParams<{ gameType: string }>();
  const navigate = useNavigate();
  const { socket, isConnected } = useSocket();

  const game = gameType ? getGame(gameType) : undefined;

  const [playerName, setPlayerName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [configValues, setConfigValues] = useState<Record<string, string | number>>({});

  // Initialize config with defaults
  useEffect(() => {
    if (game) {
      const defaults: Record<string, string | number> = {};
      game.configFields.forEach(field => {
        defaults[field.key] = field.defaultValue;
      });
      setConfigValues(defaults);
    }
  }, [game]);

  // Socket retries automatically — no need to surface transient errors here.

  if (!game || !gameType) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex items-center justify-center flex-1">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground mb-4">Game type not found.</p>
              <Button onClick={() => navigate('/')}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const Icon = game.icon;

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim() || !socket || !isConnected) return;
    setIsCreating(true);

    const roomId = `room-${Math.floor(Math.random() * 10000)}`;
    const playerId = uuidv4();

    socket!.emit('joinRoom', {
      roomId,
      playerName,
      playerId,
      isHost: true,
      gameType,
    });

    const params = new URLSearchParams({
      name: playerName,
      host: 'true',
      playerId,
    });

    Object.entries(configValues).forEach(([key, value]) => {
      params.set(key, String(value));
    });

    navigate(`/game/${gameType}/${roomId}?${params.toString()}`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-cyan-50">
      <Navbar />
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 rounded-lg ${game.color} flex items-center justify-center`}>
                <Icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle>{game.name}</CardTitle>
                <CardDescription>Create a new room</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
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

              {game.configFields.map(field => (
                <div key={field.key} className="space-y-2">
                  <div className="flex justify-between">
                    <Label htmlFor={field.key}>{field.label}</Label>
                    {field.type === 'slider' && (
                      <span className="text-sm text-muted-foreground">
                        {configValues[field.key]} seconds
                      </span>
                    )}
                    {field.type === 'select' && (
                      <span className="text-sm text-muted-foreground">
                        {configValues[field.key]}
                      </span>
                    )}
                  </div>

                  {field.type === 'select' && field.options && (
                    <Select
                      value={String(configValues[field.key] || field.defaultValue)}
                      onValueChange={(value) => setConfigValues(prev => ({ ...prev, [field.key]: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {field.type === 'slider' && (
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <Slider
                        id={field.key}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        value={[Number(configValues[field.key] || field.defaultValue)]}
                        onValueChange={(value) => setConfigValues(prev => ({ ...prev, [field.key]: value[0] }))}
                      />
                    </div>
                  )}
                </div>
              ))}

              <Button type="submit" className="w-full" disabled={isCreating || !playerName.trim() || !isConnected}>
                {!isConnected ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connecting to server...</>
                ) : isCreating ? "Creating Room..." : "Create Room"}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => navigate('/')}
              >
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Games
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CreateGamePage;
