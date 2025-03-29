
declare global {
  interface Window {
    google: any;
    initGoogleMapsAPI: () => void;
    googleMapsLoaded: boolean;
    googleMapsLoading: boolean;
    googleMapsCallbacks: Array<() => void>;
  }
}

// You should replace this with your actual Google Maps API key
// In production, this would ideally come from environment variables
const GOOGLE_MAPS_API_KEY = "YOUR_API_KEY";

/**
 * Loads the Google Maps API once and ensures it's not loaded multiple times
 * @param callback Function to call when Google Maps is loaded
 */
export const loadGoogleMapsApi = (callback: () => void): void => {
  // If already loaded, just call the callback
  if (window.google && window.google.maps) {
    callback();
    return;
  }

  // Initialize the callbacks array if it doesn't exist
  if (!window.googleMapsCallbacks) {
    window.googleMapsCallbacks = [];
  }

  // Add this callback to the queue
  window.googleMapsCallbacks.push(callback);

  // If already loading, just wait for the existing script to finish
  if (window.googleMapsLoading) {
    return;
  }

  // Set loading flag
  window.googleMapsLoading = true;

  // Set up the global callback
  window.initGoogleMapsAPI = () => {
    window.googleMapsLoaded = true;
    window.googleMapsLoading = false;
    
    // Call all queued callbacks
    if (window.googleMapsCallbacks) {
      window.googleMapsCallbacks.forEach(cb => cb());
      window.googleMapsCallbacks = [];
    }
  };

  // Create script element
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&callback=initGoogleMapsAPI`;
  script.async = true;
  script.defer = true;
  
  document.head.appendChild(script);
};
