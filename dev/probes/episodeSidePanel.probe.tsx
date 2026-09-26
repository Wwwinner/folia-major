import React, { useState } from 'react';
import type { SongResult } from '../../src/types';
import { SidePanelList } from '../../src/components/shared/SidePanelList';
import EpisodeTrackRow from '../../src/components/app/playback/EpisodeTrackRow';
import EpisodeListLayoutButton from '../../src/components/app/playback/EpisodeListLayoutButton';
import type { ProbeDefinition } from './definition';

// 分集侧栏探针：奇数集数与末尾焦点覆盖双列虚拟行的边界，不请求或播放媒体。
const tracks: SongResult[] = Array.from({ length: 51 }, (_, index) => ({
    id: String(index + 1), name: `第${index + 1}集 · 一段很长的广播剧分集标题`,
    artists: [], album: { id: 'probe', name: '分集布局' }, durationMs: 1800000,
    sourceRef: { kind: 'online', providerId: 'fanjiao', mediaId: String(index + 1) },
    episode: { kind: 'main', playCount: 28177 },
}));

function EpisodeSidePanelProbe() {
    const [columns, setColumns] = useState<1 | 2>(1);
    const [focusedIndex, setFocusedIndex] = useState(50);
    const [selected, setSelected] = useState('');
    const [isOpen, setIsOpen] = useState(true);
    return <div className="relative h-screen" data-probe-selected={selected}>
        <SidePanelList isOpen={isOpen} onClose={() => setIsOpen(false)} title="分集布局"
            items={tracks} columns={columns} itemHeight={76}
            isDaylight={false} focusedIndex={focusedIndex}
            headerActions={<EpisodeListLayoutButton columns={columns} onChange={setColumns} />}
            renderItem={(track, index, style) => <EpisodeTrackRow track={track} style={style}
                active={index === focusedIndex}
                onPlay={() => { setSelected(String(track.id)); setFocusedIndex(index); }} />} />
    </div>;
}

const definition: ProbeDefinition = {
    id: 'episodeSidePanel', title: '广播剧 · 单列与双列分集',
    description: '验证虚拟列表末行、焦点定位、点击身份和窄屏长标题。', Component: EpisodeSidePanelProbe,
};
export default definition;
