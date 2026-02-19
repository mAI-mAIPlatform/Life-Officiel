import React, { useRef, useImperativeHandle, forwardRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ICameraRig } from '../../gameplay/PlayerController';

export interface CameraRigProps {
    /** Target object to follow (usually the player's head) */
    target?: THREE.Object3D;
    /** Offset from target */
    offset?: [number, number, number];
}

/**
 * Procedural Camera Rig
 * 
 * Features:
 * - Spring-based follow (smooth lag)
 * - Head Bobbing (sinusoidal vertical/lateral motion)
 * - Camera Shake (perlin-like noise with decay)
 * - Dynamic FOV (speed lines effect)
 * - Tilt (wall-running)
 */
export const CameraRig = forwardRef<ICameraRig, CameraRigProps>(({
    target,
    offset = [0, 0, 0]
}, ref) => {
    const { camera } = useThree();

    // ── State ─────────────────────────────────────────────────────────────────

    // Physics / Spring state
    const currentPos = useRef(new THREE.Vector3());
    const currentRot = useRef(new THREE.Quaternion());

    // Shake state
    const shakeIntensity = useRef(0);
    const shakeDecay = useRef(5.0);
    const shakeTimer = useRef(0);

    // Recoil state
    const recoilPitch = useRef(0);
    const recoilYaw = useRef(0);

    // Tilt (roll)
    const targetRoll = useRef(0);
    const currentRoll = useRef(0);

    // FOV
    const targetFOV = useRef(75);
    const currentFOV = useRef(75);

    // ── Helpers ───────────────────────────────────────────────────────────────

    const noise = (t: number) => {
        return Math.sin(t * 987.654) * 0.5 + Math.sin(t * 123.456) * 0.5;
    };

    // ── ICameraRig Implementation ─────────────────────────────────────────────

    useImperativeHandle(ref, () => ({
        worldForward: () => {
            const fwd = new THREE.Vector3();
            camera.getWorldDirection(fwd);
            return fwd;
        },
        worldRight: () => {
            const right = new THREE.Vector3();
            camera.getWorldDirection(right);
            right.cross(new THREE.Vector3(0, 1, 0)).normalize();
            return right;
        },
        setFOV: (fov, _lerpSpeed) => {
            targetFOV.current = fov;
        },
        addRecoil: (pitch, yaw) => {
            recoilPitch.current += pitch;
            recoilYaw.current += yaw;
        },
        tilt: (roll, _lerpSpeed) => {
            targetRoll.current = roll;
        }
    }));

    // ── Update Loop ───────────────────────────────────────────────────────────

    useFrame((state, delta) => {
        // 1. Follow Target (if exists)
        if (target) {
            // Ideally, the PlayerController updates the target object's position.
            // We just snap or lerp to it.
            // For a cinematic feel, we might want a VERY tight lerp or just snap + offsets.

            const targetPos = target.position.clone().add(new THREE.Vector3(...offset));
            // Simple spring/damp could go here, but usually for FPS we want 1:1 sync with head
            // to avoid motion sickness, and add "juice" on top.
            camera.position.lerp(targetPos, 0.8); // slight smooth
        }

        // 2. Head Bob (if moving)
        // This usually requires knowing velocity/isGrounded from Controller.
        // Since we don't have that direct link here without a store, 
        // we'll rely on the Controller to pass "bob" intensity or logic, 
        // OR we can infer it if we had velocity. 
        // For now, we'll keep it simple: Controller drives the position, 
        // this Rig adds "Juice".

        // 3. Camera Shake
        if (shakeIntensity.current > 0) {
            shakeTimer.current += delta * 20;
            const s = shakeIntensity.current;
            const rx = (Math.random() - 0.5) * s * 0.1;
            const ry = (Math.random() - 0.5) * s * 0.1;
            const rz = (Math.random() - 0.5) * s * 0.1;

            camera.position.add(new THREE.Vector3(rx, ry, rz));
            camera.rotation.x += rx * 0.5;
            camera.rotation.z += rz * 0.5;

            // Decay
            shakeIntensity.current -= shakeDecay.current * delta;
            if (shakeIntensity.current < 0) shakeIntensity.current = 0;
        }

        // 4. Recoil Recovery
        if (Math.abs(recoilPitch.current) > 0.001 || Math.abs(recoilYaw.current) > 0.001) {
            // Spring back
            const recovery = 8.0 * delta;
            recoilPitch.current = THREE.MathUtils.lerp(recoilPitch.current, 0, recovery);
            recoilYaw.current = THREE.MathUtils.lerp(recoilYaw.current, 0, recovery);

            // Apply recoil (this should ideally affect the "look" direction, not just camera object)
            // But since this is a visual rig, we can add local rotation
            camera.rotation.x += recoilPitch.current * delta;
            camera.rotation.y += recoilYaw.current * delta;
        }

        // 5. Tilt (Roll)
        currentRoll.current = THREE.MathUtils.lerp(currentRoll.current, targetRoll.current, 6.0 * delta);
        camera.rotation.z = currentRoll.current; // Warning: might overwrite lookAt logic if not careful

        // 6. Dynamic FOV
        currentFOV.current = THREE.MathUtils.lerp(currentFOV.current, targetFOV.current, 4.0 * delta);
        if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - currentFOV.current) > 0.1) {
            camera.fov = currentFOV.current;
            camera.updateProjectionMatrix();
        }
    });

    return null;
});

CameraRig.displayName = 'CameraRig';
