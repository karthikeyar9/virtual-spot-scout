import { ComponentType, LazyExoticComponent } from 'react';
import { LucideIcon } from 'lucide-react';

export interface Player {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  isReady: boolean;
  isBot?: boolean;
  roundScore?: number;
  distanceToTarget?: number;
  guessLocation?: { lat: number; lng: number };
}

export interface GameComponentProps {
  roomId: string;
  playerId: string;
  players: Player[];
  isHost: boolean;
  timeLimit: number;
  rounds: number;
  onGameComplete: () => void;
  setPlayers: (players: Player[]) => void;
  gameData?: any;
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'select' | 'slider';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number | string;
}

export interface GameDefinition {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  color: string;
  minPlayers: number;
  maxPlayers: number;
  component: LazyExoticComponent<ComponentType<GameComponentProps>>;
  configFields: ConfigField[];
}
