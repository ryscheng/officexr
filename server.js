const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Store connected users and their positions by office
// Structure: Map<officeId, Map<userId, userData>>
const offices = new Map();

// Store chat messages by office (in memory, ephemeral)
// Structure: Map<officeId, Array<chatMessage>>
const chatHistory = new Map();
const MAX_CHAT_HISTORY = 50;

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
    let officeId = null;

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case 'join':
            userId = data.userId;
            officeId = data.officeId;

            if (!officeId) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'officeId is required to join',
              }));
              return;
            }

            // Ensure office exists in map
            if (!offices.has(officeId)) {
              offices.set(officeId, new Map());
            }

            const officeUsers = offices.get(officeId);
            officeUsers.set(userId, {
              id: userId,
              name: data.name,
              image: data.image,
              position: data.position || { x: 0, y: 1.6, z: 5 },
              rotation: data.rotation || { x: 0, y: 0, z: 0 },
              customization: data.customization,
              ws,
            });

            // Send current users in this office to the new user
            const currentUsers = Array.from(officeUsers.values()).map(u => ({
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

            // Send recent chat history to the new user
            if (chatHistory.has(officeId)) {
              ws.send(JSON.stringify({
                type: 'chat-history',
                messages: chatHistory.get(officeId),
              }));
            }

            // Broadcast new user to all other users in this office
            broadcastToOffice(officeId, {
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

            console.log(`User ${userId} (${data.name}) joined office ${officeId}. Office users: ${officeUsers.size}`);
            break;

          case 'position':
            if (userId && officeId && offices.has(officeId)) {
              const officeUsers = offices.get(officeId);
              if (officeUsers.has(userId)) {
                const user = officeUsers.get(userId);
                user.position = data.position;
                user.rotation = data.rotation;

                // Broadcast position update to all other users in this office
                broadcastToOffice(officeId, {
                  type: 'position',
                  userId,
                  position: data.position,
                  rotation: data.rotation,
                }, userId);
              }
            }
            break;

          case 'avatar-update':
            if (userId && officeId && offices.has(officeId)) {
              const officeUsers = offices.get(officeId);
              if (officeUsers.has(userId)) {
                const user = officeUsers.get(userId);
                user.customization = data.customization;

                // Broadcast avatar update to all other users in this office
                broadcastToOffice(officeId, {
                  type: 'avatar-update',
                  userId,
                  customization: data.customization,
                }, userId);

                console.log(`User ${userId} updated avatar customization in office ${officeId}`);
              }
            }
            break;

          case 'chat':
            if (userId && officeId && offices.has(officeId)) {
              const officeUsers = offices.get(officeId);
              if (officeUsers.has(userId)) {
                const user = officeUsers.get(userId);

                const chatMessage = {
                  id: `${Date.now()}-${userId}`,
                  userId,
                  userName: user.name,
                  message: data.message,
                  timestamp: Date.now(),
                };

                // Store message in chat history
                if (!chatHistory.has(officeId)) {
                  chatHistory.set(officeId, []);
                }
                const messages = chatHistory.get(officeId);
                messages.push(chatMessage);

                // Keep only the last MAX_CHAT_HISTORY messages
                if (messages.length > MAX_CHAT_HISTORY) {
                  messages.shift();
                }

                // Broadcast chat message to all users in this office (including sender)
                broadcastToOffice(officeId, {
                  type: 'chat',
                  message: chatMessage,
                });

                console.log(`[Office ${officeId}] ${user.name}: ${data.message}`);
              }
            }
            break;
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    ws.on('close', () => {
      if (userId && officeId && offices.has(officeId)) {
        const officeUsers = offices.get(officeId);
        officeUsers.delete(userId);

        // Broadcast user left to all other users in this office
        broadcastToOffice(officeId, {
          type: 'user-left',
          userId,
        }, userId);

        console.log(`User ${userId} left office ${officeId}. Office users: ${officeUsers.size}`);

        // Clean up empty offices
        if (officeUsers.size === 0) {
          offices.delete(officeId);
          chatHistory.delete(officeId);
          console.log(`Office ${officeId} is now empty and removed`);
        }
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  function broadcastToOffice(officeId, message, excludeUserId) {
    if (!offices.has(officeId)) {
      return;
    }

    const messageStr = JSON.stringify(message);
    const officeUsers = offices.get(officeId);

    officeUsers.forEach((user, id) => {
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
