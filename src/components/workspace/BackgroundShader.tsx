/**
 * BackgroundShader.tsx
 *
 * WebGL2 bioluminescent flow field for Dream State Canvas / Sherpa workspace.
 *
 * Architecture:
 *   - Ping-pong FBOs at 512x512 (simulation resolution)
 *   - Display pass upscales to full screen via bilinear sampling
 *   - Simplex noise flow field advects color through the feedback loop
 *   - Decay targets app's lavender-cream background exactly
 *   - 30fps throttle, tab-pause, prefers-reduced-motion respected
 *   - All visual parameters exposed as uniforms, driven by shader-settings.ts
 *
 * Dependencies: none (WebGL2 + ResizeObserver, both baseline 2024)
 */

import { useEffect, useRef } from 'react'
import { getShaderSettings } from '@/lib/shader-settings'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// ─── Vertex shader (shared between both passes) ───────────────────────────────

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

// ─── Simulation pass ──────────────────────────────────────────────────────────

const SIM_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_prev;
uniform vec2      u_resolution;
uniform float     u_time;
uniform vec2      u_mouse;

// Tunable uniforms — driven by admin panel
uniform float u_speed;
uniform float u_intensity;
uniform float u_diffusion;
uniform float u_emission;
uniform float u_mouse_react;
uniform float u_decay;
uniform float u_hue;
uniform float u_saturation;
uniform float u_brightness;
uniform float u_scale;
uniform float u_turbulence;
uniform float u_coverage;
uniform float u_vividness;
uniform float u_bloom_radius;

in  vec2 v_uv;
out vec4 out_color;

// ── Simplex 2D noise (Ashima Arts / McEwan) ──────────────────────────────────
vec3 _permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187, 0.366025403784439,
   -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1  = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy  -= i1;
  i        = mod(i, 289.0);
  vec3 p   = _permute(
    _permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0)
  );
  vec3 m   = max(
    0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)),
    0.0
  );
  m        = m * m * m * m;
  vec3 x   = 2.0 * fract(p * C.www) - 1.0;
  vec3 h   = abs(x) - 0.5;
  vec3 ox  = floor(x + 0.5);
  vec3 a0  = x - ox;
  m       *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x   + h.x  * x0.y;
  g.yz = a0.yz * x12.xz  + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// ── HSL helpers for hue/saturation/brightness control ────────────────────────
vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0/2.0) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    hue2rgb(p, q, hsl.x + 1.0/3.0),
    hue2rgb(p, q, hsl.x),
    hue2rgb(p, q, hsl.x - 1.0/3.0)
  );
}
// ─────────────────────────────────────────────────────────────────────────────

