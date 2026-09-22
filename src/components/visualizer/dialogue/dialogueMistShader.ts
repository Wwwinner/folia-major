// 小区域烟雾材质：多层噪声互相扭曲坐标，形成不断变化的丝状密度和卷动边缘。
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
uniform vec3 u_color;

float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
        mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), f.x), f.y);
}
float fbm(vec2 p) {
    float value = 0.0, amplitude = 0.55;
    mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 4; i++) {
        value += amplitude * noise(p);
        p = turn * p * 2.03 + vec2(7.3, 3.1);
        amplitude *= 0.5;
    }
    return value;
}
void main() {
    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
    float t = u_time * 0.72;
    vec2 p = uv * vec2(4.8, 2.6);
    vec2 flow = vec2(fbm(p * 0.8 + vec2(t * 0.21, -t * 0.16)),
        fbm(p * 0.9 + vec2(4.2 - t * 0.13, 2.6 + t * 0.19)));
    vec2 warped = p + (flow - 0.5) * 2.6 + vec2(t * 0.22, -t * 0.17);
    // 反向采样让纹理向左右外侧舒展；中心先变薄，而不是整团平移。
    warped += vec2(-(uv.x - 0.5) * 2.0, 0.35) * u_reveal;
    float body = fbm(warped);
    float threads = fbm(warped * 2.1 + vec2(-t * 0.15, t * 0.11));
    float center = 0.51 + (flow.x - 0.5) * 0.35 + sin(p.x * 1.5 + t * 0.7) * 0.07;
    float vertical = (uv.y - center + (threads - 0.5) * 0.16) / (0.20 + flow.y * 0.12);
    float envelope = exp(-vertical * vertical * 1.8);
    envelope *= smoothstep(0.0, 0.16, uv.x) * (1.0 - smoothstep(0.80, 1.0, uv.x));
    float density = smoothstep(0.28 + u_reveal * 0.09, 0.78, body + threads * 0.20);
    float filaments = smoothstep(0.43, 0.70, threads) * (1.0 - density * 0.6);
    float alpha = clamp((density * 0.77 + filaments * 0.24) * envelope, 0.0, 0.88);
    alpha *= 1.0 - u_reveal * (1.0 - smoothstep(0.0, 0.42, abs(uv.x - 0.5))) * 0.85;
    gl_FragColor = vec4(u_color * alpha, alpha);
}`;
