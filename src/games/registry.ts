import { lazy } from 'react';
import { Globe, HelpCircle, ThumbsUp, Smile, Crown } from 'lucide-react';
import { GameDefinition } from './types';

export const games: Record<string, GameDefinition> = {
  'city-guesser': {
    id: 'city-guesser',
    name: 'Virtual City Guesser',
    description: 'Guess world locations from street view images. Compete to pinpoint cities most accurately!',
    icon: Globe,
    color: 'bg-gradient-to-br from-sky-500 to-blue-600',
    minPlayers: 1,
    maxPlayers: 10,
    component: lazy(() => import('./city-guesser/CityGuesserGame')),
    configFields: [
      {
        key: 'rounds',
        label: 'Number of Rounds',
        type: 'select',
        options: [
          { value: '3', label: '3 Rounds' },
          { value: '5', label: '5 Rounds' },
          { value: '7', label: '7 Rounds' },
          { value: '10', label: '10 Rounds' },
        ],
        defaultValue: '5',
      },
      {
        key: 'time',
        label: 'Time Limit per Round',
        type: 'slider',
        min: 30,
        max: 120,
        step: 15,
        defaultValue: 60,
      },
    ],
  },
  'trivia': {
    id: 'trivia',
    name: 'Trivia Blitz',
    description: 'Answer multiple-choice questions. First correct answer gets a speed bonus!',
    icon: HelpCircle,
    color: 'bg-gradient-to-br from-violet-500 to-purple-600',
    minPlayers: 1,
    maxPlayers: 10,
    component: lazy(() => import('./trivia/TriviaGame')),
    configFields: [
      {
        key: 'rounds',
        label: 'Number of Questions',
        type: 'select',
        options: [
          { value: '5', label: '5 Questions' },
          { value: '10', label: '10 Questions' },
          { value: '15', label: '15 Questions' },
          { value: '20', label: '20 Questions' },
        ],
        defaultValue: '10',
      },
      {
        key: 'time',
        label: 'Time per Question',
        type: 'slider',
        min: 10,
        max: 30,
        step: 5,
        defaultValue: 15,
      },
    ],
  },
  'hot-takes': {
    id: 'hot-takes',
    name: 'Hot Takes',
    description: 'Vote on spicy prompts and see how your friends compare! Would you rather...?',
    icon: ThumbsUp,
    color: 'bg-gradient-to-br from-orange-500 to-rose-500',
    minPlayers: 2,
    maxPlayers: 10,
    component: lazy(() => import('./hot-takes/HotTakesGame')),
    configFields: [
      {
        key: 'rounds',
        label: 'Number of Prompts',
        type: 'select',
        options: [
          { value: '5', label: '5 Prompts' },
          { value: '10', label: '10 Prompts' },
          { value: '15', label: '15 Prompts' },
        ],
        defaultValue: '10',
      },
      {
        key: 'time',
        label: 'Time to Vote',
        type: 'slider',
        min: 10,
        max: 30,
        step: 5,
        defaultValue: 15,
      },
    ],
  },
  'emoji-decoder': {
    id: 'emoji-decoder',
    name: 'Emoji Decoder',
    description: 'Guess the movie, phrase, or thing from emoji clues. Type your guesses fast!',
    icon: Smile,
    color: 'bg-gradient-to-br from-amber-400 to-orange-500',
    minPlayers: 1,
    maxPlayers: 10,
    component: lazy(() => import('./emoji-decoder/EmojiDecoderGame')),
    configFields: [
      {
        key: 'rounds',
        label: 'Number of Puzzles',
        type: 'select',
        options: [
          { value: '5', label: '5 Puzzles' },
          { value: '10', label: '10 Puzzles' },
          { value: '15', label: '15 Puzzles' },
        ],
        defaultValue: '10',
      },
      {
        key: 'time',
        label: 'Time per Puzzle',
        type: 'slider',
        min: 15,
        max: 45,
        step: 5,
        defaultValue: 30,
      },
    ],
  },
  'chess': {
    id: 'chess',
    name: 'Chess',
    description: 'The classic game of kings. Outplay your opponent in a head-to-head battle of wits!',
    icon: Crown,
    color: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    minPlayers: 2,
    maxPlayers: 2,
    component: lazy(() => import('./chess/ChessGame')),
    configFields: [],
  },
};

export const getGame = (gameType: string): GameDefinition | undefined => games[gameType];
export const gameList = Object.values(games);
