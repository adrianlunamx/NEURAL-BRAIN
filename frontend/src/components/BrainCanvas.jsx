import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import Neuron from './Neuron'
import Connection from './Connection'
import ThinkingFX from './ThinkingFX'
import CameraRig from './CameraRig'
import ShaderWarmup from './ShaderWarmup'
import { AmbientParticles, ThinkingParticles } from './Particles'
import { NeuronLabel, NeuronTooltip } from './NeuronInfo'
import { bump, edgeKey, now } from '../utils/animations'
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

/** Chromatic "motion smear" that spikes on each phase change (stands in for motion blur). */
function PhaseAberration({ phaseAt }) {
  const effect = useRef()
  const initial = useMemo(() => new THREE.Vector2(0.0006, 0.0004), [])
  useFrame(() => {
    if (!effect.current) return
    const t = now()
    let k = 0
    for (const at of Object.values(phaseAt || {})) k += bump(t, at + 0.05, 0.12)
    effect.current.offset.set(0.0006 + 0.0035 * k, 0.0004 + 0.002 * k)
  })
  return <ChromaticAberration ref={effect} offset={initial} radialModulation={false} />
}

function Scene({ graph, scene, hoveredId, selectedId, showLabels, onHover, onSelect, rigRef, autoRotate }) {
  const { nodes, edges, nodeMap, radius } = graph
  const { activeNodes, activeEdges, phase, phaseAt } = scene
  const dimmed = phase !== 'idle' && Object.keys(activeNodes).length > 0

  const hits = useMemo(
    () => Object.entries(activeNodes).filter(([id, a]) => a.role === 'hit' && nodeMap.has(id)),
    [activeNodes, nodeMap],
  )

  return (
    <>
      <BackgroundGradient />
      <fogExp2 attach="fog" args={[COLORS.bgBottom, 0.0065]} />
      <ambientLight intensity={0.2} />
      <pointLight position={[10, 10, 10]} intensity={0.5} />
      <pointLight position={[-20, -10, -15]} intensity={0.3} color={COLORS.query} />

      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <AmbientParticles radius={radius} />
      <gridHelper
        args={[radius * 6, 36, COLORS.gridMain, COLORS.gridSub]}
        position={[0, -radius * 1.15, 0]}
        material-transparent
        material-opacity={0.55}
      />

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
            activation={activeEdges[key]}
            dimmed={dimmed}
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
      {hits.map(([id, a]) => (
        <NeuronLabel key={`h-${id}`} node={nodeMap.get(id)} score={a.score} />
      ))}
      {hoveredId && nodeMap.get(hoveredId) && <NeuronTooltip node={nodeMap.get(hoveredId)} />}

      <ThinkingFX scene={scene} nodeMap={nodeMap} radius={radius} />
      <ThinkingParticles />
      <ShaderWarmup />

      <CameraRig ref={rigRef} autoRotate={autoRotate} homeDistance={Math.max(50, radius * 2.1)} />
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

function Effects({ dof, phaseAt, focusRef }) {
  return (
    <EffectComposer multisampling={0}>
      {dof ? <FocusedDepthOfField rigRef={focusRef} /> : <></>}
      <Bloom mipmapBlur luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.5} radius={0.75} />
      <PhaseAberration phaseAt={phaseAt} />
      <Vignette eskil={false} offset={0.2} darkness={0.75} />
    </EffectComposer>
  )
}

function BrainCanvas({ graph, scene, hoveredId, selectedId, showLabels, dof, onHover, onSelect, onBackground, rigRef, autoRotate }) {
  const handleMissed = useCallback((e) => e.type === 'dblclick' && onBackground?.(), [onBackground])

  // cursor feedback for hover
  useEffect(() => {
    document.body.style.cursor = hoveredId ? 'pointer' : 'auto'
    return () => (document.body.style.cursor = 'auto')
  }, [hoveredId])

  return (
    <Canvas
      className="!absolute inset-0"
      camera={{ position: [0, 0, 50], fov: 60, near: 0.1, far: 1200 }}
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
        onHover={onHover}
        onSelect={onSelect}
        rigRef={rigRef}
        autoRotate={autoRotate}
      />
      <Effects dof={dof} phaseAt={scene.phaseAt} focusRef={rigRef} />
    </Canvas>
  )
}

export default memo(BrainCanvas)
