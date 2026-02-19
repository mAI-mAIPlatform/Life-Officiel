import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { useWeatherStore } from './WeatherSystem';
import { RainVertexShader, RainFragmentShader } from './shaders/rain';

const DAY_COLOR = new THREE.Color('#ffffff');
const NOON_COLOR = new THREE.Color('#fffee0');
const SUNSET_COLOR = new THREE.Color('#ffaa44');
const NIGHT_COLOR = new THREE.Color('#0a0c14');
const AMBIENT_DAY = 0.6;
const AMBIENT_NIGHT = 0.1;

export function WeatherRenderer() {
    const { timeOfDay, advanceTime, condition, rainIntensity } = useWeatherStore();
    const { scene, camera } = useThree();

    // Refs for lights
    const sunRef = useRef<THREE.DirectionalLight>(null);
    const ambientRef = useRef<THREE.AmbientLight>(null);

    // Rain Instanced Mesh
    const rainRef = useRef<THREE.InstancedMesh>(null);
    const RAIN_COUNT = 5000;

    // Update Logic
    useFrame((state, delta) => {
        advanceTime(delta);

        // --- Day/Night Cycle ---
        // 0 = Midnight, 6 = Dawn, 12 = Noon, 18 = Dusk
        const time = timeOfDay;

        // Sun Angle
        // Need sun to rise in East, set in West
        // 6AM -> X+, 12 -> Y+, 18 -> X- (simplified)
        const angle = ((time - 6) / 24) * Math.PI * 2;
        const sunX = Math.cos(timeOfDay / 24 * Math.PI * 2 - Math.PI / 2) * 100;
        const sunY = Math.sin(timeOfDay / 24 * Math.PI * 2 - Math.PI / 2) * 100;
        const sunZ = 20; // slight offset

        if (sunRef.current) {
            sunRef.current.position.set(sunX, sunY, sunZ);
            sunRef.current.intensity = Math.max(0, sunY / 100) * 2.0;
        }

        // Sky/Ambient Color
        let targetColor = NIGHT_COLOR;
        let ambientInt = AMBIENT_NIGHT;

        if (time > 5 && time < 8) { // Dawn
            const t = (time - 5) / 3;
            targetColor = new THREE.Color().lerpColors(NIGHT_COLOR, SUNSET_COLOR, t);
            ambientInt = THREE.MathUtils.lerp(AMBIENT_NIGHT, 0.4, t);
        } else if (time >= 8 && time < 16) { // Day
            const t = (time - 8) / 4;
            // transition to noon color then back? simplified
            targetColor = DAY_COLOR;
            ambientInt = AMBIENT_DAY;
        } else if (time >= 16 && time < 20) { // Dusk
            const t = (time - 16) / 4;
            targetColor = new THREE.Color().lerpColors(DAY_COLOR, SUNSET_COLOR, t);
            ambientInt = THREE.MathUtils.lerp(AMBIENT_DAY, 0.3, t);
        } else if (time >= 20) { // Night
            const t = (time - 20) / 4;
            targetColor = new THREE.Color().lerpColors(SUNSET_COLOR, NIGHT_COLOR, t);
            ambientInt = AMBIENT_NIGHT;
        }

        scene.background = targetColor;
        scene.fog = new THREE.FogExp2(targetColor.getHex(), useWeatherStore.getState().fogDensity);
        if (ambientRef.current) {
            ambientRef.current.color = targetColor;
            ambientRef.current.intensity = ambientInt;
        }

        // --- Rain Update ---
        if (rainRef.current && rainRef.current.material instanceof THREE.ShaderMaterial) {
            rainRef.current.visible = rainIntensity > 0;
            if (rainIntensity > 0) {
                rainRef.current.material.uniforms.uTime.value = state.clock.elapsedTime;
                rainRef.current.material.uniforms.uCameraPos.value.copy(camera.position);
                rainRef.current.material.uniforms.uOpacity.value = rainIntensity * 0.8;
            }
        }
    });

    // Rain Particles Setup
    const rainGeo = useMemo(() => new THREE.PlaneGeometry(0.05, 1), []);
    const rainMat = useMemo(() => new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uSpeed: { value: 20.0 },
            uHeightRange: { value: 30.0 },
            uCameraPos: { value: new THREE.Vector3() },
            uColor: { value: new THREE.Color('#aaddff') },
            uOpacity: { value: 0.0 }
        },
        vertexShader: RainVertexShader,
        fragmentShader: RainFragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    }), []);

    // Init Rain Instances
    useEffect(() => {
        if (rainRef.current) {
            const dummy = new THREE.Object3D();
            const offsets = new Float32Array(RAIN_COUNT * 3);
            const speeds = new Float32Array(RAIN_COUNT);

            for (let i = 0; i < RAIN_COUNT; i++) {
                // Random position in a box
                offsets[i * 3 + 0] = (Math.random() - 0.5) * 40;
                offsets[i * 3 + 1] = (Math.random() - 0.5) * 30; // Y offset initial
                offsets[i * 3 + 2] = (Math.random() - 0.5) * 40;
                speeds[i] = 0.5 + Math.random() * 0.5;

                dummy.position.set(0, 0, 0);
                dummy.updateMatrix();
                rainRef.current.setMatrixAt(i, dummy.matrix);
            }

            rainRef.current.geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
            rainRef.current.geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
            rainRef.current.instanceMatrix.needsUpdate = true;
        }
    }, []);

    return (
        <>
            <ambientLight ref={ambientRef} intensity={0.2} />
            <directionalLight
                ref={sunRef}
                position={[50, 50, 20]}
                castShadow
                shadow-mapSize={[2048, 2048]}
            />

            <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />

            {/* Rain Instances */}
            <instancedMesh
                ref={rainRef}
                args={[rainGeo, rainMat, RAIN_COUNT]}
                renderOrder={1000} // Render last-ish
            />
        </>
    );
}
