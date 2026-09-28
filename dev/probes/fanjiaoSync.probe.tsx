import { useState, type CSSProperties } from 'react';
import StorageSettingsSection from '../../src/components/modal/settings/StorageSettingsSection';
import EpisodeHistoryPage from '../../src/components/app/home/EpisodeHistoryPage';
import type { ProbeDefinition } from './definition';

// Exercises real sync settings and history deletion in StrictMode without requesting media.
function FanjiaoSyncProbe() {
    const [history, setHistory] = useState(false);
    return <div className="flex min-h-screen flex-col gap-5 bg-neutral-950 p-6 text-neutral-100"
        style={{ '--text-primary': '#f5f5f5', '--text-secondary': '#a3a3a3' } as CSSProperties}>
        <div className="flex gap-4"><button onClick={() => setHistory(false)}>Sync settings</button><button onClick={() => setHistory(true)}>Listening history</button></div>
        {history ? <EpisodeHistoryPage providerId="fanjiao" isDaylight={false} onPlay={() => {}} onOpen={() => {}} />
            : <div className="w-full max-w-3xl space-y-4"><StorageSettingsSection cacheDirectory="" cacheDirectoryIsDefault cacheDirectoryStatus="idle"
                cacheSizes={{ playlist: '0 B', lyrics: '0 B', cover: '0 B', media: '0 B', analysis: '0 B' }}
                enableMediaCache={false} errorTextColor="text-red-400" isCleaning={null} isElectron={false} mediaCacheLimitGb={1} mediaCount={0}
                onChooseCacheDirectory={() => {}} onClear={() => {}} onClearAll={() => {}} onSetMediaCacheLimitGb={() => {}} onToggleMediaCache={() => {}}
                settingsCardClass="border-white/10" toggleOffBackgroundClass="bg-white/10" /></div>}
    </div>;
}
const definition: ProbeDefinition = { id: 'fanjiaoSync', title: 'Fanjiao sync', description: 'Manual history sync and history deletion.', Component: FanjiaoSyncProbe };
export default definition;
