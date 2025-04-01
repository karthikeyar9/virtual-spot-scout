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