import React, { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { loadGoogleMapsApi } from "@/utils/googleMapsLoader";

interface GuessMapProps {
  onGuess?: (lat: number, lng: number) => void;
  actualLocation?: { lat: number; lng: number };
  guessLocation?: { lat: number; lng: number };
  isRevealed?: boolean;
  className?: string;
  disabled?: boolean;
}

declare global {
  interface Window {
    google: any;
  }
}

const GuessMap = ({
  onGuess,
  actualLocation,
  guessLocation,
  isRevealed = false,
  className,
  disabled = false,
}: GuessMapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const actualMarkerRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Initialize the map
  useEffect(() => {
    // Use our shared Google Maps loader
    loadGoogleMapsApi(() => {
      if (mapRef.current && !mapInstanceRef.current) {
        initializeMap();
      }
    });

    return () => {
      // Clean up map instance if needed
      mapInstanceRef.current = null;
    };
  }, []);

  // Update map when props change
  useEffect(() => {
    if (mapInstanceRef.current) {
      updateMapState();
    }
  }, [guessLocation, actualLocation, isRevealed, disabled]);

  const initializeMap = () => {
    if (!mapRef.current || mapInstanceRef.current) return;
    
    const map = new window.google.maps.Map(mapRef.current, {
      center: { lat: 20, lng: 0 },
      zoom: 2,
      disableDefaultUI: true,
      zoomControl: true,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: false,
      styles: [
        {
          featureType: "poi",
          elementType: "labels",
          stylers: [{ visibility: "off" }],
        },
      ],
    });
    
    mapInstanceRef.current = map;
    
    if (!disabled) {
      map.addListener("click", (e: any) => {
        handleMapClick(e.latLng.lat(), e.latLng.lng());
      });
    }
  };

  const updateMapState = () => {
    if (!mapInstanceRef.current) return;
    
    // Handle guess marker
    if (guessLocation) {
      if (!markerRef.current) {
        markerRef.current = new window.google.maps.Marker({
          position: guessLocation,
          map: mapInstanceRef.current,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: "#3b82f6",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        });
      } else {
        markerRef.current.setPosition(guessLocation);
      }
      setSelectedLocation(guessLocation);
    }
    
    // Handle actual location marker and line when revealed
    if (isRevealed && actualLocation) {
      // Create or update actual location marker
      if (!actualMarkerRef.current) {
        actualMarkerRef.current = new window.google.maps.Marker({
          position: actualLocation,
          map: mapInstanceRef.current,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: "#10b981",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        });
      } else {
        actualMarkerRef.current.setPosition(actualLocation);
      }
      
      // Create or update line between guess and actual locations
      if (guessLocation && !lineRef.current) {
        lineRef.current = new window.google.maps.Polyline({
          path: [guessLocation, actualLocation],
          geodesic: true,
          strokeColor: "#6366f1",
          strokeOpacity: 0.8,
          strokeWeight: 2,
          map: mapInstanceRef.current,
        });
      } else if (guessLocation && lineRef.current) {
        lineRef.current.setPath([guessLocation, actualLocation]);
      }
      
      // Fit bounds to show both markers
      if (guessLocation) {
        const bounds = new window.google.maps.LatLngBounds();
        bounds.extend(actualLocation);
        bounds.extend(guessLocation);
        mapInstanceRef.current.fitBounds(bounds, 50);
      } else {
        mapInstanceRef.current.setCenter(actualLocation);
        mapInstanceRef.current.setZoom(5);
      }
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (disabled) return;
    
    const location = { lat, lng };
    setSelectedLocation(location);
    
    // Update marker
    if (!markerRef.current) {
      markerRef.current = new window.google.maps.Marker({
        position: location,
        map: mapInstanceRef.current,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#3b82f6",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
    } else {
      markerRef.current.setPosition(location);
    }
    
    // Call onGuess callback if provided
    if (onGuess) {
      onGuess(lat, lng);
    }
  };

  // Render a placeholder if no API key
  const renderPlaceholder = () => (
    <div className="flex flex-col items-center justify-center h-full bg-muted p-6 text-center">
      <MapPin className="h-16 w-16 mb-4 text-muted-foreground" />
      <p className="text-lg font-medium mb-2">World Map</p>
      <p className="text-sm text-muted-foreground mb-4">
        Please add a valid Google Maps API key to googleMapsLoader.ts
      </p>
      <div className="w-full h-44 bg-background/50 rounded flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Map will appear here</p>
      </div>
    </div>
  );

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-0 h-full relative">
        <div ref={mapRef} className="map-container h-full" />
        {!window.google && renderPlaceholder()}
        
        {!isRevealed && !disabled && (
          <div className="absolute bottom-4 left-4 right-4 bg-background/80 backdrop-blur-sm p-3 rounded-md text-sm text-center">
            {selectedLocation ? (
              <p>Click the map to update your guess or submit to confirm</p>
            ) : (
              <p>Click anywhere on the map to make your guess</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GuessMap;
