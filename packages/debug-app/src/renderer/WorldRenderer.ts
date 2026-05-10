import * as THREE from 'three';
import { BUBBLE_RADIUS } from '@officexr/sdk';
import type { OfficeState } from '@officexr/sdk';

export class WorldRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private playerMeshes = new Map<string, THREE.Mesh>();
  private bubbleMesh: THREE.Mesh;
  private container: HTMLDivElement;
  private selfId: string | null = null;

  private onResize: () => void;

  constructor(container: HTMLDivElement) {
    this.container = container;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    // Camera
    const aspect = (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    this.camera.position.set(0, 1.6, 5);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 5);
    this.scene.add(directional);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(40, 40);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a7c59 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Proximity bubble (wireframe sphere around local player)
    const bubbleGeo = new THREE.SphereGeometry(BUBBLE_RADIUS, 16, 16);
    const bubbleMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
    });
    this.bubbleMesh = new THREE.Mesh(bubbleGeo, bubbleMat);
    this.bubbleMesh.visible = true;
    this.scene.add(this.bubbleMesh);

    // Window resize handler
    this.onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this.onResize);
  }

  render(state: OfficeState): void {
    // Track the self id from state
    this.selfId = state.selfId;

    const presentIds = new Set(Object.keys(state.players));

    // Remove meshes for players no longer in state
    for (const [id, mesh] of this.playerMeshes) {
      if (!presentIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.playerMeshes.delete(id);
      }
    }

    // Create/update player meshes
    for (const [playerId, player] of Object.entries(state.players)) {
      let mesh = this.playerMeshes.get(playerId);
      if (!mesh) {
        const geo = new THREE.BoxGeometry(0.6, 1.8, 0.6);
        const color = playerId === state.selfId ? 0x4488ff : 0xaaaaaa;
        const mat = new THREE.MeshLambertMaterial({ color });
        mesh = new THREE.Mesh(geo, mat);
        this.scene.add(mesh);
        this.playerMeshes.set(playerId, mesh);
      }

      // Position the mesh
      mesh.position.set(player.pos.x, player.pos.y + 0.9, player.pos.z);

      // If this is the local player, update camera and bubble
      if (playerId === state.selfId) {
        this.camera.position.set(
          player.pos.x,
          player.pos.y + 1.6,
          player.pos.z + 5
        );
        this.bubbleMesh.position.set(player.pos.x, player.pos.y, player.pos.z);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);

    // Remove player meshes
    for (const [, mesh] of this.playerMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.playerMeshes.clear();

    this.renderer.dispose();

    // Remove canvas from container
    const canvas = this.renderer.domElement;
    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
