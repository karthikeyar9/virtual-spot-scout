import { createContext } from 'react';
import { Socket } from 'socket.io-client';

export interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  error: Error | null;
}

export const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
  error: null
}); 