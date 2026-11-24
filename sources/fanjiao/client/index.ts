import type { FoliumClientApi, FoliumCollection, FoliumSong } from '@folia/folium';
import { createFanjiaoHistory, latestResume } from './history';
import { createFanjiaoPlayer } from './player';
import { createFanjiaoRequest, createFanjiaoSource } from './provider';

// 在首个异步请求前登记；继续收听只走模组存储、公开 Omni 目录和宿主队列。
const SOURCE = 'fanjiao';

export default function activate(folium: FoliumClientApi) {
    const request = createFanjiaoRequest(folium);
    const history = createFanjiaoHistory(folium.storage, folium.log);
    let configured = false;
    let stopped = false;
    const isStopped = () => stopped;
    const player = createFanjiaoPlayer(folium, request, history);
    const source = folium.sources.register(createFanjiaoSource(folium, request, player, () => configured));
    if (folium.host.folium.minor >= 1) folium.registries.commands.register({
        id: 'continue-listening',
        label: {
            'zh-CN': '继续收听饭角', 'zh-TW': '繼續收聽飯角', en: 'Continue listening to Fanjiao',
            in: 'Lanjutkan mendengarkan Fanjiao', vi: 'Tiếp tục nghe Fanjiao',
        },
        run: () => continueListening(),
    });
    let showingFanjiao = false;
    folium.events.on('playback.songChanged', ({ song }) => {
        // The host also emits this for lyric and metadata updates to the displayed track.
        const wasShowing = showingFanjiao;
        showingFanjiao = song?.source === source.id;
        if (wasShowing && !showingFanjiao) player.dispose();
    });
    const page = typeof window === 'undefined' ? undefined : window;
    page?.addEventListener('pagehide', player.dispose);
    void request('status').then(({ configured: ready }) => {
        if (stopped || configured === ready) return;
        configured = ready;
        source.changed();
    }, (error: unknown) => {
        if (!stopped) folium.log.warn('[Fanjiao] Could not read source status', error);
    });

    async function albumTracks(collection: FoliumCollection): Promise<FoliumSong[]> {
        const songs: FoliumSong[] = [];
        let cursor: string | undefined;
        do {
            const result = await folium.omni.getTracks(collection, { cursor, limit: 100 });
            songs.push(...result.items);
            cursor = result.nextCursor ?? undefined;
        } while (cursor && songs.length < 5000);
        if (cursor) throw new Error('The saved album exceeds the playback queue limit');
        return songs;
    }

    async function continueListening(): Promise<void> {
        const expectedVersion = folium.playback.getQueue().version;
        try {
            const ready = (await request('status')).configured;
            if (stopped) return undefined;
            if (ready !== configured) {
                configured = ready;
                source.changed();
            }
            if (!ready) {
                folium.ui.toast(folium.i18n.text('notConfigured'), { type: 'error' });
                return;
            }
            const entry = latestResume(await history.list());
            if (isStopped()) return;
            if (!entry) {
                folium.ui.toast(folium.i18n.text('nothingToContinue'), { type: 'info' });
                return;
            }
            const collection = await folium.omni.resolveCollection({ source: SOURCE, kind: 'album', id: entry.albumId });
            if (isStopped()) return;
            if (!collection) throw new Error('The saved album was not found');
            const songs = await albumTracks(collection);
            if (isStopped()) return;
            const song = songs.find(item => item.id === entry.id);
            if (!song) throw new Error('The saved episode is no longer in its album');
            if (!(await folium.playback.playSongWithQueue(song, { queue: songs, expectedVersion, startAtSec: entry.position }))) {
                throw new Error('The playback queue or episode changed before playback could start');
            }
        } catch (error) {
            if (stopped) return;
            folium.log.warn('[Fanjiao] Could not continue listening', error);
            folium.ui.toast(folium.i18n.text('playbackFailed'), { type: 'error' });
        }
    }

    return () => {
        stopped = true;
        page?.removeEventListener('pagehide', player.dispose);
        player.dispose();
    };
}
