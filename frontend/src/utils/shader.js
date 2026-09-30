/** Split a single .glsl file into `{ vertexShader, fragmentShader }` using `// @vertex` / `// @fragment` markers. */
export function splitShader(source) {
  const [, rest = ''] = source.split('// @vertex')
  const [vertexShader, fragmentShader] = rest.split('// @fragment')
  return { vertexShader: vertexShader.trim(), fragmentShader: fragmentShader.trim() }
}
