export const RainVertexShader = `
uniform float uTime;
uniform float uSpeed;
uniform float uHeightRange;
uniform vec3 uCameraPos;

attribute vec3 aOffset; // Initial random position offset
attribute float aSpeed; // Per-drop speed variance

varying float vAlpha;

void main() {
    vec3 pos = position;
    
    // Apply instance offset
    vec3 instancePos = aOffset;
    
    // Animate Y position (falling)
    // We use a modulo approx for wrapping
    float fallDistance = (uTime * uSpeed * aSpeed);
    instancePos.y -= fallDistance;
    
    // Wrap within box height
    // Offset relative to camera for "infinite" rain
    float relY = instancePos.y - uCameraPos.y;
    float wrappedY = mod(relY, uHeightRange) - (uHeightRange * 0.5);
    instancePos.y = uCameraPos.y + wrappedY;
    
    // Wrap X/Z to follow camera (snap to grid to avoid jitter)
    vec3 wrapSize = vec3(40.0, uHeightRange, 40.0); // Rain box size
    
    vec3 relPos = instancePos - uCameraPos;
    relPos.x = mod(relPos.x, wrapSize.x) - wrapSize.x * 0.5;
    relPos.z = mod(relPos.z, wrapSize.z) - wrapSize.z * 0.5;
    
    vec3 finalPos = uCameraPos + relPos;
    
    // Stretch rain drop based on velocity
    pos.y *= (1.0 + uSpeed * 0.5);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos + pos, 1.0);
    
    // Fade out at bottom/top edges
    float distY = abs(wrappedY / (uHeightRange * 0.5));
    vAlpha = 1.0 - smoothstep(0.7, 1.0, distY);
}
`;

export const RainFragmentShader = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;

void main() {
    // Simple gradient streak or soft particle
    if (vAlpha <= 0.01) discard;
    gl_FragColor = vec4(uColor, uOpacity * vAlpha);
}
`;
