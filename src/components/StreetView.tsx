import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface StreetViewProps {
  position: { lat: number; lng: number } | undefined;
  onLoad?: () => void;
  isLoaded: boolean;
  loadError: Error | undefined;
  onError?: (error: Error) => void;
}

const StreetView: React.FC<StreetViewProps> = ({ 
  position, 
  onLoad, 
  isLoaded, 
  loadError,
  onError
}) => {
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);

  // Initialize or update Street View when position changes or maps API loads
  useEffect(() => {
    if (!isLoaded || !position || !mapRef.current) return;

    const initStreetView = async () => {
      try {
        // Clean up previous panorama if it exists
        if (panoramaRef.current) {
          panoramaRef.current = null;
        }

        // Create a new Street View panorama
        const panorama = new google.maps.StreetViewPanorama(mapRef.current, {
          position: position,
          pov: { heading: 0, pitch: 0 },
          addressControl: false,
          fullscreenControl: false,
          enableCloseButton: false,
          showRoadLabels: false,
          zoomControl: true,
          panControl: true,
          motionTracking: false,
          motionTrackingControl: false,
          linksControl: false,
          clickToGo: false,
          disableDefaultUI: false,
          visible: true
        });

        // Store reference to the panorama
        panoramaRef.current = panorama;
        
        // Call the parent onLoad callback if provided
        if (onLoad) {
          onLoad();
        }

        // Setup error event listener
        const streetViewService = new google.maps.StreetViewService();
        streetViewService.getPanorama({
          location: position,
          radius: 50 // Search within 50 meters
        }).then(() => {
          console.log('Street View panorama available for this location');
        }).catch((e) => {
          console.error('Street View error:', e);
          setError('No Street View imagery available for this location');
          if (onError) {
            onError(new Error(e.message || 'Street View not available'));
          }
        });

      } catch (e) {
        console.error('Street View initialization error:', e);
        setError('Failed to initialize Street View');
        if (onError) {
          onError(e instanceof Error ? e : new Error('Unknown error'));
        }
      }
    };

    initStreetView();

    // Cleanup function
    return () => {
      if (panoramaRef.current) {
        panoramaRef.current = null;
      }
    };
  }, [isLoaded, position, onLoad, onError]);

  // Reset error state when position changes
  useEffect(() => {
    setError(null);
    setIsRetrying(false);
  }, [position]);

  // Retry loading Street View
  const handleRetry = useCallback(() => {
    setError(null);
    setIsRetrying(true);
    setRetryCount(prev => prev + 1);
    
    // After a brief delay, reset the retrying state
    setTimeout(() => {
      setIsRetrying(false);
    }, 1000);
  }, []);

  if (!isLoaded || !position) {
    return (
      <div className="w-full h-full bg-gray-100 flex items-center justify-center">
        <p>Loading Street View...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="w-full h-full bg-gray-100 flex items-center justify-center p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Google Maps Error</AlertTitle>
          <AlertDescription>
            {loadError.message}. Please check your API key and network connection.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full bg-gray-100 flex flex-col items-center justify-center p-4">
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Street View Error</AlertTitle>
          <AlertDescription>
            {error}. This location might not have Street View coverage.
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button 
            variant="default" 
            onClick={handleRetry}
            disabled={isRetrying}
          >
            {isRetrying ? "Retrying..." : "Retry"}
          </Button>
          <Button 
            variant="outline" 
            onClick={() => {
              // Notify parent component to skip to next location
              if (onError) {
                onError(new Error("SKIP_TO_NEXT_LOCATION"));
              }
            }}
          >
            Skip to Next Location
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={mapRef} 
      className="h-full w-full bg-gray-100"
    />
  );
};

export default StreetView;