void main() {
  vec2 px = 1.0 / u_resolution;

  // Flow field — scale controls zoom, turbulence controls warp depth
  float t        = u_time * u_speed;
  vec2  uv2      = v_uv * u_scale;
  float nx       = snoise(uv2 + vec2(0.0,        t));
  float ny       = snoise(uv2 + vec2(5.2, 1.3) - vec2(0.0, t * 0.75));
  float nx2      = snoise(uv2 * 0.6 + vec2(17.4, t * 0.4)) * u_turbulence;
  float ny2      = snoise(uv2 * 0.6 + vec2(8.1, 22.3 + t * 0.4)) * u_turbulence;
  vec2  flow     = vec2(nx + nx2, ny + ny2) * u_intensity;

  // Advect: sample previous frame shifted by flow
  vec4 prev = texture(u_prev, v_uv + flow);

  // 4-tap diffusion — spreads color gently, softens sharp edges
  vec4 diff =
    texture(u_prev, v_uv + vec2( px.x, 0.0)) +
    texture(u_prev, v_uv + vec2(-px.x, 0.0)) +
    texture(u_prev, v_uv + vec2(0.0,  px.y)) +
    texture(u_prev, v_uv + vec2(0.0, -px.y));
  diff *= 0.25;
  prev  = mix(prev, diff, u_diffusion);

  // Decay toward app background color (lavender-cream)
  // Brightness shifts this target lighter/darker
  vec3 BG = vec3(0.970, 0.958, 0.985) * (0.5 + u_brightness);
  prev.rgb = mix(prev.rgb, BG, u_decay);

  // ── Color injection ─────────────────────────────────────────────────────────
  float n1 = snoise(uv2 * 1.3 + vec2(t * 1.15, 0.0));
  float n2 = snoise(uv2 * 1.0 + vec2(100.0, t * 0.85));
  float n3 = snoise(uv2 * 0.7 + vec2(50.0, 200.0 + t * 0.55));

  // Base palette: indigo, teal, lavender
  vec3 INDIGO   = vec3(0.51, 0.44, 0.97);
  vec3 TEAL     = vec3(0.22, 0.76, 0.74);
  vec3 LAVENDER = vec3(0.69, 0.54, 0.95);

  float palette_t = 0.5 + 0.5 * snoise(v_uv * 1.2 + vec2(t * 0.28));
  vec3  inject_c  = mix(mix(INDIGO, TEAL, palette_t), LAVENDER, 0.25 + 0.25 * n3);

  // Apply hue/saturation shift to injected color
  vec3 hsl = rgb2hsl(inject_c);
  hsl.x = fract(hsl.x + (u_hue - 0.5));                  // rotate hue
  hsl.y = clamp(hsl.y * (u_saturation * 2.0), 0.0, 1.0); // scale saturation
  inject_c = hsl2rgb(hsl);

  // Thresholded emission — coverage controls how much of the noise field emits
  float thresh_lo = 0.82 - u_coverage * 0.7;  // coverage 0→0.82 (rare), 1→0.12 (everywhere)
  float thresh_hi = thresh_lo + 0.3;
  float emit =
    smoothstep(thresh_lo, thresh_hi, n1) * 0.038 * u_emission +
    smoothstep(thresh_lo + 0.03, thresh_hi, n2) * 0.028 * u_emission;

  // Mouse proximity bloom — radius is tunable
  vec2  mouse_uv = u_mouse / u_resolution;
  mouse_uv.y     = 1.0 - mouse_uv.y;
  float m_dist   = length(v_uv - mouse_uv);
  emit += smoothstep(u_bloom_radius, 0.0, m_dist) * u_mouse_react;

  // Vividness controls how much injected color can punch through
  prev.rgb = mix(prev.rgb, inject_c, clamp(emit, 0.0, u_vividness));

  out_color = clamp(prev, 0.0, 1.0);
}
`

// ─── Display pass ─────────────────────────────────────────────────────────────

const DISP_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_sim;
in  vec2 v_uv;
out vec4 out_color;
void main() {
  out_color = texture(u_sim, v_uv);
}
`

// ─── WebGL helpers ────────────────────────────────────────────────────────────

function compileShader(
  gl: WebGL2RenderingContext,
  src: string,
  type: number
): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[BackgroundShader] Shader compile error:', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string
): WebGLProgram | null {
  const vert = compileShader(gl, vertSrc, gl.VERTEX_SHADER)
  const frag = compileShader(gl, fragSrc, gl.FRAGMENT_SHADER)
  if (!vert || !frag) return null

  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vert)
  gl.attachShader(prog, frag)
  gl.linkProgram(prog)

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[BackgroundShader] Program link error:', gl.getProgramInfoLog(prog))
    return null
  }

  gl.deleteShader(vert)
  gl.deleteShader(frag)
  return prog
}

interface FBO {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
}

function createFBO(gl: WebGL2RenderingContext, w: number, h: number): FBO | null {
  const tex = gl.createTexture()
  if (!tex) return null
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const fbo = gl.createFramebuffer()
  if (!fbo) return null
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  return { fbo, tex }
}

function deleteFBO(gl: WebGL2RenderingContext, fbo: FBO) {
  gl.deleteFramebuffer(fbo.fbo)
  gl.deleteTexture(fbo.tex)
}

// ─── Component ────────────────────────────────────────────────────────────────

const SIM_W = 512
const SIM_H = 512
const TARGET_FPS = 30
const FRAME_MS = 1000 / TARGET_FPS

