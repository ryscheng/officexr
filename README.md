# OfficeXR - WebXR Office Environment

A 3D virtual office environment built with Next.js, TypeScript, Three.js, and WebXR. Navigate through a fully immersive office space in your browser or VR headset.

## Features

- **Google Authentication**: Secure login with Google OAuth via NextAuth.js
- **Multiplayer Support**: See and interact with other users in real-time
- **3D Avatars**: Each user is represented by a unique 3D avatar with their name
- **Real-time Position Sync**: WebSocket-based position synchronization across clients
- **3D Office Environment**: Complete office space with desks, chairs, bookshelves, and decorative elements
- **WebXR Support**: Full VR support for immersive experiences with compatible headsets
- **Desktop Navigation**: Keyboard and mouse controls for desktop browsing
- **Responsive Design**: Adapts to different screen sizes and devices
- **TypeScript**: Fully typed for better development experience

## Office Elements

The virtual office includes:
- Multiple workstations with desks and chairs
- Bookshelves with detailed shelf structures
- Walls with decorative pictures
- Proper lighting (ambient and directional)
- Textured floor and ceiling

## Controls

### Desktop Mode
- **W/A/S/D** or **Arrow Keys**: Move around the office
- **Click + Drag Mouse**: Look around
- Movement is constrained within the office boundaries

### VR Mode
- Click the **"ENTER VR"** button at the bottom of the screen
- Use your VR headset's controllers for navigation
- Requires a WebXR-compatible browser and VR device

## Getting Started

### Prerequisites
- Node.js 18+ installed
- A modern web browser (Chrome, Firefox, Edge)
- For VR: A WebXR-compatible VR headset (Meta Quest, etc.)

### Installation

1. **Clone the repository and install dependencies**

```bash
npm install
```

2. **Set up Google OAuth credentials**

   - Go to the [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable the Google+ API
   - Go to "Credentials" and create an OAuth 2.0 Client ID
   - Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
   - Copy the Client ID and Client Secret

3. **Configure environment variables**

Create a `.env.local` file in the root directory:

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key-here
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

Generate a secure secret for `NEXTAUTH_SECRET`:
```bash
openssl rand -base64 32
```

4. **Run the development server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. You'll be prompted to sign in with Google.

### Building for Production

```bash
# Create an optimized production build
npm run build

# Start the production server
npm start
```

## Technology Stack

- **Next.js 16**: React framework with App Router
- **TypeScript**: Type-safe development
- **Three.js**: 3D graphics library
- **WebXR**: Virtual reality browser API
- **NextAuth.js**: Authentication for Next.js
- **WebSocket (ws)**: Real-time bidirectional communication
- **Tailwind CSS**: Utility-first CSS framework

## Browser Compatibility

### Desktop Mode
- Chrome 90+
- Firefox 88+
- Safari 15+
- Edge 90+

### VR Mode (WebXR)
- Chrome 90+ (with VR headset)
- Edge 90+ (with VR headset)
- Firefox Reality
- Oculus Browser

## Project Structure

```
officexr/
├── app/
│   ├── api/
│   │   └── auth/[...nextauth]/
│   │       └── route.ts          # NextAuth API route
│   ├── login/
│   │   └── page.tsx              # Login page
│   ├── layout.tsx                # Root layout with SessionProvider
│   ├── page.tsx                  # Main page component
│   └── globals.css               # Global styles
├── components/
│   ├── OfficeScene.tsx           # Three.js WebXR office scene
│   ├── Avatar.tsx                # 3D avatar creation and management
│   └── SessionProvider.tsx       # NextAuth session provider wrapper
├── lib/
│   └── auth.ts                   # NextAuth configuration
├── types/
│   └── next-auth.d.ts            # NextAuth type definitions
├── server.js                     # Custom server with WebSocket support
├── middleware.ts                 # Authentication middleware
├── package.json
└── README.md
```

## Development

The main 3D scene logic is in `components/OfficeScene.tsx`, which handles:
- Three.js scene initialization
- WebXR session management
- 3D object creation (office furniture)
- Navigation controls
- Camera management
- WebSocket client connection
- Real-time avatar position updates
- User join/leave event handling

The WebSocket server (`server.js`) manages:
- Real-time position synchronization
- User connection state
- Broadcasting position updates to all connected clients
- Automatic reconnection handling

## Future Enhancements

Potential improvements:
- Add more detailed office objects (computers, plants, etc.)
- Implement collision detection
- Add interactive elements (clickable objects)
- Multiplayer support
- Custom office layouts
- Import 3D models (GLTF/GLB)
- Better lighting and shadows
- Sound effects and spatial audio

## Learn More

To learn more about the technologies used:
- [Next.js Documentation](https://nextjs.org/docs)
- [Three.js Documentation](https://threejs.org/docs/)
- [WebXR Device API](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API)

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme).

Check out the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## License

MIT
