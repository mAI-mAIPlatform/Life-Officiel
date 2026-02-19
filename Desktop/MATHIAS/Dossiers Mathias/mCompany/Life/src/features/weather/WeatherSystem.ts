import { create } from 'zustand';

export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

export interface WeatherState {
    /** Game time in hours (0.0 - 24.0) */
    timeOfDay: number;
    /** Speed of time progression (game hours per real second) */
    timeScale: number;

    condition: WeatherCondition;

    /** 0.0 to 1.0 */
    cloudCover: number;
    rainIntensity: number;
    fogDensity: number;

    /** Actions */
    setTime: (hour: number) => void;
    setCondition: (condition: WeatherCondition) => void;
    advanceTime: (deltaTime: number) => void;
}

export const useWeatherStore = create<WeatherState>((set) => ({
    timeOfDay: 12.0, // Start at noon
    timeScale: 0.05, // 1 real sec = 0.05 game hours (~20 min day)

    condition: 'clear',
    cloudCover: 0,
    rainIntensity: 0,
    fogDensity: 0.002, // Base atmospheric perspective

    setTime: (hour) => set({ timeOfDay: hour % 24 }),

    setCondition: (condition) => set((state) => {
        let targetClouds = 0;
        let targetRain = 0;
        let targetFog = 0.002;

        switch (condition) {
            case 'clear':
                targetClouds = 0.1;
                targetRain = 0;
                targetFog = 0.002;
                break;
            case 'cloudy':
                targetClouds = 0.8;
                targetRain = 0;
                targetFog = 0.005;
                break;
            case 'rain':
                targetClouds = 1.0;
                targetRain = 0.6;
                targetFog = 0.02;
                break;
            case 'storm':
                targetClouds = 1.0;
                targetRain = 1.0;
                targetFog = 0.04;
                break;
            case 'fog':
                targetClouds = 0.4;
                targetRain = 0;
                targetFog = 0.08;
                break;
        }

        return {
            condition,
            cloudCover: targetClouds,
            rainIntensity: targetRain,
            fogDensity: targetFog
        };
    }),

    advanceTime: (deltaTime) => set((state) => ({
        timeOfDay: (state.timeOfDay + deltaTime * state.timeScale) % 24
    }))
}));
