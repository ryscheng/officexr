const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Store connected users and their positions
const users = new Map();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Create WebSocket server
  const wss = new WebSocketServer({ server, path: '/api/ws' });

  wss.on('connection', (ws) => {
    console.log('New WebSocket connection');

    let userId = null;

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case 'join':
            userId = data.userId;
            users.set(userId, {
              id: userId,
              name: data.name,
              image: data.image,
              position: data.position || { x: 0, y: 1.6, z: 5 },
              rotation: data.rotation || { x: 0, y: 0, z: 0 },
              customization: data.customization,
              ws,
            });

            // Send current users to the new user
            const currentUsers = Array.from(users.values()).map(u => ({
              id: u.id,
              name: u.name,
              image: u.image,
              position: u.position,
              rotation: u.rotation,
              customization: u.customization,
            }));

            ws.send(JSON.stringify({
              type: 'users',
              users: currentUsers.filter(u => u.id !== userId),
            }));

            // Broadcast new user to all other users
            broadcast({
              type: 'user-joined',
              user: {
                id: userId,
                name: data.name,
                image: data.image,
                position: data.position || { x: 0, y: 1.6, z: 5 },
                rotation: data.rotation || { x: 0, y: 0, z: 0 },
                customization: data.customization,
              },
            }, userId);

            console.log(`User ${userId} (${data.name}) joined. Total users: ${users.size}`);
            break;

          case 'position':
            if (userId && users.has(userId)) {
              const user = users.get(userId);
              user.position = data.position;
              user.rotation = data.rotation;

              // Broadcast position update to all other users
              broadcast({
                type: 'position',
                userId,
                position: data.position,
                rotation: data.rotation,
              }, userId);
            }
            break;

          case 'avatar-update':
            if (userId && users.has(userId)) {
              const user = users.get(userId);
              user.customization = data.customization;

              // Broadcast avatar update to all other users
              broadcast({
                type: 'avatar-update',
                userId,
                customization: data.customization,
              }, userId);

              console.log(`User ${userId} updated avatar customization`);
            }
            break;
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    ws.on('close', () => {
      if (userId) {
        users.delete(userId);

        // Broadcast user left to all other users
        broadcast({
          type: 'user-left',
          userId,
        }, userId);

        console.log(`User ${userId} left. Total users: ${users.size}`);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  function broadcast(message, excludeUserId) {
    const messageStr = JSON.stringify(message);
    users.forEach((user, id) => {
      if (id !== excludeUserId && user.ws.readyState === 1) { // 1 = OPEN
        user.ws.send(messageStr);
      }
    });
  }

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket server ready on ws://${hostname}:${port}/api/ws`);
  });
});
