
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapPin, Globe, Clock, Trophy, Users } from "lucide-react";
import RoomCreation from "@/components/RoomCreation";
import JoinRoom from "@/components/JoinRoom";

const Index = () => {
  const [activeTab, setActiveTab] = useState<string>("create");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-cyan-50 map-pattern p-4">
      <div className="max-w-6xl w-full mx-auto flex flex-col items-center">
        <div className="text-center mb-8 animate-appear">
          <h1 className="text-5xl font-bold text-primary mb-4 flex items-center justify-center">
            <Globe className="mr-3 h-10 w-10" />
            Virtual City Guesser
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Test your geography skills by guessing world locations from street view images.
            Compete with friends to see who can pinpoint cities most accurately!
          </p>
        </div>

        <div className="w-full max-w-md mb-10 animate-appear" style={{ animationDelay: "0.1s" }}>
          <Tabs defaultValue="create" className="w-full" onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create">Create Room</TabsTrigger>
              <TabsTrigger value="join">Join Room</TabsTrigger>
            </TabsList>
            <TabsContent value="create">
              <Card>
                <CardHeader>
                  <CardTitle>Create a New Game Room</CardTitle>
                  <CardDescription>
                    Set up a new game and invite friends to play
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RoomCreation />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="join">
              <Card>
                <CardHeader>
                  <CardTitle>Join an Existing Room</CardTitle>
                  <CardDescription>
                    Enter a room code to join a game in progress
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <JoinRoom />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-5xl animate-appear" style={{ animationDelay: "0.2s" }}>
          <Card className="bg-white/80 backdrop-blur-sm hover:shadow-md transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center text-lg">
                <MapPin className="h-5 w-5 mr-2 text-primary" />
                Guess Locations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                View street scenes from around the world and guess where you are on the map.
              </p>
            </CardContent>
          </Card>
          
          <Card className="bg-white/80 backdrop-blur-sm hover:shadow-md transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center text-lg">
                <Clock className="h-5 w-5 mr-2 text-primary" />
                Beat the Clock
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Make your guesses before time runs out to score maximum points.
              </p>
            </CardContent>
          </Card>
          
          <Card className="bg-white/80 backdrop-blur-sm hover:shadow-md transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center text-lg">
                <Users className="h-5 w-5 mr-2 text-primary" />
                Multiplayer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Compete with friends in real-time to see who has the best geography skills.
              </p>
            </CardContent>
          </Card>
          
          <Card className="bg-white/80 backdrop-blur-sm hover:shadow-md transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center text-lg">
                <Trophy className="h-5 w-5 mr-2 text-primary" />
                Score Points
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Earn points based on how close your guess is to the actual location.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
      
      <footer className="mt-16 text-center text-sm text-muted-foreground">
        <p>Virtual City Guesser &copy; {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
};

export default Index;
