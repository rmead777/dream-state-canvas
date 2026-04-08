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

import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, RoundedBox, Float, Environment, ContactShadows, Html } from '@react-three/drei';
import { CHART_THEMES } from '@/lib/chart-themes';
import { easeOutCubic, easeOutSpring, getStaggerDelay } from '@/hooks/useAnimationTimeline';
import { mapped3D } from '@/lib/threed-settings';
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
    <gridHelper args={[size, size, '#2a2a3e', '#1e1e30']} position={[0, -0.01, 0]} />
  );
}

function AxisLabel({ position, text }: { position: [number, number, number]; text: string }) {
  return (
    <Text
      position={position}
      fontSize={0.25}
      color="#9ca3af"
      anchorX="center"
      anchorY="middle"
    >
      {text}
    </Text>
  );
}

// ─── Tooltip3D — reusable hover tooltip via drei Html ────────────────────────

function Tooltip3D({ position, label, value, total, color, visible }: {
  position: [number, number, number];
  label: string;
  value: number;
  total: number;
  color: string;
  visible: boolean;
}) {
  if (!visible) return null;
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
  return (
    <Html position={position} center style={{ pointerEvents: 'none' }}>
      <div style={{
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        borderRadius: '6px',
        padding: '6px 10px',
        whiteSpace: 'nowrap',
        border: `1px solid ${color}40`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontSize: '10px', fontWeight: 600, color: '#e5e7eb', marginBottom: '2px' }}>{label}</div>
        <div style={{ fontSize: '11px', fontFamily: 'monospace', color }}>
          {fmtValue(value)} <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '9px' }}>({pct}%)</span>
        </div>
      </div>
    </Html>
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
  const totalVal = useMemo(() => data.reduce((s, d) => s + (Number(d[valueKey]) || 0), 0), [data, valueKey]);
  const barWidth = bw ?? 0.6;
  const gap = bg ?? 0.3;
  const heightScale = mh ?? 4;
  const opacity = op ?? 0.35;
  const totalWidth = data.length * (barWidth + gap) - gap;
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <group position={[-totalWidth / 2, 0, 0]}>
      {data.map((d, i) => {
        const val = Number(d[valueKey]) || 0;
        const height = (val / maxVal) * heightScale;
        const color = colors[i % colors.length];
        const x = i * (barWidth + gap);
        const isHovered = hovered === i;
        const dimmed = hovered !== null && !isHovered;

        return (
          <group key={i} position={[x + barWidth / 2, 0, 0]}>
            <RoundedBox
              args={[barWidth, height, barWidth]}
              position={[0, height / 2, 0]}
              radius={0.05}
              smoothness={4}
              onPointerOver={(e) => { e.stopPropagation(); setHovered(i); }}
              onPointerOut={() => setHovered(null)}
            >
              <meshStandardMaterial
                color={color}
                transparent
                opacity={dimmed ? opacity * 0.3 : isHovered ? Math.min(opacity * 1.5, 0.9) : opacity}
                roughness={0.2}
                metalness={0.1}
              />
            </RoundedBox>
            <lineSegments position={[0, height / 2, 0]}>
              <edgesGeometry args={[new THREE.BoxGeometry(barWidth, height, barWidth)]} />
              <lineBasicMaterial color={color} linewidth={1} transparent opacity={dimmed ? 0.15 : 1} />
            </lineSegments>
            {showValues && !isHovered && (
              <Text
                position={[0, height + 0.3, 0]}
                fontSize={0.2}
                color="#e5e7eb"
                anchorX="center"
                anchorY="bottom"
              >
                {fmtValue(val)}
              </Text>
            )}
            {showLabels && (
              <Text
                position={[0, -0.15, barWidth / 2 + 0.3]}
                fontSize={0.16}
                color="#9ca3af"
                anchorX="center"
                anchorY="top"
                maxWidth={1.2}
              >
                {String(d[labelKey] || '')}
              </Text>
            )}
            <Tooltip3D
              position={[0, height + 0.5, 0]}
              label={String(d[labelKey] || '')}
              value={val}
              total={totalVal}
              color={color}
              visible={isHovered}
            />
          </group>
        );
      })}
      {showGrid && <GridFloor size={Math.max(totalWidth + 2, 6)} />}
      {/* Y-axis scale ticks */}
      {[0.25, 0.5, 0.75, 1].map((frac) => {
        const y = frac * heightScale;
        const val = frac * maxVal;
        return (
          <group key={`ytick-${frac}`} position={[-totalWidth / 2 - 0.3, y, 0]}>
            <Html center style={{ pointerEvents: 'none' }}>
              <span style={{ fontSize: '8px', fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>
                {fmtValue(val)}
              </span>
            </Html>
          </group>
        );
      })}
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
              color="#e5e7eb"
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

  // Memoize connection line geometries (BB-002 fix)
  const lineGeometries = useMemo(() =>
    data.map((_, i) => {
      const angle = (i / data.length) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      return new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, 0, z)]);
    }), [data, radius]);

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
                color="#e5e7eb"
                anchorX="center"
              >
                {String(d[labelKey] || '')}
              </Text>
            </group>
          </Float>
        );
      })}
      {/* Connection lines to center */}
      {lineGeometries.map((geom, i) => (
        <lineSegments key={`line-${i}`} geometry={geom}>
          <lineBasicMaterial color="#4a4a6a" transparent opacity={0.4} />
        </lineSegments>
      ))}
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
  const indexedData = useMemo(() => data.map((d, i) => ({ d, origIdx: i })), [data]);
  const sorted = useMemo(() =>
    [...indexedData].sort((a, b) => (Number(b.d[valueKey]) || 0) - (Number(a.d[valueKey]) || 0)),
    [indexedData, valueKey]
  );

  const barWidth = 0.6;
  const gap = 0.3;
  const totalWidth = data.length * (barWidth + gap) - gap;
  const startRef = useRef<number | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  // Compute sorted positions for phase 2
  const sortedPositions = useMemo(() => {
    const map = new Map<number, number>();
    sorted.forEach((item, sortIdx) => {
      map.set(item.origIdx, sortIdx * (barWidth + gap));
    });
    return map;
  }, [sorted, barWidth, gap]);

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
            <Text position={[0, 0.3, 0]} fontSize={0.2} color="#e5e7eb" anchorX="center" anchorY="bottom">
              {''}
            </Text>
            <Text position={[0, -0.15, barWidth / 2 + 0.3]} fontSize={0.16} color="#9ca3af" anchorX="center" anchorY="top" maxWidth={1.2}>
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
        const outerR = or;
        const innerR = ir;
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
            <Text position={[labelX, 0.5, -labelY]} fontSize={0.18} color="#e5e7eb" anchorX="center">
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

  // Memoize connection line geometries (BB-002 fix)
  const connLineGeoms = useMemo(() =>
    data.map((_, i) => {
      const angle = (i / data.length) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const pts: THREE.Vector3[] = [];
      const segs = 10;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        pts.push(new THREE.Vector3(x * (1 - t), 0, z * (1 - t)));
      }
      return new THREE.BufferGeometry().setFromPoints(pts);
    }), [data, radius]);

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
            <Text position={[0, nodeSize + 0.2, 0]} fontSize={0.16} color="#e5e7eb" anchorX="center">
              {String(d[labelKey] || '')}
            </Text>
          </group>,
          <lineSegments key={`line-${i}`} geometry={connLineGeoms[i]}>
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
// Tube-based liquid flow with highlight particles on top.
// Each vendor gets a TubeGeometry along a cubic bezier, width ∝ AP value.
// A custom ShaderMaterial scrolls UV for the liquid animation.
// Instanced sparkle particles ride along the tubes for detail.

