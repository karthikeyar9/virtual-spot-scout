// Predefined locations with guaranteed Street View coverage
export const streetViewLocations = [
  { lat: 40.758895, lng: -73.985131 },    // Times Square, New York
  { lat: 48.858372, lng: 2.294481 },      // Eiffel Tower, Paris
  { lat: 51.500729, lng: -0.124625 },     // London Eye
  { lat: 40.689247, lng: -74.044502 },    // Statue of Liberty
  { lat: -33.857197, lng: 151.215140 },   // Sydney Opera House
  { lat: 41.890210, lng: 12.492231 },     // Colosseum, Rome
  { lat: 37.819929, lng: -122.478255 },   // Golden Gate Bridge
  { lat: 48.208174, lng: 16.373819 },     // Vienna State Opera
  { lat: 43.722952, lng: 10.396597 },     // Leaning Tower of Pisa
  { lat: 48.860611, lng: 2.337644 },      // Louvre Museum
  { lat: 40.782865, lng: -73.965355 },    // Central Park, New York
  { lat: 51.501476, lng: -0.140634 },     // Buckingham Palace
  { lat: 41.403706, lng: 2.173504 },      // La Rambla, Barcelona
  { lat: 52.516275, lng: 13.377704 },     // Brandenburg Gate, Berlin
  { lat: 45.437500, lng: 12.335833 }      // Venice Grand Canal
];

// Function to get random locations from the predefined list
export function getRandomLocations(count: number) {
  const shuffled = [...streetViewLocations].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
} 