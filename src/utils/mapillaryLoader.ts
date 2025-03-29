
declare global {
  interface Window {
    mapillaryLoaded: boolean;
    mapillaryLoading: boolean;
    mapillaryCallbacks: Array<() => void>;
  }
}

/**
 * Loads the Mapillary CSS directly from CDN with fallback
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

  // Inject CSS with reliable CDN URL and handle errors
  const link = document.createElement("link");
  link.rel = "stylesheet";
  
  // Try loading from a more reliable CDN first
  link.href = "https://cdn.jsdelivr.net/npm/mapillary-js@4.1.2/dist/mapillary.min.css";
  
  const handleSuccess = () => {
    window.mapillaryLoaded = true;
    window.mapillaryLoading = false;
    
    // Call all queued callbacks
    if (window.mapillaryCallbacks) {
      window.mapillaryCallbacks.forEach(cb => cb());
      window.mapillaryCallbacks = [];
    }
  };
  
  const handleError = () => {
    console.warn("Failed to load Mapillary CSS from primary CDN, trying fallback");
    
    // Try fallback direct from npm
    const fallbackLink = document.createElement("link");
    fallbackLink.rel = "stylesheet";
    fallbackLink.href = "https://cdn.skypack.dev/mapillary-js@4.1.2/dist/mapillary.min.css";
    
    fallbackLink.onload = handleSuccess;
    fallbackLink.onerror = () => {
      console.error("Failed to load Mapillary CSS from all sources");
      // Still call callbacks to not block the app
      handleSuccess();
    };
    
    document.head.appendChild(fallbackLink);
  };
  
  link.onload = handleSuccess;
  link.onerror = handleError;
  
  document.head.appendChild(link);

  // Also include CSS inline as fallback
  const style = document.createElement('style');
  style.textContent = `
    .mapillary-js {
      position: relative;
      height: 100%;
      width: 100%;
    }
    .mapillary-js .mapillary-bearing-indicator {
      position: absolute;
      width: 60px;
      height: 60px;
      bottom: 10px;
      right: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }
  `;
  document.head.appendChild(style);
};
