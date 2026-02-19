/**
 * @fileoverview LIFE RPG — Daltonism (Color Blindness) Correction Filter
 * Injects an invisible SVG with a named feColorMatrix filter.
 * Applied as a CSS filter on #root via useSettingsStore.
 */
import { useEffect } from 'react';
import { useSettingsStore, DALTONISM_MATRICES } from '../store/useSettingsStore';

const FILTER_ID = 'daltonism-correction';

export default function DaltonismFilter() {
    const { daltonism, uiScale, reduceMotion } = useSettingsStore();

    useEffect(() => {
        const root = document.getElementById('root');
        if (!root) return;

        if (daltonism === 'none') {
            root.style.filter = 'none';
        } else {
            root.style.filter = `url(#${FILTER_ID})`;
        }
    }, [daltonism]);

    useEffect(() => {
        const root = document.getElementById('root');
        if (!root) return;
        root.style.fontSize = `${uiScale * 16}px`;
    }, [uiScale]);

    useEffect(() => {
        document.documentElement.classList.toggle('reduce-motion', reduceMotion);
    }, [reduceMotion]);

    if (daltonism === 'none') return null;

    const matrix = DALTONISM_MATRICES[daltonism];

    return (
        <svg
            style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
            aria-hidden="true"
        >
            <defs>
                <filter id={FILTER_ID} colorInterpolationFilters="linearRGB">
                    <feColorMatrix
                        type="matrix"
                        values={matrix}
                    />
                </filter>
            </defs>
        </svg>
    );
}
