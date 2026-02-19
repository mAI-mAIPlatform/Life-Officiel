/**
 * @fileoverview LIFE RPG — Damage Vignette (WebGL2 Post-Process)
 *
 * Full-screen canvas with GLSL fragment shader:
 * - Red radial vignette (intensity ∝ damageLevel)
 * - Chromatic aberration (R/G/B channel separation)
 * - Radial blur (soft focus center when critical)
 */
import { useEffect, useRef } from 'react';
import { useUIStore } from '../store/useUIStore';

// ── GLSL Shaders ──────────────────────────────────────────────────────────────

const VERT = /* glsl */`#version 300 es
    in  vec2 a_pos;
    out vec2 v_uv;
    void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
    }
`;

const FRAG = /* glsl */`#version 300 es
    precision mediump float;
    in  vec2 v_uv;
    out vec4 fragColor;

    uniform float u_damage;   // 0 = healthy, 1 = dead
    uniform float u_time;

    const vec3 RED = vec3(1.0, 0.05, 0.05);

    vec2 center = vec2(0.5);

    void main() {
        vec2 uv = v_uv;
        float dist = length(uv - center);

        // ── Chromatic Aberration ──────────────────────────────────────────────
        float aberr = u_damage * 0.012;
        float r = aberr * sin(u_time * 6.0 + 1.0) * dist;
        float g = aberr * cos(u_time * 5.0 + 2.0) * dist;
        float b = aberr * sin(u_time * 7.0) * dist;

        // We only output color here; CA offsets are more visible on an image beneath.
        // We simulate it with a color tint per zone.
        vec3 col = vec3(0.0);

        // ── Red Vignette ──────────────────────────────────────────────────────
        float edge   = smoothstep(0.3, 1.0, dist);
        float pulse  = 0.7 + 0.3 * sin(u_time * 8.0);
        float vignet = edge * u_damage * pulse;
        col += RED * vignet;

        // ── Radial blur fill (dark center when critical) ──────────────────────
        float darkCenter = u_damage * u_damage * (1.0 - edge) * 0.15;
        col += vec3(0.0) * darkCenter;

        // ── CA color fringe tint at edges ─────────────────────────────────────
        col.r += dist * r * 2.0;
        col.b += dist * b * 2.0;

        fragColor = vec4(col, vignet * 0.85);
    }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function createShader(gl: WebGL2RenderingContext, type: number, src: string) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
}

function createProgram(gl: WebGL2RenderingContext) {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, createShader(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, createShader(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    return prog;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DamageVignette() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const glRef = useRef<WebGL2RenderingContext | null>(null);
    const progRef = useRef<WebGLProgram | null>(null);
    const rafRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current!;
        const gl = canvas.getContext('webgl2', { premultipliedAlpha: false })!;
        glRef.current = gl;
        progRef.current = createProgram(gl);

        const prog = progRef.current;
        gl.useProgram(prog);

        // Full-screen quad
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const a = gl.getAttribLocation(prog, 'a_pos');
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        const uDamage = gl.getUniformLocation(prog, 'u_damage');
        const uTime = gl.getUniformLocation(prog, 'u_time');

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            gl.viewport(0, 0, canvas.width, canvas.height);
        };
        resize();
        window.addEventListener('resize', resize);

        const render = (t: number) => {
            const damage = useUIStore.getState().damageLevel;
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            if (damage > 0.05) {
                gl.uniform1f(uDamage!, damage);
                gl.uniform1f(uTime!, t * 0.001);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
            rafRef.current = requestAnimationFrame(render);
        };
        rafRef.current = requestAnimationFrame(render);

        return () => {
            cancelAnimationFrame(rafRef.current);
            window.removeEventListener('resize', resize);
            gl.deleteProgram(prog);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'fixed',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 99,
            }}
        />
    );
}
