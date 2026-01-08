# OfficeXR - WebXR Office Environment

A 3D virtual office environment built with Next.js, TypeScript, Three.js, and WebXR. Navigate through a fully immersive office space in your browser or VR headset.

## Features

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

```bash
# Install dependencies
npm install

# Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Building for Production

```bash
# Create an optimized production build
npm run build

# Start the production server
npm start
```

## Technology Stack

- **Next.js 15**: React framework with App Router
- **TypeScript**: Type-safe development
- **Three.js**: 3D graphics library
- **WebXR**: Virtual reality browser API
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
│   ├── layout.tsx       # Root layout with metadata
│   ├── page.tsx         # Main page component
│   └── globals.css      # Global styles
├── components/
│   └── OfficeScene.tsx  # Three.js WebXR office scene
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
