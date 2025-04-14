import { useContext } from 'react';
import { SocketContext, SocketContextValue } from '../contexts/socket';

export const useSocket = (): SocketContextValue => useContext(SocketContext); 