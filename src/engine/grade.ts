/**
 * GPU colour grading (WebGL2). Used by both the preview and the export, so the
 * grade you see is exactly what is rendered into the MP4.
 */
import type { Grade } from '../types';

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform sampler3D u_lut;
uniform vec2 u_texel;
uniform float u_aspect;
uniform float u_exposure, u_brightness, u_contrast, u_highlights, u_shadows, u_whites, u_blacks;
uniform float u_saturation, u_vibrance, u_temperature, u_tint, u_fade, u_vignette, u_sharpness;
uniform float u_hasLut, u_lutMix, u_lutSize, u_split;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toGamma(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

void main() {
  vec2 uv = v_uv;
  vec3 orig = texture(u_tex, uv).rgb;
  if (u_split >= 0.0 && uv.x < u_split) { outColor = vec4(orig, 1.0); return; }
  vec3 c = orig;

  if (u_sharpness > 0.0) {
    vec3 blur = (texture(u_tex, uv + vec2(u_texel.x, 0.0)).rgb + texture(u_tex, uv - vec2(u_texel.x, 0.0)).rgb +
                 texture(u_tex, uv + vec2(0.0, u_texel.y)).rgb + texture(u_tex, uv - vec2(0.0, u_texel.y)).rgb) * 0.25;
    c = c + (c - blur) * u_sharpness * 2.0;
  }

  // Exposure and white balance in linear light.
  vec3 lin = toLinear(c);
  lin *= exp2(u_exposure * 2.0);
  lin *= vec3(1.0 + 0.18 * u_temperature, 1.0 - 0.10 * u_tint, 1.0 - 0.18 * u_temperature);
  c = toGamma(lin);

  // Tonal ranges.
  float l = dot(c, LUMA);
  c += u_shadows * 0.28 * (1.0 - smoothstep(0.0, 0.5, l));
  c += u_highlights * 0.28 * smoothstep(0.45, 1.0, l);
  c += u_blacks * 0.16 * (1.0 - smoothstep(0.0, 0.25, l));
  c += u_whites * 0.16 * smoothstep(0.7, 1.0, l);
  c += u_brightness * 0.2;
  c = (c - 0.5) * (1.0 + u_contrast * (u_contrast > 0.0 ? 0.9 : 0.6)) + 0.5;

  // Colour intensity.
  float g = dot(c, LUMA);
  c = mix(vec3(g), c, 1.0 + u_saturation);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = mx - mn;
  c = mix(vec3(g), c, 1.0 + u_vibrance * (1.0 - sat) * 1.3);
  c = clamp(c, 0.0, 1.0);

  if (u_hasLut > 0.5) {
    vec3 coord = c * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
    c = mix(c, texture(u_lut, coord).rgb, u_lutMix);
  }

  // Film fade (lifted blacks, softer whites).
  c = mix(c, c * 0.82 + 0.1, u_fade);

  if (u_vignette > 0.0) {
    vec2 d = (uv - 0.5) * vec2(u_aspect, 1.0) / max(u_aspect, 1.0);
    float r = length(d) * 1.414;
    float v = smoothstep(1.05, 0.35, r);
    c *= mix(1.0, v, u_vignette);
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export interface LutData {
  size: number;
  /** RGB bytes, red fastest, then green, then blue. */
  data: Uint8Array;
}

export class Grader {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private lutTex: WebGLTexture;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private lutKey: string | null = null;

  static create(w: number, h: number): Grader | null {
    try {
      return new Grader(w, h);
    } catch (e) {
      console.warn('WebGL2 colour grading unavailable', e);
      return null;
    }
  }

  private constructor(w: number, h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('No WebGL2');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link error');
    this.prog = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(p, 'a_pos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['u_tex', 'u_lut', 'u_texel', 'u_aspect', 'u_exposure', 'u_brightness', 'u_contrast', 'u_highlights',
      'u_shadows', 'u_whites', 'u_blacks', 'u_saturation', 'u_vibrance', 'u_temperature', 'u_tint', 'u_fade', 'u_vignette',
      'u_sharpness', 'u_hasLut', 'u_lutMix', 'u_lutSize', 'u_split']) {
      this.loc[n] = gl.getUniformLocation(p, n);
    }
    this.tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.lutTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    for (const pn of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, pn, gl.LINEAR);
    for (const pn of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, pn, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, 2, 2, 2, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(24));
    gl.uniform1i(this.loc.u_tex, 0);
    gl.uniform1i(this.loc.u_lut, 1);
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Grade `src` (already composed at the canvas size). Returns the graded canvas. */
  process(src: TexImageSource, grade: Grade, lut: LutData | null, split: number | null): HTMLCanvasElement {
    const gl = this.gl;
    const { width: w, height: h } = this.canvas;
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    const useLut = !!(lut && grade.lutId);
    if (useLut) {
      const key = `${grade.lutId}:${lut!.size}`;
      if (key !== this.lutKey) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, lut!.size, lut!.size, lut!.size, 0, gl.RGB, gl.UNSIGNED_BYTE, lut!.data);
        this.lutKey = key;
      }
    }
    const u = (n: string, v: number) => gl.uniform1f(this.loc[n], v);
    gl.uniform2f(this.loc.u_texel, 1 / w, 1 / h);
    u('u_aspect', w / h);
    u('u_exposure', grade.exposure / 100);
    u('u_brightness', grade.brightness / 100);
    u('u_contrast', grade.contrast / 100);
    u('u_highlights', grade.highlights / 100);
    u('u_shadows', grade.shadows / 100);
    u('u_whites', grade.whites / 100);
    u('u_blacks', grade.blacks / 100);
    u('u_saturation', grade.saturation / 100);
    u('u_vibrance', grade.vibrance / 100);
    u('u_temperature', grade.temperature / 100);
    u('u_tint', grade.tint / 100);
    u('u_fade', grade.fade / 100);
    u('u_vignette', grade.vignette / 100);
    u('u_sharpness', grade.sharpness / 100);
    u('u_hasLut', useLut ? 1 : 0);
    u('u_lutMix', grade.lutMix / 100);
    u('u_lutSize', lut?.size ?? 2);
    u('u_split', split ?? -1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.width = this.canvas.height = 0;
  }
}

/** Parse an Adobe/Resolve .cube 3D LUT file. */
export function parseCube(text: string): LutData {
  let size = 0;
  const vals: number[] = [];
  let dmin = [0, 0, 0], dmax = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'LUT_3D_SIZE') { size = parseInt(parts[1], 10); continue; }
    if (key === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported — please use a 3D .cube LUT.');
    if (key === 'DOMAIN_MIN') { dmin = parts.slice(1, 4).map(Number); continue; }
    if (key === 'DOMAIN_MAX') { dmax = parts.slice(1, 4).map(Number); continue; }
    if (/^[A-Z_]+$/.test(key)) continue; // TITLE etc.
    if (parts.length >= 3) for (let i = 0; i < 3; i++) vals.push(parseFloat(parts[i]));
  }
  if (!size || size < 2 || size > 128) throw new Error('Not a valid 3D .cube LUT (missing LUT_3D_SIZE).');
  if (vals.length !== size * size * size * 3) throw new Error(`LUT has ${vals.length / 3} entries, expected ${size ** 3}.`);
  const data = new Uint8Array(vals.length);
  for (let i = 0; i < vals.length; i++) {
    const ch = i % 3;
    const v = (vals[i] - dmin[ch]) / (dmax[ch] - dmin[ch] || 1);
    data[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return { size, data };
}

export const GRADE_PRESETS: { id: string; name: string; grade: Partial<Grade> }[] = [
  { id: 'natural', name: 'Natural Professional', grade: { contrast: 8, vibrance: 12, highlights: -10, shadows: 8, sharpness: 15 } },
  { id: 'cinematic-warm', name: 'Cinematic Warm', grade: { contrast: 18, temperature: 22, tint: 4, highlights: -18, shadows: 6, saturation: -6, vibrance: 10, vignette: 28, fade: 8 } },
  { id: 'clean-luxury', name: 'Clean Luxury', grade: { exposure: 6, contrast: 10, highlights: -22, shadows: 14, saturation: -14, temperature: 6, whites: 10, vignette: 12, sharpness: 12 } },
  { id: 'moody-dark', name: 'Moody Dark', grade: { exposure: -12, contrast: 28, highlights: -25, shadows: -18, blacks: -10, saturation: -28, temperature: -10, vignette: 45, fade: 6 } },
  { id: 'bright-commercial', name: 'Bright Commercial', grade: { exposure: 10, brightness: 6, contrast: 12, saturation: 12, vibrance: 22, whites: 14, shadows: 12, sharpness: 20 } },
  { id: 'film-look', name: 'Film Look', grade: { contrast: 14, fade: 32, saturation: -16, temperature: 8, tint: -4, highlights: -14, vignette: 30 } },
  { id: 'premium-hotel', name: 'Premium Hotel', grade: { exposure: 4, contrast: 12, temperature: 14, highlights: -20, shadows: 10, saturation: -4, vibrance: 14, vignette: 20, whites: 6 } },
  { id: 'teal-orange', name: 'Teal & Orange', grade: { contrast: 20, temperature: 12, tint: -6, saturation: 4, vibrance: 18, highlights: -12, shadows: -6, vignette: 22 } },
  { id: 'black-white', name: 'Classic B&W', grade: { saturation: -100, contrast: 30, vignette: 25, sharpness: 15 } },
];
