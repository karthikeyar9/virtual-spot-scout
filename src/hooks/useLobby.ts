import { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useSocket } from './useSocket';
import { Player } from '@/games/types';

interface SavedPlayerInfo {
  playerId: string;
  roomId: string;
  playerName: string;
  isHost: boolean;
}

const savePlayerInfo = (roomId: string, playerId: string, playerName: string, isHost: boolean) => {
  try {
    const playerInfo: SavedPlayerInfo = { roomId, playerId, playerName, isHost };
    localStorage.setItem('playerInfo', JSON.stringify(playerInfo));
  } catch (error) {
    console.error('Error saving player info:', error);
  }
};

const getPlayerInfo = (): SavedPlayerInfo | null => {
  try {
    const playerInfo = localStorage.getItem('playerInfo');
    if (playerInfo) return JSON.parse(playerInfo);
  } catch (error) {
    console.error('Error retrieving player info:', error);
  }
  return null;
};

const clearPlayerInfo = () => {
  try {
    localStorage.removeItem('playerInfo');
  } catch (error) {
    console.error('Error clearing player info:', error);
  }
};

export const useLobby = (roomId: string | undefined, gameType: string) => {
  const { socket, isConnected } = useSocket();
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [gameData, setGameData] = useState<any>(null);
  const hasJoinedRef = useRef(false);

  // Load saved player info synchronously on init
  const [savedPlayerInfo] = useState<SavedPlayerInfo | null>(() => {
    const info = getPlayerInfo();
    if (info && info.roomId === roomId) {
      return info;
    }
    if (info) {
      clearPlayerInfo();
    }
    return null;
  });

  // Join room - called once from GamePage
  const joinRoom = useCallback((playerName: string, isHost: boolean, existingPlayerId?: string) => {
    if (!socket || !isConnected || !roomId) return null;
    if (hasJoinedRef.current) return playerId; // Prevent double-join

    const pid = existingPlayerId || uuidv4();
    setPlayerId(pid);
    savePlayerInfo(roomId, pid, playerName, isHost);
    hasJoinedRef.current = true;

    console.log('🔌 useLobby.joinRoom:', { roomId, playerName, pid, isHost, gameType });

    socket.emit('joinRoom', {
      roomId,
      playerName,
      playerId: pid,
      isHost,
      gameType,
    });

    return pid;
  }, [socket, isConnected, roomId, gameType, playerId]);

  // Rejoin with saved info
  const rejoinWithSavedInfo = useCallback(() => {
    if (!savedPlayerInfo || !socket || !isConnected || !roomId) return null;
    if (hasJoinedRef.current) return playerId;

    const { playerName, playerId: savedId, isHost } = savedPlayerInfo;
    setPlayerId(savedId);
    hasJoinedRef.current = true;

    console.log('🔄 useLobby.rejoinWithSavedInfo:', { roomId, playerName, savedId, isHost });

    socket.emit('joinRoom', {
      roomId,
      playerName,
      playerId: savedId,
      isHost,
      gameType,
    });
    return savedId;
  }, [savedPlayerInfo, socket, isConnected, roomId, gameType, playerId]);

  // Toggle ready - uses server-authoritative state via currentPlayer
  const toggleReady = useCallback((currentIsReady: boolean) => {
    if (!socket || !isConnected || !roomId || !playerId) return;
    const newReady = !currentIsReady;
    console.log('🔄 toggleReady:', { playerId, currentIsReady, newReady });
    socket.emit('playerReady', { roomId, playerId, isReady: newReady });
  }, [socket, isConnected, roomId, playerId]);

  // Start game
  const startGame = useCallback((rounds: number) => {
    if (!socket || !isConnected || !roomId) return;
    console.log('🎮 startGame:', { roomId, rounds, gameType });
    socket.emit('startGame', { roomId, rounds, gameType });
  }, [socket, isConnected, roomId, gameType]);

  // Leave game
  const leaveGame = useCallback(() => {
    clearPlayerInfo();
    hasJoinedRef.current = false;
  }, []);

  // Socket event listeners
  useEffect(() => {
    if (!socket || !isConnected || !roomId) return;

    console.log('🔌 useLobby: Setting up socket listeners for room', roomId);

    // Request current room state
    socket.emit('getRoomState', { roomId });

    const handleRoomState = (roomState: any) => {
      console.log('📋 useLobby roomState:', roomState);
      if (roomState.hasStarted) setHasStarted(true);
      if (roomState.players) setPlayers(roomState.players);
      if (roomState.gameData) setGameData(roomState.gameData);
    };

    const handlePlayersUpdated = ({ players: serverPlayers }: { players: Player[] }) => {
      console.log('👥 useLobby playersUpdated:', serverPlayers.map(p => p.name));
      setPlayers(serverPlayers);
    };

    const handleGameStarted = (data?: { gameData?: any }) => {
      console.log('🎮 useLobby gameStarted', data);
      if (data?.gameData) {
        setGameData(data.gameData);
      }
      setHasStarted(true);
    };

    const handleErrorMessage = ({ message }: { message: string }) => {
      console.error('❌ Server error:', message);
    };

    socket.on('roomState', handleRoomState);
    socket.on('playersUpdated', handlePlayersUpdated);
    socket.on('gameStarted', handleGameStarted);
    socket.on('errorMessage', handleErrorMessage);

    return () => {
      socket.off('roomState', handleRoomState);
      socket.off('playersUpdated', handlePlayersUpdated);
      socket.off('gameStarted', handleGameStarted);
      socket.off('errorMessage', handleErrorMessage);
    };
  }, [socket, isConnected, roomId]);

  // Reset join guard when roomId changes
  useEffect(() => {
    hasJoinedRef.current = false;
  }, [roomId]);

  const currentPlayer = playerId ? players.find(p => p.id === playerId) ?? null : null;
  const isHost = currentPlayer?.isHost ?? false;

  return {
    players,
    setPlayers,
    playerId,
    setPlayerId,
    hasStarted,
    setHasStarted,
    gameData,
    currentPlayer,
    isHost,
    savedPlayerInfo,
    joinRoom,
    rejoinWithSavedInfo,
    toggleReady,
    startGame,
    leaveGame,
  };
};
