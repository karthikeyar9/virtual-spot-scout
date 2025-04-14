import { vi } from 'vitest';

// Mock Google Maps API
export const mockGoogleMapsApi = () => {
  const mockStreetViewPanorama = vi.fn();
  const mockStreetViewService = vi.fn();
  const mockLatLng = vi.fn();
  const mockMap = vi.fn();

  const mockGetPanorama = vi.fn();

  global.google = {
    maps: {
      StreetViewPanorama: mockStreetViewPanorama,
      StreetViewService: vi.fn(() => ({
        getPanorama: mockGetPanorama
      })),
      Map: mockMap,
      LatLng: mockLatLng,
      StreetViewSource: {
        OUTDOOR: 'OUTDOOR'
      },
      event: {
        addDomListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn()
      },
      Size: vi.fn(),
      Point: vi.fn(),
      Marker: vi.fn(() => ({
        setMap: vi.fn(),
        setPosition: vi.fn()
      })),
      InfoWindow: vi.fn(() => ({
        open: vi.fn(),
        close: vi.fn(),
        setContent: vi.fn()
      })),
      geometry: {
        spherical: {
          computeDistanceBetween: vi.fn(() => 1000)
        }
      }
    }
  } as any;

  return {
    mockStreetViewPanorama,
    mockStreetViewService,
    mockGetPanorama,
    mockMap,
    mockLatLng
  };
};

// Re-export testing library utilities
export * from '@testing-library/react'; 