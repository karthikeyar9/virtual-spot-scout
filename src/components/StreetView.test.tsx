import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '../test/test-utils';
import { mockGoogleMapsApi } from '../test/test-utils';
import StreetView from './StreetView';

describe('StreetView', () => {
  beforeEach(() => {
    mockGoogleMapsApi();
  });

  it('shows loading state when not loaded', () => {
    render(<StreetView isLoaded={false} />);
    expect(screen.getByText('Loading Street View...')).toBeInTheDocument();
  });

  it('shows error when Street View service fails', async () => {
    const { mockGetPanorama } = mockGoogleMapsApi();
    mockGetPanorama.mockRejectedValue(new Error('Service failed'));

    render(
      <StreetView
        isLoaded={true}
        position={{ lat: 0, lng: 0 }}
      />
    );

    // Wait for error message to appear
    const errorMessage = await screen.findByText('Failed to load Street View. Please try again.');
    expect(errorMessage).toBeInTheDocument();
  });

  it('shows error when no panorama is available', async () => {
    const { mockGetPanorama } = mockGoogleMapsApi();
    mockGetPanorama.mockResolvedValue({ data: null });

    render(
      <StreetView
        isLoaded={true}
        position={{ lat: 0, lng: 0 }}
      />
    );

    // Wait for error message to appear
    const errorMessage = await screen.findByText('Street View is not available for this location.');
    expect(errorMessage).toBeInTheDocument();
  });

  it('initializes Street View when panorama is available', async () => {
    const { mockGetPanorama, mockStreetViewPanorama } = mockGoogleMapsApi();
    const mockLatLng = { lat: () => 0, lng: () => 0 };
    
    mockGetPanorama.mockResolvedValue({
      data: {
        location: {
          latLng: mockLatLng
        }
      }
    });

    const onLoad = vi.fn();

    render(
      <StreetView
        isLoaded={true}
        position={{ lat: 0, lng: 0 }}
        onLoad={onLoad}
      />
    );

    // Wait for Street View to initialize
    await vi.waitFor(() => {
      expect(mockStreetViewPanorama).toHaveBeenCalled();
    });

    expect(onLoad).toHaveBeenCalled();
  });
}); 