export function BackgroundShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Transient pulse multiplier driven by agent loop events. Listeners add
  // to this on `sherpa-shader-pulse`; the render loop decays it each frame.
  // Values stay in [0, 1] range and are applied as (1 + pulse * gain)
  // multipliers on speed + intensity at uniform-write time.
  const pulseRef = useRef(0)

  useEffect(() => {
    const handler = (e: Event) => {
      const amt = (e as CustomEvent<number>).detail ?? 0
      pulseRef.current = Math.min(1, pulseRef.current + Math.max(0, amt))
    }
    window.addEventListener('sherpa-shader-pulse', handler)
    return () => window.removeEventListener('sherpa-shader-pulse', handler)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    }) as WebGL2RenderingContext | null

    if (!gl) {
      console.info('[BackgroundShader] WebGL2 unavailable, skipping shader background')
      return
    }

    if (!gl.getExtension('EXT_color_buffer_float')) {
      console.info('[BackgroundShader] EXT_color_buffer_float unavailable, skipping')
      return
    }

    const simProg  = createProgram(gl, VERT, SIM_FRAG)
    const dispProg = createProgram(gl, VERT, DISP_FRAG)
    if (!simProg || !dispProg) return

    // ── Pre-cache all uniform locations ───────────────────────────────────────
    const simUniforms = {
      prev:       gl.getUniformLocation(simProg, 'u_prev'),
      resolution: gl.getUniformLocation(simProg, 'u_resolution'),
      time:       gl.getUniformLocation(simProg, 'u_time'),
      mouse:      gl.getUniformLocation(simProg, 'u_mouse'),
      speed:      gl.getUniformLocation(simProg, 'u_speed'),
      intensity:  gl.getUniformLocation(simProg, 'u_intensity'),
      diffusion:  gl.getUniformLocation(simProg, 'u_diffusion'),
      emission:   gl.getUniformLocation(simProg, 'u_emission'),
      mouseReact: gl.getUniformLocation(simProg, 'u_mouse_react'),
      decay:      gl.getUniformLocation(simProg, 'u_decay'),
      hue:        gl.getUniformLocation(simProg, 'u_hue'),
      saturation: gl.getUniformLocation(simProg, 'u_saturation'),
      brightness: gl.getUniformLocation(simProg, 'u_brightness'),
      scale:      gl.getUniformLocation(simProg, 'u_scale'),
      turbulence: gl.getUniformLocation(simProg, 'u_turbulence'),
      coverage:   gl.getUniformLocation(simProg, 'u_coverage'),
      vividness:  gl.getUniformLocation(simProg, 'u_vividness'),
      bloomRadius:gl.getUniformLocation(simProg, 'u_bloom_radius'),
    }
    const dispUniforms = {
      sim: gl.getUniformLocation(dispProg, 'u_sim'),
    }

    // ── Full-screen quad ──────────────────────────────────────────────────────
    const quadBuf = gl.createBuffer()
    if (!quadBuf) return
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),
      gl.STATIC_DRAW
    )

    function makeVAO(prog: WebGLProgram): WebGLVertexArrayObject | null {
      const vao = gl!.createVertexArray()
      if (!vao) return null
      gl!.bindVertexArray(vao)
      gl!.bindBuffer(gl!.ARRAY_BUFFER, quadBuf)
      const loc = gl!.getAttribLocation(prog, 'a_pos')
      gl!.enableVertexAttribArray(loc)
      gl!.vertexAttribPointer(loc, 2, gl!.FLOAT, false, 0, 0)
      gl!.bindVertexArray(null)
      return vao
    }

    const simVAO  = makeVAO(simProg)
    const dispVAO = makeVAO(dispProg)
    if (!simVAO || !dispVAO) return

    // ── Ping-pong FBOs ────────────────────────────────────────────────────────
    let fbos: [FBO | null, FBO | null] = [
      createFBO(gl, SIM_W, SIM_H),
      createFBO(gl, SIM_W, SIM_H),
    ]
    if (!fbos[0] || !fbos[1]) return

    const initData = new Float32Array(SIM_W * SIM_H * 4)
    for (let i = 0; i < SIM_W * SIM_H; i++) {
      initData[i * 4 + 0] = 0.970
      initData[i * 4 + 1] = 0.958
      initData[i * 4 + 2] = 0.985
      initData[i * 4 + 3] = 1.0
    }
    ;[fbos[0]!, fbos[1]!].forEach(({ tex }) => {
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, SIM_W, SIM_H, 0, gl.RGBA, gl.FLOAT, initData)
    })

    let readIdx = 0

    // ── Canvas sizing ─────────────────────────────────────────────────────────
    function resize() {
      if (!canvas) return
      const dpr = Math.min(window.devicePixelRatio, 2)
      const w   = Math.round(canvas.offsetWidth  * dpr)
      const h   = Math.round(canvas.offsetHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w
        canvas.height = h
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(document.documentElement)

    // ── Mouse tracking ────────────────────────────────────────────────────────
    let mouseX = canvas.offsetWidth  * 0.5
    let mouseY = canvas.offsetHeight * 0.5

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX
      mouseY = e.clientY
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true })

    // ── Visibility / tab focus ────────────────────────────────────────────────
    let paused = false
    const onVisibility = () => { paused = document.hidden }
    document.addEventListener('visibilitychange', onVisibility)

    // ── Render loop ───────────────────────────────────────────────────────────
    let raf = 0
    let lastFrameTime = 0

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (paused) return
      if (now - lastFrameTime < FRAME_MS) return
      lastFrameTime = now

      // Read settings each frame — cheap module-level object access
      const s = getShaderSettings()

      const writeIdx = 1 - readIdx
      const time     = now * 0.001

      const cssW  = canvas.offsetWidth
      const cssH  = canvas.offsetHeight
      const simMX = (mouseX / cssW)  * SIM_W
      const simMY = (mouseY / cssH)  * SIM_H

      // ── Pass 1: Simulation ──────────────────────────────────────────────────
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[writeIdx]!.fbo)
      gl.viewport(0, 0, SIM_W, SIM_H)
      gl.useProgram(simProg)
      gl.bindVertexArray(simVAO)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, fbos[readIdx]!.tex)

      gl.uniform1i(simUniforms.prev, 0)
      gl.uniform2f(simUniforms.resolution, SIM_W, SIM_H)
      gl.uniform1f(simUniforms.time, time)
      gl.uniform2f(simUniforms.mouse, simMX, simMY)

      // Decay the pulse each frame (30fps → ~1s half-life at 0.977). Apply
      // as a multiplier on the motion-related uniforms so the field breathes
      // during agent work. Gain tuned so full pulse ≈ 2x speed, 1.8x intensity.
      pulseRef.current *= 0.977
      if (pulseRef.current < 0.001) pulseRef.current = 0
      const pulseMult = 1 + pulseRef.current
      const speedBoost = pulseMult * pulseMult      // slightly super-linear on speed
      const intensityBoost = 1 + pulseRef.current * 0.8

      // Tunable uniforms — map 0..1 slider range to shader-appropriate ranges
      gl.uniform1f(simUniforms.speed,      lerp(0.01,  0.15,  s.speed) * speedBoost)
      gl.uniform1f(simUniforms.intensity,  lerp(0.0005, 0.006, s.intensity) * intensityBoost)
      gl.uniform1f(simUniforms.diffusion,  lerp(0.01,  0.12,  s.diffusion))
      gl.uniform1f(simUniforms.emission,   lerp(0.2,   3.0,   s.emission))
      gl.uniform1f(simUniforms.mouseReact, lerp(0.0,   0.08,  s.mouseReactivity))
      gl.uniform1f(simUniforms.decay,      lerp(0.005, 0.04,  s.decay))
      gl.uniform1f(simUniforms.hue,        s.hue)
      gl.uniform1f(simUniforms.saturation, s.saturation)
      gl.uniform1f(simUniforms.brightness, s.brightness)
      gl.uniform1f(simUniforms.scale,      lerp(1.0,   6.0,   s.scale))
      gl.uniform1f(simUniforms.turbulence, lerp(0.0,   1.0,   s.turbulence))
      gl.uniform1f(simUniforms.coverage,   s.coverage)
      gl.uniform1f(simUniforms.vividness,  lerp(0.05,  0.6,   s.vividness))
      gl.uniform1f(simUniforms.bloomRadius,lerp(0.05,  0.5,   s.bloomRadius))

      gl.drawArrays(gl.TRIANGLES, 0, 6)

      // ── Pass 2: Display ─────────────────────────────────────────────────────
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(dispProg)
      gl.bindVertexArray(dispVAO)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, fbos[writeIdx]!.tex)
      gl.uniform1i(dispUniforms.sim, 0)

      gl.drawArrays(gl.TRIANGLES, 0, 6)

      readIdx = writeIdx
    }

    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('visibilitychange', onVisibility)

      gl.deleteProgram(simProg)
      gl.deleteProgram(dispProg)
      gl.deleteBuffer(quadBuf)
      gl.deleteVertexArray(simVAO)
      gl.deleteVertexArray(dispVAO)
      fbos.forEach(fbo => { if (fbo) deleteFBO(gl, fbo) })
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
        pointerEvents: 'none',
        display: 'block',
      }}
    />
  )
}
