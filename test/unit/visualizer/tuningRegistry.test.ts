import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIORAMA_TUNING, DEFAULT_SONNET_TUNING, DEFAULT_MONET_TUNING } from '../../../src/types';
import type { VisualizerSharedProps } from '../../../src/components/visualizer/definition';
import {
    applyVisualizerTuningsToSettings,
    applyVisualizerTuning,
    collectVisualizerTunings,
    getVisualizerTuningModes,
} from '../../../src/components/visualizer/tuningRegistry';

// Verifies that mode-local tuning adapters are auto-discovered for transport and settings bridges.
describe('visualizer tuning registry', () => {
    it('uses the same Monet tuning for the whole-line Dialogue mode without another storage key', () => {
        const tuning = { ...DEFAULT_MONET_TUNING, fontScale: 1.8 };
        const props = {} as VisualizerSharedProps;
        expect(applyVisualizerTuning('dialogue', props, { monet: tuning }).monetTuning).toEqual(tuning);
        expect(applyVisualizerTuning('monet', props, { monet: tuning }).monetTuning).toEqual(tuning);
        expect(getVisualizerTuningModes()).not.toContain('dialogue');
    });
    it('auto-discovers every mode with dedicated tuning', () => {
        expect(getVisualizerTuningModes().sort()).toEqual([
            'cadenza',
            'cappella',
            'claddagh',
            'classic',
            'diorama',
            'fume',
            'lumiere',
            'monet',
            'partita',
            'pendolo',
            'sonnet',
            'tempera',
            'tilt',
        ]);
    });

    it('collects and applies Diorama tuning through its discovered adapter', () => {
        const handleSetDioramaTuning = vi.fn();
        const settings = {
            dioramaTuning: DEFAULT_DIORAMA_TUNING,
            handleSetDioramaTuning,
        };

        expect(collectVisualizerTunings(settings).diorama).toEqual(DEFAULT_DIORAMA_TUNING);
        applyVisualizerTuningsToSettings(settings, { diorama: DEFAULT_DIORAMA_TUNING });
        expect(handleSetDioramaTuning).toHaveBeenCalledWith(DEFAULT_DIORAMA_TUNING);
    });

    it('collects and applies Sonnet tuning through its discovered adapter', () => {
        const handleSetSonnetTuning = vi.fn();
        const settings = {
            sonnetTuning: DEFAULT_SONNET_TUNING,
            handleSetSonnetTuning,
        };

        expect(collectVisualizerTunings(settings).sonnet).toEqual(DEFAULT_SONNET_TUNING);
        applyVisualizerTuningsToSettings(settings, { sonnet: DEFAULT_SONNET_TUNING });
        expect(handleSetSonnetTuning).toHaveBeenCalledWith(DEFAULT_SONNET_TUNING);
    });
});
