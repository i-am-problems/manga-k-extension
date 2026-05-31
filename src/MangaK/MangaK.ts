import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    HomePageSectionsProviding,
    HomeSection,
    MangaProviding,
    PagedResults,
    PartialSourceManga,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga
} from '@paperback/types'

import * as cheerio from 'cheerio'

import {
    MK_API_DOMAIN,
    MK_DOMAIN,
    parseChapterPages,
    parseChapters,
    parseHomeSections,
    parseInternalMangaId,
    parseLatest,
    parseMangaDetails,
    parsePopular,
    parseSearch
} from './MangaKParser'

export const MangaKInfo: SourceInfo = {
    version: '1.0.0',
    name: 'MangaK',
    icon: 'icon.svg',
    author: 'Problems',
    authorWebsite: '',
    description: 'Extension that pulls manga from mangak.io',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: MK_DOMAIN,
    sourceTags: [
        { text: 'Cloudflare', type: BadgeColor.YELLOW }
    ],
    intents:
        SourceIntents.MANGA_CHAPTERS
        | SourceIntents.HOMEPAGE_SECTIONS
        | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class MangaK implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {

    requestManager = App.createRequestManager({
        requestsPerSecond: 5,
        requestTimeout: 15000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    ...{
                        'Referer': `${MK_DOMAIN}/`,
                        'Origin': MK_DOMAIN,
                        'User-Agent': await this.requestManager.getDefaultUserAgent()
                    }
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => response
        }
    });

    getMangaShareUrl(mangaId: string): string {
        return `${MK_DOMAIN}/${mangaId}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const $ = await this.fetchCheerio(`${MK_DOMAIN}/${mangaId}`)
        return parseMangaDetails($, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const $ = await this.fetchCheerio(`${MK_DOMAIN}/${mangaId}`)
        const internalId = parseInternalMangaId($)

        const request = App.createRequest({
            url: `${MK_API_DOMAIN}/titles/${internalId}/chapters`,
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        })

        const response = await this.requestManager.schedule(request, 1)
        let data
        try {
            data = JSON.parse(response.data as string)
        } catch (e) {
            throw new Error(`Failed to parse chapters JSON for mangaId ${mangaId}: ${e}`)
        }

        return parseChapters(data, mangaId)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const $ = await this.fetchCheerio(`${MK_DOMAIN}/${mangaId}/${chapterId}`)
        const pages = parseChapterPages($)
        return App.createChapterDetails({
            id: chapterId,
            mangaId,
            pages
        })
    }

    async getSearchResults(query: SearchRequest, metadata: unknown): Promise<PagedResults> {
        const page = (metadata as { page?: number } | undefined)?.page ?? 1
        const title = encodeURIComponent(query?.title ?? '')

        const request = App.createRequest({
            url: `${MK_API_DOMAIN}/titles/search?q=${title}&page=${page}&limit=24`,
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        })

        const response = await this.requestManager.schedule(request, 1)
        let data
        try {
            data = JSON.parse(response.data as string)
        } catch (e) {
            throw new Error(`Failed to parse search JSON: ${e}`)
        }

        const { results, hasNext } = parseSearch(data)
        return App.createPagedResults({
            results,
            metadata: hasNext ? { page: page + 1 } : undefined
        })
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const [popular, latest] = await Promise.all([
            this.fetchPopular(),
            this.fetchLatest(1)
        ])
        parseHomeSections(popular, latest.results, sectionCallback)
    }

    async getViewMoreItems(homepageSectionId: string, metadata: unknown): Promise<PagedResults> {
        const page = (metadata as { page?: number } | undefined)?.page ?? 1

        if (homepageSectionId === 'updated_section') {
            const { results, hasNext } = await this.fetchLatest(page)
            return App.createPagedResults({
                results,
                metadata: hasNext ? { page: page + 1 } : undefined
            })
        }

        return App.createPagedResults({ results: [], metadata: undefined })
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: `${MK_DOMAIN}/`,
            method: 'GET',
            headers: {
                'Referer': `${MK_DOMAIN}/`,
                'User-Agent': await this.requestManager.getDefaultUserAgent()
            }
        })
    }

    private async fetchPopular(): Promise<PartialSourceManga[]> {
        const $ = await this.fetchCheerio(`${MK_DOMAIN}/top/day`)
        return parsePopular($)
    }

    private async fetchLatest(page: number): Promise<{ results: PartialSourceManga[]; hasNext: boolean }> {
        const $ = await this.fetchCheerio(`${MK_DOMAIN}/latest?sort=latest&page=${page}`)
        return parseLatest($)
    }

    private async fetchCheerio(url: string): Promise<cheerio.CheerioAPI> {
        const request = App.createRequest({ url, method: 'GET' })
        const response = await this.requestManager.schedule(request, 1)
        if (response.status === 503 || response.status === 403) {
            throw new Error(`Cloudflare challenge encountered for ${url}`)
        }
        return cheerio.load(response.data as string)
    }
}
