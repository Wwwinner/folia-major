import { useEffect, useState, type CSSProperties } from 'react';
import FanjiaoSyncSettings from '../../src/components/modal/settings/FanjiaoSyncSettings';
import EpisodeHistoryPage from '../../src/components/app/home/EpisodeHistoryPage';
import { getSyncConfig, saveSyncConfig, subscribeSyncConfig } from '../../src/services/sync/syncConfig';
import type { ProbeDefinition } from './definition';

// Exercises real sync settings and history deletion in StrictMode without requesting media.
function FanjiaoSyncProbe() {
    const [config, setConfig] = useState(getSyncConfig);
    const [history, setHistory] = useState(false);
    useEffect(() => subscribeSyncConfig(() => setConfig(getSyncConfig())), []);
    return <div className="flex h-screen flex-col gap-5 bg-neutral-950 p-6 text-neutral-100"
        style={{ '--text-primary': '#f5f5f5', '--text-secondary': '#a3a3a3' } as CSSProperties}>
        <div className="flex gap-4"><button onClick={() => setHistory(false)}>Sync settings</button><button onClick={() => setHistory(true)}>Listening history</button></div>
        {history ? <EpisodeHistoryPage providerId="fanjiao" isDaylight={false} onPlay={() => {}} onOpen={() => {}} />
            : <div className="w-full max-w-xl space-y-4"><FanjiaoSyncSettings config={config} busy={false}
                onChange={patch => setConfig(previous => ({ ...previous, ...patch }))} onSave={() => saveSyncConfig(config)} />
                <button onClick={() => saveSyncConfig(config)}>Save choices</button></div>}
    </div>;
}
const definition: ProbeDefinition = { id: 'fanjiaoSync', title: 'Fanjiao optional sync', description: 'Manual category sync and history deletion.', Component: FanjiaoSyncProbe };
export default definition;
