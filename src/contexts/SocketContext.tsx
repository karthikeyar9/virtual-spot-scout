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
  const { toast } = useToast();

  useEffect(() => {
    console.log('🔄 Socket Provider: Initializing...');
    console.log('📡 Attempting connection to:', SOCKET_SERVER_URL);
    console.log('🔧 Environment:', {
      isProd: import.meta.env.PROD,
      VITE_SOCKET_SERVER_URL: import.meta.env.VITE_SOCKET_SERVER_URL,
      resolvedURL: SOCKET_SERVER_URL
    });
    
    try {
      // Create socket with explicit configuration
      const newSocket = io(SOCKET_SERVER_URL, {
        reconnectionAttempts: 10,    // Increased from 5 to 10 attempts
        timeout: 20000,              // Increased to match server's connectTimeout
        transports: ['websocket', 'polling'],
        forceNew: true,
        withCredentials: false,
        autoConnect: true,
        path: '/socket.io',
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5,
        reconnectionDelay: 2000      // Fixed 2 second delay between reconnection attempts
      });
      
      console.log('🔌 Socket instance created with config:', {
        url: SOCKET_SERVER_URL,
        options: {
          transports: ['websocket', 'polling'],
          path: '/socket.io'
        }
      });

      // Listen for connection events
      newSocket.on('connect', () => {
        console.log('✅ Socket connected successfully! ID:', newSocket.id);
        console.log('🔍 Connection details:', {
          transport: newSocket.io.engine?.transport?.name || 'unknown',
          connected: newSocket.connected,
          reconnecting: newSocket.io._reconnecting
        });
        
        setIsConnected(true);
        setError(null);
        
        toast({
          title: "Connected",
          description: "Successfully connected to game server",
          variant: "default",
        });
      });
      
      // Listen for connection errors with more detailed logging
      newSocket.on('connect_error', (err) => {
        console.error('❌ Socket connection error:', {
          message: err.message,
          name: err.name,
          transport: newSocket.io.engine?.transport?.name || 'unknown'
        });
        
        setIsConnected(false);
        setError(err);
        
        // Only show toast for initial connection errors, not reconnection attempts
        if (!newSocket.io._reconnecting) {
          toast({
            title: "Connection Error",
            description: `Could not connect to game server: ${err.message}`,
            variant: "destructive",
          });
        }
      });
      
      // Listen for disconnection
      newSocket.on('disconnect', (reason) => {
        console.log('🔌 Socket disconnected. Reason:', reason);
        setIsConnected(false);
        
        if (reason === 'io server disconnect') {
          console.log('🔄 Server initiated disconnect, attempting reconnection...');
          newSocket.connect();
        }
      });
      
      // Listen for reconnection attempts
      newSocket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`🔄 Reconnection attempt ${attemptNumber}`);
      });
      
      // Listen for reconnection success
      newSocket.on('reconnect', (attemptNumber) => {
        console.log(`✅ Reconnected after ${attemptNumber} attempts`);
        setIsConnected(true);
        setError(null);
      });

      // Listen for reconnection errors
      newSocket.on('reconnect_error', (err) => {
        console.error('❌ Reconnection error:', err);
      });

      // Listen for reconnection failed
      newSocket.on('reconnect_failed', () => {
        console.error('❌ Reconnection failed after all attempts');
      });
      
      // Set the socket
      setSocket(newSocket);
      
      // Clean up function
      return () => {
        console.log('🧹 Cleaning up socket connection');
        if (newSocket.connected) {
          console.log('🔌 Disconnecting socket:', newSocket.id);
          newSocket.disconnect();
        }
      };
    } catch (err) {
      console.error('❌ Error creating socket connection:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      toast({
        title: "Connection Error",
        description: "Failed to initialize socket connection",
        variant: "destructive",
      });
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