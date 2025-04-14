import React from 'react';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StreetView from './StreetView';
import { mockGoogleMapsApi } from '@/test/test-utils';

// Mock UI components
vi.mock('@/components/ui/alert', () => ({
  Alert: ({ 
    children, 
    variant, 
    className 
  }: { 
    children: React.ReactNode;
    variant?: string;
    className?: string;
  }) => (
    <div data-testid="alert" data-variant={variant} className={className}>
      {children}
    </div>
  ),
  AlertTitle: ({ children }: { children: React.ReactNode }) => (
    <h3 data-testid="alert-title">{children}</h3>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="alert-description">{children}</p>
  ),
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

vi.mock('lucide-react', () => ({
  AlertCircle: () => <span data-testid="alert-circle-icon">Icon</span>
}));

describe('StreetView Component', () => {
  // Setup Google Maps mock
  const { 
    mockStreetViewPanorama, 
    mockGetPanorama 
  } = mockGoogleMapsApi();

  const testPosition = { lat: 37.7749, lng: -122.4194 }; // San Francisco coordinates

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock successful panorama response
    mockGetPanorama.mockImplementation(() => Promise.resolve({
      data: { location: { pano: 'test-pano-id' } }
    }));

    // Make sure the DOM is cleared between tests
    document.body.innerHTML = '';
  });

  test('renders loading state when not loaded', () => {
    render(
      <StreetView 
        position={testPosition}
        isLoaded={false}
        loadError={undefined}
      />
    );
    
    expect(screen.getByText('Loading Street View...')).toBeInTheDocument();
  });

  test('renders Google Maps error when loadError is provided', () => {
    const testError = new Error('Google Maps API error');
    
    render(
      <StreetView 
        position={testPosition}
        isLoaded={true}
        loadError={testError}
      />
    );
    
    expect(screen.getByTestId('alert-title')).toHaveTextContent('Google Maps Error');
    expect(screen.getByTestId('alert-description')).toHaveTextContent(/Google Maps API error/i);
  });

  test('initializes Street View panorama when loaded', () => {
    const onLoadMock = vi.fn();
    
    render(
      <StreetView 
        position={testPosition}
        isLoaded={true}
        loadError={undefined}
        onLoad={onLoadMock}
      />
    );
    
    // We expect the Street View Panorama constructor to be called
    expect(mockStreetViewPanorama).toHaveBeenCalled();
  });

  test('handles Street View error correctly', async () => {
    // Mock failed panorama response
    mockGetPanorama.mockImplementation(() => Promise.reject(new Error('No imagery available')));
    
    const onErrorMock = vi.fn();
    
    render(
      <StreetView 
        position={testPosition}
        isLoaded={true}
        loadError={undefined}
        onError={onErrorMock}
      />
    );

    // Wait for the error state to appear
    await waitFor(() => {
      expect(screen.getByTestId('alert-title')).toHaveTextContent('Street View Error');
    });
    
    // Verify error handler was called
    expect(onErrorMock).toHaveBeenCalled();
  });

  test('shows retry button on error', async () => {
    // Mock failed panorama response
    mockGetPanorama.mockImplementation(() => Promise.reject(new Error('No imagery available')));
    
    render(
      <StreetView 
        position={testPosition}
        isLoaded={true}
        loadError={undefined}
      />
    );

    // Wait for the error state to appear
    await waitFor(() => {
      const buttons = screen.getAllByTestId('button');
      const retryButton = buttons.find(button => button.textContent === 'Retry');
      expect(retryButton).toBeTruthy();
    });
  });

  test('calls skip handler when Skip button is clicked', async () => {
    // Mock failed panorama response
    mockGetPanorama.mockImplementation(() => Promise.reject(new Error('No imagery available')));
    
    const onErrorMock = vi.fn();
    
    render(
      <StreetView 
        position={testPosition}
        isLoaded={true}
        loadError={undefined}
        onError={onErrorMock}
      />
    );

    // Wait for the error state to appear and buttons to be rendered
    await waitFor(() => {
      expect(screen.getAllByTestId('button').length).toBeGreaterThan(0);
    });
    
    // Find and click the skip button
    const buttons = screen.getAllByTestId('button');
    const skipButton = buttons.find(button => button.textContent?.includes('Skip'));
    expect(skipButton).toBeTruthy();
    
    if (skipButton) {
      fireEvent.click(skipButton);
    }
    
    // Verify skip error was sent with the right message
    expect(onErrorMock).toHaveBeenCalledWith(expect.objectContaining({
      message: 'SKIP_TO_NEXT_LOCATION'
    }));
  });

}); 