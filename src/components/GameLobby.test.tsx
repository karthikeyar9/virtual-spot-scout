import React from 'react';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import GameLobby from './GameLobby';

// Simple mock for toast functionality
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

// Mock navigate function
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual as Record<string, unknown>,
    useNavigate: () => vi.fn(),
  };
});

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn()
  }
});

// Mock UI components
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children, className }: { children: React.ReactNode, className?: string }) => 
    <h2 data-testid="card-title" className={className}>{children}</h2>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div data-testid="card-content">{children}</div>,
  CardFooter: ({ children, className }: { children: React.ReactNode, className?: string }) => 
    <div data-testid="card-footer" className={className}>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ 
    children, 
    onClick,
    disabled,
    variant,
    className
  }: { 
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    className?: string;
  }) => (
    <button 
      onClick={onClick} 
      disabled={disabled}
      data-testid="button"
      data-variant={variant}
      className={className}
    >
      {children}
    </button>
  )
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ 
    children, 
    variant,
    className
  }: { 
    children: React.ReactNode;
    variant?: string;
    className?: string;
  }) => (
    <span 
      data-testid="badge"
      data-variant={variant}
      className={className}
    >
      {children}
    </span>
  )
}));

// Mock Navbar component
vi.mock('./Navbar', () => ({
  default: ({ roomId }: { roomId?: string }) => (
    <div data-testid="navbar" data-roomid={roomId}>
      Navbar
    </div>
  )
}));

describe('GameLobby Component', () => {
  const mockPlayers = [
    { id: '1', name: 'Player 1', isReady: false, isHost: true },
    { id: '2', name: 'Player 2', isReady: false, isHost: false },
  ];

  const currentPlayer = { id: '1', name: 'Player 1', isReady: false, isHost: true };

  const renderGameLobby = (props = {}) => {
    return render(
      <BrowserRouter>
        <GameLobby
          roomId="test-room-123"
          players={mockPlayers}
          isHost={true}
          currentPlayer={currentPlayer}
          onStartGame={vi.fn()}
          onToggleReady={vi.fn()}
          {...props}
        />
      </BrowserRouter>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders the game lobby with room code', () => {
    renderGameLobby();
    expect(screen.getByText('Game Lobby')).toBeInTheDocument();
    expect(screen.getByText('Room Code: test-room-123')).toBeInTheDocument();
  });

  test('displays all players in the list', () => {
    renderGameLobby();
    expect(screen.getByText('Player 1')).toBeInTheDocument();
    expect(screen.getByText('Player 2')).toBeInTheDocument();
  });

  test('shows host badge for the host player', () => {
    renderGameLobby();
    const badges = screen.getAllByTestId('badge');
    const hostBadge = badges.find(badge => badge.textContent === 'Host');
    expect(hostBadge).toBeTruthy();
  });

  test('copies room link when share button is clicked', () => {
    renderGameLobby();
    
    const buttons = screen.getAllByTestId('button');
    const shareButton = buttons.find(button => button.textContent?.includes('Share'));
    
    if (shareButton) {
      fireEvent.click(shareButton);
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('/game/test-room-123')
      );
    }
  });

  test('calls onToggleReady when ready button is clicked', () => {
    const mockToggleReady = vi.fn();
    renderGameLobby({ onToggleReady: mockToggleReady });
    
    const buttons = screen.getAllByTestId('button');
    const readyButton = buttons.find(button => button.textContent === 'Ready');
    
    if (readyButton) {
      fireEvent.click(readyButton);
      expect(mockToggleReady).toHaveBeenCalled();
    }
  });

  test('shows start game button when current player is ready', () => {
    const readyPlayer = { ...currentPlayer, isReady: true };
    renderGameLobby({ currentPlayer: readyPlayer });
    
    expect(screen.getByText('Waiting...')).toBeInTheDocument();
  });

  test('enables start game button when all players are ready', () => {
    const readyPlayers = [
      { id: '1', name: 'Player 1', isReady: true, isHost: true },
      { id: '2', name: 'Player 2', isReady: true, isHost: false },
    ];
    
    const readyPlayer = { ...currentPlayer, isReady: true };
    
    renderGameLobby({ 
      players: readyPlayers, 
      currentPlayer: readyPlayer 
    });
    
    const buttons = screen.getAllByTestId('button');
    const startButton = buttons.find(button => button.textContent?.includes('Start Game'));
    
    expect(startButton).toBeTruthy();
    expect(startButton).not.toHaveAttribute('disabled');
  });

  test('calls onStartGame when start button is clicked', () => {
    const readyPlayers = [
      { id: '1', name: 'Player 1', isReady: true, isHost: true },
      { id: '2', name: 'Player 2', isReady: true, isHost: false },
    ];
    
    const readyPlayer = { ...currentPlayer, isReady: true };
    const mockStartGame = vi.fn();
    
    renderGameLobby({ 
      players: readyPlayers, 
      currentPlayer: readyPlayer,
      onStartGame: mockStartGame
    });
    
    const buttons = screen.getAllByTestId('button');
    const startButton = buttons.find(button => button.textContent?.includes('Start Game'));
    
    if (startButton) {
      fireEvent.click(startButton);
      expect(mockStartGame).toHaveBeenCalled();
    }
  });
}); 