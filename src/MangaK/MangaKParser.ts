import {
    Chapter,
    HomeSection,
    HomeSectionType,
    PartialSourceManga,
    SourceManga,
    TagSection
} from '@paperback/types'

import { decode as decodeHTMLEntity } from 'html-entities'

export const BASE_URL = 'https://mangak.io'
export const API_URL = `${BASE_URL}/api`
export const API_DOMAIN_URL = 'https://api.mangak.io'

interface MangaKItem {
    slug: string
    name: string
    cover: string
    latestChapters?: { slug: string; name?: string; chapter_number?: number }[]
    displayUpdatedShort?: string
    displayRating?: string
    displayViews?: string
}

interface MangaKApiSearchItem {
    slug: string
    name?: string
    cover?: string
    status?: string
    latest_chapters?: { slug?: string; name?: string; chapter_number?: number }[]
}

interface MangaKPagination {
    page: number
    has_next: boolean
}

interface MangaKChapter {
    slug: string
    name?: string
    chapterNumber?: number
    chapter_number?: number
    updatedAt?: string
    updated_at?: string
}

interface MangaKManga {
    id: number | string
    name: string
    altNames?: { name: string }[]
    cover?: string
    status?: string
    summary?: string
    genres?: { slug: string; name: string }[]
    tags?: { slug: string; name: string }[]
    formats?: { slug: string; name: string }[]
    type?: { slug: string; name: string }
    contentRating?: string
    authors?: { name: string }[]
    artists?: { name: string }[]
    chapters?: MangaKChapter[]
}

export interface HomeResponse {
    pageProps: {
        heroItems: MangaKItem[]
        trendingItems: MangaKItem[]
        popularItems: MangaKItem[]
        latest: { items: MangaKItem[] }
    }
}

export interface LatestResponse {
    pageProps: {
        items: MangaKItem[]
    }
}

export interface TrendingResponse {
    pageProps: {
        initialItems: MangaKItem[]
    }
}

export interface MangaResponse {
    pageProps: {
        initialManga: MangaKManga
    }
}

export interface ChapterResponse {
    pageProps: {
        initialChapter: { slug: string; images: string[] }
    }
}

export interface ChaptersListResponse {
    success?: boolean
    data?: { chapters: MangaKChapter[] }
}

export interface SearchResponse {
    success?: boolean
    message?: string
    data?: { items?: MangaKApiSearchItem[]; pagination?: MangaKPagination }
}

const toPartial = (item: MangaKItem, subtitle?: string): PartialSourceManga =>
    App.createPartialSourceManga({
        mangaId: item.slug,
        title: decodeHTMLEntity(item.name ?? ''),
        image: item.cover ?? '',
        subtitle
    })

const latestChapterLabel = (item: MangaKItem): string | undefined => {
    const ch = item.latestChapters?.[0]
    if (!ch) return item.displayUpdatedShort
    const num = ch.chapter_number ?? ch.slug.split('-')[1]
    return num !== undefined ? `Ch. ${num}` : ch.name
}

export const parseHero = (data: HomeResponse['pageProps']): PartialSourceManga[] =>
    data.heroItems.map((i) => toPartial(i))

export const parseTrending = (data: HomeResponse['pageProps']): PartialSourceManga[] =>
    data.trendingItems.map((i) =>
        toPartial(
            i,
            [i.displayRating && `⭐ ${i.displayRating}`, i.displayViews && `🔥 ${i.displayViews}`]
                .filter(Boolean)
                .join(' ')
        )
    )

export const parsePopular = (data: HomeResponse['pageProps']): PartialSourceManga[] =>
    data.popularItems.map((i) => toPartial(i, i.displayUpdatedShort))

export const parseLatestItems = (items: MangaKItem[]): PartialSourceManga[] =>
    items.map((i) => toPartial(i, latestChapterLabel(i)))

export const buildHomeSections = (): Record<
    'hero' | 'trending' | 'popular' | 'latest',
    {
        section: HomeSection
        extract: (props: HomeResponse['pageProps']) => PartialSourceManga[]
        viewMore: boolean
    }
> => ({
    hero: {
        section: App.createHomeSection({
            id: 'hero',
            title: 'Hot This Week',
            type: HomeSectionType.featured,
            containsMoreItems: false
        }),
        extract: parseHero,
        viewMore: false
    },
    trending: {
        section: App.createHomeSection({
            id: 'trending',
            title: 'Trending Today',
            type: HomeSectionType.singleRowNormal,
            containsMoreItems: true
        }),
        extract: parseTrending,
        viewMore: true
    },
    popular: {
        section: App.createHomeSection({
            id: 'popular',
            title: 'Popular Updates',
            type: HomeSectionType.singleRowNormal,
            containsMoreItems: false
        }),
        extract: parsePopular,
        viewMore: false
    },
    latest: {
        section: App.createHomeSection({
            id: 'latest',
            title: 'Recently Updated',
            type: HomeSectionType.singleRowNormal,
            containsMoreItems: true
        }),
        extract: (p) => parseLatestItems(p.latest.items),
        viewMore: true
    }
})

