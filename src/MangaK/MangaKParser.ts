import {
    Chapter,
    HomeSection,
    HomeSectionType,
    PartialSourceManga,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

import { CheerioAPI } from 'cheerio'
import { decode as decodeHTMLEntity } from 'html-entities'

export const MK_DOMAIN = 'https://mangak.io'
export const MK_API_DOMAIN = 'https://api.mangak.io'

type NextDataProps = Record<string, unknown>

interface MangakGenre {
    name: string
    slug: string
}

interface MangakAltName {
    name: string
}

interface MangakInitialManga {
    id: number | string
    name: string
    altNames?: MangakAltName[]
    cover?: string
    status?: string
    rating?: number
    summary?: string
    genres?: MangakGenre[]
    author?: string
    artist?: string
}

interface MangakApiChapter {
    slug: string
    name?: string
    updated_at?: string
    chapter_number?: number
}

interface MangakApiSearchItem {
    slug: string
    name?: string
    cover?: string
    latest_chapters?: { slug?: string; name?: string }[]
}

interface MangakNextItem {
    slug: string
    name?: string
    cover?: string
    latestChapters?: { slug?: string; name?: string }[]
}

interface MangakPagination {
    has_next: boolean
    page: number
    total_pages?: number
}

export const extractNextData = ($: CheerioAPI): NextDataProps => {
    const raw = $('#__NEXT_DATA__').html() || '{}'
    try {
        const doc = JSON.parse(raw) as { props?: { pageProps?: NextDataProps } }
        return doc?.props?.pageProps ?? {}
    } catch {
        return {}
    }
}

export const normalizeMangaId = (hrefOrId: string | undefined): string => {
    if (!hrefOrId) return ''
    try {
        const parsed = new URL(hrefOrId, MK_DOMAIN)
        return parsed.pathname.replace(/^\/+|\/+$/g, '')
    } catch {
        return hrefOrId.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '')
    }
}

const buildStatus = (status: string | undefined): string => {
    const s = (status ?? '').toLowerCase()
    if (s.includes('ongoing')) return 'Ongoing'
    if (s.includes('completed')) return 'Completed'
    return 'Unknown'
}

export const parseMangaDetails = ($: CheerioAPI, mangaId: string): SourceManga => {
    const pageProps = extractNextData($)
    const manga = pageProps['initialManga'] as MangakInitialManga | undefined
    if (!manga) throw new Error(`Manga not found: ${mangaId}`)

    const titles: string[] = []
    titles.push(decodeHTMLEntity(manga.name))
    for (const alt of manga.altNames ?? []) {
        for (const piece of (alt.name ?? '').split(/\s*,\s*/)) {
            const t = piece.trim()
            if (t && t.toLowerCase() !== manga.name.toLowerCase()) {
                titles.push(decodeHTMLEntity(t))
            }
        }
    }

    const genres = manga.genres ?? []
    const tagSections: TagSection[] = []
    if (genres.length > 0) {
        const tags: Tag[] = genres.map(g => App.createTag({ id: g.slug, label: g.name }))
        tagSections.push(App.createTagSection({ id: 'genres', label: 'Genres', tags }))
    }

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles,
            image: manga.cover ?? '',
            status: buildStatus(manga.status),
            author: manga.author ?? '',
            artist: manga.artist ?? '',
            tags: tagSections,
            desc: decodeHTMLEntity(manga.summary ?? '')
        })
    })
}

export const parseInternalMangaId = ($: CheerioAPI): string => {
    const pageProps = extractNextData($)
    const manga = pageProps['initialManga'] as MangakInitialManga | undefined
    const id = manga?.id
    if (id === undefined || id === null || id === '') {
        throw new Error('Could not extract internal manga ID')
    }
    return String(id)
}

export const parseChapters = (apiJson: { success?: boolean; data?: { chapters?: MangakApiChapter[] } }, mangaId: string): Chapter[] => {
    const list = apiJson?.data?.chapters
    if (!apiJson.success || !Array.isArray(list)) {
        throw new Error(`Failed to parse chapters for mangaId: ${mangaId}`)
    }

    const chapters: Chapter[] = list.map((ch, index) => {
        const name = ch.name ?? ''
        const match = name.match(/(\d+(?:\.\d+)?)/)
        const chapNum = match && match[1] !== undefined ? Number(match[1]) : (ch.chapter_number ?? index + 1)
        return App.createChapter({
            id: ch.slug,
            name,
            chapNum,
            time: ch.updated_at ? new Date(ch.updated_at) : new Date(),
            langCode: '🇬🇧'
        })
    })

    if (chapters.length === 0) {
        throw new Error(`No chapters returned for mangaId: ${mangaId}`)
    }
    return chapters
}

