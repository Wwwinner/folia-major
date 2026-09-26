import { describe, expect, it } from 'vitest';
import { homeSectionsDto } from '../../../electron/fanjiao/discovery.mjs';

// 横幅只输出图片与已核验的专辑身份，禁止将上游路由、外链及授权字段传给界面。
const banner = { banner_id: 4205, title: 'Drama campaign', album_id: 0, type: 'album',
    cover: 'https://example.com/banner.png', extras: { path: '/index/drama_info', params: { album_id: 111734 } }, play_auth: 'private-value' };
const normalize = (list: unknown[], style = 2) => homeSectionsDto({
    list: [{ modular_name: 'Banner', type: 1, modular_style: style, list }],
    paging: { page: 1, page_size: 20, total: 22 },
}, { page: 1, limit: 20, offset: 0 });

describe('Fanjiao homepage banners', () => {
    it('preserves campaign order and resolves album identity from extras or encoded link', () => {
        const page = normalize([banner, { ...banner, banner_id: 4206, extras: undefined,
            link: JSON.stringify({ path: '/index/drama_info', params: { album_id: 111735 } }) }]);
        expect(page).toMatchObject({ total: 22, hasMore: true, nextOffset: 20, items: [{ kind: 'banners', items: [], banners: [
            { id: '4205', title: 'Drama campaign', imageUrl: banner.cover, album: { id: '111734', coverUrl: '' } },
            { id: '4206', album: { id: '111735', coverUrl: '' } },
        ] }] });
        const encoded = JSON.stringify(page);
        expect(encoded).not.toContain('private-value');
        expect(encoded).not.toContain('/index/drama_info');
        expect(encoded).not.toContain('extras');
    });
    it.each([
        { type: 'web' }, { banner_id: '../route' }, { extras: { path: '/index/user', params: { album_id: 111734 } } },
        { extras: { path: '/index/drama_info', params: { album_id: 0 } } }, { extras: undefined, link: '{invalid' },
        { cover: 'javascript:alert(1)' }, { cover: 'file:///private' }, { cover: 'http://example.com/image.png' },
        { cover: 'https://user:password@example.com/image.png' },
    ])('filters unsupported or malformed banner metadata: %j', overrides => {
        expect(normalize([{ ...banner, ...overrides }]).items).toEqual([]);
    });
    it('keeps the secondary promotional module out of the main banner slot', () => {
        expect(normalize([banner], 11).items).toEqual([]);
    });
});
