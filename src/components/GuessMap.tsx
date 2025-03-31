import React, { useEffect, useRef, useState } from "react";
import { MapPin, Send } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GoogleMap } from '@react-google-maps/api';
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

interface GuessMapProps {
  actualLocation?: { lat: number; lng: number };
  isRevealed?: boolean;
  className?: string;
  disabled?: boolean;
  onLocationSelect?: (location: { lat: number; lng: number } | null) => void;
  selectedLocation?: { lat: number; lng: number } | null;
  onSubmitGuess: () => void;
  isLoaded: boolean;
  loadError?: Error | null;
}

const mapContainerStyle = {
  width: '100%',
  height: '100%'
};

const initialCenter = {
  lat: 0,
  lng: 0
};

const GuessMap: React.FC<GuessMapProps> = ({
  actualLocation,
  isRevealed = false,
  className,
  disabled = false,
  onLocationSelect,
  selectedLocation,
  onSubmitGuess,
  isLoaded,
  loadError
}) => {
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const actualMarkerRef = useRef<google.maps.Marker | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  const onLoad = React.useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const onUnmount = React.useCallback(() => {
    mapRef.current = null;
    markerRef.current?.setMap(null);
    actualMarkerRef.current?.setMap(null);
    polylineRef.current?.setMap(null);
    markerRef.current = null;
    actualMarkerRef.current = null;
    polylineRef.current = null;
  }, []);

  const handleMapClick = (e: google.maps.MapMouseEvent) => {
    if (!disabled && onLocationSelect && e.latLng) {
      onLocationSelect({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    }
  };

  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    if (selectedLocation) {
      if (!markerRef.current) {
        markerRef.current = new google.maps.Marker({ position: selectedLocation });
      } else {
        markerRef.current.setPosition(selectedLocation);
      }
      markerRef.current.setMap(mapRef.current);
    } else if (markerRef.current) {
      markerRef.current.setMap(null);
    }
  }, [isLoaded, selectedLocation]);

  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    if (isRevealed && actualLocation && selectedLocation) {
      if (!actualMarkerRef.current) {
        actualMarkerRef.current = new google.maps.Marker({
          position: actualLocation,
          icon: { url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png' }
        });
      } else {
        actualMarkerRef.current.setPosition(actualLocation);
      }
      actualMarkerRef.current.setMap(mapRef.current);

      const lineCoordinates = [selectedLocation, actualLocation];
      if (!polylineRef.current) {
        polylineRef.current = new google.maps.Polyline({
          path: lineCoordinates,
          geodesic: true,
          strokeColor: '#FF0000',
          strokeOpacity: 0.8,
          strokeWeight: 2
        });
      } else {
        polylineRef.current.setPath(lineCoordinates);
      }
      polylineRef.current.setMap(mapRef.current);

      const bounds = new google.maps.LatLngBounds();
      bounds.extend(selectedLocation);
      bounds.extend(actualLocation);
      mapRef.current.fitBounds(bounds);
      google.maps.event.addListenerOnce(mapRef.current, 'bounds_changed', () => {
        if (mapRef.current) {
          let currentZoom = mapRef.current.getZoom();
          if (typeof currentZoom === 'number' && currentZoom > 2) {
            mapRef.current.setZoom(currentZoom - 1);
          }
        }
      });

    } else {
      actualMarkerRef.current?.setMap(null);
      polylineRef.current?.setMap(null);
    }
  }, [isLoaded, isRevealed, actualLocation, selectedLocation]);

  const calculateDistance = () => {
    if (isLoaded && google.maps.geometry && actualLocation && selectedLocation) {
      const from = new google.maps.LatLng(selectedLocation.lat, selectedLocation.lng);
      const to = new google.maps.LatLng(actualLocation.lat, actualLocation.lng);
      const distanceInMeters = google.maps.geometry.spherical.computeDistanceBetween(from, to);
      return Math.round(distanceInMeters / 1000);
    }
    return null;
  };

  if (!isLoaded) {
    return (
      <Card className="flex items-center justify-center h-full">
        <CardContent className="p-4">
          Loading Map...
        </CardContent>
      </Card>
    );
  }

  const distance = isRevealed ? calculateDistance() : null;

  return (
    <Card className={cn("h-full flex flex-col", className)}>
      <CardContent className="p-0 flex-grow relative">
        {isLoaded && (
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={initialCenter}
            zoom={2}
            onLoad={onLoad}
            onUnmount={onUnmount}
            onClick={handleMapClick}
            options={{
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              clickableIcons: !disabled,
              gestureHandling: disabled ? 'none' : 'auto',
              zoomControl: !disabled
            }}
          >
          </GoogleMap>
        )}
        
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

      <CardFooter className="p-3 flex justify-between items-center border-t bg-muted/40">
        <div className="flex items-center gap-2 text-sm min-w-0">
          <MapPin className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">
            {selectedLocation
              ? `Selected: ${selectedLocation.lat.toFixed(4)}, ${selectedLocation.lng.toFixed(4)}`
              : isRevealed ? "Round Complete" : "Select a location"}
          </span>
        </div>
        <Button
          onClick={onSubmitGuess}
          disabled={!selectedLocation || disabled || isRevealed}
          size="sm"
        >
          <Send className="h-4 w-4 mr-2" />
          {isRevealed ? "Submitted" : "Submit Guess"}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default GuessMap;
