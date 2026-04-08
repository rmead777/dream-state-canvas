/**
 * ThreeDRenderer — renders 3D data visualizations using React Three Fiber.
 *
 * Scene types:
 *   bar3d     — 3D bar chart with orbit controls
 *   scatter3d — 3D scatter plot
 *   pie3d     — extruded pie/donut chart
 *   network   — force-directed node graph
 *   surface   — 3D surface/terrain from grid data
 *
 * Uses the same frosted glass palette as 2D charts.
 * Lazy-loaded to avoid bundling Three.js for users who never see 3D.
 */

import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, RoundedBox, Float } from '@react-three/drei';
import { CHART_THEMES } from '@/lib/chart-themes';
import { easeOutCubic, easeOutSpring, getStaggerDelay } from '@/hooks/useAnimationTimeline';
import * as THREE from 'three';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ThreeDSectionData {
  sceneType: string;
  data: Record<string, string | number>[];
  xAxis?: string;
  yAxis?: string;
  zAxis?: string;
  labelKey?: string;
  valueKey?: string;
  colorKey?: string;
  colors?: string[];
  height?: number;
  caption?: string;

  // ─── Scene controls (all optional, sensible defaults) ───────────────
  autoRotate?: boolean;        // default true — slow orbit
  autoRotateSpeed?: number;    // default 0.5
  showGrid?: boolean;          // default true — floor grid
  showLabels?: boolean;        // default true — name labels
  showValues?: boolean;        // default true — value labels above bars
  cameraPosition?: [number, number, number]; // default [5,4,5]
  lookAt?: [number, number, number];         // default [0,0,0]

  // ─── Bar controls (bar3d, barRace) ──────────────────────────────────
  barWidth?: number;           // default 0.6
  barGap?: number;             // default 0.3
  maxHeight?: number;          // default 4

  // ─── Material controls (all scenes) ─────────────────────────────────
  opacity?: number;            // fill opacity, default 0.35
  wireframe?: boolean;         // show wireframe borders, default true
  metalness?: number;          // 0-1, default 0.1
  roughness?: number;          // 0-1, default 0.2

  // ─── Node controls (network, connectionMap) ─────────────────────────
  nodeMinSize?: number;        // default 0.08
  nodeMaxSize?: number;        // default 1.2
  circleRadius?: number;       // layout radius, default 4

  // ─── Animation controls (animated scenes) ───────────────────────────
  animationSpeed?: number;     // multiplier, default 1.0
  stagger?: number;            // delay between items, default varies by scene

  // ─── Pie/radial controls ────────────────────────────────────────────
  innerRadius?: number;        // donut hole size, default 1.0
  outerRadius?: number;        // segment reach, default 2.0
  extrudeDepth?: number;       // 3D depth, default 0.4

  // ─── Particle controls (particleFlow) ───────────────────────────────
  particleDensity?: number;    // max particles per flow, default 30
  flowSpeed?: number;          // particle speed, default 0.3

  // ─── Timeline controls (timelineFlow) ───────────────────────────────
  dollySpeed?: number;         // camera speed, default 0.8
  eventSpacing?: number;       // distance between events, default 2.0

  // ─── Lighting ───────────────────────────────────────────────────────
  ambientIntensity?: number;   // default 0.6
  lightIntensity?: number;     // directional light, default 0.8

  // ─── Catch-all for future props ─────────────────────────────────────
  [key: string]: any;
}

interface ThreeDRendererProps {
  section: ThreeDSectionData;
}

const DEFAULT_COLORS = CHART_THEMES['default'].colors;

// ─── Shared Components ────────────────────────────────────────────────────────

function AutoRotate({ speed = 0.3 }: { speed?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * speed;
  });
  return <group ref={ref} />;
}

function GridFloor({ size = 10 }: { size?: number }) {
  return (
    <gridHelper args={[size, size, '#d1d5db', '#e5e7eb']} position={[0, -0.01, 0]} />
  );
}

function AxisLabel({ position, text }: { position: [number, number, number]; text: string }) {
  return (
    <Text
      position={position}
      fontSize={0.25}
      color="#6b7280"
      anchorX="center"
      anchorY="middle"
    >
      {text}
    </Text>
  );
}

// ─── Bar3D Scene ──────────────────────────────────────────────────────────────

