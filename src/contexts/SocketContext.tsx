import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { SocketContext } from './socket';
import { useToast } from '@/hooks/use-toast';

// Get the environment-specific server URL
const getServerUrl = () => {
  // Production environment (deployed on Render)
  if (import.meta.env.PROD) {
    return 'https://virtual-city-guess-backend.onrender.com/';
  }
  
  // Use environment variable if available
  if (import.meta.env.VITE_SOCKET_SERVER_URL) {
    return import.meta.env.VITE_SOCKET_SERVER_URL;
  }
  
  // Default development URL
  return 'http://localhost:3001';
};

// Define the socket server URL
const SOCKET_SERVER_URL = getServerUrl();

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const hasConnectedOnce = React.useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    try {
      const newSocket = io(SOCKET_SERVER_URL, {
        // Render free-tier cold start can take 60s+ — keep retrying long enough
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        randomizationFactor: 0.5,
        timeout: 20000,
        transports: ['websocket', 'polling'],
        forceNew: true,
        withCredentials: false,
        autoConnect: true,
        path: '/socket.io',
      });

      newSocket.on('connect', () => {
        console.log('✅ Socket connected:', newSocket.id);
        setIsConnected(true);
        setError(null);

        // Only toast on the very first connection, not on every reconnect
        if (!hasConnectedOnce.current) {
          hasConnectedOnce.current = true;
          toast({
            title: "Connected",
            description: "Successfully connected to game server",
            variant: "default",
          });
        }
      });

      newSocket.on('connect_error', (err) => {
        console.error('❌ Socket connection error:', err.message);
        setIsConnected(false);
        setError(err);
      });

      newSocket.on('disconnect', (reason) => {
        console.log('🔌 Socket disconnected. Reason:', reason);
        setIsConnected(false);
        if (reason === 'io server disconnect') {
          newSocket.connect();
        }
      });

      newSocket.on('reconnect', (attemptNumber) => {
        console.log(`✅ Reconnected after ${attemptNumber} attempts`);
        setIsConnected(true);
        setError(null);
      });

      newSocket.on('reconnect_failed', () => {
        console.error('❌ Reconnection failed');
      });

      setSocket(newSocket);

      return () => {
        if (newSocket.connected) newSocket.disconnect();
      };
    } catch (err) {
      console.error('❌ Error creating socket connection:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [toast]);

  const value = {
    socket,
    isConnected,
    error
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};