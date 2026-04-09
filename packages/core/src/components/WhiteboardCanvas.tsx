import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { WhiteboardStroke, WhiteboardPoint, WhiteboardTool } from '@/hooks/useWhiteboard';

interface WhiteboardCanvasProps {
  active: boolean;
  is2DMode: boolean;
  strokes: WhiteboardStroke[];
  currentStroke: WhiteboardPoint[];
  tool: WhiteboardTool;
  color: string;
  strokeWidth: number;
  orthoCamera: THREE.OrthographicCamera | null;
  /** Container element to match canvas size */
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  onBeginStroke: (point: WhiteboardPoint) => void;
  onContinueStroke: (point: WhiteboardPoint) => void;
  onEndStroke: () => void;
}

/**
 * HTML Canvas overlay that renders whiteboard strokes in 2D mode.
 * Handles drawing input (pointer events) and maps screen coordinates
 * to world XZ coordinates via the orthographic camera.
 */
export default function WhiteboardCanvas({
  active,
  is2DMode,
  strokes,
  currentStroke,
  tool,
  color,
  strokeWidth,
  orthoCamera,
  containerRef,
  onBeginStroke,
  onContinueStroke,
  onEndStroke,
}: WhiteboardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const animFrameRef = useRef<number>(0);

  // Convert screen coordinates to world XZ
  const screenToWorld = useCallback((clientX: number, clientY: number): WhiteboardPoint | null => {
    if (!orthoCamera || !containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), orthoCamera);
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, intersection)) {
      return { x: intersection.x, z: intersection.z };
    }
    return null;
  }, [orthoCamera, containerRef]);

  // Convert world XZ to screen coordinates for rendering
  const worldToScreen = useCallback((point: WhiteboardPoint, canvas: HTMLCanvasElement): [number, number] | null => {
    if (!orthoCamera || !containerRef.current) return null;
    const v = new THREE.Vector3(point.x, 0, point.z);
    v.project(orthoCamera);
    const x = (v.x * 0.5 + 0.5) * canvas.width;
    const y = (-v.y * 0.5 + 0.5) * canvas.height;
    return [x, y];
  }, [orthoCamera, containerRef]);

  // Render strokes to canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !orthoCamera) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ensure canvas matches container size
    const container = containerRef.current;
    if (container) {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.scale(dpr, dpr);
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawStrokeOnCanvas = (points: WhiteboardPoint[], strokeColor: string, width: number, strokeTool: WhiteboardTool) => {
      if (points.length < 2) return;
      // Calculate a sensible pixel width based on zoom
      const viewSize = orthoCamera.top - orthoCamera.bottom;
      const canvasH = canvas.height / (window.devicePixelRatio || 1);
      const pixelsPerUnit = canvasH / viewSize;
      const pixelWidth = (width * 0.04) * pixelsPerUnit;

      if (strokeTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = strokeColor;
      }
      ctx.lineWidth = pixelWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const start = worldToScreen(points[0], canvas);
      if (!start) return;
      ctx.moveTo(start[0], start[1]);
      for (let i = 1; i < points.length; i++) {
        const pt = worldToScreen(points[i], canvas);
        if (pt) ctx.lineTo(pt[0], pt[1]);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    };

    // Draw completed strokes
    for (const stroke of strokes) {
      drawStrokeOnCanvas(stroke.points, stroke.color, stroke.width, stroke.tool);
    }

    // Draw current in-progress stroke
    if (currentStroke.length >= 2) {
      drawStrokeOnCanvas(currentStroke, tool === 'eraser' ? '#000000' : color, strokeWidth, tool);
    }
  }, [strokes, currentStroke, orthoCamera, containerRef, worldToScreen, tool, color, strokeWidth]);

  // Keep a stable ref to renderCanvas so the animation loop never needs to restart.
  // Without this, the loop would cancel+restart on every mouse move (because
  // renderCanvas depends on currentStroke which changes every pointer event),
  // causing the RAF to be cancelled before it fires and the stroke to only
  // appear after the mouse stops moving.
  const renderCanvasRef = useRef(renderCanvas);
  useEffect(() => { renderCanvasRef.current = renderCanvas; });

  // Animation frame loop for rendering — only restarts when is2DMode changes.
  useEffect(() => {
    if (!is2DMode) return;
    const tick = () => {
      renderCanvasRef.current();
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [is2DMode]);

  // Pointer event handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!active || !is2DMode) return;
    const pt = screenToWorld(e.clientX, e.clientY);
    if (!pt) return;
    isDrawingRef.current = true;
    onBeginStroke(pt);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [active, is2DMode, screenToWorld, onBeginStroke]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDrawingRef.current) return;
    const pt = screenToWorld(e.clientX, e.clientY);
    if (pt) onContinueStroke(pt);
  }, [screenToWorld, onContinueStroke]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    onEndStroke();
  }, [onEndStroke]);

  const showCanvas = is2DMode && (active || strokes.length > 0 || currentStroke.length > 0);

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: active ? 90 : 80,
        pointerEvents: active && is2DMode ? 'auto' : 'none',
        cursor: active && is2DMode ? (tool === 'eraser' ? 'crosshair' : 'crosshair') : 'default',
        display: showCanvas ? 'block' : 'none',
      }}
    />
  );
}