function Bar3DScene({ data, labelKey, valueKey, colors, showGrid = true, showLabels = true, showValues = true, barWidth: bw, barGap: bg, maxHeight: mh, opacity: op }: {
  data: Record<string, string | number>[];
  labelKey: string;
  valueKey: string;
  colors: string[];
  showGrid?: boolean;
  showLabels?: boolean;
  showValues?: boolean;
  barWidth?: number;
  barGap?: number;
  maxHeight?: number;
  opacity?: number;
}) {
  const maxVal = useMemo(() => Math.max(...data.map(d => Number(d[valueKey]) || 0), 1), [data, valueKey]);
  const barWidth = bw ?? 0.6;
  const gap = bg ?? 0.3;
  const heightScale = mh ?? 4;
  const opacity = op ?? 0.35;
  const totalWidth = data.length * (barWidth + gap) - gap;

  return (
    <group position={[-totalWidth / 2, 0, 0]}>
      {data.map((d, i) => {
        const val = Number(d[valueKey]) || 0;
        const height = (val / maxVal) * heightScale;
        const color = colors[i % colors.length];
        const x = i * (barWidth + gap);

        return (
          <group key={i} position={[x + barWidth / 2, 0, 0]}>
            <RoundedBox
              args={[barWidth, height, barWidth]}
              position={[0, height / 2, 0]}
              radius={0.05}
              smoothness={4}
            >
              <meshStandardMaterial
                color={color}
                transparent
                opacity={opacity}
                roughness={0.2}
                metalness={0.1}
              />
            </RoundedBox>
            <lineSegments position={[0, height / 2, 0]}>
              <edgesGeometry args={[new THREE.BoxGeometry(barWidth, height, barWidth)]} />
              <lineBasicMaterial color={color} linewidth={1} />
            </lineSegments>
            {showValues && (
              <Text
                position={[0, height + 0.3, 0]}
                fontSize={0.2}
                color="#374151"
                anchorX="center"
                anchorY="bottom"
              >
                {val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` :
                 val >= 1000 ? `${(val / 1000).toFixed(0)}K` :
                 val.toLocaleString()}
              </Text>
            )}
            {showLabels && (
              <Text
                position={[0, -0.15, barWidth / 2 + 0.3]}
                fontSize={0.16}
                color="#6b7280"
                anchorX="center"
                anchorY="top"
                maxWidth={1.2}
              >
                {String(d[labelKey] || '')}
              </Text>
            )}
          </group>
        );
      })}
      {showGrid && <GridFloor size={Math.max(totalWidth + 2, 6)} />}
    </group>
  );
}

// ─── Scatter3D Scene ──────────────────────────────────────────────────────────

function Scatter3DScene({ data, xAxis, yAxis, zAxis, colors }: {
  data: Record<string, string | number>[];
  xAxis: string;
  yAxis: string;
  zAxis: string;
  colors: string[];
}) {
  const bounds = useMemo(() => {
    const xs = data.map(d => Number(d[xAxis]) || 0);
    const ys = data.map(d => Number(d[yAxis]) || 0);
    const zs = data.map(d => Number(d[zAxis]) || 0);
    return {
      x: { min: Math.min(...xs), max: Math.max(...xs) },
      y: { min: Math.min(...ys), max: Math.max(...ys) },
      z: { min: Math.min(...zs), max: Math.max(...zs) },
    };
  }, [data, xAxis, yAxis, zAxis]);

  const normalize = (val: number, min: number, max: number) =>
    max === min ? 0 : ((val - min) / (max - min)) * 4 - 2;

  return (
    <group>
      {data.map((d, i) => {
        const x = normalize(Number(d[xAxis]) || 0, bounds.x.min, bounds.x.max);
        const y = normalize(Number(d[yAxis]) || 0, bounds.y.min, bounds.y.max);
        const z = normalize(Number(d[zAxis]) || 0, bounds.z.min, bounds.z.max);
        const color = colors[i % colors.length];

        return (
          <Float key={i} speed={1} rotationIntensity={0} floatIntensity={0.3}>
            <mesh position={[x, y, z]}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial
                color={color}
                transparent
                opacity={0.5}
                roughness={0.3}
              />
            </mesh>
            {/* Wireframe sphere for frosted border effect */}
            <mesh position={[x, y, z]}>
              <sphereGeometry args={[0.13, 8, 8]} />
              <meshBasicMaterial color={color} wireframe />
            </mesh>
          </Float>
        );
      })}
      <AxisLabel position={[3, -2.5, 0]} text={xAxis} />
      <AxisLabel position={[0, 2.8, 0]} text={yAxis} />
      <AxisLabel position={[0, -2.5, 3]} text={zAxis} />
      <GridFloor size={6} />
    </group>
  );
}

// ─── Pie3D Scene ──────────────────────────────────────────────────────────────

function Pie3DScene({ data, labelKey, valueKey, colors, opacity: op = 0.4, innerRadius: ir = 1, outerRadius: or = 2, extrudeDepth: ed = 0.4 }: {
  data: Record<string, string | number>[];
  labelKey: string;
  valueKey: string;
  colors: string[];
  opacity?: number;
  innerRadius?: number;
  outerRadius?: number;
  extrudeDepth?: number;
}) {
  const total = useMemo(() => data.reduce((sum, d) => sum + (Number(d[valueKey]) || 0), 0), [data, valueKey]);

  const segments = useMemo(() => {
    let startAngle = 0;
    return data.map((d, i) => {
      const val = Number(d[valueKey]) || 0;
      const angle = (val / total) * Math.PI * 2;
      const seg = { startAngle, angle, color: colors[i % colors.length], label: String(d[labelKey] || ''), val };
      startAngle += angle;
      return seg;
    });
  }, [data, valueKey, labelKey, total, colors]);

  return (
    <group rotation={[-0.3, 0, 0]}>
      {segments.map((seg, i) => {
        const midAngle = seg.startAngle + seg.angle / 2;
        const shape = new THREE.Shape();
        const steps = 32;

        for (let s = 0; s <= steps; s++) {
          const a = seg.startAngle + (seg.angle * s) / steps;
          if (s === 0) shape.moveTo(Math.cos(a) * or, Math.sin(a) * or);
          else shape.lineTo(Math.cos(a) * or, Math.sin(a) * or);
        }
        for (let s = steps; s >= 0; s--) {
          const a = seg.startAngle + (seg.angle * s) / steps;
          shape.lineTo(Math.cos(a) * ir, Math.sin(a) * ir);
        }
        shape.closePath();

        const labelX = Math.cos(midAngle) * (or + 0.5);
        const labelY = Math.sin(midAngle) * (or + 0.5);

        return (
          <group key={i}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <extrudeGeometry args={[shape, { depth: ed, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }]} />
              <meshStandardMaterial
                color={seg.color}
                transparent
                opacity={op}
                roughness={0.2}
                metalness={0.1}
                side={THREE.DoubleSide}
              />
            </mesh>
            <Text
              position={[labelX, 0.5, -labelY]}
              fontSize={0.18}
              color="#374151"
              anchorX="center"
            >
              {seg.label}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

// ─── Network Scene ────────────────────────────────────────────────────────────

function NetworkScene({ data, labelKey, valueKey, colors, nodeMin = 0.08, nodeMax = 1.2, radius: r = 4 }: {
  data: Record<string, string | number>[];
  labelKey: string;
  valueKey: string;
  colors: string[];
  nodeMin?: number;
  nodeMax?: number;
  radius?: number;
}) {
  const maxVal = useMemo(() => Math.max(...data.map(d => Number(d[valueKey]) || 1), 1), [data, valueKey]);
  const radius = r;

  return (
    <group>
      {data.map((d, i) => {
        const angle = (i / data.length) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const val = Number(d[valueKey]) || 1;
        const nodeSize = nodeMin + Math.sqrt(val / maxVal) * (nodeMax - nodeMin);
        const color = colors[i % colors.length];

        return (
          <Float key={i} speed={1.5} rotationIntensity={0} floatIntensity={0.5}>
            <group position={[x, 0, z]}>
              <mesh>
                <sphereGeometry args={[nodeSize, 16, 16]} />
                <meshStandardMaterial color={color} transparent opacity={0.4} roughness={0.2} />
              </mesh>
              <mesh>
                <sphereGeometry args={[nodeSize + 0.02, 8, 8]} />
                <meshBasicMaterial color={color} wireframe />
              </mesh>
              <Text
                position={[0, nodeSize + 0.2, 0]}
                fontSize={0.16}
                color="#374151"
                anchorX="center"
              >
                {String(d[labelKey] || '')}
              </Text>
            </group>
          </Float>
        );
      })}
      {/* Connection lines to center */}
      {data.map((_, i) => {
        const angle = (i / data.length) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, 0, z)];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return (
          <lineSegments key={`line-${i}`} geometry={geometry}>
            <lineBasicMaterial color="#d1d5db" transparent opacity={0.3} />
          </lineSegments>
        );
      })}
      {/* Center hub */}
      <mesh>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial color="#6366f1" transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

// ─── Surface Scene ────────────────────────────────────────────────────────────

function SurfaceScene({ data, xAxis, yAxis, zAxis, colors }: {
  data: Record<string, string | number>[];
  xAxis: string;
  yAxis: string;
  zAxis: string;
  colors: string[];
}) {
  const gridSize = Math.ceil(Math.sqrt(data.length));
  const maxY = useMemo(() => Math.max(...data.map(d => Number(d[yAxis]) || 0), 1), [data, yAxis]);

  return (
    <group>
      {data.slice(0, gridSize * gridSize).map((d, i) => {
        const row = Math.floor(i / gridSize);
        const col = i % gridSize;
        const val = Number(d[yAxis]) || 0;
        const height = (val / maxY) * 3;
        const color = colors[i % colors.length];
        const spacing = 0.5;

        return (
          <mesh key={i} position={[(col - gridSize / 2) * spacing, height / 2, (row - gridSize / 2) * spacing]}>
            <boxGeometry args={[spacing * 0.9, height, spacing * 0.9]} />
            <meshStandardMaterial color={color} transparent opacity={0.35} roughness={0.2} />
          </mesh>
        );
      })}
      <GridFloor size={gridSize * 0.6} />
    </group>
  );
}

// ─── Bar Race Scene (Animated) ────────────────────────────────────────────────

function BarRaceScene({ data, labelKey, valueKey, colors, showGrid = true }: {
  data: Record<string, string | number>[];
  labelKey: string;
  valueKey: string;
  colors: string[];
  showGrid?: boolean;
}) {
  const maxVal = useMemo(() => Math.max(...data.map(d => Number(d[valueKey]) || 0), 1), [data, valueKey]);
  const sorted = useMemo(() =>
    [...data].sort((a, b) => (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0)),
    [data, valueKey]
  );

  const barWidth = 0.6;
  const gap = 0.3;
  const totalWidth = data.length * (barWidth + gap) - gap;
  const startRef = useRef<number | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  // Compute sorted positions for phase 2
  const sortedPositions = useMemo(() => {
    const map = new Map<number, number>();
    sorted.forEach((d, sortIdx) => {
      const origIdx = data.indexOf(d);
      map.set(origIdx, sortIdx * (barWidth + gap));
    });
    return map;
  }, [data, sorted, barWidth, gap]);

  useFrame(({ clock }) => {
    if (startRef.current === null) startRef.current = clock.getElapsedTime();
    const elapsed = clock.getElapsedTime() - startRef.current;

    if (!groupRef.current) return;
    const children = groupRef.current.children;

    for (let i = 0; i < data.length; i++) {
      const child = children[i] as THREE.Group;
      if (!child) continue;

      const val = Number(data[i][valueKey]) || 0;
      const targetHeight = (val / maxVal) * 4;
      const stagger = getStaggerDelay(i, 0.06);

      // Phase 1: grow (0 → 1.2s)
      const growT = Math.min(1, Math.max(0, elapsed - stagger) / 1.0);
      const height = targetHeight * easeOutCubic(growT);

      // Phase 2: slide to sorted position (1.2s → 2.0s)
      const origX = i * (barWidth + gap);
      const sortedX = sortedPositions.get(i) ?? origX;
      const slideT = Math.min(1, Math.max(0, elapsed - 1.2) / 0.8);
      const x = origX + (sortedX - origX) * easeOutSpring(slideT);

      child.position.x = x + barWidth / 2 - totalWidth / 2;

      // Update bar mesh scale
      const bar = child.children[0] as THREE.Mesh;
      if (bar) {
        bar.scale.y = Math.max(0.001, height);
        bar.position.y = height / 2;
      }
      // Update wireframe
      const wire = child.children[1] as THREE.LineSegments;
      if (wire) {
        wire.scale.y = Math.max(0.001, height);
        wire.position.y = height / 2;
      }
      // Update value label
      const valLabel = child.children[2] as any;
      if (valLabel) valLabel.position.y = height + 0.3;
    }
  });

  return (
    <group ref={groupRef}>
      {data.map((d, i) => {
        const color = colors[i % colors.length];
        return (
          <group key={i}>
            <RoundedBox args={[barWidth, 1, barWidth]} position={[0, 0, 0]} radius={0.05} smoothness={4}>
              <meshStandardMaterial color={color} transparent opacity={0.35} roughness={0.2} metalness={0.1} />
            </RoundedBox>
            <lineSegments>
              <edgesGeometry args={[new THREE.BoxGeometry(barWidth, 1, barWidth)]} />
              <lineBasicMaterial color={color} />
            </lineSegments>
            <Text position={[0, 0.3, 0]} fontSize={0.2} color="#374151" anchorX="center" anchorY="bottom">
              {''}
            </Text>
            <Text position={[0, -0.15, barWidth / 2 + 0.3]} fontSize={0.16} color="#6b7280" anchorX="center" anchorY="top" maxWidth={1.2}>
              {String(d[labelKey] || '')}
            </Text>
          </group>
        );
      })}
      {showGrid && <GridFloor size={Math.max(totalWidth + 2, 6)} />}
    </group>
  );
}

// ─── Radial Burst Scene (Animated) ────────────────────────────────────────────

function RadialBurstScene({ data, labelKey, valueKey, colors, opacity: op = 0.4, stagger: sg = 0.1, innerRadius: ir = 1, outerRadius: or = 2 }: {
  data: Record<string, string | number>[];
  labelKey: string;
  valueKey: string;
  colors: string[];
  opacity?: number;
  stagger?: number;
  innerRadius?: number;
  outerRadius?: number;
}) {
  const total = useMemo(() => data.reduce((sum, d) => sum + (Number(d[valueKey]) || 0), 0), [data, valueKey]);
  const startRef = useRef<number | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  const segments = useMemo(() => {
    let startAngle = 0;
    return data.map((d, i) => {
      const val = Number(d[valueKey]) || 0;
      const angle = (val / total) * Math.PI * 2;
      const seg = { startAngle, angle, color: colors[i % colors.length], label: String(d[labelKey] || ''), val };
      startAngle += angle;
      return seg;
    });
  }, [data, valueKey, labelKey, total, colors]);

  useFrame(({ clock }) => {
    if (startRef.current === null) startRef.current = clock.getElapsedTime();
    const elapsed = clock.getElapsedTime() - startRef.current;

    if (!groupRef.current) return;

    segments.forEach((seg, i) => {
      const child = groupRef.current!.children[i] as THREE.Group;
      if (!child) return;

      const delay = getStaggerDelay(i, sg);
      const t = Math.min(1, Math.max(0, elapsed - delay) / 0.8);
      const scale = easeOutSpring(t);

      child.scale.set(scale, scale, scale);

      // Emissive pulse on completion
      const mesh = child.children[0] as THREE.Mesh;
      if (mesh?.material && 'emissiveIntensity' in (mesh.material as any)) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (t >= 1 && elapsed - delay < 1.2) {
          mat.emissiveIntensity = 0.3 * (1 - (elapsed - delay - 0.8) / 0.4);
        } else {
          mat.emissiveIntensity = 0;
        }
      }
    });
  });

  return (
    <group rotation={[-0.3, 0, 0]} ref={groupRef}>
      {segments.map((seg, i) => {
        const midAngle = seg.startAngle + seg.angle / 2;
        const shape = new THREE.Shape();
        const outerR = 2;
        const innerR = 1;
        const steps = 32;

        for (let s = 0; s <= steps; s++) {
          const a = seg.startAngle + (seg.angle * s) / steps;
          if (s === 0) shape.moveTo(Math.cos(a) * outerR, Math.sin(a) * outerR);
          else shape.lineTo(Math.cos(a) * outerR, Math.sin(a) * outerR);
        }
        for (let s = steps; s >= 0; s--) {
          const a = seg.startAngle + (seg.angle * s) / steps;
          shape.lineTo(Math.cos(a) * innerR, Math.sin(a) * innerR);
        }
        shape.closePath();

        const labelX = Math.cos(midAngle) * 2.5;
        const labelY = Math.sin(midAngle) * 2.5;

        return (
          <group key={i}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <extrudeGeometry args={[shape, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }]} />
              <meshStandardMaterial
                color={seg.color}
                transparent
                opacity={0.4}
                roughness={0.2}
                metalness={0.1}
                emissive={seg.color}
                emissiveIntensity={0}
                side={THREE.DoubleSide}
              />
            </mesh>
            <Text position={[labelX, 0.5, -labelY]} fontSize={0.18} color="#374151" anchorX="center">
              {seg.label}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

// ─── Connection Map Scene (Animated) ──────────────────────────────────────────

function ConnectionMapScene({ data, labelKey, valueKey, colors, nodeMin = 0.08, nodeMax = 1.2, radius: r = 4, stagger: sg = 0.15 }: {
  data: Record<string, string | number>[];
  labelKey: string;
  valueKey: string;
  colors: string[];
  nodeMin?: number;
  nodeMax?: number;
  radius?: number;
  stagger?: number;
}) {
  const maxVal = useMemo(() => Math.max(...data.map(d => Number(d[valueKey]) || 1), 1), [data, valueKey]);
  const radius = r;
  const startRef = useRef<number | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (startRef.current === null) startRef.current = clock.getElapsedTime();
    const elapsed = clock.getElapsedTime() - startRef.current;

    if (!groupRef.current) return;

    // Each node has: nodeGroup, lineGroup
    for (let i = 0; i < data.length; i++) {
      const nodeGroup = groupRef.current.children[i * 2] as THREE.Group;
      const lineGroup = groupRef.current.children[i * 2 + 1] as THREE.LineSegments;

      if (!nodeGroup || !lineGroup) continue;

      const delay = getStaggerDelay(i, sg);

      // Node: scale in
      const nodeT = Math.min(1, Math.max(0, elapsed - delay) / 0.4);
      const nodeScale = easeOutSpring(nodeT);
      nodeGroup.scale.set(nodeScale, nodeScale, nodeScale);

      // Line: draw on (progressive reveal)
      const lineDelay = delay + 0.2;
      const lineT = Math.min(1, Math.max(0, elapsed - lineDelay) / 0.3);
      const geom = lineGroup.geometry as THREE.BufferGeometry;
      if (geom) {
        const totalVerts = geom.attributes.position?.count || 2;
        geom.setDrawRange(0, Math.ceil(totalVerts * easeOutCubic(lineT)));
      }

      // Node emissive pulse when line completes
      const mesh = nodeGroup.children[0] as THREE.Mesh;
      if (mesh?.material && lineT >= 1) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const pulseT = elapsed - lineDelay - 0.3;
        if (pulseT > 0 && pulseT < 0.4) {
          mat.emissiveIntensity = 0.4 * (1 - pulseT / 0.4);
        } else {
          mat.emissiveIntensity = 0;
        }
      }
    }
  });

  return (
    <group ref={groupRef}>
      {data.map((d, i) => {
        const angle = (i / data.length) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const val = Number(d[valueKey]) || 1;
        const nodeSize = nodeMin + Math.sqrt(val / maxVal) * (nodeMax - nodeMin);
        const color = colors[i % colors.length];

        // Line geometry from node to center
        const points: THREE.Vector3[] = [];
        const segments = 10;
        for (let s = 0; s <= segments; s++) {
          const t = s / segments;
          points.push(new THREE.Vector3(x * (1 - t), 0, z * (1 - t)));
        }
        const lineGeom = new THREE.BufferGeometry().setFromPoints(points);

        return [
          <group key={`node-${i}`} position={[x, 0, z]}>
            <mesh>
              <sphereGeometry args={[nodeSize, 16, 16]} />
              <meshStandardMaterial color={color} transparent opacity={0.4} roughness={0.2} emissive={color} emissiveIntensity={0} />
            </mesh>
            <mesh>
              <sphereGeometry args={[nodeSize + 0.02, 8, 8]} />
              <meshBasicMaterial color={color} wireframe />
            </mesh>
            <Text position={[0, nodeSize + 0.2, 0]} fontSize={0.16} color="#374151" anchorX="center">
              {String(d[labelKey] || '')}
            </Text>
          </group>,
          <lineSegments key={`line-${i}`} geometry={lineGeom}>
            <lineBasicMaterial color={color} transparent opacity={0.5} />
          </lineSegments>,
        ];
      })}
      {/* Center hub */}
      <mesh>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial color="#6366f1" transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

// ─── Particle Flow Scene (Animated) ───────────────────────────────────────────

const PARTICLE_COUNT_PER_FLOW = 30;
const PARTICLE_GEO = new THREE.SphereGeometry(0.08, 8, 8);

function ParticleFlowScene({ data, labelKey, valueKey, colors, particleDensity = 30, flowSpeed = 0.3 }: {
  data: Record<string, string | number>[];
  labelKey: string;
  valueKey: string;
  colors: string[];
  particleDensity?: number;
  flowSpeed?: number;
}) {
  // Data items are flow sources; each gets particles proportional to value
  const maxVal = useMemo(() => Math.max(...data.map(d => Number(d[valueKey]) || 1), 1), [data, valueKey]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Pre-compute flow paths: source (left) → center → destination (right)
  // Each flow's particle count, size, and speed scale with its value
  const flows = useMemo(() => {
    return data.map((d, i) => {
      const val = Number(d[valueKey]) || 1;
      const ratio = val / maxVal; // 0..1 proportion of largest value
      const count = Math.max(4, Math.round(ratio * particleDensity));
      const yOffset = ((i / (data.length - 1 || 1)) - 0.5) * 5;
      return {
        label: String(d[labelKey] || ''),
        val,
        ratio,
        count,
        // Larger values → bigger particles (0.4–1.5x) and faster flow (0.6–1.4x)
        sizeScale: 0.4 + ratio * 1.1,
        speedScale: 0.6 + ratio * 0.8,
        sourceY: yOffset,
        color: new THREE.Color(colors[i % colors.length]),
        // Bezier control points: source(-5, y, 0) → ctrl(-1, y*0.3, 0) → ctrl(1, -y*0.3, 0) → dest(5, 0, 0)
        p0: new THREE.Vector3(-5, yOffset, 0),
        p1: new THREE.Vector3(-1.5, yOffset * 0.3, (Math.random() - 0.5) * 2),
        p2: new THREE.Vector3(1.5, -yOffset * 0.3, (Math.random() - 0.5) * 2),
        p3: new THREE.Vector3(5, 0, 0),
      };
    });
  }, [data, labelKey, valueKey, maxVal, colors]);

  const totalParticles = useMemo(() => flows.reduce((sum, f) => sum + f.count, 0), [flows]);

  // Pre-compute particle offsets (which flow, which index within flow)
  const particleMap = useMemo(() => {
    const map: { flowIdx: number; timeOffset: number; color: THREE.Color }[] = [];
    for (let fi = 0; fi < flows.length; fi++) {
      const f = flows[fi];
      for (let pi = 0; pi < f.count; pi++) {
        map.push({
          flowIdx: fi,
          timeOffset: pi / f.count, // spread particles along path
          color: f.color,
        });
      }
    }
    return map;
  }, [flows]);

  const colorsApplied = useRef(false);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;

    // Apply instance colors once after mesh is mounted
    if (!colorsApplied.current) {
      const colorArr = new Float32Array(totalParticles * 3);
      particleMap.forEach((p, i) => {
        colorArr[i * 3] = p.color.r;
        colorArr[i * 3 + 1] = p.color.g;
        colorArr[i * 3 + 2] = p.color.b;
      });
      meshRef.current.instanceColor = new THREE.InstancedBufferAttribute(colorArr, 3);
      colorsApplied.current = true;
    }

    const elapsed = clock.getElapsedTime() * flowSpeed;

    for (let i = 0; i < particleMap.length; i++) {
      const { flowIdx, timeOffset } = particleMap[i];
      const f = flows[flowIdx];

      // Per-flow speed: larger values flow faster
      const t = (elapsed * f.speedScale + timeOffset) % 1;

      // Cubic bezier interpolation
      const mt = 1 - t;
      const x = mt * mt * mt * f.p0.x + 3 * mt * mt * t * f.p1.x + 3 * mt * t * t * f.p2.x + t * t * t * f.p3.x;
      const y = mt * mt * mt * f.p0.y + 3 * mt * mt * t * f.p1.y + 3 * mt * t * t * f.p2.y + t * t * t * f.p3.y;
      const z = mt * mt * mt * f.p0.z + 3 * mt * mt * t * f.p1.z + 3 * mt * t * t * f.p2.z + t * t * t * f.p3.z;

      // Fade opacity at start/end of path
      const opacity = t < 0.1 ? t / 0.1 : t > 0.9 ? (1 - t) / 0.1 : 1;

      // Per-flow size: larger values → bigger particles
      dummy.position.set(x, y, z);
      dummy.scale.setScalar((0.5 + opacity * 0.6) * f.sizeScale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={meshRef} args={[PARTICLE_GEO, undefined, totalParticles]}>
        <meshStandardMaterial transparent opacity={0.6} roughness={0.3} />
      </instancedMesh>

      {/* Source labels + markers (left side) — sized by value */}
      {flows.map((f, i) => (
        <group key={`src-${i}`}>
          <mesh position={[-5, f.sourceY, 0]}>
            <sphereGeometry args={[0.06 + f.ratio * 0.14, 12, 12]} />
            <meshStandardMaterial color={colors[i % colors.length]} transparent opacity={0.7} />
          </mesh>
          <Text
            position={[-5.5, f.sourceY, 0]}
            fontSize={0.18}
            color="#374151"
            anchorX="right"
            anchorY="middle"
            maxWidth={2.5}
          >
            {f.label}
          </Text>
        </group>
      ))}

      {/* Destination hub (right side) */}
      <mesh position={[5, 0, 0]}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshStandardMaterial color="#6366f1" transparent opacity={0.4} />
      </mesh>
      <Text position={[5, -0.9, 0]} fontSize={0.2} color="#374151" anchorX="center">
        Total
      </Text>
    </group>
  );
}

// ─── Timeline Flow Scene (Animated) ───────────────────────────────────────────

function TimelineFlowScene({ data, labelKey, valueKey, colors, dollySpeed: ds = 0.8, eventSpacing: es = 2.0 }: {
  data: Record<string, string | number>[];
  labelKey: string;
  valueKey: string;
  colors: string[];
  dollySpeed?: number;
  eventSpacing?: number;
}) {
  const startRef = useRef<number | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const spacing = es;
  const totalLength = (data.length - 1) * spacing;

  // Build the path as a set of points along the Z axis
  const pathPoints = useMemo(() => {
    return data.map((_, i) => new THREE.Vector3(0, 0, -i * spacing));
  }, [data, spacing]);

  // Path tube geometry
  const tubeGeom = useMemo(() => {
    if (pathPoints.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(pathPoints);
    return new THREE.TubeGeometry(curve, 64, 0.02, 8, false);
  }, [pathPoints]);

  useFrame(({ clock, camera }) => {
    if (startRef.current === null) startRef.current = clock.getElapsedTime();
    const elapsed = clock.getElapsedTime() - startRef.current;

    const dollyZ = Math.min(elapsed * ds, totalLength);
    camera.position.set(3, 2.5, 2 - dollyZ);
    camera.lookAt(0, 0.5, -dollyZ);

    if (!groupRef.current) return;

    // Reveal events as camera approaches
    for (let i = 0; i < data.length; i++) {
      const eventGroup = groupRef.current.children[i + 1] as THREE.Group; // +1 for tube mesh
      if (!eventGroup) continue;

      const eventZ = i * spacing;
      const distFromCamera = eventZ - dollyZ;

      // Event becomes visible when camera is within 2 units
      if (distFromCamera < 2) {
        const revealT = Math.min(1, Math.max(0, (2 - distFromCamera) / 1.5));
        const scale = easeOutSpring(revealT);
        eventGroup.scale.set(scale, scale, scale);
        eventGroup.visible = true;
      } else {
        eventGroup.visible = false;
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* Path tube */}
      {tubeGeom && (
        <mesh geometry={tubeGeom}>
          <meshStandardMaterial color="#d1d5db" transparent opacity={0.4} />
        </mesh>
      )}

      {/* Event markers along path */}
      {data.map((d, i) => {
        const val = Number(d[valueKey]) || 0;
        const color = colors[i % colors.length];
        const z = -i * spacing;

        return (
          <group key={i} position={[0, 0, z]} visible={false}>
            {/* Event node */}
            <mesh position={[0, 0, 0]}>
              <sphereGeometry args={[0.15, 16, 16]} />
              <meshStandardMaterial color={color} transparent opacity={0.5} />
            </mesh>
            <mesh position={[0, 0, 0]}>
              <sphereGeometry args={[0.16, 8, 8]} />
              <meshBasicMaterial color={color} wireframe />
            </mesh>

            {/* Event card — frosted glass panel */}
            <group position={[0.8, 0.5, 0]}>
              <RoundedBox args={[2.2, 0.8, 0.05]} radius={0.05} smoothness={4}>
                <meshStandardMaterial color="white" transparent opacity={0.7} roughness={0.1} />
              </RoundedBox>
              <Text
                position={[0, 0.15, 0.03]}
                fontSize={0.12}
                color="#374151"
                anchorX="center"
                anchorY="middle"
                maxWidth={2}
                fontWeight="bold"
              >
                {String(d[labelKey] || '')}
              </Text>
              {val > 0 && (
                <Text
                  position={[0, -0.12, 0.03]}
                  fontSize={0.1}
                  color="#6b7280"
                  anchorX="center"
                  anchorY="middle"
                >
                  {val >= 1000000 ? `$${(val / 1000000).toFixed(1)}M` :
                   val >= 1000 ? `$${(val / 1000).toFixed(0)}K` :
                   val.toLocaleString()}
                </Text>
              )}
            </group>
          </group>
        );
      })}
    </group>
  );
}

// ─── Main Renderer ────────────────────────────────────────────────────────────

export function ThreeDRenderer({ section }: ThreeDRendererProps) {
  const colors = section.colors || DEFAULT_COLORS;
  const chartHeight = section.height || 320;
  const labelKey = section.labelKey || section.xAxis || 'name';
  const valueKey = section.valueKey || section.yAxis || 'value';
  const autoRotate = section.autoRotate !== false;
  const autoRotateSpeed = section.autoRotateSpeed ?? 0.5;
  const showGrid = section.showGrid !== false;
  const showLabels = section.showLabels !== false;
  const showValues = section.showValues !== false;
  const cameraPos = section.cameraPosition || [5, 4, 5];
  const ambientIntensity = section.ambientIntensity ?? 0.6;
  const lightIntensity = section.lightIntensity ?? 0.8;
  const materialOpacity = section.opacity ?? 0.35;
  const nodeMin = section.nodeMinSize ?? 0.08;
  const nodeMax = section.nodeMaxSize ?? 1.2;
  const circleRadius = section.circleRadius ?? 4;

  return (
    <div className="space-y-1">
      <div
        className="w-full rounded-lg overflow-hidden border border-workspace-border/20 bg-gradient-to-b from-white to-workspace-surface/10"
        style={{ height: chartHeight }}
      >
        <Suspense fallback={
          <div className="flex items-center justify-center h-full text-[11px] text-workspace-text-secondary/50">
            Loading 3D scene...
          </div>
        }>
          <Canvas
            camera={{ position: cameraPos, fov: 45 }}
            dpr={[1, 1.5]}
            gl={{ antialias: true, alpha: true }}
            style={{ background: 'transparent' }}
          >
            <ambientLight intensity={ambientIntensity} />
            <directionalLight position={[5, 8, 5]} intensity={lightIntensity} castShadow />
            <directionalLight position={[-3, 4, -3]} intensity={lightIntensity * 0.375} />

            {section.sceneType === 'bar3d' && (
              <Bar3DScene data={section.data} labelKey={labelKey} valueKey={valueKey} colors={colors} showGrid={showGrid} showLabels={showLabels} showValues={showValues} barWidth={section.barWidth} barGap={section.barGap} maxHeight={section.maxHeight} opacity={materialOpacity} />
            )}
            {section.sceneType === 'scatter3d' && (
              <Scatter3DScene data={section.data} xAxis={section.xAxis || 'x'} yAxis={section.yAxis || 'y'} zAxis={section.zAxis || 'z'} colors={colors} />
            )}
            {section.sceneType === 'pie3d' && (
              <Pie3DScene data={section.data} labelKey={labelKey} valueKey={valueKey} colors={colors} opacity={materialOpacity} innerRadius={section.innerRadius} outerRadius={section.outerRadius} extrudeDepth={section.extrudeDepth} />
            )}
            {section.sceneType === 'network' && (
              <NetworkScene data={section.data} labelKey={labelKey} valueKey={valueKey} colors={colors} nodeMin={nodeMin} nodeMax={nodeMax} radius={circleRadius} />
            )}
            {section.sceneType === 'surface' && (
              <SurfaceScene data={section.data} xAxis={section.xAxis || 'x'} yAxis={section.yAxis || 'y'} zAxis={section.zAxis || 'z'} colors={colors} />
            )}

            {/* Animated scene types */}
            {section.sceneType === 'barRace' && (
              <BarRaceScene data={section.data} labelKey={labelKey} valueKey={valueKey} colors={colors} showGrid={showGrid} />
            )}
            {section.sceneType === 'radialBurst' && (
              <RadialBurstScene data={section.data} labelKey={labelKey} valueKey={valueKey} colors={colors} opacity={materialOpacity} stagger={section.stagger} innerRadius={section.innerRadius} outerRadius={section.outerRadius} />
            )}
            {section.sceneType === 'connectionMap' && (
              <ConnectionMapScene data={section.data} labelKey={labelKey} valueKey={valueKey} colors={colors} nodeMin={nodeMin} nodeMax={nodeMax} radius={circleRadius} stagger={section.stagger} />
            )}
            {section.sceneType === 'particleFlow' && (
              <ParticleFlowScene data={section.data} labelKey={labelKey} valueKey={valueKey} colors={colors} particleDensity={section.particleDensity} flowSpeed={section.flowSpeed} />
            )}
            {section.sceneType === 'timelineFlow' && (
              <TimelineFlowScene data={section.data} labelKey={labelKey} valueKey={valueKey} colors={colors} dollySpeed={section.dollySpeed} eventSpacing={section.eventSpacing} />
            )}

            <OrbitControls
              enablePan
              enableZoom
              enableRotate
              autoRotate={autoRotate}
              autoRotateSpeed={autoRotateSpeed}
              maxPolarAngle={Math.PI / 2}
              minDistance={3}
              maxDistance={15}
            />
          </Canvas>
        </Suspense>
      </div>
      {section.caption && (
        <p className="text-[10px] text-workspace-text-secondary/50 px-1">{section.caption}</p>
      )}
    </div>
  );
}
