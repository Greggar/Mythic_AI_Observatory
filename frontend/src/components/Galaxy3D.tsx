"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const DDC_COLORS: Record<string, string> = {
  "0": "#6b7280", "1": "#a78bfa", "2": "#f87171",
  "3": "#60a5fa", "4": "#34d399", "5": "#fbbf24",
  "6": "#f472b6", "7": "#fb923c", "8": "#818cf8",
  "9": "#2dd4bf",
};

const ARM_LABELS = ["General & Philosophy", "Religion & Social", "Science & Technology", "Arts & History"];

const ARM_COLORS = [0x4a6fa5, 0x3b82f6, 0xf59e0b, 0x8b5cf6];
const ARM_COLORS_HEX = ["#4a6fa5", "#3b82f6", "#f59e0b", "#8b5cf6"];

interface HistoryEntry {
  id: string;
  prompt: string;
  status: string;
  created_at: string;
  output: string | null;
  steps: { duration_ms: number | null }[];
  ddc?: { prompt: { code?: string; label?: string } | null } | null;
}

interface Props {
  onSelect: (traceId: string) => void;
  refreshTrigger: number;
}

function armForDDC(ddcCode?: string): number {
  if (!ddcCode) return Math.floor(Math.random() * 4);
  const d = ddcCode[0];
  if (d === "0" || d === "1") return 0;
  if (d === "2" || d === "3") return 1;
  if (d === "4" || d === "5" || d === "6") return 2;
  return 3;
}

function entryColor(entry: HistoryEntry): string {
  const code = entry.ddc?.prompt?.code;
  if (code) return DDC_COLORS[code[0]] || "#2dd4bf";
  return "#2dd4bf";
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function makeTextSprite(text: string, subtext: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 80;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, 320, 80);

  ctx.textAlign = "center";

  ctx.font = "bold 22px ui-monospace, monospace";
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 8;
  ctx.fillText(text, 160, 34);

  ctx.font = "16px ui-monospace, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.shadowBlur = 4;
  ctx.fillText(subtext, 160, 66);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(24, 6, 1);
  return sprite;
}

