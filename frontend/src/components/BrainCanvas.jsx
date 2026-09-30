import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { Bloom, DepthOfField, EffectComposer } from '@react-three/postprocessing'
import * as THREE from 'three'
import Neuron from './Neuron'
import Connection from './Connection'
import ThinkingFX from './ThinkingFX'
import CameraRig from './CameraRig'
import ShaderWarmup from './ShaderWarmup'
import BrainShell from './BrainShell'
import { AmbientParticles, ThinkingParticles } from './Particles'
import { NeuronLabel } from './NeuronInfo'
import { bowFor, edgeKey } from '../utils/animations'
import { COLORS } from '../utils/colors'

/** Huge inverted sphere painting the #0a0e27 → #1a1f3a vertical gradient. */
function BackgroundGradient() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(COLORS.bgTop) },
          uBottom: { value: new THREE.Color(COLORS.bgBottom) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uBottom;
          varying vec3 vDir;
          void main() {
            float h = smoothstep(-0.55, 0.75, vDir.y);
            gl_FragColor = vec4(mix(uBottom, uTop, h), 1.0);
          }`,
      }),
    [],
  )
  return (
    <mesh material={material} renderOrder={-1} raycast={() => null}>
      <sphereGeometry args={[480, 32, 32]} />
    </mesh>
  )
}

function Scene({ graph, scene, hoveredId, selectedId, showLabels, showShell, onHover, onSelect, rigRef, autoRotate }) {
  const { nodes, edges, nodeMap, radius, brain, layout } = graph
  const { activeNodes, activeEdges, phase, phaseAt, answer } = scene
  const dimmed = phase !== 'idle' && Object.keys(activeNodes).length > 0
  const thinking = !['idle', 'answered'].includes(phase)
  const synthesisId = answer?.id ?? null

  return (
    <>
      <BackgroundGradient />
      <fogExp2 attach="fog" args={[COLORS.bgBottom, 0.0065]} />
      <ambientLight intensity={0.2} />
      <pointLight position={[10, 10, 10]} intensity={0.5} />
      <pointLight position={[-20, -10, -15]} intensity={0.3} color={COLORS.query} />

      <Stars radius={100} depth={50} count={3000} factor={3} saturation={0} fade speed={0.5} />
      {/* floating dust only while idle */}
      {!thinking && <AmbientParticles count={500} radius={radius} />}
      {showShell && brain?.shell?.length > 0 && <BrainShell points={brain.shell} thinking={thinking} />}
      {layout !== 'oval' && (
        <gridHelper
          args={[radius * 6, 36, COLORS.gridMain, COLORS.gridSub]}
          position={[0, -radius * 1.15, 0]}
          material-transparent
          material-opacity={0.55}
        />
      )}

      {edges.map((e) => {
        const a = nodeMap.get(e.from)
        const b = nodeMap.get(e.to)
        if (!a || !b) return null
        const key = edgeKey(e.from, e.to)
        return (
          <Connection
            key={key}
            id={key}
            from={a.vec}
            to={b.vec}
            weight={e.weight}
            range={e.range}
            bow={bowFor(e, layout)}
            near={e.near ?? true}
            activation={activeEdges[key]}
            thinking={dimmed}
          />
        )
      })}

      {nodes.map((n) => {
        const data = nodeMap.get(n.id)
        return (
          <Neuron
            key={n.id}
            data={data}
            activation={activeNodes[n.id]}
            phase={phase}
            phaseAt={activeNodes[n.id] ? phaseAt : undefined}
            isSynthesis={synthesisId === n.id}
            hovered={hoveredId === n.id}
            selected={selectedId === n.id}
            dimmed={dimmed}
            onHover={onHover}
            onSelect={onSelect}
          />
        )
      })}

      {showLabels &&
        nodes
          .filter((n) => n.type === 'concept' && !activeNodes[n.id] && n.id !== hoveredId)
          .map((n) => <NeuronLabel key={`l-${n.id}`} node={nodeMap.get(n.id)} subtle />)}
      <ThinkingFX scene={scene} nodeMap={nodeMap} />
      <ThinkingParticles />
      <ShaderWarmup />

      <CameraRig ref={rigRef} autoRotate={autoRotate} homeDistance={layout === 'oval' ? Math.max(40, radius * 2.6) : Math.max(45, radius * 2.3)} />
    </>
  )
}

/** Depth of field that keeps whatever the camera orbits around in focus. */
function FocusedDepthOfField({ rigRef }) {
  const effect = useRef()
  useFrame(() => {
    const target = rigRef.current?.target
    if (target && effect.current?.target) effect.current.target.copy(target)
  })
  return <DepthOfField ref={effect} target={[0, 0, 0]} worldFocusRange={28} bokehScale={3.5} />
}

/** Bloom that eases from 1.2 (idle) to 2.0 while the brain is thinking. */
function PhaseBloom({ thinking }) {
  const effect = useRef()
  useFrame((_, delta) => {
    if (effect.current) effect.current.intensity = THREE.MathUtils.damp(effect.current.intensity, thinking ? 2.0 : 1.2, 3, delta)
  })
  return <Bloom ref={effect} mipmapBlur luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.2} radius={0.75} />
}

function Effects({ dof, thinking, focusRef }) {
  return (
    <EffectComposer multisampling={0}>
      {dof ? <FocusedDepthOfField rigRef={focusRef} /> : <></>}
      <PhaseBloom thinking={thinking} />
    </EffectComposer>
  )
}

function BrainCanvas({ graph, scene, hoveredId, selectedId, showLabels, showShell, dof, onHover, onSelect, onBackground, rigRef, autoRotate }) {
  const handleMissed = useCallback((e) => e.type === 'dblclick' && onBackground?.(), [onBackground])

  // cursor feedback for hover
  useEffect(() => {
    document.body.style.cursor = hoveredId ? 'pointer' : 'auto'
    return () => (document.body.style.cursor = 'auto')
  }, [hoveredId])

  return (
    <Canvas
      className="!absolute inset-0"
      camera={{ position: [0, 0, 40], fov: 60, near: 0.1, far: 1200 }}
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping }}
      onPointerMissed={handleMissed}
    >
      <Scene
        graph={graph}
        scene={scene}
        hoveredId={hoveredId}
        selectedId={selectedId}
        showLabels={showLabels}
        showShell={showShell}
        onHover={onHover}
        onSelect={onSelect}
        rigRef={rigRef}
        autoRotate={autoRotate}
      />
      <Effects dof={dof} thinking={!['idle', 'answered'].includes(scene.phase)} focusRef={rigRef} />
    </Canvas>
  )
}

export default memo(BrainCanvas)
