
declare global {
  interface Window {
    mapillaryLoaded: boolean;
    mapillaryLoading: boolean;
    mapillaryCallbacks: Array<() => void>;
  }
}

// No API key is required for basic Mapillary usage
// but you might want to register for a Mapillary account for better experience

/**
 * Loads the Mapillary CSS once and ensures it's not loaded multiple times
 * @param callback Function to call when Mapillary styles are loaded
 */
export const loadMapillary = (callback: () => void): void => {
  // If already loaded, just call the callback
  if (window.mapillaryLoaded) {
    callback();
    return;
  }

  // Initialize the callbacks array if it doesn't exist
  if (!window.mapillaryCallbacks) {
    window.mapillaryCallbacks = [];
  }

  // Add this callback to the queue
  window.mapillaryCallbacks.push(callback);

  // If already loading, just wait for the existing stylesheets to finish
  if (window.mapillaryLoading) {
    return;
  }

  // Set loading flag
  window.mapillaryLoading = true;

  // Load Mapillary CSS
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.min.css";
  link.onload = () => {
    window.mapillaryLoaded = true;
    window.mapillaryLoading = false;
    
    // Call all queued callbacks
    if (window.mapillaryCallbacks) {
      window.mapillaryCallbacks.forEach(cb => cb());
      window.mapillaryCallbacks = [];
    }
  };
  
  document.head.appendChild(link);
};
