// Neuron halo, additive blending.
//   uRim = 0 → soft volumetric glow: brightest facing the camera, fading to 0 at the silhouette
//   uRim = 1 → fresnel rim: transparent centre, bright edge (used for shock waves)
// @vertex
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}

// @fragment
uniform vec3 uColor;
uniform float uIntensity;
uniform float uPower;
uniform float uTime;
uniform float uRim;

varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
  float glow = mix(pow(facing, uPower) * 0.5, pow(1.0 - facing, uPower), uRim);
  // faint animated interference bands for a holographic feel
  float bands = 0.9 + 0.1 * sin(facing * 26.0 - uTime * 3.0);
  float alpha = glow * uIntensity * bands;
  gl_FragColor = vec4(uColor * (1.0 + uIntensity), alpha);
}