export const parseChapterPages = ($: CheerioAPI): string[] => {
    const pageProps = extractNextData($)
    const initialChapter = pageProps['initialChapter'] as { images?: string[] } | undefined
    const pages = initialChapter?.images ?? []
    if (!Array.isArray(pages) || pages.length === 0) {
        throw new Error('No images found for chapter')
    }
    return pages
}

export const parseSearch = (apiJson: {
    success?: boolean
    data?: { items?: MangakApiSearchItem[]; pagination?: MangakPagination }
}): { results: PartialSourceManga[]; hasNext: boolean } => {
    if (!apiJson.success || !apiJson.data?.items) {
        return { results: [], hasNext: false }
    }

    const results: PartialSourceManga[] = apiJson.data.items
        .filter(item => item.slug)
        .map(item => App.createPartialSourceManga({
            mangaId: item.slug,
            image: item.cover ?? '',
            title: decodeHTMLEntity(item.name ?? ''),
            subtitle: item.latest_chapters?.[0]?.name ?? ''
        }))

    return { results, hasNext: apiJson.data.pagination?.has_next ?? false }
}

export const parsePopular = ($: CheerioAPI): PartialSourceManga[] => {
    const items: PartialSourceManga[] = []
    const elements = $('.top-item').length ? $('.top-item') : $('article.group, .group')

    elements.each((_: number, element) => {
        const unit = $(element)

        const image =
            unit.find('img').first().attr('data-src') ||
            unit.find('img').first().attr('src') ||
            ''

        const href =
            unit.find('a[aria-label]').first().attr('href') ||
            unit.find('a[title]').first().attr('href') ||
            unit.find('a').first().attr('href') ||
            ''

        const mangaId = normalizeMangaId(href)

        const title =
            unit.find('a[title]').first().attr('title') ||
            unit.find('.meta .title a').text().trim() ||
            unit.find('a > span').first().text().trim() ||
            unit.find('img').first().attr('alt') ||
            ''

        const latestChapter =
            unit.find('a[href*="/chapter"]').first().text().trim() ||
            unit.find('.thumb .latest-chapter').text().trim() ||
            ''

        const chapterMatch = latestChapter.match(/Chapter\s*([0-9]+(?:\.[0-9]+)?)/i)
        const subtitle = chapterMatch && chapterMatch[1] !== undefined
            ? `Ch. ${chapterMatch[1]}`
            : latestChapter

        if (title && mangaId) {
            items.push(App.createPartialSourceManga({
                mangaId,
                image,
                title: decodeHTMLEntity(title),
                subtitle
            }))
        }
    })

    return items
}

export const parseLatest = ($: CheerioAPI): { results: PartialSourceManga[]; hasNext: boolean } => {
    const pageProps = extractNextData($)
    const rawItems = (pageProps['items'] as MangakNextItem[] | undefined) ?? []
    const pagination = pageProps['pagination'] as MangakPagination | undefined

    const results: PartialSourceManga[] = rawItems
        .filter(item => item.slug)
        .map(item => App.createPartialSourceManga({
            mangaId: item.slug,
            image: item.cover ?? '',
            title: decodeHTMLEntity(item.name ?? ''),
            subtitle: item.latestChapters?.[0]?.name ?? ''
        }))

    return { results, hasNext: pagination?.has_next ?? false }
}

export const parseHomeSections = (
    popular: PartialSourceManga[],
    latest: PartialSourceManga[],
    sectionCallback: (section: HomeSection) => void
): void => {
    const popularSection = App.createHomeSection({
        id: 'popular_section',
        title: 'Popular',
        containsMoreItems: false,
        type: HomeSectionType.featured
    })
    popularSection.items = popular
    sectionCallback(popularSection)

    const latestSection = App.createHomeSection({
        id: 'updated_section',
        title: 'Recently Updated',
        containsMoreItems: true,
        type: HomeSectionType.singleRowNormal
    })
    latestSection.items = latest
    sectionCallback(latestSection)
}
