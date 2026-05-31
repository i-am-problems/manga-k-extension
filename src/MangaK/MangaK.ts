import {
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    HomePageSectionsProviding,
    HomeSection,
    MangaProviding,
    PagedResults,
    Request,
    RequestManager,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga
} from '@paperback/types'

import {
    API_DOMAIN_URL,
    API_URL,
    BASE_URL,
    buildHomeSections,
    buildSearchUrl,
    ChapterResponse,
    ChaptersListResponse,
    HomeResponse,
    LatestResponse,
    MangaResponse,
    parseApiChapters,
    parseInlineChapters,
    parseLatestItems,
    parseMangaDetails,
    parseSearch,
    parseTrending,
    TrendingResponse
} from './MangaKParser'

export const MangaKInfo: SourceInfo = {
    version: '2.0.0',
    name: 'MangaK',
    icon: 'icon.svg',
    author: 'Problems',
    description: 'Extension that pulls manga from mangak.io',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: BASE_URL,
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class MangaK implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {
    requestManager: RequestManager = App.createRequestManager({
        requestsPerSecond: 5,
        requestTimeout: 15000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    referer: `${BASE_URL}/`
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => response
        }
    })

    private sections = buildHomeSections()

    async fetchBuildId(): Promise<string> {
        const res = await this.requestManager.schedule(
            App.createRequest({ url: `${API_URL}/version`, method: 'GET' }),
            1
        )
        const data = JSON.parse(res.data ?? '{}') as { buildId?: string }
        if (!data.buildId) throw new Error('Failed to fetch buildId from /api/version')
        return data.buildId
    }

    async fetchNextData<T>(route: string): Promise<T> {
        const buildId = await this.fetchBuildId()
        const res = await this.requestManager.schedule(
            App.createRequest({
                url: `${BASE_URL}/_next/data/${buildId}/${route}`,
                method: 'GET',
                headers: { origin: BASE_URL, referer: `${BASE_URL}/` }
            }),
            1
        )
        return JSON.parse(res.data ?? '{}') as T
    }

    getMangaShareUrl(mangaId: string): string {
        return `${BASE_URL}/${mangaId}`
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        for (const s of Object.values(this.sections)) sectionCallback(s.section)

        const data = await this.fetchNextData<HomeResponse>('home.json')
        for (const s of Object.values(this.sections)) {
            s.section.items = s.extract(data.pageProps)
            sectionCallback(s.section)
        }
    }

    async getViewMoreItems(homepageSectionId: string, _metadata: unknown): Promise<PagedResults> {
        switch (homepageSectionId) {
            case 'latest': {
                const data = await this.fetchNextData<LatestResponse>('latest.json')
                return App.createPagedResults({
                    results: parseLatestItems(data.pageProps.items),
                    metadata: undefined
                })
            }
            case 'trending': {
                const data = await this.fetchNextData<TrendingResponse>('top/day.json?type=day')
                return App.createPagedResults({
                    results: parseTrending({
                        heroItems: [],
                        popularItems: [],
                        latest: { items: [] },
                        trendingItems: data.pageProps.initialItems
                    }),
                    metadata: undefined
                })
            }
            default:
                return App.createPagedResults({ results: [], metadata: undefined })
        }
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const data = await this.fetchNextData<MangaResponse>(`${mangaId}.json`)
        return parseMangaDetails(data.pageProps.initialManga, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const data = await this.fetchNextData<MangaResponse>(`${mangaId}.json`)
        const manga = data.pageProps.initialManga
        const inline = manga.chapters ?? []

        if (inline.length < 50) return parseInlineChapters(inline)

        const res = await this.requestManager.schedule(
            App.createRequest({
                url: `${API_DOMAIN_URL}/titles/${manga.id}/chapters`,
                method: 'GET'
            }),
            1
        )
        const list = JSON.parse(res.data ?? '{}') as ChaptersListResponse
        return parseApiChapters(list)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const data = await this.fetchNextData<ChapterResponse>(`${mangaId}/${chapterId}.json`)
        return App.createChapterDetails({
            id: chapterId,
            mangaId,
            pages: data.pageProps.initialChapter.images
        })
    }

    async getSearchResults(query: SearchRequest, metadata: unknown): Promise<PagedResults> {
        const page = (metadata as { page?: number } | undefined)?.page ?? 1
        const url = buildSearchUrl(query?.title, page)

        const res = await this.requestManager.schedule(
            App.createRequest({
                url,
                method: 'GET',
                headers: { origin: BASE_URL, referer: `${BASE_URL}/search` }
            }),
            1
        )
        const data = JSON.parse(res.data ?? '{}')
        const { results, hasNext } = parseSearch(data)

        return App.createPagedResults({
            results,
            metadata: hasNext ? { page: page + 1 } : undefined
        })
    }
}