const HIGHLIGHT_GEO = new THREE.SphereGeometry(0.03, 6, 6);

/** Cubic bezier curve for Three.js TubeGeometry */
class FlowBezier extends THREE.Curve<THREE.Vector3> {
  p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; p3: THREE.Vector3;
  constructor(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) {
    super();
    this.p0 = p0; this.p1 = p1; this.p2 = p2; this.p3 = p3;
  }
  getPoint(t: number) {
    const mt = 1 - t;
    return new THREE.Vector3(
      mt*mt*mt*this.p0.x + 3*mt*mt*t*this.p1.x + 3*mt*t*t*this.p2.x + t*t*t*this.p3.x,
      mt*mt*mt*this.p0.y + 3*mt*mt*t*this.p1.y + 3*mt*t*t*this.p2.y + t*t*t*this.p3.y,
      mt*mt*mt*this.p0.z + 3*mt*mt*t*this.p1.z + 3*mt*t*t*this.p2.z + t*t*t*this.p3.z,
    );
  }
}

/** Liquid flow shader — scrolling UV with noise-like pulsing */
const flowVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flowFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSpeed;
  // Simple pseudo-noise for organic feel
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  varying vec2 vUv;
  void main() {
    // Scroll UV along the tube length
    float scrolledX = vUv.x - uTime * uSpeed;
    // Noise-based variation for organic liquid feel
    float n = noise(vec2(scrolledX * 6.0, vUv.y * 3.0 + uTime * 0.5));
    // Core brightness — brighter in the center of the tube
    float centerGlow = 1.0 - abs(vUv.y - 0.5) * 2.0;
    centerGlow = pow(centerGlow, 0.6);
    // Combine: base color + noise variation + center glow
    float intensity = 0.5 + 0.3 * n + 0.2 * centerGlow;
    // Flowing bright bands
    float band = sin(scrolledX * 12.0) * 0.5 + 0.5;
    band = pow(band, 2.0);
    intensity += band * 0.25;
    // Edge fade for soft tube edges
    float edgeFade = smoothstep(0.0, 0.15, centerGlow);
    vec3 col = uColor * intensity;
    // Add slight white highlight at center
    col += vec3(0.15) * centerGlow * band;
    gl_FragColor = vec4(col, uOpacity * edgeFade * (0.6 + 0.4 * intensity));
  }
