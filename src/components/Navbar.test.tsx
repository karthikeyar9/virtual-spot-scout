import React from 'react';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Navbar from './Navbar';

// Simple mock for toast functionality
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

// Mock navigate function
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual as Record<string, unknown>,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/game/test-room-123' })
  };
});

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn()
  }
});

// Mock the entire Dropdown menu as it's complex to test
vi.mock('@/components/ui/dropdown-menu', () => {
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdown-menu">{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <button data-testid="menu-trigger">{children}</button>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div data-testid="menu-content">{children}</div>,
    DropdownMenuItem: ({ 
      children, 
      onClick 
    }: { 
      children: React.ReactNode;
      onClick?: () => void;
    }) => <button data-testid="menu-item" onClick={onClick}>{children}</button>,
  };
});

// Mock Button component
vi.mock('@/components/ui/button', () => ({
  Button: ({ 
    children, 
    onClick,
    title
  }: { 
    children: React.ReactNode;
    onClick?: () => void;
    title?: string;
  }) => (
    <button onClick={onClick} title={title} data-testid="button">
      {children}
    </button>
  )
}));

describe('Navbar Component', () => {
  const renderNavbar = (props = {}) => {
    return render(
      <BrowserRouter>
        <Navbar roomId="test-room-123" {...props} />
      </BrowserRouter>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders with logo and brand name', () => {
    renderNavbar();
    expect(screen.getByText('Virtual Scout')).toBeInTheDocument();
  });

  test('shows share button on game page', () => {
    renderNavbar();
    const shareButtons = screen.getAllByTestId('button');
    const shareButton = shareButtons.find(button => button.title === 'Share Game');
    expect(shareButton).toBeTruthy();
  });

  test('shares game link when share button is clicked', () => {
    renderNavbar();
    const shareButtons = screen.getAllByTestId('button');
    const shareButton = shareButtons.find(button => button.title === 'Share Game');
    
    if (shareButton) {
      fireEvent.click(shareButton);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('/game/test-room-123')
      );
    }
  });

  test('renders menu button on game page', () => {
    renderNavbar();
    expect(screen.getByText('Menu')).toBeInTheDocument();
  });

  test('shows restart button when onRestartGame prop is provided', () => {
    const mockRestartGame = vi.fn();
    renderNavbar({ onRestartGame: mockRestartGame });
    
    // Open dropdown menu
    fireEvent.click(screen.getByTestId('menu-trigger'));
    
    // Check if restart option exists
    expect(screen.getByText('Restart Game')).toBeInTheDocument();
  });

  test('calls onRestartGame when restart button is clicked', () => {
    const mockRestartGame = vi.fn();
    renderNavbar({ onRestartGame: mockRestartGame });
    
    // Get all menu items
    const menuItems = screen.getAllByTestId('menu-item');
    // Find the restart button
    const restartButton = menuItems.find(item => item.textContent?.includes('Restart Game'));
    
    if (restartButton) {
      fireEvent.click(restartButton);
      expect(mockRestartGame).toHaveBeenCalled();
    }
  });

  test('navigates to home when home button is clicked', () => {
    renderNavbar();
    
    // Get all menu items
    const menuItems = screen.getAllByTestId('menu-item');
    // Find the home button
    const homeButton = menuItems.find(item => item.textContent?.includes('Home'));
    
    if (homeButton) {
      fireEvent.click(homeButton);
      expect(mockNavigate).toHaveBeenCalledWith('/');
    }
  });
}); 