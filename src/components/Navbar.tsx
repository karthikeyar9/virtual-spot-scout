import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, RotateCcw, Info, Share2, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';

interface NavbarProps {
  onRestartGame?: () => void;
  roomId?: string;
  gameName?: string;
}

const Navbar: React.FC<NavbarProps> = ({ onRestartGame, roomId, gameName }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const isGameRoom = location.pathname.includes('/game/');

  const handleRestart = () => {
    if (onRestartGame) {
      onRestartGame();
      toast({
        title: "Game Restarted",
        description: "Starting a new game with fresh locations",
      });
    }
  };

  const handleShareGame = () => {
    if (roomId) {
      // Use current pathname which already includes /game/:gameType/:roomId
      const shareUrl = `${window.location.origin}${location.pathname}`;
      navigator.clipboard.writeText(shareUrl);
      toast({
        title: "Link Copied!",
        description: "Game link copied to clipboard",
      });
    }
  };

  return (
    <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b">
      <div className="container mx-auto px-4 py-2 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <span className="font-bold text-lg">Virtual Scout</span>
            {gameName && (
              <span className="text-sm text-muted-foreground hidden sm:inline">/ {gameName}</span>
            )}
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {isGameRoom && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleShareGame}
                disabled={!roomId}
                title="Share Game"
              >
                <Share2 className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Share</span>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Menu
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => navigate('/')}>
                    <Home className="h-4 w-4 mr-2" />
                    Home
                  </DropdownMenuItem>
                  {onRestartGame && (
                    <DropdownMenuItem onClick={handleRestart}>
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Restart Game
                    </DropdownMenuItem>
                  )}
                  {/* <DropdownMenuItem onClick={() => window.open('https://github.com/username/virtual-spot-scout', '_blank')}>
                    <Info className="h-4 w-4 mr-2" />
                    About
                  </DropdownMenuItem> */}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Navbar; 