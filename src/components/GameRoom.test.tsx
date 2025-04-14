import React from 'react';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import GameRoom from './GameRoom';
import { mockGoogleMapsApi } from '@/test/test-utils';

// Mock game state hooks and components
vi.mock('@/hooks/useGameState', () => ({
  useGameState: () => ({
    gameState: {
      players: [
        { id: 'player1', name: 'Player 1', isReady: true, isHost: true, score: 0 }
      ],
      rounds: [
        { 
          id: 'round1', 
          target: { lat: 37.7749, lng: -122.4194 }, 
          guesses: {},
          isComplete: false
        },
        { 
          id: 'round2', 
          target: { lat: 40.7128, lng: -74.0060 }, 
          guesses: {},
          isComplete: false
        }
      ],
      currentRound: 0,
      hasStarted: true,
      isActive: true,
      timeLimit: 60,
      savedPlayerInfo: { playerId: 'player1', playerName: 'Player 1', isHost: true }
    },
    addPlayer: vi.fn(),
    startGame: vi.fn(),
    submitGuess: vi.fn(),
    nextRound: vi.fn(),
    resetGame: vi.fn(),
    updatePlayerReadyStatus: vi.fn(),
    setPlayers: vi.fn(),
    skipToBackupLocation: vi.fn().mockReturnValue(true)
  })
}));

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({
    socket: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    },
    isConnected: true,
    error: null
  })
}));

vi.mock('@react-google-maps/api', () => ({
  useJsApiLoader: () => ({
    isLoaded: true,
    loadError: null
  }),
  StreetViewPanorama: () => <div data-testid="street-view-panorama">Street View</div>
}));

// Mock UI components
vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: { children: React.ReactNode, className?: string }) => 
    <div data-testid="card" className={className}>{children}</div>,
  CardContent: ({ children, className }: { children: React.ReactNode, className?: string }) => 
    <div data-testid="card-content" className={className}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="card-title">{children}</div>,
  CardFooter: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="card-footer">{children}</div>
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode, open: boolean }) => 
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="dialog-header">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="dialog-title">{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="dialog-footer">{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="dialog-description">{children}</div>
}));

vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="alert">{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="alert-title">{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => 
    <div data-testid="alert-description">{children}</div>
}));

// Mock child components
vi.mock('./StreetView', () => ({
  default: ({ position, onError }) => (
    <div data-testid="street-view-component">
      <p>Street View at {position ? `${position.lat}, ${position.lng}` : 'unknown'}</p>
      <button onClick={() => onError && onError(new Error('Test error'))} data-testid="error-button">
        Trigger Error
      </button>
    </div>
  )
}));

vi.mock('./GuessMap', () => ({
  default: ({ onLocationSelect, onSubmitGuess, selectedLocation }) => (
    <div data-testid="guess-map-component">
      <p>Guess Map</p>
      <button 
        onClick={() => onLocationSelect && onLocationSelect({ lat: 37.76, lng: -122.45 })}
        data-testid="select-location-button"
      >
        Select Location
      </button>
      <button 
        onClick={() => onSubmitGuess && onSubmitGuess()}
        data-testid="submit-guess-button"
        disabled={!selectedLocation}
      >
        Submit Guess
      </button>
    </div>
  )
}));

vi.mock('./Timer', () => ({
  default: ({ duration, isRunning, onComplete }) => (
    <div data-testid="timer-component">
      <p>Timer: {duration}s</p>
      {isRunning ? <p>Running</p> : <p>Stopped</p>}
      <button onClick={() => onComplete && onComplete()} data-testid="complete-timer-button">
        Complete Timer
      </button>
    </div>
  )
}));

vi.mock('./PlayerList', () => ({
  default: ({ players }) => (
    <div data-testid="player-list">
      <p>Players: {players.length}</p>
    </div>
  )
}));

vi.mock('./ResultsDisplay', () => ({
  default: ({ onNextRound }) => (
    <div data-testid="results-display">
      <button onClick={onNextRound} data-testid="next-round-button">
        Next Round
      </button>
    </div>
  )
}));

vi.mock('./Navbar', () => ({
  default: ({ roomId }) => (
    <div data-testid="navbar" data-roomid={roomId}>
      Navbar Component
    </div>
  )
}));

// Mock hooks
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual as Record<string, unknown>,
    useParams: () => ({ roomId: 'test-room-123' }),
    useSearchParams: () => [
      new URLSearchParams('name=Player1&host=true&rounds=5&time=60'),
      vi.fn()
    ],
    useNavigate: () => vi.fn()
  };
});

describe('GameRoom Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup Google Maps mock
    mockGoogleMapsApi();
    // Clear DOM between tests
    document.body.innerHTML = '';
  });

  test('renders the game interface correctly when game has started', async () => {
    render(
      <MemoryRouter initialEntries={['/game/test-room-123']}>
        <Routes>
          <Route path="/game/:roomId" element={<GameRoom />} />
        </Routes>
      </MemoryRouter>
    );

    // Verify that the main game components are rendered
    await waitFor(() => {
      expect(screen.getByTestId('street-view-component')).toBeInTheDocument();
      expect(screen.getByTestId('guess-map-component')).toBeInTheDocument();
      expect(screen.getByTestId('timer-component')).toBeInTheDocument();
      expect(screen.getByTestId('player-list')).toBeInTheDocument();
    });
  });

  test('allows making a guess', async () => {
    render(
      <MemoryRouter initialEntries={['/game/test-room-123']}>
        <Routes>
          <Route path="/game/:roomId" element={<GameRoom />} />
        </Routes>
      </MemoryRouter>
    );

    // Select a location on the map
    await waitFor(() => {
      const selectButton = screen.getByTestId('select-location-button');
      fireEvent.click(selectButton);
    });

    // Submit the guess
    const submitButton = screen.getByTestId('submit-guess-button');
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    // Verify timer stops after guess
    await waitFor(() => {
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });
  });

  test('handles StreetView errors correctly', async () => {
    render(
      <MemoryRouter initialEntries={['/game/test-room-123']}>
        <Routes>
          <Route path="/game/:roomId" element={<GameRoom />} />
        </Routes>
      </MemoryRouter>
    );

    // Trigger a StreetView error
    await waitFor(() => {
      const errorButton = screen.getByTestId('error-button');
      fireEvent.click(errorButton);
    });

    // Check that the game still works after an error
    expect(screen.getByTestId('street-view-component')).toBeInTheDocument();
    expect(screen.getByTestId('guess-map-component')).toBeInTheDocument();
  });

  test('timer completes automatically when time expires', async () => {
    render(
      <MemoryRouter initialEntries={['/game/test-room-123']}>
        <Routes>
          <Route path="/game/:roomId" element={<GameRoom />} />
        </Routes>
      </MemoryRouter>
    );

    // Trigger timer completion
    await waitFor(() => {
      const completeTimerButton = screen.getByTestId('complete-timer-button');
      fireEvent.click(completeTimerButton);
    });

    // Verify timer stops after completion
    await waitFor(() => {
      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });
  });
}); 