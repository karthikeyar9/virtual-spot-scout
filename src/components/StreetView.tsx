
import React, { useEffect, useRef, useState } from "react";
import { Compass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { loadMapillary } from "@/utils/mapillaryLoader";
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
    if (viewerRef.current && isLoaded && (position || panoId)) {
      updateMapillaryView();
    }
  }, [position, panoId, heading, pitch, zoom, isLoaded]);

  const initializeMapillary = async () => {
    if (!streetViewRef.current || viewerRef.current) return;
    
    try {
      // Create a Mapillary viewer with correct ViewerOptions
      const viewer = new Mapillary.Viewer({
        container: streetViewRef.current,
        accessToken: 'MLY|4761405525255083|3efb317758c3ebe4ec7edeea41a91d54', // Public demo key
        component: {
          cover: false,
          bearing: true,
          sequence: false,
        }
      });
      
      viewerRef.current = viewer;
      
      // Set up event listeners with correct event types
      viewer.on(Mapillary.Viewer.nodechanged, (event) => {
        console.log("Current image ID:", event.image.id);
      });
      
      viewer.on(Mapillary.Viewer.navigable, (event) => {
        if (event.navigable) {
          // Loaded and ready
          setIsLoaded(true);
          if (onLoad) onLoad();
        }
      });
      
      // If we have a specific panoId or position, use it
      if (panoId) {
        viewer.moveTo(panoId).catch(e => {
          console.error("Error moving to specific image:", e);
          // Try random location if specific ID fails
          loadRandomLocation(viewer);
        });
      } else if (position) {
        // For position-based lookup, we need to use Mapillary API methods
        lookupImageByPosition(viewer, position.lat, position.lng);
      } else {
        // Load a random street view if no specific location is provided
        loadRandomLocation(viewer);
      }
    } catch (e) {
      console.error("Error initializing Mapillary:", e);
      setError("Failed to initialize street view. Please try again later.");
    }
  };

  const lookupImageByPosition = async (viewer: Mapillary.Viewer, lat: number, lng: number) => {
    try {
      // Convert position to Mapillary image ID (nearest image)
      // Note: This is a simple approach - in production, you'd use Mapillary's API more effectively
      const response = await fetch(
        `https://graph.mapillary.com/images?access_token=MLY|4761405525255083|3efb317758c3ebe4ec7edeea41a91d54&fields=id&limit=1&closeto=${lng},${lat}`
      );
      
      const data = await response.json();
      
      if (data && data.data && data.data.length > 0) {
        const imageId = data.data[0].id;
        await viewer.moveTo(imageId);
      } else {
        console.error("No images found near the position");
        loadRandomLocation(viewer);
      }
    } catch (e) {
      console.error("Error finding image at position:", e);
      loadRandomLocation(viewer);
    }
  };

  const loadRandomLocation = async (viewer: Mapillary.Viewer) => {
    // Try some interesting locations when no specific location is provided
    const randomLocations = [
      { key: "227409887608392", name: "Times Square, NYC" },
      { key: "523807935785302", name: "Golden Gate Bridge, SF" },
      { key: "1058421999886976", name: "Eiffel Tower, Paris" },
      { key: "380837778861888", name: "Colosseum, Rome" },
    ];
    
    const location = randomLocations[Math.floor(Math.random() * randomLocations.length)];
    
    try {
      await viewer.moveTo(location.key);
      console.log(`Loaded random location: ${location.name}`);
    } catch (e) {
      console.error("Error loading random location:", e);
      setError("Could not load street view. Please try again.");
    }
  };

  const updateMapillaryView = async () => {
    if (!viewerRef.current) return;
    
    try {
      if (panoId) {
        await viewerRef.current.moveTo(panoId);
      } else if (position) {
        // For position-based updates, we need to use our custom function
        lookupImageByPosition(viewerRef.current, position.lat, position.lng);
      }
      
      // Update camera position
      // Mapillary API doesn't have direct camera control methods
      // so we need to use moveDir for heading/bearing
      viewerRef.current.moveDir(heading);
      
      // Set zoom level by adjusting field of view
      viewerRef.current.setFieldOfView(calculateFov(zoom));
      
    } catch (e) {
      console.error("Error updating Mapillary view:", e);
    }
  };

  // Helper function to convert zoom to FOV
  const calculateFov = (zoom: number): number => {
    // Mapillary uses FOV in degrees (lower value = more zoom)
    // Convert our zoom scale (1-4) to FOV (90-30 degrees)
    return 90 - ((zoom - 1) * 20);
  };

  // Render a placeholder if error or no location
  const renderPlaceholder = () => (
    <div className="flex flex-col items-center justify-center h-full bg-muted p-6 text-center">
      <Compass className="h-16 w-16 mb-4 text-muted-foreground" />
      <p className="text-lg font-medium mb-2">Street View</p>
      {error ? (
        <p className="text-sm text-red-500 mb-4">{error}</p>
      ) : (
        <p className="text-sm text-muted-foreground mb-4">
          Select a location to view street imagery
        </p>
      )}
      <div className="w-full h-44 bg-background/50 rounded flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Street view will appear here</p>
      </div>
    </div>
  );

  return (
    <Card className="overflow-hidden h-full">
      <CardContent className="p-0 h-full">
        <div ref={streetViewRef} className="street-view-container h-full" />
        {(!isLoaded && !viewerRef.current) && renderPlaceholder()}
      </CardContent>
    </Card>
  );
};

export default StreetView;
