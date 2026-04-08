import { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { RealtimeChannel } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WhiteboardPoint {
  x: number;
  z: number;
}

export interface WhiteboardStroke {
  id: string;
  userId: string;
  points: WhiteboardPoint[];
  color: string;
  width: number;
  tool: 'pen' | 'eraser';
  timestamp: number;
}

export type WhiteboardTool = 'pen' | 'eraser';

// ─── Constants ──────────────────────────────────────────────────────────────

export const WB_COLORS = [
  '#000000', '#e74c3c', '#3498db', '#2ecc71',
  '#f39c12', '#9b59b6', '#ffffff', '#f1c40f',
];

export const WB_WIDTHS = [2, 5, 10]; // thin, medium, thick

// ─── Whiteboard texture for 3D mode ─────────────────────────────────────────

const WB_TEX_SIZE = 2048;
const WB_WORLD_SIZE = 30; // matches floor plane geometry

function worldToTexCoord(wx: number, wz: number): [number, number] {
  // World: -15..+15 maps to texture: 0..2048
  const tx = ((wx + WB_WORLD_SIZE / 2) / WB_WORLD_SIZE) * WB_TEX_SIZE;
  const ty = ((wz + WB_WORLD_SIZE / 2) / WB_WORLD_SIZE) * WB_TEX_SIZE;
  return [tx, ty];
}

function renderStrokesToCanvas(
  ctx: CanvasRenderingContext2D,
  strokes: WhiteboardStroke[],
) {
  ctx.clearRect(0, 0, WB_TEX_SIZE, WB_TEX_SIZE);
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
    }
    // Scale width: world units to texture pixels (~68 px per world unit)
    ctx.lineWidth = stroke.width * (WB_TEX_SIZE / WB_WORLD_SIZE) * 0.04;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const [sx, sy] = worldToTexCoord(stroke.points[0].x, stroke.points[0].z);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < stroke.points.length; i++) {
      const [px, py] = worldToTexCoord(stroke.points[i].x, stroke.points[i].z);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export interface WhiteboardHandle {
  whiteboardActive: boolean;
  setWhiteboardActive: (active: boolean) => void;
  strokes: WhiteboardStroke[];
  currentStroke: WhiteboardPoint[];
  tool: WhiteboardTool;
  setTool: (tool: WhiteboardTool) => void;
  color: string;
  setColor: (color: string) => void;
  strokeWidth: number;
  setStrokeWidth: (width: number) => void;
  beginStroke: (point: WhiteboardPoint) => void;
  continueStroke: (point: WhiteboardPoint) => void;
  endStroke: () => void;
  undo: () => void;
  clearAll: () => void;
  registerWhiteboardListeners: (channel: RealtimeChannel) => void;
  /** Call from animation loop to update 3D floor texture if strokes changed */
  updateFloorTexture: () => void;
  /** Ref to the 3D whiteboard mesh (created on init) */
  whiteboardMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  /** Create the 3D whiteboard mesh and add to scene */
  initWhiteboardMesh: (scene: THREE.Scene) => void;
  strokesRef: React.MutableRefObject<WhiteboardStroke[]>;
}

interface UseWhiteboardOptions {
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
  channelSubscribedRef: React.MutableRefObject<boolean>;
  currentUserId: string | undefined;
}

export function useWhiteboard({
  channelRef,
  channelSubscribedRef,
  currentUserId,
}: UseWhiteboardOptions): WhiteboardHandle {
  const [whiteboardActive, setWhiteboardActive] = useState(false);
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<WhiteboardPoint[]>([]);
  const [tool, setTool] = useState<WhiteboardTool>('pen');
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(5);

  const strokesRef = useRef<WhiteboardStroke[]>([]);
  const localStrokeIdsRef = useRef<string[]>([]);
  const texDirtyRef = useRef(false);

  // 3D whiteboard floor texture
  const whiteboardMeshRef = useRef<THREE.Mesh | null>(null);
  const wbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wbCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const wbTextureRef = useRef<THREE.CanvasTexture | null>(null);

  const updateStrokesState = useCallback((newStrokes: WhiteboardStroke[]) => {
    strokesRef.current = newStrokes;
    setStrokes(newStrokes);
    texDirtyRef.current = true;
  }, []);

  const beginStroke = useCallback((point: WhiteboardPoint) => {
    setCurrentStroke([point]);
  }, []);

  const continueStroke = useCallback((point: WhiteboardPoint) => {
    setCurrentStroke(prev => [...prev, point]);
  }, []);

  const endStroke = useCallback(() => {
    setCurrentStroke(prev => {
      if (prev.length < 2) return [];
      const stroke: WhiteboardStroke = {
        id: `${currentUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId: currentUserId || 'unknown',
        points: prev,
        color: tool === 'eraser' ? '#000000' : color,
        width: strokeWidth,
        tool,
        timestamp: Date.now(),
      };
      const newStrokes = [...strokesRef.current, stroke];
      updateStrokesState(newStrokes);
      localStrokeIdsRef.current.push(stroke.id);
      // Broadcast
      if (channelRef.current && channelSubscribedRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'whiteboard-stroke',
          payload: stroke,
        });
      }
      return [];
    });
  }, [currentUserId, tool, color, strokeWidth, channelRef, channelSubscribedRef, updateStrokesState]);

  const undo = useCallback(() => {
    const lastId = localStrokeIdsRef.current.pop();
    if (!lastId) return;
    const newStrokes = strokesRef.current.filter(s => s.id !== lastId);
    updateStrokesState(newStrokes);
    if (channelRef.current && channelSubscribedRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'whiteboard-undo',
        payload: { strokeId: lastId },
      });
    }
  }, [channelRef, channelSubscribedRef, updateStrokesState]);

  const clearAll = useCallback(() => {
    updateStrokesState([]);
    localStrokeIdsRef.current = [];
    if (channelRef.current && channelSubscribedRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'whiteboard-clear',
        payload: {},
      });
    }
  }, [channelRef, channelSubscribedRef, updateStrokesState]);

  const registerWhiteboardListeners = useCallback((channel: RealtimeChannel) => {
    channel.on('broadcast', { event: 'whiteboard-stroke' }, ({ payload }) => {
      const stroke = payload as WhiteboardStroke;
      if (stroke.userId === currentUserId) return;
      const newStrokes = [...strokesRef.current, stroke];
      updateStrokesState(newStrokes);
    });

    channel.on('broadcast', { event: 'whiteboard-undo' }, ({ payload }) => {
      const { strokeId } = payload as { strokeId: string };
      const newStrokes = strokesRef.current.filter(s => s.id !== strokeId);
      updateStrokesState(newStrokes);
    });

    channel.on('broadcast', { event: 'whiteboard-clear' }, () => {
      updateStrokesState([]);
      localStrokeIdsRef.current = [];
    });
  }, [currentUserId, updateStrokesState]);

  // ─── 3D Floor texture ─────────────────────────────────────────────────────

  const initWhiteboardMesh = useCallback((scene: THREE.Scene) => {
    if (whiteboardMeshRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = WB_TEX_SIZE;
    canvas.height = WB_TEX_SIZE;
    wbCanvasRef.current = canvas;
    wbCtxRef.current = canvas.getContext('2d')!;

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    wbTextureRef.current = texture;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WB_WORLD_SIZE, WB_WORLD_SIZE),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.04;
    scene.add(mesh);
    whiteboardMeshRef.current = mesh;
  }, []);

  const updateFloorTexture = useCallback(() => {
    if (!texDirtyRef.current) return;
    texDirtyRef.current = false;
    const ctx = wbCtxRef.current;
    const tex = wbTextureRef.current;
    if (!ctx || !tex) return;
    renderStrokesToCanvas(ctx, strokesRef.current);
    tex.needsUpdate = true;
  }, []);

  return {
    whiteboardActive,
    setWhiteboardActive,
    strokes,
    currentStroke,
    tool,
    setTool,
    color,
    setColor,
    strokeWidth,
    setStrokeWidth,
    beginStroke,
    continueStroke,
    endStroke,
    undo,
    clearAll,
    registerWhiteboardListeners,
    updateFloorTexture,
    whiteboardMeshRef,
    initWhiteboardMesh,
    strokesRef,
  };
}
