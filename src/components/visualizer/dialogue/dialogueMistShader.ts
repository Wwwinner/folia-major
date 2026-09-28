// 小区域雾气材质：几层低对比度的体积密度叠加，保留自然软边和缓慢流动。
export const MIST_VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

export const MIST_FRAGMENT_SHADER = `
precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_reveal;
uniform float u_aspect;
uniform vec2 u_viewScale;
uniform vec3 u_color;

float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
        mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), f.x), f.y);
}
float fbm(vec2 p) {
    float value = 0.0, amplitude = 0.55;
    mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 3; i++) {
        value += amplitude * noise(p);
        p = turn * p * 2.03 + vec2(7.3, 3.1);
        amplitude *= 0.5;
    }
    return value;
}
void main() {
    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
    float t = u_time * 0.7;
    // 透明画布留白不扩大主雾，只容纳散开时的少量雾丝。
    float aspect = max(u_aspect, 1.0);
    vec2 coreUv = (uv - 0.5) * u_viewScale + 0.5;
    vec2 p = vec2((coreUv.x - 0.5) * aspect, coreUv.y - 0.5);
    float turn = noise(p * vec2(0.65, 1.1) + vec2(t * 0.1, 7.3));
    vec2 drift = vec2((turn - 0.5) * 0.65 + sign(p.x) * 0.1,
        sin(p.x * 0.9 + turn * 3.0 + t * 0.16) * 0.32 - 0.14);
    vec2 source = p - drift * u_reveal;

    // 独立缓流的前后雾层积累光学厚度，不画亮丝、褶皱或恒定底密度。
    float opticalDepth = 0.0;
    for (int i = 0; i < 3; i++) {
        float layer = float(i), phase = layer * 2.17;
        vec2 local = source - vec2(sin(t * 0.17 + phase) * aspect * 0.035,
            sin(t * 0.31 + phase) * 0.075);
        local.y += sin(source.x * 0.55 + phase + t * 0.25) * 0.055;
        vec2 radius = vec2(aspect * (0.35 + layer * 0.045), 0.26 + layer * 0.06);
        vec2 d = local / radius;
        float envelope = exp(-dot(d, d) * 1.65);
        vec2 wind = vec2(t * (0.24 - layer * 0.18), -t * (0.14 + layer * 0.04));
        vec2 detail = i == 0 ? vec2(1.6, 2.4) : vec2(0.95, 1.5);
        float softness = fbm(local * detail + wind + vec2(layer * 7.1, layer * 4.3));
        float density = smoothstep(0.24, 0.72, softness);
        float life = noise(local * vec2(0.7, 1.3) + vec2(phase, 5.2));
        float disperse = 1.0 - smoothstep(0.05 + life * 0.25, 0.65 + life * 0.3, u_reveal);
        float weight = i == 0 ? 0.65 : (i == 1 ? 0.36 : 0.24);
        opticalDepth += envelope * density * disperse * weight;
    }
    float alpha = min(1.0 - exp(-opticalDepth), 0.52);
    alpha *= smoothstep(0.0, 0.04, uv.x) * (1.0 - smoothstep(0.96, 1.0, uv.x));
    alpha *= smoothstep(0.0, 0.06, uv.y) * (1.0 - smoothstep(0.94, 1.0, uv.y));
    gl_FragColor = vec4(u_color * alpha, alpha);
}`;
