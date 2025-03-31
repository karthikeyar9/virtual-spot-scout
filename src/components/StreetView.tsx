import React, { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

interface StreetViewProps {
  position?: {
    lat: number;
    lng: number;
  };
  onLoad?: () => void;
  isLoaded: boolean;
  loadError?: Error | null;
}

const StreetView: React.FC<StreetViewProps> = ({ position, onLoad, isLoaded, loadError }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !mapRef.current || !position) return;

    const initStreetView = async () => {
      try {
        const streetViewService = new google.maps.StreetViewService();
        const data = await streetViewService.getPanorama({
          location: position,
          radius: 1000,
          source: google.maps.StreetViewSource.OUTDOOR
        });

        if (data.data && data.data.location && data.data.location.latLng) {
          const panorama = new google.maps.StreetViewPanorama(mapRef.current!, {
            position: data.data.location.latLng,
            pov: { heading: 0, pitch: 0 },
            addressControl: false,
            showRoadLabels: false,
            zoomControl: true,
            fullscreenControl: false,
            motionTracking: false,
            motionTrackingControl: false,
            enableCloseButton: false,
            visible: true
          });
          if (onLoad) onLoad();
        } else {
          console.error('No suitable Street View panorama found.');
          setError('Street View is not available for this location.');
        }
      } catch (err) {
        console.error('Street View initialization error:', err);
        setError('Failed to load Street View. Please try again.');
      }
    };

    initStreetView();
  }, [isLoaded, position, onLoad]);

  if (!isLoaded) {
    return (
      <Card className="flex items-center justify-center h-full">
        <CardContent className="p-4 text-center">
          <p>Loading Street View...</p>
        </CardContent>
      </Card>
    );
  }
  
  if (error) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Street View Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      );
    }

  return (
    <div 
      ref={mapRef} 
      className="w-full h-full rounded-lg overflow-hidden bg-muted"
    />
  );
};

export default StreetView;