export default function Galaxy3D({ onSelect, refreshTrigger }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [tooltip, setTooltip] = useState<{ entry: HistoryEntry; x: number; y: number } | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const labelSprites = useRef<THREE.Sprite[]>([]);
  const tooltipDataRef = useRef<Map<number, HistoryEntry>>(new Map());
  const animFrameRef = useRef<number>(0);
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const hoveredIdx = useRef<number | null>(null);
  const armSpirals = useRef<THREE.Line[]>([]);

  const fetchTraces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/traces?view=summary`);
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : data.traces ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTraces(); }, [fetchTraces, refreshTrigger]);

  const perArm = useMemo(() => {
    const arms: HistoryEntry[][] = Array.from({ length: 4 }, () => []);
    for (const e of entries) {
      arms[armForDDC(e.ddc?.prompt?.code ?? undefined)].push(e);
    }
    return arms;
  }, [entries]);

  const particleData = useMemo(() => {
    if (entries.length === 0) return { positions: new Float32Array(), colors: new Float32Array(), sizes: new Float32Array(), tooltipMap: new Map<number, HistoryEntry>() };

    const ARM_COUNT = 4;
    const SPIN_ANGLE = Math.PI * 2.5;
    const MIN_RADIUS = 8;
    const MAX_RADIUS = 55;
    const HEIGHT_SPREAD = 6;

    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    const tooltipMap = new Map<number, HistoryEntry>();
    let idx = 0;

    for (let arm = 0; arm < ARM_COUNT; arm++) {
      const armEntries = perArm[arm];
      const n = armEntries.length;
      if (n === 0) continue;
      const armAngle = (arm / ARM_COUNT) * Math.PI * 2;

      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const angle = armAngle + t * SPIN_ANGLE;
        const radius = MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);

        const scatter = 1.5 * (1 - t) + 0.5;
        const x = radius * Math.cos(angle) + (Math.random() - 0.5) * scatter;
        const z = radius * Math.sin(angle) + (Math.random() - 0.5) * scatter;
        const y = (Math.random() - 0.5) * HEIGHT_SPREAD * (1 - t * 0.5);

        positions.push(x, y, z);

        const col = new THREE.Color(entryColor(armEntries[i]));
        colors.push(col.r, col.g, col.b);

        const ts = new Date(armEntries[i].created_at).getTime();
        const age = isNaN(ts) ? 0.5 : Math.max(0, Math.min(1, (Date.now() - ts) / (30 * 86400000)));
        const size = 0.35 + (1 - age) * 0.5;
        sizes.push(size);

        tooltipMap.set(idx, armEntries[i]);
        idx++;
      }
    }

    return {
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      sizes: new Float32Array(sizes),
      tooltipMap,
    };
  }, [perArm, entries]);

  // Build arm spiral paths
  const spiralPaths = useMemo(() => {
    const ARM_COUNT = 4;
    const SPIN_ANGLE = Math.PI * 2.5;
    const MIN_RADIUS = 6;
    const MAX_RADIUS = 58;
    const ptsPerArm = 60;

    return Array.from({ length: ARM_COUNT }, (_, arm) => {
      const armAngle = (arm / ARM_COUNT) * Math.PI * 2;
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= ptsPerArm; i++) {
        const t = i / ptsPerArm;
        const angle = armAngle + t * SPIN_ANGLE;
        const radius = MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
        const scatter = (1 - t) * 0.8;
        points.push(new THREE.Vector3(
          radius * Math.cos(angle) + (Math.random() - 0.5) * scatter,
          (Math.random() - 0.5) * 1.5,
          radius * Math.sin(angle) + (Math.random() - 0.5) * scatter,
        ));
      }
      return points;
    });
  }, []);

  // Init Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const w = container.clientWidth || 500;
    const h = 400;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
    camera.position.set(30, 25, 50);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 15;
    controls.maxDistance = 150;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0x404060, 0.6));

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    const coreLight = new THREE.PointLight(0x88ccff, 0.8, 30);
    coreLight.position.set(0, 0, 0);
    scene.add(coreLight);

    const coreGeo = new THREE.SphereGeometry(3, 24, 24);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x88ccff });
    scene.add(new THREE.Mesh(coreGeo, coreMat));

    // Starfield
    const starCount = 1000;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 500;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 500;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 500;
      starSizes[i] = 0.1 + Math.random() * 0.4;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x8888aa,
      size: 0.3,
      transparent: true,
      opacity: 0.5,
      sizeAttenuation: true,
    });
    scene.add(new THREE.Points(starGeo, starMat));

    // Build arm spiral paths
    for (let arm = 0; arm < 4; arm++) {
      const pts = spiralPaths[arm];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: ARM_COLORS[arm],
        transparent: true,
        opacity: 0.12,
      });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      armSpirals.current.push(line);

      // Denser inner glow
      const innerPts = pts.slice(0, 20);
      const innerGeo = new THREE.BufferGeometry().setFromPoints(innerPts);
      const innerMat = new THREE.LineBasicMaterial({
        color: ARM_COLORS[arm],
        transparent: true,
        opacity: 0.25,
      });
      scene.add(new THREE.Line(innerGeo, innerMat));
    }

    // Animation loop
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    const onResize = () => {
      const nw = container.clientWidth || 500;
      const nh = 400;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      for (const c of scene.children) {
        if ("geometry" in c) (c as any).geometry?.dispose();
        if ("material" in c) (c as any).material?.dispose();
      }
      scene.clear();
      container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update particles when data changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove old points
    if (pointsRef.current) {
      scene.remove(pointsRef.current);
      pointsRef.current.geometry.dispose();
      (pointsRef.current.material as THREE.Material).dispose();
      pointsRef.current = null;
    }
    // Remove old labels
    for (const s of labelSprites.current) {
      scene.remove(s);
      s.material.dispose();
    }
    labelSprites.current = [];

    tooltipDataRef.current = particleData.tooltipMap;

    if (particleData.positions.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(particleData.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(particleData.colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.6,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    pointsRef.current = points;
    scene.add(points);

    // Arm labels
    const SPIN_ANGLE = Math.PI * 2.5;
    const LABEL_RADIUS = 64;
    for (let arm = 0; arm < 4; arm++) {
      const count = perArm[arm].length;
      if (count === 0) continue;
      const armAngle = (arm / 4) * Math.PI * 2;
      const labelAngle = armAngle + SPIN_ANGLE * 0.85;
      const lx = LABEL_RADIUS * Math.cos(labelAngle);
      const lz = LABEL_RADIUS * Math.sin(labelAngle);
      const sprite = makeTextSprite(
        ARM_LABELS[arm],
        `${count} trace${count !== 1 ? "s" : ""}`,
        ARM_COLORS_HEX[arm],
      );
      sprite.position.set(lx, 3, lz);
      scene.add(sprite);
      labelSprites.current.push(sprite);
    }
  }, [particleData, perArm]);

  // Mouse interaction
  const handlePointer = useCallback((clientX: number, clientY: number) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!renderer || !camera || !container || !pointsRef.current) return null;

    const rect = container.getBoundingClientRect();
    mouse.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.current.setFromCamera(mouse.current, camera);
    const intersects = raycaster.current.intersectObject(pointsRef.current);

    if (intersects.length > 0 && intersects[0].index != null) {
      const entry = tooltipDataRef.current.get(intersects[0].index);
      if (entry) {
        container.style.cursor = "pointer";
        setTooltip({ entry, x: clientX, y: clientY });
        hoveredIdx.current = intersects[0].index;

        const posAttr = pointsRef.current.geometry.getAttribute("position");
        const sizeAttr = pointsRef.current.geometry.getAttribute("size");
        if (posAttr && sizeAttr) {
          const origSize = 0.35 + (1 - Math.max(0, Math.min(1, (Date.now() - new Date(entry.created_at).getTime()) / (30 * 86400000)))) * 0.5;
          const sizes = new Float32Array(posAttr.count);
          const colors = new Float32Array(posAttr.count * 3);
          const highlightColor = new THREE.Color("#ffffff");
          for (let i = 0; i < posAttr.count; i++) {
            if (i === intersects[0].index) {
              sizes[i] = 1.2;
              colors[i * 3] = 1;
              colors[i * 3 + 1] = 1;
              colors[i * 3 + 2] = 1;
            } else {
              sizes[i] = origSize * 0.5;
              colors[i * 3] = 0.3;
              colors[i * 3 + 1] = 0.3;
              colors[i * 3 + 2] = 0.4;
            }
          }
          pointsRef.current.geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
          pointsRef.current.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
          pointsRef.current.geometry.attributes.size.needsUpdate = true;
          pointsRef.current.geometry.attributes.color.needsUpdate = true;
        }
        return entry;
      }
    }

    container.style.cursor = "default";
    setTooltip(null);
    hoveredIdx.current = null;

    // Restore original colors
    if (pointsRef.current) {
      const posAttr = pointsRef.current.geometry.getAttribute("position");
      if (posAttr) {
        const sizes = new Float32Array(posAttr.count);
        const colors = new Float32Array(posAttr.count * 3);
        for (let i = 0; i < posAttr.count; i++) {
          const entry = tooltipDataRef.current.get(i);
          if (entry) {
            const ts = new Date(entry.created_at).getTime();
            const age = isNaN(ts) ? 0.5 : Math.max(0, Math.min(1, (Date.now() - ts) / (30 * 86400000)));
            sizes[i] = 0.35 + (1 - age) * 0.5;
            const col = new THREE.Color(entryColor(entry));
            colors[i * 3] = col.r;
            colors[i * 3 + 1] = col.g;
            colors[i * 3 + 2] = col.b;
          }
        }
        pointsRef.current.geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
        pointsRef.current.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        pointsRef.current.geometry.attributes.size.needsUpdate = true;
        pointsRef.current.geometry.attributes.color.needsUpdate = true;
      }
    }

    return null;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    handlePointer(e.clientX, e.clientY);
  }, [handlePointer]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".galaxy-label")) return;
    const entry = handlePointer(e.clientX, e.clientY);
    if (entry) onSelect(entry.id);
  }, [handlePointer, onSelect]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!controlsRef.current || !cameraRef.current) return;
    const ctrl = controlsRef.current;
    const cam = cameraRef.current;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = (e.clientX - rect.left) / rect.width * 2 - 1;
    const cy = -(e.clientY - rect.top) / rect.height * 2 + 1;
    const angle = Math.atan2(cy, cx);

    let norm = angle;
    if (norm < 0) norm += Math.PI * 2;
    const armIdx = Math.round(norm / (Math.PI / 2)) % 4;
    const targetAngle = (armIdx / 4) * Math.PI * 2 + Math.PI * 2.5 * 0.7;
    const targetR = 40;

    const tx = targetR * Math.cos(targetAngle);
    const tz = targetR * Math.sin(targetAngle);

    ctrl.autoRotate = false;
    const start = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
    const startTarget = { x: ctrl.target.x, y: ctrl.target.y, z: ctrl.target.z };
    const endTarget = new THREE.Vector3(tx, 0, tz);
    const endPos = new THREE.Vector3(tx + 20, 15, tz + 25);
    const duration = 800;
    const t0 = performance.now();

    function tween(now: number) {
      const t = Math.min((now - t0) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      cam.position.lerpVectors(
        new THREE.Vector3(start.x, start.y, start.z),
        endPos,
        ease,
      );
      ctrl.target.lerpVectors(
        new THREE.Vector3(startTarget.x, startTarget.y, startTarget.z),
        endTarget,
        ease,
      );
      if (t < 1) requestAnimationFrame(tween);
      else ctrl.autoRotate = true;
    }
    requestAnimationFrame(tween);
  }, []);

  const onReset = useCallback(() => {
    const cam = cameraRef.current!;
    const ctrl = controlsRef.current!;
    if (!cam || !ctrl) return;

    const start = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
    const duration = 600;
    const t0 = performance.now();
    ctrl.autoRotate = false;

    function tween(now: number) {
      const t = Math.min((now - t0) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      cam.position.lerpVectors(
        new THREE.Vector3(start.x, start.y, start.z),
        new THREE.Vector3(30, 25, 50),
        ease,
      );
      ctrl.target.lerpVectors(
        new THREE.Vector3(ctrl.target.x, ctrl.target.y, ctrl.target.z),
        new THREE.Vector3(0, 0, 0),
        ease,
      );
      if (t < 1) requestAnimationFrame(tween);
      else ctrl.autoRotate = true;
    }
    requestAnimationFrame(tween);
  }, []);

  // Toggle label visibility
  useEffect(() => {
    for (const s of labelSprites.current) {
      s.visible = showLabels;
    }
  }, [showLabels]);

  return (
    <div className="relative w-full">
      <div
        ref={containerRef}
        className="w-full rounded-xl overflow-hidden"
        style={{ height: "400px" }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[10px] font-mono text-zinc-600">Loading traces...</span>
        </div>
      )}
      {!loading && entries.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[10px] font-mono text-zinc-600">No traces yet</span>
        </div>
      )}
      <div className="absolute top-2 right-2 flex items-center gap-1.5">
        <button
          onClick={() => setShowLabels((v) => !v)}
          className={`text-[9px] font-mono px-2 py-1 rounded-full transition-colors border ${
            showLabels
              ? "bg-white/[0.06] text-zinc-400 border-white/[0.06]"
              : "bg-white/[0.02] text-zinc-600 border-white/[0.04]"
          } hover:text-zinc-300 hover:bg-white/[0.08]`}
        >
          Labels
        </button>
        <button
          onClick={onReset}
          className="text-[9px] font-mono px-2 py-1 rounded-full
            bg-white/[0.04] text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.08]
            transition-colors border border-white/[0.06]"
        >
          Reset view
        </button>
      </div>
      <div className="absolute bottom-2 left-2 flex flex-col gap-0.5">
        {ARM_LABELS.map((label, arm) => {
          const count = perArm[arm].length;
          return (
            <div key={label} className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: ARM_COLORS_HEX[arm] }}
              />
              <span className="text-[8px] font-mono text-zinc-500 leading-none">{label}</span>
              <span className="text-[8px] font-mono text-zinc-600 leading-none">
                {count}
              </span>
            </div>
          );
        })}
        {entries.length > 0 && (
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-[7px] font-mono text-zinc-700 leading-none">DDC</span>
            {[["0","#6b7280"],["1","#a78bfa"],["2","#f87171"],["3","#60a5fa"],["4","#34d399"],
              ["5","#fbbf24"],["6","#f472b6"],["7","#fb923c"],["8","#818cf8"],["9","#2dd4bf"]].map(([d, c]) => (
              <span
                key={d}
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: c }}
                title={`DDC class ${d}`}
              />
            ))}
          </div>
        )}
      </div>
      {tooltip && createPortal(
        <div
          className="fixed z-[100] pointer-events-none glass-panel !rounded-lg px-3 py-2 min-w-[180px]"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: entryColor(tooltip.entry) }}
            />
            <span className="text-[10px] font-mono text-zinc-300 truncate max-w-[120px]">
              {tooltip.entry.id.slice(0, 8)}
            </span>
            <span className={`text-[8px] font-mono px-1 py-0.5 rounded-full ${
              tooltip.entry.status === "complete" ? "bg-teal-mystic/10 text-teal-mystic" : "bg-amber-500/10 text-amber-400"
            }`}>
              {tooltip.entry.status}
            </span>
          </div>
          <p className="text-[9px] text-zinc-400 mt-1 truncate max-w-[220px]">
            {tooltip.entry.prompt.slice(0, 80)}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[8px] text-zinc-600">
              {formatDate(tooltip.entry.created_at)}
            </span>
            {tooltip.entry.ddc?.prompt?.label && (
              <span className="text-[8px] text-zinc-600 truncate">
                {tooltip.entry.ddc.prompt.label}
              </span>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
