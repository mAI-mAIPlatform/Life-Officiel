import React, { useRef, useLayoutEffect, useImperativeHandle, forwardRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type VFXType = 'impact' | 'muzzle' | 'blood' | 'smoke';

export interface VFXEvent {
    type: VFXType;
    position: THREE.Vector3;
    normal?: THREE.Vector3;
    count?: number;
}

export interface VFXSystemHandle {
    trigger: (event: VFXEvent) => void;
}

/**
 * GPU Instanced Particle System
 * Allocates a fixed pool of particles to avoid GC.
 */
export const VFXSystem = forwardRef<VFXSystemHandle, {}>((props, ref) => {

    // ── Configuration ──
    const MAX_PARTICLES = 2000;

    // ── State ──
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const dummy = new THREE.Object3D();

    // Data Arrays
    // [Active(1/0), Age, Life, Scale]
    const dataRef = useRef(new Float32Array(MAX_PARTICLES * 4));
    // [Vx, Vy, Vz, Gravity]
    const velocityRef = useRef(new Float32Array(MAX_PARTICLES * 4));
    // Color [R, G, B] - could be per instance or texture atlas
    const colorRef = useRef(new Float32Array(MAX_PARTICLES * 3));

    // Tracks next free index
    const cursor = useRef(0);

    // ── Interface ──
    useImperativeHandle(ref, () => ({
        trigger: (e: VFXEvent) => {
            const count = e.count ?? 10;

            for (let i = 0; i < count; i++) {
                const idx = cursor.current;
                cursor.current = (cursor.current + 1) % MAX_PARTICLES;

                // Init Particle

                // Position
                dummy.position.copy(e.position);
                // Random spread
                dummy.position.add(new THREE.Vector3(
                    (Math.random() - 0.5) * 0.2,
                    (Math.random() - 0.5) * 0.2,
                    (Math.random() - 0.5) * 0.2
                ));
                dummy.scale.setScalar(0.0); // Start small
                dummy.updateMatrix();
                meshRef.current?.setMatrixAt(idx, dummy.matrix);

                // Velocity
                const speed = 2.0 + Math.random() * 4.0;
                let dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();

                if (e.normal) {
                    // Bias toward normal
                    dir.add(e.normal).normalize();
                }

                velocityRef.current[idx * 4 + 0] = dir.x * speed;
                velocityRef.current[idx * 4 + 1] = dir.y * speed;
                velocityRef.current[idx * 4 + 2] = dir.z * speed;
                velocityRef.current[idx * 4 + 3] = e.type === 'smoke' ? -0.5 : 9.8; // Gravity/Buoyancy

                // Lifecycle
                const life = 0.5 + Math.random() * 0.5;
                dataRef.current[idx * 4 + 0] = 1; // Active
                dataRef.current[idx * 4 + 1] = 0; // Age
                dataRef.current[idx * 4 + 2] = life;
                dataRef.current[idx * 4 + 3] = 0.1 + Math.random() * 0.1; // Max Scale

                // Color
                if (e.type === 'blood') {
                    colorRef.current[idx * 3 + 0] = 0.8;
                    colorRef.current[idx * 3 + 1] = 0.0;
                    colorRef.current[idx * 3 + 2] = 0.0;
                } else if (e.type === 'smoke') {
                    const g = 0.5 + Math.random() * 0.3;
                    colorRef.current[idx * 3 + 0] = g;
                    colorRef.current[idx * 3 + 1] = g;
                    colorRef.current[idx * 3 + 2] = g;
                } else {
                    // Sparks (impact)
                    colorRef.current[idx * 3 + 0] = 1.0;
                    colorRef.current[idx * 3 + 1] = 0.8;
                    colorRef.current[idx * 3 + 2] = 0.2;
                }

                if (meshRef.current) {
                    meshRef.current.setColorAt(idx, new THREE.Color(
                        colorRef.current[idx * 3],
                        colorRef.current[idx * 3 + 1],
                        colorRef.current[idx * 3 + 2]
                    ));
                }
            }

            if (meshRef.current) {
                meshRef.current.instanceMatrix.needsUpdate = true;
                if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
            }
        }
    }));

    // ── Loop ──
    useFrame((state, delta) => {
        if (!meshRef.current) return;

        let dirty = false;

        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (dataRef.current[i * 4 + 0] === 0) continue; // Inactive

            // Update Age
            dataRef.current[i * 4 + 1] += delta;
            const age = dataRef.current[i * 4 + 1];
            const life = dataRef.current[i * 4 + 2];

            if (age >= life) {
                dataRef.current[i * 4 + 0] = 0; // Kill
                // HACK: scale to 0 to hide
                meshRef.current.getMatrixAt(i, dummy.matrix);
                dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
                dummy.scale.setScalar(0);
                dummy.updateMatrix();
                meshRef.current.setMatrixAt(i, dummy.matrix);
                dirty = true;
                continue;
            }

            // Physics
            const vx = velocityRef.current[i * 4 + 0];
            const vy = velocityRef.current[i * 4 + 1];
            const vz = velocityRef.current[i * 4 + 2];
            const grav = velocityRef.current[i * 4 + 3];

            // Get current pos
            meshRef.current.getMatrixAt(i, dummy.matrix);
            dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);

            dummy.position.x += vx * delta;
            dummy.position.y += (vy - grav * age) * delta; // Simple gravity integration
            dummy.position.z += vz * delta;

            // Scale animation (pop in, fade out)
            const targetScale = dataRef.current[i * 4 + 3];
            const lifeRatio = age / life;
            let s = targetScale;
            if (lifeRatio < 0.1) s = targetScale * (lifeRatio / 0.1);
            else if (lifeRatio > 0.8) s = targetScale * (1.0 - (lifeRatio - 0.8) / 0.2);

            dummy.scale.setScalar(s);
            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);
            dirty = true;
        }

        if (dirty) {
            meshRef.current.instanceMatrix.needsUpdate = true;
        }
    });

    return (
        <instancedMesh
            ref={meshRef}
            args={[undefined, undefined, MAX_PARTICLES]}
            frustumCulled={false}
        >
            <boxGeometry args={[0.05, 0.05, 0.05]} />
            <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
    );
});

VFXSystem.displayName = 'VFXSystem';
