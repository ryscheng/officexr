import React, { useMemo } from 'react';
import * as THREE from 'three';

interface EndlessGridProps {
  /** World-space spacing between minor lines (default 1 m). */
  cellSize?: number;
  /** Major-line every Nth cell (default every 10). */
  sectionSize?: number;
  /** Half-width of the rendered quad in metres. Big enough that the
   * fade-out at the edge isn't visible from any reasonable viewpoint;
   * the shader fades transparent past `fadeDistance`. */
  size?: number;
  /** Distance at which lines fade out completely. */
  fadeDistance?: number;
  cellColor?: string;
  sectionColor?: string;
}

/**
 * Procedural infinite-looking grid floor. A single quad covering
 * `2*size` metres per side; a fragment shader paints major + minor
 * grid lines from the world-space XZ coords and fades them with
 * distance from origin so the grid reads as bounded near the camera
 * but featureless in the distance.
 *
 * The Character editor uses this in place of `<Floor>` to give the
 * "endless reference grid" feel without 50×50 instanced cubes.
 */
export function EndlessGrid({
  cellSize = 1,
  sectionSize = 10,
  size = 200,
  fadeDistance = 80,
  cellColor = '#3f3f46',
  sectionColor = '#71717a',
}: EndlessGridProps) {
  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uCellSize: { value: cellSize },
        uSectionSize: { value: cellSize * sectionSize },
        uCellColor: { value: new THREE.Color(cellColor) },
        uSectionColor: { value: new THREE.Color(sectionColor) },
        uFadeDistance: { value: fadeDistance },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    return m;
  }, [cellSize, sectionSize, cellColor, sectionColor, fadeDistance]);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      receiveShadow={false}
      // Render before normal opaque so shadows from objects above
      // don't z-fight with the grid surface.
      renderOrder={-1}
    >
      <planeGeometry args={[size * 2, size * 2]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

const VERT = /* glsl */ `
varying vec2 vWorldXZ;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldXZ = worldPos.xz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// Antialiased grid via fwidth — see iquilez "filtering" trick. We
// compute distance-to-nearest-line in cell units, then divide by the
// derivative so a line is one screen pixel wide regardless of zoom.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vWorldXZ;
uniform float uCellSize;
uniform float uSectionSize;
uniform vec3 uCellColor;
uniform vec3 uSectionColor;
uniform float uFadeDistance;

float gridLine(vec2 coord, float scale) {
  vec2 g = abs(fract(coord / scale - 0.5) - 0.5) / fwidth(coord / scale);
  return 1.0 - min(min(g.x, g.y), 1.0);
}

void main() {
  float minor = gridLine(vWorldXZ, uCellSize);
  float major = gridLine(vWorldXZ, uSectionSize);
  vec3 color = mix(uCellColor, uSectionColor, major);
  float a = max(minor, major);
  float dist = length(vWorldXZ);
  float fade = 1.0 - smoothstep(uFadeDistance * 0.4, uFadeDistance, dist);
  a *= fade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(color, a);
}
`;
