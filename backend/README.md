# Virtual Spot Scout - Backend Server

This is the backend server for the Virtual Spot Scout application, a multiplayer geography guessing game based on Google Street View.

## Features

- Real-time multiplayer gameplay with WebSockets (Socket.IO)
- Room-based game sessions
- Player management and score tracking
- Round progression and game state management

## Tech Stack

- Node.js
- Express
- Socket.IO
- Cors

## Deployment on Render

This backend is designed to be deployed on Render.com's Web Service platform.

## Environment Variables

None required for basic functionality. The server will automatically use the `PORT` provided by Render.

## Local Development

1. Install dependencies:
   ```
   npm install
   ```

2. Run the development server:
   ```
   npm run dev
   ```

3. The server will be available at `http://localhost:3001`

## Production Deployment

The server is configured to work with Render.com Web Services out of the box. 