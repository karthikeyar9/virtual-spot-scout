
import React, { useEffect, useRef, useState } from "react";
import { Compass, Map } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { loadMapillary, MAP_ACCESS_TOKEN } from "@/utils/mapillaryLoader";
import * as Mapillary from 'mapillary-js';

interface StreetViewProps {
  position?: { lat: number; lng: number };
  panoId?: string;
  heading?: number;
  pitch?: number;
  zoom?: number;
  onLoad?: () => void;
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
  const viewerRef = useRef<Mapillary.Viewer | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [useFallback, setUseFallback] = useState(false);

  // Static locations that seem to work reliably with the demo key
  const staticLocations = [
    { imageId: "312919238638775", name: "Stockholm, Sweden" },
    { imageId: "947786435851984", name: "Berlin, Germany" },
    { imageId: "568327597650502", name: "Barcelona, Spain" },
    { imageId: "1055650831678465", name: "San Francisco, USA" }
  ];

  useEffect(() => {
    // Use our shared Mapillary loader
    loadMapillary(() => {
      if (streetViewRef.current) {
        initializeMapillary();
      }
    });

    return () => {
      // Clean up Mapillary viewer instance
      if (viewerRef.current) {
        viewerRef.current.remove();
        viewerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (viewerRef.current && isLoaded && !useFallback && (position || panoId)) {
      updateMapillaryView();
    }
  }, [position, panoId, heading, pitch, zoom, isLoaded, useFallback]);

  const initializeMapillary = async () => {
    if (!streetViewRef.current || viewerRef.current) return;
    
    try {
      console.log("Initializing Mapillary viewer...");
      
      // Create a Mapillary viewer with a known working demo token
      const viewer = new Mapillary.Viewer({
        container: streetViewRef.current,
        accessToken: MAP_ACCESS_TOKEN, // Use token from loader
        component: {
          cover: false,
          bearing: true,
          sequence: true,
          direction: true,
          spatial: true,
          zoom: true,
          keyboard: true,
        }
      });
      
      viewerRef.current = viewer;
      
      // Register event listeners
      viewer.on('image', (event) => {
        console.log("Image loaded:", event.image.id);
        setIsLoaded(true);
        setError(null);
        if (onLoad) onLoad();
      });
      
      viewer.on('error', (error) => {
        console.error("Mapillary viewer error:", error);
        setError("Error loading street view");
      });
      
      // If we have a specific panoId or position, use it
      if (panoId) {
        console.log("Moving to specific panoId:", panoId);
        viewer.moveTo(panoId).catch(e => {
          console.error("Error moving to specific image:", e);
          // Try static location if specific ID fails
          loadStaticLocations(viewer);
        });
      } else if (position) {
        // For position-based lookup, we need to use Mapillary API methods
        console.log("Looking up image by position:", position);
        lookupImageByPosition(viewer, position.lat, position.lng);
      } else {
        // Load a static location if no specific location is provided
        console.log("Loading static location");
        loadStaticLocations(viewer);
      }
    } catch (e) {
      console.error("Error initializing Mapillary:", e);
      setError("Failed to initialize street view. Using fallback.");
      setUseFallback(true);
    }
  };

  const lookupImageByPosition = async (viewer: Mapillary.Viewer, lat: number, lng: number) => {
    try {
      // Convert position to Mapillary image ID (nearest image)
      console.log(`Requesting image near ${lat},${lng}`);
      const response = await fetch(
        `https://graph.mapillary.com/images?access_token=${MAP_ACCESS_TOKEN}&fields=id&limit=1&closeto=${lng},${lat}`
      );
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log("API response:", data);
      
      if (data && data.data && data.data.length > 0) {
        const imageId = data.data[0].id;
        console.log("Found image ID:", imageId);
        await viewer.moveTo(imageId);
      } else {
        console.error("No images found near the position");
        loadStaticLocations(viewer);
      }
    } catch (e) {
      console.error("Error finding image at position:", e);
      if (!isRetrying) {
        setIsRetrying(true);
        loadStaticLocations(viewer);
      } else {
        setUseFallback(true);
        setError("Could not load street view data. Using fallback.");
      }
    }
  };

  const loadStaticLocations = async (viewer: Mapillary.Viewer) => {
    // Try some known locations that work with the demo key
    const location = staticLocations[Math.floor(Math.random() * staticLocations.length)];
    
    try {
      console.log(`Loading static location: ${location.name}`);
      await viewer.moveTo(location.imageId);
      console.log(`Loaded location: ${location.name}`);
    } catch (e) {
      console.error("Error loading static location:", e);
      setError("Could not load street view. Using fallback view.");
      setUseFallback(true);
    }
  };

  const updateMapillaryView = async () => {
    if (!viewerRef.current || useFallback) return;
    
    try {
      if (panoId) {
        await viewerRef.current.moveTo(panoId);
      } else if (position) {
        // For position-based updates, use our custom function
        lookupImageByPosition(viewerRef.current, position.lat, position.lng);
      }
      
      // Update camera position
      viewerRef.current.moveDir(heading);
      
      // Set zoom level by adjusting field of view
      viewerRef.current.setFieldOfView(calculateFov(zoom));
      
    } catch (e) {
      console.error("Error updating Mapillary view:", e);
      setError("Error updating view. Using fallback.");
      setUseFallback(true);
    }
  };

  // Helper function to convert zoom to FOV
  const calculateFov = (zoom: number): number => {
    // Mapillary uses FOV in degrees (lower value = more zoom)
    return 90 - ((zoom - 1) * 20);
  };

  // Fallback street view if Mapillary fails
  const renderFallback = () => (
    <div className="h-full w-full bg-neutral-800 relative flex flex-col items-center justify-center text-white p-6">
      <Map className="h-16 w-16 mb-4 opacity-50" />
      <h3 className="text-lg font-medium">Street View</h3>
      <p className="text-sm text-gray-300 mt-2 text-center">
        {position ? 
          `Showing location at ${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}` : 
          'No location data available'
        }
      </p>
      <div className="absolute bottom-4 right-4">
        <Compass className="h-10 w-10 text-gray-400" />
      </div>
    </div>
  );

  // Render a placeholder if error or no location
  const renderPlaceholder = () => (
    <div className="flex flex-col items-center justify-center h-full bg-neutral-800 p-6 text-center text-white">
      <Compass className="h-16 w-16 mb-4 text-gray-400" />
      <p className="text-lg font-medium mb-2">Street View</p>
      {error ? (
        <p className="text-sm text-red-400 mb-4">{error}</p>
      ) : (
        <p className="text-sm text-gray-300 mb-4">
          Loading street view imagery...
        </p>
      )}
      <div className="w-full h-44 bg-neutral-900 rounded flex items-center justify-center">
        <p className="text-gray-400 text-sm">Street view will appear here</p>
      </div>
    </div>
  );

  return (
    <Card className="overflow-hidden h-full">
      <CardContent className="p-0 h-full">
        {useFallback ? (
          renderFallback()
        ) : (
          <div 
            ref={streetViewRef} 
            className="street-view-container h-full w-full" 
            style={{ 
              height: "100%", 
              width: "100%",
              minHeight: "400px",
              backgroundColor: "#333" // Avoid white flash
            }}
          />
        )}
        
        {(!isLoaded && !useFallback) && renderPlaceholder()}
      </CardContent>
    </Card>
  );
};

export default StreetView;
