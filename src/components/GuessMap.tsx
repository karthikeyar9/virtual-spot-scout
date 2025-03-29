import React, { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// Custom marker icons
const guessIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const actualIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

interface GuessMapProps {
  onGuess?: (lat: number, lng: number) => void;
  actualLocation?: { lat: number; lng: number };
  guessLocation?: { lat: number; lng: number };
  isRevealed?: boolean;
  className?: string;
  disabled?: boolean;
  onSubmitGuess?: () => void;
}

// Helper component to handle map click events
const MapClickHandler = ({ onClick, disabled }: { onClick: (lat: number, lng: number) => void, disabled: boolean }) => {
  const map = useMap();
  
  useEffect(() => {
    if (disabled) return;
    
    const handleClick = (e: L.LeafletMouseEvent) => {
      onClick(e.latlng.lat, e.latlng.lng);
    };
    
    map.on('click', handleClick);
    
    return () => {
      map.off('click', handleClick);
    };
  }, [map, onClick, disabled]);
  
  return null;
};

// Helper component to handle map bounds
const UpdateMapBounds = ({ 
  guessLocation, 
  actualLocation, 
  isRevealed 
}: { 
  guessLocation?: { lat: number; lng: number }; 
  actualLocation?: { lat: number; lng: number }; 
  isRevealed: boolean;
}) => {
  const map = useMap();
  
  useEffect(() => {
    if (isRevealed && actualLocation && guessLocation) {
      const bounds = L.latLngBounds(
        L.latLng(actualLocation.lat, actualLocation.lng),
        L.latLng(guessLocation.lat, guessLocation.lng)
      );
      map.fitBounds(bounds.pad(0.2));
    } else if (guessLocation) {
      map.setView([guessLocation.lat, guessLocation.lng], 5);
    }
  }, [map, guessLocation, actualLocation, isRevealed]);
  
  return null;
};

const GuessMap = ({
  onGuess,
  actualLocation,
  guessLocation,
  isRevealed = false,
  className,
  disabled = false,
  onSubmitGuess,
}: GuessMapProps) => {
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number } | null>(null);

  const handleMapClick = (lat: number, lng: number) => {
    if (disabled) return;
    
    const location = { lat, lng };
    setSelectedLocation(location);
    
    // Call onGuess callback if provided, but don't finalize the guess
    if (onGuess) {
      onGuess(lat, lng);
    }
  };

  // Calculate the distance between two points (in km)
  const calculateDistance = () => {
    if (!actualLocation || !guessLocation) return null;
    
    // Haversine formula
    const R = 6371; // Earth's radius in km
    const dLat = (actualLocation.lat - guessLocation.lat) * Math.PI / 180;
    const dLon = (actualLocation.lng - guessLocation.lng) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(guessLocation.lat * Math.PI / 180) * Math.cos(actualLocation.lat * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    
    return Math.round(distance);
  };

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-0 h-full relative">
        <MapContainer 
          center={[20, 0]} 
          zoom={2} 
          style={{ height: '100%', width: '100%' }}
          zoomControl={true}
          attributionControl={true}
          worldCopyJump={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {(guessLocation || selectedLocation) && (
            <Marker 
              position={[
                guessLocation?.lat || selectedLocation?.lat || 0, 
                guessLocation?.lng || selectedLocation?.lng || 0
              ]} 
              icon={guessIcon}
            >
              <Popup>Your guess</Popup>
            </Marker>
          )}
          
          {isRevealed && actualLocation && (
            <Marker position={[actualLocation.lat, actualLocation.lng]} icon={actualIcon}>
              <Popup>Actual location</Popup>
            </Marker>
          )}
          
          {isRevealed && guessLocation && actualLocation && (
            <>
              <Polyline 
                positions={[
                  [guessLocation.lat, guessLocation.lng],
                  [actualLocation.lat, actualLocation.lng]
                ]}
                color="#6366f1"
                weight={3}
                opacity={0.7}
              />
            </>
          )}
          
          <MapClickHandler onClick={handleMapClick} disabled={disabled} />
          <UpdateMapBounds 
            guessLocation={guessLocation || selectedLocation || undefined} 
            actualLocation={actualLocation}
            isRevealed={isRevealed}
          />
        </MapContainer>
        
        {!isRevealed && !disabled && (
          <div className="absolute bottom-4 left-4 right-4 bg-background/80 backdrop-blur-sm p-3 rounded-md text-sm text-center z-[1000]">
            {selectedLocation || guessLocation ? (
              <p>Click the map to update your guess or use the Submit button to confirm</p>
            ) : (
              <p>Click anywhere on the map to make your guess</p>
            )}
          </div>
        )}
        
        {isRevealed && guessLocation && actualLocation && (
          <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-sm p-3 rounded-md text-sm font-semibold z-[1000]">
            Distance: {calculateDistance()} km
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GuessMap;