const normalizeStatus = (status: string | undefined): string => {
    const s = (status ?? '').toLowerCase()
    if (s.includes('ongoing')) return 'Ongoing'
    if (s.includes('completed')) return 'Completed'
    if (s.includes('hiatus')) return 'Hiatus'
    if (s.includes('cancel')) return 'Cancelled'
    return 'Unknown'
}

export const parseMangaDetails = (manga: MangaKManga, mangaId: string): SourceManga => {
    const titles = [decodeHTMLEntity(manga.name)]
    for (const alt of manga.altNames ?? []) {
        const n = decodeHTMLEntity(alt.name ?? '').trim()
        if (n && !titles.some((t) => t.toLowerCase() === n.toLowerCase())) titles.push(n)
    }

    const tagSections: TagSection[] = []
    const pushTags = (id: string, label: string, tags: { slug: string; name: string }[] | undefined): void => {
        if (!tags || tags.length === 0) return
        tagSections.push(
            App.createTagSection({
                id,
                label,
                tags: tags.map((t) => App.createTag({ id: t.slug, label: t.name }))
            })
        )
    }
    pushTags('genres', 'Genres', manga.genres)
    pushTags('tags', 'Tags', manga.tags)
    pushTags('formats', 'Formats', manga.formats)
    if (manga.type) {
        tagSections.push(
            App.createTagSection({
                id: 'type',
                label: 'Type',
                tags: [App.createTag({ id: manga.type.slug, label: manga.type.name })]
            })
        )
    }

    const author = manga.authors && manga.authors.length > 0 ? manga.authors.map((a) => a.name).join(', ') : ''
    const artist = manga.artists && manga.artists.length > 0 ? manga.artists.map((a) => a.name).join(', ') : ''

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles,
            image: manga.cover ?? '',
            status: normalizeStatus(manga.status),
            author,
            artist,
            desc: decodeHTMLEntity(manga.summary ?? ''),
            tags: tagSections,
            hentai: manga.contentRating === 'erotica' || manga.contentRating === 'pornographic'
        })
    })
}

const toChapter = (ch: MangaKChapter): Chapter => {
    const inferred = Number((ch.name ?? '').match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0)
    const num = ch.chapterNumber ?? ch.chapter_number ?? inferred
    const ts = ch.updatedAt ?? ch.updated_at
    return App.createChapter({
        id: ch.slug,
        name: ch.name ?? `Chapter ${num}`,
        chapNum: num,
        time: ts ? new Date(ts) : new Date(),
        langCode: '🇬🇧'
    })
}

export const parseInlineChapters = (chapters: MangaKChapter[]): Chapter[] => chapters.map(toChapter)

export const parseApiChapters = (resp: ChaptersListResponse): Chapter[] => {
    const list = resp.data?.chapters
    if (!resp.success || !Array.isArray(list)) throw new Error('Failed to parse chapter list')
    return list.map(toChapter)
}

export const parseSearch = (
    resp: SearchResponse
): { results: PartialSourceManga[]; hasNext: boolean; page: number } => {
    if (resp.success === false) throw new Error(resp.message || 'Search failed')
    const items = resp.data?.items ?? []
    const pagination = resp.data?.pagination ?? { page: 1, has_next: false }

    const results = items
        .filter((i) => i.slug)
        .map((i) => {
            const ch = i.latest_chapters?.[0]
            const subtitle =
                ch?.chapter_number !== undefined ? `Ch. ${ch.chapter_number}` : (ch?.name ?? i.status)
            return App.createPartialSourceManga({
                mangaId: i.slug,
                title: decodeHTMLEntity(i.name ?? ''),
                image: i.cover ?? '',
                subtitle
            })
        })

    return { results, hasNext: pagination.has_next, page: pagination.page }
}

export const buildSearchUrl = (title: string | undefined, page: number): string => {
    const params: string[] = [`page=${page}`, 'limit=24']
    const q = (title ?? '').trim()
    if (q) params.push(`q=${encodeURIComponent(q.slice(0, 50))}`)
    return `${API_DOMAIN_URL}/titles/search?${params.join('&')}`
}
