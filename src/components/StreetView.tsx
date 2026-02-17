import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface StreetViewProps {
  position?: { lat: number; lng: number };
  className?: string;
  onLoad?: () => void;
  onError?: (error: Error) => void;
  isLoaded: boolean;
  loadError?: Error | null;
}

const StreetView: React.FC<StreetViewProps> = ({
  position,
  className,
  onLoad,
  onError,
  isLoaded,
  loadError
}) => {
  const streetViewRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [loadRetries, setLoadRetries] = useState(0);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds

  const initializeStreetView = () => {
    if (!streetViewRef.current || !position || !isLoaded) return;

    const panorama = new google.maps.StreetViewPanorama(streetViewRef.current, {
      position,
      pov: { heading: 0, pitch: 0 },
      zoom: 1,
      addressControl: false,
      showRoadLabels: false,
      motionTracking: false,
      fullscreenControl: false,
      linksControl: false,
      motionTrackingControl: false,
      panControl: true,
      enableCloseButton: false,
      visible: true
    });

    // Handle panorama status changes
    panorama.addListener('status_changed', () => {
      const status = panorama.getStatus();
      console.log('Street View status:', status);
      
      if (status === google.maps.StreetViewStatus.OK) {
        setLoadingError(null);
        if (onLoad) onLoad();
      } else if (status === google.maps.StreetViewStatus.ZERO_RESULTS) {
        if (onError) onError(new Error("SKIP_TO_NEXT_LOCATION"));
      }
    });

    // Handle panorama visibility changes and errors
    panorama.addListener('visible_changed', () => {
      if (!panorama.getVisible()) {
        handleLoadError('Street View not available for this location');
      }
    });

    panoramaRef.current = panorama;
  };

  const handleLoadError = (errorMessage: string) => {
    console.error('Street View error:', errorMessage);
    setLoadingError(errorMessage);

    if (loadRetries < maxRetries) {
      setTimeout(() => {
        console.log(`Retrying Street View load (attempt ${loadRetries + 1}/${maxRetries})`);
        setLoadRetries(prev => prev + 1);
        initializeStreetView();
      }, retryDelay);
    } else if (onError) {
      onError(new Error("SKIP_TO_NEXT_LOCATION"));
    }
  };

  const handleRetryClick = () => {
    setLoadingError(null);
    setLoadRetries(0);
    initializeStreetView();
  };

  useEffect(() => {
    if (isLoaded && position) {
      initializeStreetView();
    }

    return () => {
      if (panoramaRef.current) {
        // Clean up listeners and panorama instance
        google.maps.event.clearInstanceListeners(panoramaRef.current);
      }
    };
  }, [isLoaded, position]);

  if (loadError) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load Street View. Please try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loadingError) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-4", className)}>
        <Alert>
          <AlertDescription>{loadingError}</AlertDescription>
        </Alert>
        <Button onClick={handleRetryClick} variant="outline" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry Loading
        </Button>
      </div>
    );
  }

  return <div ref={streetViewRef} className={cn("w-full h-full", className)} />;
};

export default StreetView;