`;

/** A single animated tube for one flow */
function FlowTube({ curve, color, radius, speed, entranceDelay = 0 }: {
  curve: FlowBezier;
  color: THREE.Color;
  radius: number;
  speed: number;
  entranceDelay?: number;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const geom = useMemo(() => new THREE.TubeGeometry(curve, 64, radius, 12, false), [curve, radius]);
  const startRef = useRef<number | null>(null);

  useFrame(({ clock }) => {
    if (!matRef.current) return;
    if (startRef.current === null) startRef.current = clock.getElapsedTime();
    const elapsed = clock.getElapsedTime() - startRef.current;
    matRef.current.uniforms.uTime.value = clock.getElapsedTime();
    // Entrance fade: 0→0.7 over 0.8s after delay
    const entranceProgress = Math.min(1, Math.max(0, (elapsed - entranceDelay) / 0.8));
    matRef.current.uniforms.uOpacity.value = easeOutCubic(entranceProgress) * 0.7;
  });

  const uniforms = useMemo(() => ({
    uColor: { value: color },
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uSpeed: { value: speed },
  }), [color, speed]);

  return (
    <mesh geometry={geom}>
      <shaderMaterial
        ref={matRef}
        vertexShader={flowVertexShader}
        fragmentShader={flowFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function ParticleFlowScene({ data, labelKey, valueKey, colors, particleDensity: propDensity, flowSpeed: propSpeed }: {
  data: Record<string, string | number>[];
  labelKey: string;
  valueKey: string;
  colors: string[];
  particleDensity?: number;
  flowSpeed?: number;
}) {
  const cfg = mapped3D();
  const density = propDensity ?? cfg.particleDensity;
  const baseSpeed = propSpeed ?? cfg.flowSpeed;
  const totalValue = useMemo(() => data.reduce((s, d) => s + (Number(d[valueKey]) || 0), 0), [data, valueKey]);

  const maxVal = useMemo(() => Math.max(...data.map(d => Number(d[valueKey]) || 1), 1), [data, valueKey]);
  const highlightRef = useRef<THREE.InstancedMesh>(null);
  const hubRef = useRef<THREE.Mesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const [hoveredFlow, setHoveredFlow] = useState<number | null>(null);

  // Build flows with bezier curves and tube radii
  // Tubes converge toward a funnel point (p2 → p3 tightens near destination)
  const flows = useMemo(() => {
    return data.map((d, i) => {
      const val = Number(d[valueKey]) || 1;
      const ratio = val / maxVal;
      const yOffset = ((i / (data.length - 1 || 1)) - 0.5) * 5;
      const p0 = new THREE.Vector3(-5, yOffset, 0);
      const p1 = new THREE.Vector3(-1.5, yOffset * 0.3, (Math.random() - 0.5) * cfg.trailSpread);
      // Funnel convergence: p2 pulls toward center more tightly
      const p2 = new THREE.Vector3(2.5, yOffset * 0.08, (Math.random() - 0.5) * cfg.trailSpread * 0.3);
      const p3 = new THREE.Vector3(5, 0, 0);
      const sizeScale = cfg.particleRadius / 0.08;
      const tubeRadius = (0.02 + Math.pow(ratio, mapped3D().valueExponent) * 0.16) * sizeScale;
      return {
        label: String(d[labelKey] || ''),
        val,
        ratio,
        sourceY: yOffset,
        color: new THREE.Color(colors[i % colors.length]),
        curve: new FlowBezier(p0, p1, p2, p3),
        tubeRadius,
        highlightCount: Math.max(2, Math.round(ratio * density * 0.3)),
        speedScale: cfg.speedMin + ratio * (cfg.speedMax - cfg.speedMin),
        // Staggered entrance: larger values enter first
        entranceDelay: (1 - ratio) * 1.2,
      };
    });
  }, [data, labelKey, valueKey, maxVal, colors, density]);

  // Sparkle particles: small highlights riding on the tubes
  const totalHighlights = useMemo(() => flows.reduce((sum, f) => sum + f.highlightCount, 0), [flows]);

  const highlightMap = useMemo(() => {
    const map: { flowIdx: number; timeOffset: number; color: THREE.Color }[] = [];
    for (let fi = 0; fi < flows.length; fi++) {
      const f = flows[fi];
      for (let pi = 0; pi < f.highlightCount; pi++) {
        map.push({
          flowIdx: fi,
          timeOffset: pi / f.highlightCount,
          color: new THREE.Color().copy(f.color).lerp(new THREE.Color('#ffffff'), 0.5),
        });
      }
    }
    return map;
  }, [flows]);

  const colorsApplied = useRef(false);

  useFrame(({ clock }) => {
    if (!highlightRef.current) return;

    // Apply highlight colors once
    if (!colorsApplied.current) {
      const colorArr = new Float32Array(totalHighlights * 3);
      highlightMap.forEach((p, i) => {
        colorArr[i * 3] = p.color.r;
        colorArr[i * 3 + 1] = p.color.g;
        colorArr[i * 3 + 2] = p.color.b;
      });
      highlightRef.current.instanceColor = new THREE.InstancedBufferAttribute(colorArr, 3);
      colorsApplied.current = true;
    }

    const live = mapped3D();
    const elapsed = clock.getElapsedTime() * baseSpeed;

    for (let i = 0; i < highlightMap.length; i++) {
      const { flowIdx, timeOffset } = highlightMap[i];
      const f = flows[flowIdx];

      const speedScale = live.speedMin + f.ratio * (live.speedMax - live.speedMin);
      const t = (elapsed * speedScale * 1.2 + timeOffset) % 1;

      // Sample position from the bezier curve
      const pos = f.curve.getPoint(t);

      // Fade at endpoints
      const fade = t < 0.05 ? t / 0.05 : t > 0.95 ? (1 - t) / 0.05 : 1;

      dummy.position.copy(pos);
      // Slight random offset perpendicular to path for sparkle effect
      dummy.position.y += Math.sin(elapsed * 8 + i * 1.7) * f.tubeRadius * 0.3;
      dummy.position.z += Math.cos(elapsed * 6 + i * 2.3) * f.tubeRadius * 0.3;
      dummy.scale.setScalar(fade * (0.8 + 0.5 * Math.sin(elapsed * 12 + i)));
      dummy.updateMatrix();
      highlightRef.current.setMatrixAt(i, dummy.matrix);
    }
    highlightRef.current.instanceMatrix.needsUpdate = true;

    // Hub breathing animation — pulsing speed increases with flow count
    if (hubRef.current) {
      const pulse = 1 + Math.sin(elapsed * 2.5) * 0.06;
      hubRef.current.scale.setScalar(pulse);
    }
  });

  // Hub color based on data pressure (total value relative to count)
  const hubColor = useMemo(() => {
    const avgVal = totalValue / (data.length || 1);
    // More items or higher total → warmer color
    if (data.length > 15 || totalValue > 1_000_000) return '#ef4444'; // red — high pressure
    if (data.length > 8 || totalValue > 500_000) return '#f59e0b';   // amber — moderate
    return '#6366f1'; // indigo — normal
  }, [data.length, totalValue]);

  return (
    <group>
      {/* Liquid flow tubes — staggered entrance, largest first */}
      {flows.map((f, i) => (
        <FlowTube
          key={`tube-${i}`}
          curve={f.curve}
          color={f.color}
          radius={f.tubeRadius}
          speed={f.speedScale * baseSpeed * 3}
          entranceDelay={f.entranceDelay}
        />
      ))}

      {/* Sparkle highlight particles riding on tubes */}
      {totalHighlights > 0 && (
        <instancedMesh ref={highlightRef} args={[HIGHLIGHT_GEO, undefined, totalHighlights]}>
          <meshStandardMaterial transparent opacity={0.9} roughness={0.1} metalness={0.3} />
        </instancedMesh>
      )}

      {/* Source labels + markers + value annotations (left side) */}
      {flows.map((f, i) => (
        <group key={`src-${i}`}>
          <mesh
            position={[-5, f.sourceY, 0]}
            onPointerOver={(e) => { e.stopPropagation(); setHoveredFlow(i); }}
            onPointerOut={() => setHoveredFlow(null)}
          >
            <sphereGeometry args={[0.06 + f.ratio * 0.14, 12, 12]} />
            <meshStandardMaterial color={colors[i % colors.length]} transparent opacity={hoveredFlow === i ? 1 : 0.7} />
          </mesh>
          <Text
            position={[-5.5, f.sourceY, 0]}
            fontSize={0.18}
            color="#e5e7eb"
            anchorX="right"
            anchorY="middle"
            maxWidth={2.5}
          >
            {f.label}
          </Text>
          {/* Html value label — visible for top items or hovered */}
          {(f.ratio > 0.15 || hoveredFlow === i) && (
            <Html position={[-5, f.sourceY + 0.25, 0]} center style={{ pointerEvents: 'none' }}>
              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: hoveredFlow === i ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>
                {fmtValue(f.val)}
              </span>
            </Html>
          )}
          <Tooltip3D
            position={[-5, f.sourceY + 0.45, 0]}
            label={f.label}
            value={f.val}
            total={totalValue}
            color={colors[i % colors.length]}
            visible={hoveredFlow === i}
          />
        </group>
      ))}

      {/* Destination hub — pressure-colored, breathing */}
      <mesh ref={hubRef} position={[5, 0, 0]}>
        <sphereGeometry args={[cfg.hubRadius, 24, 24]} />
        <meshStandardMaterial
          color={hubColor}
          transparent
          opacity={0.35}
          roughness={0.15}
          emissive={hubColor}
          emissiveIntensity={0.15}
        />
      </mesh>
      {/* Outer glow ring */}
      <mesh position={[5, 0, 0]}>
        <sphereGeometry args={[cfg.hubRadius + 0.05, 16, 16]} />
        <meshBasicMaterial color={hubColor} wireframe transparent opacity={0.15} />
      </mesh>
      <Text position={[5, -(cfg.hubRadius + 0.4), 0]} fontSize={0.2} color="#e5e7eb" anchorX="center">
        {fmtValue(totalValue)}
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
          <meshStandardMaterial color="#2a2a3e" transparent opacity={0.4} />
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
                <meshStandardMaterial color="#1e1e30" transparent opacity={0.85} roughness={0.1} />
              </RoundedBox>
              <Text
                position={[0, 0.15, 0.03]}
                fontSize={0.12}
                color="#e5e7eb"
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
                  color="#9ca3af"
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

// ─── Scene Type Labels ───────────────────────────────────────────────────────

const SCENE_LABELS: Record<string, string> = {
  bar3d: 'BAR CHART',
  scatter3d: 'SCATTER PLOT',
  pie3d: 'PIE CHART',
  network: 'NETWORK GRAPH',
  surface: 'SURFACE MAP',
  barRace: 'BAR RACE',
  radialBurst: 'RADIAL BURST',
  connectionMap: 'CONNECTION MAP',
  particleFlow: 'PARTICLE FLOW',
  timelineFlow: 'TIMELINE FLOW',
};

// Format numbers for display
function fmtValue(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return v.toLocaleString();
}

// Scene types that use categorical colors and should show a legend
const LEGEND_SCENES = new Set(['bar3d', 'pie3d', 'particleFlow', 'network', 'connectionMap', 'barRace', 'radialBurst']);

// Scenes that have a ground plane (not flow/network types)
const GROUNDED_SCENES = new Set(['bar3d', 'scatter3d', 'pie3d', 'surface', 'barRace']);

// ─── Dark Environment Sub-component ──────────────────────────────────────────

function SceneEnvironment({ grounded }: { grounded: boolean }) {
  return (
    <>
      {/* Soft environment reflections for material depth */}
      <Environment preset="city" environmentIntensity={0.15} />
      {/* Subtle distance fog for spatial reading */}
      <fog attach="fog" args={['#0e0e16', 10, 25]} />
      {/* Ground plane with contact shadows for grounded scenes */}
      {grounded && (
        <>
          <ContactShadows position={[0, -0.01, 0]} opacity={0.3} scale={12} blur={2} far={4} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
            <planeGeometry args={[20, 20]} />
            <meshStandardMaterial color="#141420" transparent opacity={0.5} roughness={0.9} />
          </mesh>
          {/* Grid handled by per-scene GridFloor — no duplicate here (BB-004) */}
        </>
      )}
    </>
  );
}

// ─── Main Renderer ────────────────────────────────────────────────────────────

export function ThreeDRenderer({ section }: ThreeDRendererProps) {
  const cfg = mapped3D();
  const colors = section.colors || DEFAULT_COLORS;
  const chartHeight = section.height || 380;
  const labelKey = section.labelKey || section.xAxis || 'name';
  const valueKey = section.valueKey || section.yAxis || 'value';
  const autoRotate = section.autoRotate !== false;
  const autoRotateSpeed = section.autoRotateSpeed ?? cfg.autoRotateSpeed;
  const showGrid = section.showGrid !== false;
  const showLabels = section.showLabels !== false;
  const showValues = section.showValues !== false;
  const isParticleFlow = section.sceneType === 'particleFlow';
  const defaultCam: [number, number, number] = isParticleFlow
    ? [0, 0, cfg.cameraDistance]
    : [5, 4, 5];
  const cameraPos = section.cameraPosition || defaultCam;
  const ambientIntensity = section.ambientIntensity ?? 0.4;
  const lightIntensity = section.lightIntensity ?? 0.6;
  const materialOpacity = section.opacity ?? 0.35;
  const nodeMin = section.nodeMinSize ?? 0.08;
  const nodeMax = section.nodeMaxSize ?? 1.2;
  const circleRadius = section.circleRadius ?? 4;
  const isGrounded = GROUNDED_SCENES.has(section.sceneType);

  // Compute data summary for overlays
  const data = section.data || [];
  const values = useMemo(() => data.map(d => Number(d[valueKey]) || 0).filter(v => v > 0), [data, valueKey]);
  const totalValue = useMemo(() => values.reduce((s, v) => s + v, 0), [values]);
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const maxValue = values.length > 0 ? Math.max(...values) : 0;

  // Legend: top N items by value
  const legendItems = useMemo(() => {
    if (!LEGEND_SCENES.has(section.sceneType)) return [];
    const items = data
      .map((d, i) => ({ label: String(d[labelKey] || ''), value: Number(d[valueKey]) || 0, color: colors[i % colors.length] }))
      .sort((a, b) => b.value - a.value);
    const MAX_LEGEND = 6;
    const shown = items.slice(0, MAX_LEGEND);
    const remaining = items.length - MAX_LEGEND;
    return { shown, remaining: remaining > 0 ? remaining : 0 };
  }, [data, labelKey, valueKey, colors, section.sceneType]);

  const sceneLabel = SCENE_LABELS[section.sceneType] || '3D SCENE';
  const dataSummary = `${data.length} items` + (totalValue > 0 ? ` · ${fmtValue(totalValue)} total` : '');

  return (
    <div className="space-y-1">
      {/* ─── Dark Analytical Viewport ─────────────────────────────────── */}
      <div
        className="w-full rounded-xl overflow-hidden relative"
        style={{
          height: chartHeight,
          background: 'linear-gradient(180deg, #0c0c14 0%, #0a0a12 50%, #080810 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03), 0 4px 24px rgba(0,0,0,0.3)',
        }}
      >
        {/* ─── Title Bar Overlay ─────────────────────────────────────── */}
        <div
          className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-2"
          style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 100%)' }}
        >
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-400/80 animate-pulse" />
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">
              {sceneLabel}
            </span>
          </div>
          <span className="text-[9px] font-mono text-white/30 tabular-nums">
            {dataSummary}
          </span>
        </div>

        {/* ─── Legend Overlay (bottom-left) ──────────────────────────── */}
        {legendItems && 'shown' in legendItems && legendItems.shown.length > 0 && (
          <div className="absolute bottom-2 left-3 z-10 flex flex-col gap-0.5">
            {legendItems.shown.map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-[8px] text-white/50 leading-none truncate max-w-[100px]">
                  {item.label}
                </span>
              </div>
            ))}
            {legendItems.remaining > 0 && (
              <span className="text-[8px] text-white/30 pl-3">
                + {legendItems.remaining} more
              </span>
            )}
          </div>
        )}

        {/* ─── Value Annotation (bottom-right) ──────────────────────── */}
        {totalValue > 0 && (
          <div className="absolute bottom-2 right-3 z-10 text-right">
            {minValue !== maxValue && (
              <div className="text-[8px] font-mono text-white/30 tabular-nums">
                {fmtValue(minValue)} — {fmtValue(maxValue)}
              </div>
            )}
            <div className="text-[10px] font-mono text-white/50 tabular-nums">
              {fmtValue(totalValue)}
            </div>
          </div>
        )}

        {/* ─── 3D Canvas ────────────────────────────────────────────── */}
        <Suspense fallback={
          <div className="flex items-center justify-center h-full text-[11px] text-white/20">
            Loading 3D scene...
          </div>
        }>
          <Canvas
            camera={{ position: cameraPos, fov: 45 }}
            dpr={[1, 1.5]}
            gl={{ antialias: true, alpha: false }}
          >
            {/* Dark scene background */}
            <color attach="background" args={['#0e0e16']} />

            {/* Lighting — reduced ambient, added rim light for edge definition */}
            <ambientLight intensity={ambientIntensity} />
            <directionalLight position={[5, 8, 5]} intensity={lightIntensity} castShadow />
            <directionalLight position={[-3, 4, -3]} intensity={lightIntensity * 0.4} />
            <directionalLight position={[0, -2, 5]} intensity={0.15} color="#6366f1" />

            {/* Environment: reflections, fog, ground */}
            <SceneEnvironment grounded={isGrounded} />

            {section.sceneType === 'bar3d' && (
              <Bar3DScene data={data} labelKey={labelKey} valueKey={valueKey} colors={colors} showGrid={showGrid} showLabels={showLabels} showValues={showValues} barWidth={section.barWidth} barGap={section.barGap} maxHeight={section.maxHeight} opacity={materialOpacity} />
            )}
            {section.sceneType === 'scatter3d' && (
              <Scatter3DScene data={data} xAxis={section.xAxis || 'x'} yAxis={section.yAxis || 'y'} zAxis={section.zAxis || 'z'} colors={colors} />
            )}
            {section.sceneType === 'pie3d' && (
              <Pie3DScene data={data} labelKey={labelKey} valueKey={valueKey} colors={colors} opacity={materialOpacity} innerRadius={section.innerRadius} outerRadius={section.outerRadius} extrudeDepth={section.extrudeDepth} />
            )}
            {section.sceneType === 'network' && (
              <NetworkScene data={data} labelKey={labelKey} valueKey={valueKey} colors={colors} nodeMin={nodeMin} nodeMax={nodeMax} radius={circleRadius} />
            )}
            {section.sceneType === 'surface' && (
              <SurfaceScene data={data} xAxis={section.xAxis || 'x'} yAxis={section.yAxis || 'y'} zAxis={section.zAxis || 'z'} colors={colors} />
            )}

            {/* Animated scene types */}
            {section.sceneType === 'barRace' && (
              <BarRaceScene data={data} labelKey={labelKey} valueKey={valueKey} colors={colors} showGrid={showGrid} />
            )}
            {section.sceneType === 'radialBurst' && (
              <RadialBurstScene data={data} labelKey={labelKey} valueKey={valueKey} colors={colors} opacity={materialOpacity} stagger={section.stagger} innerRadius={section.innerRadius} outerRadius={section.outerRadius} />
            )}
            {section.sceneType === 'connectionMap' && (
              <ConnectionMapScene data={data} labelKey={labelKey} valueKey={valueKey} colors={colors} nodeMin={nodeMin} nodeMax={nodeMax} radius={circleRadius} stagger={section.stagger} />
            )}
            {section.sceneType === 'particleFlow' && (
              <ParticleFlowScene data={data} labelKey={labelKey} valueKey={valueKey} colors={colors} particleDensity={section.particleDensity} flowSpeed={section.flowSpeed} />
            )}
            {section.sceneType === 'timelineFlow' && (
              <TimelineFlowScene data={data} labelKey={labelKey} valueKey={valueKey} colors={colors} dollySpeed={section.dollySpeed} eventSpacing={section.eventSpacing} />
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
