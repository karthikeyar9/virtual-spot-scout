import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { SocketContext } from './socket';
import { useToast } from '@/hooks/use-toast';

// Define the socket server URL - ensure this matches your server port
const SOCKET_SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || 'http://localhost:3001';

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    console.log('🔄 Socket Provider: Initializing...');
    console.log('📡 Attempting connection to:', SOCKET_SERVER_URL);
    console.log('🔧 Environment variables:', {
      VITE_SOCKET_SERVER_URL: import.meta.env.VITE_SOCKET_SERVER_URL,
      fallbackURL: 'http://localhost:3001'
    });
    
    try {
      // Create socket with explicit configuration
      const newSocket = io(SOCKET_SERVER_URL, {
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
        transports: ['websocket', 'polling'],
        forceNew: true,
        withCredentials: false, // Changed to false since we're using '*' for CORS
        autoConnect: true,
        path: '/socket.io' // Explicitly set the socket.io path
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
          connected: newSocket.connected
        });
        
        setIsConnected(true);
        setError(null);
        
        toast({
          title: "Connected",
          description: "Successfully connected to game server",
          variant: "default",
        });
      });
      
      // Listen for connection errors
      newSocket.on('connect_error', (err) => {
        console.error('❌ Socket connection error:', {
          message: err.message,
          name: err.name
        });
        setIsConnected(false);
        setError(err);
        
        toast({
          title: "Connection Error",
          description: `Could not connect to game server: ${err.message}. Please ensure the server is running on port 3001.`,
          variant: "destructive",
        });
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