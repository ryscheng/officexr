import * as THREE from 'three';
import { BUBBLE_RADIUS } from '@officexr/sdk';
import type { OfficeState } from '@officexr/sdk';

const CAMERA_RADIUS = 6;
const PITCH_MIN = -1.3;
const PITCH_MAX = 1.3;
const MOUSE_SENSITIVITY = 0.0025;

export class WorldRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private playerMeshes = new Map<string, THREE.Mesh>();
  private bubbleMesh: THREE.Mesh;
  private container: HTMLDivElement;

  private yaw = 0;
  private pitch = -0.25;

  private onResize: () => void;
  private onCanvasMouseDown: () => void;
  private onMouseMove: (e: MouseEvent) => void;

  constructor(container: HTMLDivElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.cursor = 'grab';
    container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    const aspect = (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 5);
    this.scene.add(directional);

    const groundGeo = new THREE.PlaneGeometry(40, 40);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a7c59 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

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

    this.onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this.onResize);

    this.onCanvasMouseDown = () => {
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
      }
    };
    canvas.addEventListener('mousedown', this.onCanvasMouseDown);

    this.onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch -= e.movementY * MOUSE_SENSITIVITY;
      if (this.pitch < PITCH_MIN) this.pitch = PITCH_MIN;
      if (this.pitch > PITCH_MAX) this.pitch = PITCH_MAX;
    };
    document.addEventListener('mousemove', this.onMouseMove);
  }

  getYaw(): number {
    return this.yaw;
  }

  render(state: OfficeState): void {
    const presentIds = new Set(Object.keys(state.players));

    for (const [id, mesh] of this.playerMeshes) {
      if (!presentIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.playerMeshes.delete(id);
      }
    }

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

      mesh.position.set(player.pos.x, player.pos.y + 0.9, player.pos.z);

      if (playerId === state.selfId) {
        const head = new THREE.Vector3(player.pos.x, player.pos.y + 1.6, player.pos.z);
        const offsetX = Math.sin(this.yaw) * Math.cos(this.pitch) * CAMERA_RADIUS;
        const offsetY = Math.sin(this.pitch) * CAMERA_RADIUS;
        const offsetZ = Math.cos(this.yaw) * Math.cos(this.pitch) * CAMERA_RADIUS;
        this.camera.position.set(head.x + offsetX, head.y + offsetY, head.z + offsetZ);
        this.camera.lookAt(head);
        this.bubbleMesh.position.set(player.pos.x, player.pos.y, player.pos.z);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('mousedown', this.onCanvasMouseDown);
    document.removeEventListener('mousemove', this.onMouseMove);
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock?.();
    }

    for (const [, mesh] of this.playerMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.playerMeshes.clear();

    this.renderer.dispose();

    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
