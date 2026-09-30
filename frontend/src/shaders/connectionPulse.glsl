// Synapse shader: idle shimmer + an electric pulse that travels along active edges.
// @vertex
attribute float aT;   // 0 at the source neuron, 1 at the target
varying float vT;

void main() {
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// @fragment
uniform vec3 uColor;
uniform vec3 uActiveColor;
uniform float uOpacity;
uniform float uActive;   // 0..1 activation
uniform float uTime;
uniform float uSeed;
uniform float uSpeed;

varying float vT;

void main() {
  // idle: slow shimmer running along the synapse
  float shimmer = 0.75 + 0.25 * sin(vT * 18.0 - uTime * 1.6 + uSeed * 6.2831);

  // active: bright current head with an exponential tail
  float head = fract(uTime * uSpeed + uSeed);
  float d = head - vT;
  float tail = d >= 0.0 ? exp(-d * 9.0) : exp(d * 60.0);
  float current = uActive * tail;

  vec3 color = mix(uColor, uActiveColor, clamp(uActive * 0.85 + current, 0.0, 1.0));
  float alpha = uOpacity * shimmer + uActive * 0.45 + current * 0.9;
  gl_FragColor = vec4(color * (1.0 + current * 2.5), clamp(alpha, 0.0, 1.0));
}
