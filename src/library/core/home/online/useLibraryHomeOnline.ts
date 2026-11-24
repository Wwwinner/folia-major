import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryHomeCard, LibraryHomeResources } from '../homeModel.contract';
import { buildOnlineAlbumCards, buildOnlinePlaylistCards, buildOnlineRadioCards } from '../homeCards';
import {
    canBrowsePublicRadio,
    isOnlineHomeTab,
    onlineHomeTitleKey,
    resolveOnlineHomeLoading,
    resolveOnlineTabUnavailableReason,
    translateHomeMessage,
} from '../homeSources';
import { useLibraryHomeOnlineFeeds } from './useLibraryHomeOnlineFeeds';
import type { LibraryHomeSources } from '../useLibraryHomeSources';

// src/library/core/home/online/useLibraryHomeOnline.ts
// 在线页签的列表：账户歌单 / 收藏专辑 / 电台三份卡片（core/home/homeCards），当前页签的标题、加载态与
// 不可用原因。收藏专辑与电台来自宿主的首页资源（归属与读取见 useLibraryHomeOnlineFeeds）。

export type LibraryHomeOnlineList = {
    /** 当前在线页签的卡片（不在在线页签时为空）。 */
    items: LibraryHomeCard[];
    /** 此视图可显示原生列表；探索与账户提示由 suite 自己呈现。 */
    showList: boolean;
    title: string;
    isLoading: boolean;
    /** 列表为空时显示的文案：加载中、空结果或不可用原因。 */
    emptyMessage: string;
};

export const useLibraryHomeOnline = (
    resources: Pick<LibraryHomeResources, 'favoriteAlbums' | 'radioFeed'>,
    sources: Pick<LibraryHomeSources, 'tab' | 'online' | 'personalFmModeLabel'>,
): LibraryHomeOnlineList => {
    const { t } = useTranslation();
    const { tab, online, personalFmModeLabel } = sources;
    const accountlessRadio = tab === 'radio' && online.accountView === 'accountless' && online.canUseRadio;
    const publicRadio = canBrowsePublicRadio(online);
    const { favoriteAlbums, radioFeed } = useLibraryHomeOnlineFeeds({
        resources,
        tab,
        providerId: online.providerId,
        userId: online.user?.id ?? null,
        canUseAlbums: online.canUseAlbums,
        canUseRadio: online.canUseRadio,
        canBrowsePublicRadio: publicRadio,
    });
    const owner = radioFeed.owner;
    const radio = owner && owner.providerId === online.providerId
        && (publicRadio ? owner.userId === null : owner.userId !== null && String(owner.userId) === String(online.user?.id)) ? radioFeed : undefined;
    const radioData = radio?.data ?? null;

    const playlistCards = useMemo(() => buildOnlinePlaylistCards(online.collections, t), [online.collections, t]);
    const albumCards = useMemo(() => buildOnlineAlbumCards(favoriteAlbums.data, t), [favoriteAlbums.data, t]);
    const radioCards = useMemo(
        () => buildOnlineRadioCards(radioData, { t, personalFmModeLabel }),
        [personalFmModeLabel, radioData, t],
    );

    const items = tab === 'playlist' ? playlistCards : tab === 'albums' ? albumCards : tab === 'radio' ? radioCards : NO_CARDS;
    const onlineTab = isOnlineHomeTab(tab) ? tab : 'radio';
    const unavailable = resolveOnlineTabUnavailableReason(online, onlineTab);
    const unavailableRadio = accountlessRadio && !publicRadio
        ? t(online.provider?.availability.messageKey ?? 'libraryBravaisAccount.notConfigured') : undefined;
    return {
        items,
        showList: tab !== 'explore' && isOnlineHomeTab(tab) && (online.accountView === 'authenticated' || accountlessRadio),
        title: t(onlineHomeTitleKey(onlineTab)),
        isLoading: resolveOnlineHomeLoading({
            tab,
            source: online,
            favoriteAlbumsLoading: favoriteAlbums.status === 'loading',
            radioFeedLoading: radio?.status === 'loading',
        }),
        emptyMessage: unavailableRadio ?? (unavailable ? translateHomeMessage(t, unavailable)
            : tab === 'radio' && radio?.status === 'error' ? t('home.exploreFailed')
                : tab === 'radio' && radio?.status === 'ready' ? t('home.exploreEmpty') : t('home.loadingLibrary')),
    };
};

const NO_CARDS: LibraryHomeCard[] = [];
