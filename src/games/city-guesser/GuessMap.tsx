import React, { useCallback, useEffect, useState } from "react";
import { MapPin, Send } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GoogleMap, Marker, Polyline } from '@react-google-maps/api';
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

interface GuessMapProps {
  actualLocation?: { lat: number; lng: number };
  isRevealed?: boolean;
  className?: string;
  disabled?: boolean;
  onLocationSelect: (location: { lat: number; lng: number }) => void;
  selectedLocation: { lat: number; lng: number } | null;
  onSubmitGuess: () => void;
  isLoaded: boolean;
  loadError: Error | null;
  onCenterChange?: (center: { lat: number; lng: number }) => void;
}

const mapContainerStyle = {
  width: '100%',
  height: '100%'
};

const initialCenter = {
  lat: 0,
  lng: 0
};

const defaultCenter = { lat: 20, lng: 0 };

export const GuessMap: React.FC<GuessMapProps> = ({
  actualLocation,
  isRevealed = false,
  className,
  disabled = false,
  onLocationSelect,
  selectedLocation,
  onSubmitGuess,
  isLoaded,
  loadError,
  onCenterChange
}) => {
  const [map, setMap] = useState<google.maps.Map | null>(null);

  const mapOptions: google.maps.MapOptions = {
    mapTypeControl: true,
    streetViewControl: false,
    fullscreenControl: true,
    gestureHandling: "greedy",
    zoomControl: true
  };

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!disabled && e.latLng) {
      onLocationSelect({
        lat: e.latLng.lat(),
        lng: e.latLng.lng()
      });
    }
  }, [disabled, onLocationSelect]);

  const handleCenterChanged = () => {
    if (map && onCenterChange) {
      const center = map.getCenter();
      if (center) {
        onCenterChange({
          lat: center.lat(),
          lng: center.lng()
        });
      }
    }
  };

  useEffect(() => {
    if (map && isRevealed && actualLocation) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(actualLocation);
      if (selectedLocation) {
        bounds.extend(selectedLocation);
      }
      map.fitBounds(bounds, {
        top: 50,
        right: 50,
        bottom: 50,
        left: 50
      });
    }
  }, [map, isRevealed, actualLocation, selectedLocation]);

  const calculateDistance = () => {
    if (isLoaded && google.maps.geometry && actualLocation && selectedLocation) {
      const from = new google.maps.LatLng(selectedLocation.lat, selectedLocation.lng);
      const to = new google.maps.LatLng(actualLocation.lat, actualLocation.lng);
      const distanceInMeters = google.maps.geometry.spherical.computeDistanceBetween(from, to);
      return Math.round(distanceInMeters / 1000);
    }
    return null;
  };

  if (loadError) {
    return <div>Error loading maps</div>;
  }

  if (!isLoaded) {
    return <div>Loading maps</div>;
  }

  const distance = isRevealed ? calculateDistance() : null;

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardContent className="flex-grow p-0 relative">
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%', minHeight: '300px' }}
          zoom={2}
          center={defaultCenter}
          options={mapOptions}
          onClick={handleMapClick}
          onLoad={setMap}
          onCenterChanged={handleCenterChanged}
        >
          {selectedLocation && (
            <Marker
              position={selectedLocation}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: "#ef4444",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              }}
            />
          )}

          {isRevealed && actualLocation && (
            <>
              <Marker
                position={actualLocation}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 10,
                  fillColor: "#22c55e",
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: 2,
                }}
              />
              {selectedLocation && (
                <Polyline
                  path={[selectedLocation, actualLocation]}
                  options={{
                    strokeColor: "#6b7280",
                    strokeOpacity: 0.8,
                    strokeWeight: 2,
                    geodesic: true
                  }}
                />
              )}
            </>
          )}
        </GoogleMap>
        
        {isRevealed && distance !== null && (
          <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-sm p-2 rounded-md text-sm font-semibold z-10">
            Distance: {distance} km
          </div>
        )}
      </CardContent>

      {!isRevealed && !disabled && (
        <div className="p-3 border-t text-center text-sm text-muted-foreground bg-muted/20">
          {selectedLocation ? (
            <span>Click map to change guess, or Submit below</span>
          ) : (
            <span>Click anywhere on the map to make your guess</span>
          )}
        </div>
      )}

      <CardFooter className="p-2">
        <Button
          className="w-full"
          onClick={onSubmitGuess}
          disabled={!selectedLocation || disabled}
        >
          <Send className="mr-2 h-4 w-4" />
          Submit Guess
        </Button>
      </CardFooter>
    </Card>
  );
};
