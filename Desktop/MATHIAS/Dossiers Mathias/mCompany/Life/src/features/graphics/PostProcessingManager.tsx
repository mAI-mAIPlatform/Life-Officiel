/**
 * @fileoverview Post-Processing Stack for Cinematic Rendering
 * Uses @react-three/postprocessing (wrapping `postprocessing` library).
 * 
 * Features:
 * - SSAO: Screen Space Ambient Occlusion for depth.
 * - Bloom: Selective glow for neons/sky (threshold 0.9).
 * - Noise: Subtle film grain (dithering).
 * - Vignette: Dynamic darkening based on player health.
 * - ChromaticAberration: Dynamic distortion based on health/speed.
 */

import React from 'react';
import { EffectComposer, Bloom, SSAO, Vignette, Noise, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { Vector2 } from 'three';
import { useUIStore } from '../../ui/store/useUIStore';

export function PostProcessingManager() {
  // Subscribe to damage level (0.0 = healthy, 1.0 = critical)
  const damageLevel = useUIStore((s) => s.damageLevel);

  return (
    <EffectComposer disableNormalPass={false} multisampling={0}>
      {/* 
              SSAO: Adds contact shadows. 
              Adjust radius/intensity for scale. 
            */}
      <SSAO
        radius={0.4}
        intensity={50}
        luminanceInfluence={0.4}
        color={undefined}
        worldDistanceThreshold={1.0}
        worldDistanceFalloff={0.1}
        worldProximityThreshold={1.0}
        worldProximityFalloff={0.1}
      />

      {/* 
              Bloom: High threshold to only glow very bright objects (neons, sky).
              mipmapBlur gives a smoother, more natural glow.
            */}
      <Bloom
        luminanceThreshold={0.9}
        mipmapBlur
        intensity={1.5}
        radius={0.6}
      />

      {/* 
              Noise: Breaks the "digital plastic" look. 
              Very subtle (0.02).
            */}
      <Noise opacity={0.02} blendFunction={BlendFunction.OVERLAY} />

      {/* 
              Vignette: Darkens corners. 
              Becomes aggressive when damaged to simulate tunnel vision.
            */}
      <Vignette
        eskil={false}
        offset={0.1}
        darkness={0.5 + damageLevel * 0.4}
      />

      {/* 
              Chromatic Aberration: Simulates lens imperfection / trauma.
              Increases significantly when damaged.
            */}
      <ChromaticAberration
        offset={new Vector2(0.002 * (1 + damageLevel * 5), 0.002 * (1 + damageLevel * 5))}
        radialModulation={false}
        modulationOffset={0}
      />
    </EffectComposer>
  );
}
