
import React, { useEffect, useRef } from "react";
import { Compass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { loadGoogleMapsApi } from "@/utils/googleMapsLoader";

interface StreetViewProps {
  position?: { lat: number; lng: number };
  panoId?: string;
  heading?: number;
  pitch?: number;
  zoom?: number;
  onLoad?: () => void;
}

declare global {
  interface Window {
    google: any;
  }
}

const StreetView = ({ 
  position, 
  panoId, 
  heading = 0, 
  pitch = 0, 
  zoom = 1,
  onLoad 
}: StreetViewProps) => {
  const streetViewRef = useRef<HTMLDivElement>(null);
  const streetViewInstanceRef = useRef<any>(null);

  useEffect(() => {
    // Use our shared Google Maps loader
    loadGoogleMapsApi(() => {
      if (streetViewRef.current) {
        initializeStreetView();
      }
    });

    return () => {
      // Clean up street view instance if needed
      streetViewInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (streetViewInstanceRef.current && (position || panoId)) {
      updateStreetView();
    }
  }, [position, panoId, heading, pitch, zoom]);

  const initializeStreetView = () => {
    if (!streetViewRef.current || streetViewInstanceRef.current) return;
    
    const panorama = new window.google.maps.StreetViewPanorama(
      streetViewRef.current,
      {
        position: position || { lat: 0, lng: 0 },
        pano: panoId,
        pov: {
          heading,
          pitch,
        },
        zoom,
        addressControl: false,
        fullscreenControl: false,
        linksControl: true,
        panControl: true,
        enableCloseButton: false,
        zoomControl: true,
        showRoadLabels: false,
      }
    );
    
    streetViewInstanceRef.current = panorama;
    
    // Call onLoad callback when Street View is initialized
    if (onLoad) {
      window.google.maps.event.addListenerOnce(
        panorama,
        "status_changed",
        () => {
          if (panorama.getStatus() === "OK") {
            onLoad();
          }
        }
      );
    }
  };

  const updateStreetView = () => {
    if (!streetViewInstanceRef.current) return;
    
    if (panoId) {
      streetViewInstanceRef.current.setPano(panoId);
    } else if (position) {
      streetViewInstanceRef.current.setPosition(position);
    }
    
    streetViewInstanceRef.current.setPov({
      heading,
      pitch,
    });
    
    streetViewInstanceRef.current.setZoom(zoom);
  };

  // Render a placeholder if no API key
  const renderPlaceholder = () => (
    <div className="flex flex-col items-center justify-center h-full bg-muted p-6 text-center">
      <Compass className="h-16 w-16 mb-4 text-muted-foreground" />
      <p className="text-lg font-medium mb-2">Street View</p>
      <p className="text-sm text-muted-foreground mb-4">
        Please add a valid Google Maps API key to googleMapsLoader.ts
      </p>
      <div className="w-full h-44 bg-background/50 rounded flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Street view will appear here</p>
      </div>
    </div>
  );

  return (
    <Card className="overflow-hidden h-full">
      <CardContent className="p-0 h-full">
        {position || panoId ? (
          <div ref={streetViewRef} className="street-view-container h-full" />
        ) : (
          renderPlaceholder()
        )}
      </CardContent>
    </Card>
  );
};

export default StreetView;
