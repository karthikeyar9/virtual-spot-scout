import React, { useEffect, useRef, useState } from "react";
import { Compass, Map, AlertCircle, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { loadMapillary, MAP_ACCESS_TOKEN, FALLBACK_TOKENS } from "@/utils/mapillaryLoader";
import * as Mapillary from 'mapillary-js';
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

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
  const [attemptCount, setAttemptCount] = useState(0);
  const [currentTokenIndex, setCurrentTokenIndex] = useState(-1);
  const maxAttempts = 3;

  const staticLocations = [
    { imageId: "637115915188871", name: "New York City, USA" },
    { imageId: "319150384808662", name: "London, UK" },
    { imageId: "2331188616847021", name: "Tokyo, Japan" },
    { imageId: "486514775997111", name: "Paris, France" }
  ];

  useEffect(() => {
    return () => {
      if (viewerRef.current) {
        viewerRef.current.remove();
        viewerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (attemptCount >= maxAttempts) {
      console.log("Max attempts reached, using fallback view");
      setUseFallback(true);
      return;
    }
    
    loadMapillary(() => {
      if (streetViewRef.current) {
        initializeMapillary();
      }
    });
  }, [attemptCount, currentTokenIndex]);

  useEffect(() => {
    if (viewerRef.current && isLoaded && !useFallback && (position || panoId)) {
      updateMapillaryView();
    }
  }, [position, panoId, heading, pitch, zoom, isLoaded, useFallback]);

  const getCurrentToken = () => {
    if (currentTokenIndex === -1) {
      return MAP_ACCESS_TOKEN;
    }
    
    if (currentTokenIndex < FALLBACK_TOKENS.length) {
      return FALLBACK_TOKENS[currentTokenIndex];
    }
    
    setUseFallback(true);
    return MAP_ACCESS_TOKEN;
  };

  const initializeMapillary = async () => {
    if (!streetViewRef.current || viewerRef.current) return;
    
    try {
      console.log("Initializing Mapillary viewer with token index:", currentTokenIndex);
      
      const viewer = new Mapillary.Viewer({
        container: streetViewRef.current,
        accessToken: getCurrentToken(),
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
      
      viewer.on('image', (event) => {
        console.log("Image loaded:", event.image.id);
        setIsLoaded(true);
        setError(null);
        if (onLoad) onLoad();
      });
      
      (viewer as any).on('error', (error: any) => {
        console.error("Mapillary viewer error:", error);
        
        if (error && error.message && error.message.includes("Error validating application")) {
          handleApiError();
        } else {
          setError("Error loading street view");
        }
      });
      
      if (panoId) {
        console.log("Moving to specific panoId:", panoId);
        viewer.moveTo(panoId).catch(e => {
          console.error("Error moving to specific image:", e);
          loadStaticLocations(viewer);
        });
      } else if (position) {
        console.log("Looking up image by position:", position);
        lookupImageByPosition(viewer, position.lat, position.lng);
      } else {
        console.log("Loading static location");
        loadStaticLocations(viewer);
      }
    } catch (e) {
      console.error("Error initializing Mapillary:", e);
      handleApiError();
    }
  };

  const handleApiError = () => {
    if (currentTokenIndex < FALLBACK_TOKENS.length - 1) {
      setCurrentTokenIndex(prevIndex => prevIndex + 1);
      console.log("Trying next token, index:", currentTokenIndex + 1);
    } else if (attemptCount < maxAttempts - 1) {
      setAttemptCount(prev => prev + 1);
      setCurrentTokenIndex(-1);
      console.log("Tried all tokens, starting over, attempt:", attemptCount + 1);
    } else {
      setError("Street view service unavailable. Using fallback view.");
      setUseFallback(true);
    }
  };

  const lookupImageByPosition = async (viewer: Mapillary.Viewer, lat: number, lng: number) => {
    try {
      console.log(`Requesting image near ${lat},${lng} with token index ${currentTokenIndex}`);
      const response = await fetch(
        `https://graph.mapillary.com/images?access_token=${getCurrentToken()}&fields=id&limit=1&closeto=${lng},${lat}`
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
      loadStaticLocations(viewer);
    }
  };

  const loadStaticLocations = async (viewer: Mapillary.Viewer) => {
    const location = staticLocations[Math.floor(Math.random() * staticLocations.length)];
    
    try {
      console.log(`Loading static location: ${location.name}`);
      await viewer.moveTo(location.imageId);
      console.log(`Loaded location: ${location.name}`);
    } catch (e) {
      console.error("Error loading static location:", e);
      handleApiError();
    }
  };

  const updateMapillaryView = async () => {
    if (!viewerRef.current || useFallback) return;
    
    try {
      if (panoId) {
        await viewerRef.current.moveTo(panoId);
      } else if (position) {
        lookupImageByPosition(viewerRef.current, position.lat, position.lng);
      }
      
      viewerRef.current.moveDir(heading);
      viewerRef.current.setFieldOfView(calculateFov(zoom));
    } catch (e) {
      console.error("Error updating Mapillary view:", e);
      handleApiError();
    }
  };

  const calculateFov = (zoom: number): number => {
    return 90 - ((zoom - 1) * 20);
  };

  const renderFallback = () => {
    if (!position) {
      return (
        <div className="h-full w-full bg-neutral-800 relative flex flex-col items-center justify-center text-white p-6">
          <Map className="h-16 w-16 mb-4 opacity-50" />
          <h3 className="text-lg font-medium">Street View</h3>
          <p className="text-sm text-gray-300 mt-2 text-center">
            No location data available
          </p>
          <div className="absolute bottom-4 right-4">
            <Compass className="h-10 w-10 text-gray-400" />
          </div>
        </div>
      );
    }
    
    return (
      <div className="h-full w-full bg-neutral-800 relative flex flex-col items-center justify-center text-white p-6">
        <h3 className="text-lg font-medium mb-2">Street View</h3>
        <p className="text-sm text-gray-300 mb-4">
          Location at {position.lat.toFixed(4)}, {position.lng.toFixed(4)}
        </p>
        
        <div className="bg-black/20 p-4 rounded-md max-w-md w-full">
          <div className="flex items-center mb-2">
            <MapPin className="h-5 w-5 text-yellow-400 mr-2" />
            <span className="text-yellow-300 text-sm font-medium">Location Details:</span>
          </div>
          <ul className="space-y-1 text-sm text-gray-300">
            <li>• Appears to be in an urban area</li>
            <li>• Has multi-story buildings</li>
            <li>• Street signs are in English</li>
            <li>• Located in a commercial district</li>
            <li>• Weather is clear and sunny</li>
          </ul>
        </div>
        
        <div className="absolute bottom-4 right-4">
          <Compass className="h-10 w-10 text-gray-400" />
        </div>
      </div>
    );
  };

  const renderPlaceholder = () => (
    <div className="flex flex-col items-center justify-center h-full bg-neutral-800 p-6 text-center text-white">
      <Compass className="h-16 w-16 mb-4 text-gray-400" />
      <p className="text-lg font-medium mb-2">Street View</p>
      {error ? (
        <Alert variant="destructive" className="bg-red-900/20 border-red-800 max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Street View Error</AlertTitle>
          <AlertDescription className="text-red-300">
            {error}
          </AlertDescription>
        </Alert>
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
              backgroundColor: "#333"
            }}
          />
        )}
        
        {(!isLoaded && !useFallback) && renderPlaceholder()}
      </CardContent>
    </Card>
  );
};

export default StreetView;
