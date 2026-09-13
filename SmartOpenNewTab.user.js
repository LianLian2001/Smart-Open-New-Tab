// ==UserScript==
// @name         Smart Open New Tab
// @namespace    https://github.com/LianLian2001/Smart-Open-New-Tab
// @version      4.2.0
// @description  Intelligent userscript that opens normal page navigation in new tabs while preserving pagination, search, authentication, modal, menu, theme, download, and other in-page interactions.
// @author       Lian Lian
// @license      MIT
// @homepageURL  https://github.com/LianLian2001/Smart-Open-New-Tab
// @supportURL   https://github.com/LianLian2001/Smart-Open-New-Tab/issues
// @match        *://*/*
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // 域名设置
    // ============================================================

    const domain = location.hostname;

    const disabledKey =
        `SmartNewTab_Disabled_${domain}`;

    const debugKey =
        `SmartNewTab_Debug_${domain}`;

    const isDomainDisabled =
        GM_getValue(disabledKey, false);

    const debugEnabled =
        GM_getValue(debugKey, false);


    // ============================================================
    // 配置
    // ============================================================

    const CONFIG = {
        enabled: true,

        // 普通链接如果已经明确写了 target="_blank"，不进行二次干涉
        respectExplicitNewTab: true,

        // Ctrl / Cmd / 中键：普通导航在后台打开
        backgroundWithModifier: true,

        // Shift 点击交给浏览器
        respectShiftClick: true,

        // 右键不处理
        respectRightClick: true,

        // 登录 / OAuth / SSO / 认证保护
        protectAuthFlows: true,

        // Modal / Menu / Theme / Toggle 等页面内操作保护
        protectInteractiveUI: true,

        // 下载保护
        protectDownloads: true,

        // ========================================================
        // 高优先级“当前标签页”规则
        // ========================================================

        // 分页强制当前标签页
        forcePaginationCurrentTab: true,

        // 搜索相关导航强制当前标签页
        forceSearchCurrentTab: true,

        // 鼠标中键分页是否也强制当前标签页
        //
        // false：
        //   左键分页 -> 当前页
        //   中键分页 -> 后台新标签
        //
        // true：
        //   中键分页也 -> 当前页
        forcePaginationMiddleClick: false,

        // 鼠标中键搜索是否强制当前标签页
        forceSearchMiddleClick: false,

        // 普通导航最低分
        navigationScoreThreshold: 2,

        debug: debugEnabled
    };


    // ============================================================
    // Tampermonkey 菜单
    // ============================================================

    //
    // 现在显示当前状态，而不是简单说“永久关闭”
    //
    // ✅ 开启｜点击关闭此网站
    // ❌ 关闭｜点击开启此网站
    //

    GM_registerMenuCommand(
        isDomainDisabled
            ? '❌ 关闭｜点击开启此网站'
            : '✅ 开启｜点击关闭此网站',
        () => {

            GM_setValue(
                disabledKey,
                !isDomainDisabled
            );

            location.reload();
        }
    );


    GM_registerMenuCommand(
        CONFIG.debug
            ? '🐞 调试日志：✅ 开启｜点击关闭'
            : '🐞 调试日志：❌ 关闭｜点击开启',
        () => {

            GM_setValue(
                debugKey,
                !CONFIG.debug
            );

            location.reload();
        }
    );


    // 当前域名被关闭
    if (isDomainDisabled) {
        return;
    }


    // ============================================================
    // Debug
    // ============================================================

    const log = (...args) => {
        if (CONFIG.debug) {
            console.debug(
                '[SmartNewTab]',
                ...args
            );
        }
    };


    // ============================================================
    // 基础工具
    // ============================================================

    const normalize = (value) => {
        return String(value ?? '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    };


    const getElementText = (element) => {
        if (!(element instanceof Element)) {
            return '';
        }

        return normalize([
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
            element.getAttribute('data-label'),
            element.textContent
        ].filter(Boolean).join(' '));
    };


    const getElementSignature = (element) => {
        if (!(element instanceof Element)) {
            return '';
        }

        return normalize([
            element.id,

            typeof element.className === 'string'
                ? element.className
                : '',

            element.getAttribute('role'),
            element.getAttribute('rel'),
            element.getAttribute('name'),
            element.getAttribute('type'),

            element.getAttribute('data-action'),
            element.getAttribute('data-target'),
            element.getAttribute('data-toggle'),
            element.getAttribute('data-bs-toggle'),
            element.getAttribute('data-testid'),

            element.getAttribute('data-href'),
            element.getAttribute('data-url'),
            element.getAttribute('data-route'),
            element.getAttribute('data-link'),
            element.getAttribute('data-to')
        ].filter(Boolean).join(' '));
    };


    const hasAnyAttribute = (
        element,
        attributes
    ) => {
        if (!(element instanceof Element)) {
            return false;
        }

        return attributes.some(
            attribute =>
                element.hasAttribute(attribute)
        );
    };


    const attributeContains = (
        element,
        attributes,
        patterns
    ) => {
        if (!(element instanceof Element)) {
            return false;
        }

        for (const attribute of attributes) {

            const value = normalize(
                element.getAttribute(attribute)
            );

            if (!value) {
                continue;
            }

            for (const pattern of patterns) {
                if (pattern.test(value)) {
                    return true;
                }
            }
        }

        return false;
    };


    // ============================================================
    // 获取点击元素
    //
    // 支持：
    // <a>
    // <area>
    // <button>
    // [role="link"]
    // [role="button"]
    //
    // Shadow DOM 也尽量支持。
    // ============================================================

    const getClickableElement = (event) => {

        if (!event) {
            return null;
        }


        if (
            typeof event.composedPath === 'function'
        ) {

            const path =
                event.composedPath();


            for (const item of path) {

                if (!(item instanceof Element)) {
                    continue;
                }


                if (
                    item instanceof HTMLAnchorElement ||
                    item instanceof HTMLAreaElement ||
                    item instanceof HTMLButtonElement ||
                    item.getAttribute('role') === 'link' ||
                    item.getAttribute('role') === 'button'
                ) {
                    return item;
                }
            }
        }


        const target =
            event.target;


        if (!(target instanceof Element)) {
            return null;
        }


        return target.closest(
            'a, area, button, [role="link"], [role="button"]'
        );
    };


    // ============================================================
    // URL
    // ============================================================

    const parseURL = (href) => {

        try {
            return new URL(
                href,
                location.href
            );
        } catch {
            return null;
        }
    };


    const getNavigationURL = (element) => {

        if (!(element instanceof Element)) {
            return '';
        }


        // --------------------------------------------------------
        // <a href="">
        // --------------------------------------------------------

        if (
            element instanceof HTMLAnchorElement ||
            element instanceof HTMLAreaElement
        ) {

            try {

                return (
                    element.href ||
                    element.getAttribute('href') ||
                    ''
                );

            } catch {
                return '';
            }
        }


        // --------------------------------------------------------
        // data-* URL
        // --------------------------------------------------------

        const urlAttributes = [
            'data-href',
            'data-url',
            'data-link',
            'data-route',
            'data-to',
            'data-target-url',
            'data-next-url',
            'data-prev-url',
            'data-page-url',
            'formaction'
        ];


        for (
            const attribute
            of urlAttributes
        ) {

            const value =
                element.getAttribute(attribute);


            if (value) {
                return value;
            }
        }


        // --------------------------------------------------------
        // onclick
        // --------------------------------------------------------

        const onclick =
            element.getAttribute(
                'onclick'
            );


        if (onclick) {

            const result =
                extractURLFromInlineCode(
                    onclick
                );


            if (result) {
                return result;
            }
        }


        return '';
    };


    // ============================================================
    // 从 onclick 中提取 URL
    // ============================================================

    const extractURLFromInlineCode = (
        code
    ) => {

        if (!code) {
            return '';
        }


        const source =
            String(code);


        const patterns = [

            // location.href = "/xxx"
            /(?:window\.)?location(?:\.href)?\s*=\s*['"`]([^'"`]+)['"`]/i,

            // location.assign("/xxx")
            /(?:window\.)?location\.assign\s*\(\s*['"`]([^'"`]+)['"`]/i,

            // location.replace("/xxx")
            /(?:window\.)?location\.replace\s*\(\s*['"`]([^'"`]+)['"`]/i,

            // router.push("/xxx")
            /(?:router|navigation|nav)\.push\s*\(\s*['"`]([^'"`]+)['"`]/i,

            // router.replace("/xxx")
            /(?:router|navigation|nav)\.replace\s*\(\s*['"`]([^'"`]+)['"`]/i,

            // navigate("/xxx")
            /\bnavigate\s*\(\s*['"`]([^'"`]+)['"`]/i,

            // window.open("/xxx")
            /window\.open\s*\(\s*['"`]([^'"`]+)['"`]/i,

            // history.pushState(..., "/xxx")
            /history\.pushState\s*\([\s\S]*?,\s*['"`][^'"`]*['"`]\s*,\s*['"`]([^'"`]+)['"`]\s*\)/i,

            // history.replaceState(..., "/xxx")
            /history\.replaceState\s*\([\s\S]*?,\s*['"`][^'"`]*['"`]\s*,\s*['"`]([^'"`]+)['"`]\s*\)/i
        ];


        for (
            const pattern
            of patterns
        ) {

            const match =
                source.match(pattern);


            if (
                match &&
                match[1]
            ) {

                return match[1];
            }
        }


        return '';
    };


    // ============================================================
    // URL 类型
    // ============================================================

    const getRawHref = (element) => {

        if (!(element instanceof Element)) {
            return '';
        }

        return normalize(
            element.getAttribute('href')
        );
    };


    const isNonNavigationScheme = (
        href
    ) => {

        return /^(?:javascript|mailto|tel|sms|data|blob|file|about):/i
            .test(
                normalize(href)
            );
    };


    const isHashOnly = (
        href
    ) => {

        return /^#[^#]*/.test(
            normalize(href)
        );
    };


    const normalizePath = (
        pathname
    ) => {

        let value =
            pathname || '/';


        if (
            !value.startsWith('/')
        ) {

            value =
                `/${value}`;
        }


        value =
            value.replace(
                /\/{2,}/g,
                '/'
            );


        if (
            value.length > 1 &&
            value.endsWith('/')
        ) {

            value =
                value.slice(
                    0,
                    -1
                );
        }


        return value || '/';
    };


    // ============================================================
    // Disabled
    // ============================================================

    const isDisabledElement = (
        element
    ) => {

        if (!(element instanceof Element)) {
            return false;
        }


        if (
            element.hasAttribute(
                'disabled'
            )
        ) {
            return true;
        }


        if (
            normalize(
                element.getAttribute(
                    'aria-disabled'
                )
            ) === 'true'
        ) {
            return true;
        }


        return /\bdisabled\b|\bis-disabled\b|\bdeactivated\b/i
            .test(
                getElementSignature(
                    element
                )
            );
    };


    // ============================================================
    // ★★★★★
    // 强制当前页：分页
    // ============================================================

    const PAGINATION_QUERY_KEYS = new Set([
        'page',
        'p',
        'pg',
        'pn',
        'pageno',
        'pagenum',
        'pagenumber',
        'pageindex',
        'page_number',
        'page_num',
        'page_no',
        'currentpage',
        'current_page',
        'currentpage',
        'paged',
        'pagination',
        'paging',
        'offset',
        'start',
        'from',
        'skip'
    ]);


    const getComparableQuery = (
        url
    ) => {

        if (!url) {
            return '';
        }


        const pairs = [];


        for (
            const [key, value]
            of url.searchParams.entries()
        ) {

            const lowerKey =
                key.toLowerCase();


            if (
                PAGINATION_QUERY_KEYS.has(
                    lowerKey
                )
            ) {
                continue;
            }


            pairs.push([
                lowerKey,
                value
            ]);
        }


        pairs.sort(
            (a, b) => {

                const aa =
                    `${a[0]}=${a[1]}`;

                const bb =
                    `${b[0]}=${b[1]}`;

                return aa.localeCompare(bb);
            }
        );


        return pairs
            .map(
                ([key, value]) =>
                    `${key}=${value}`
            )
            .join('&');
    };


    const getPageQueryInfo = (
        url
    ) => {

        if (!url) {
            return null;
        }


        for (
            const [key, value]
            of url.searchParams.entries()
        ) {

            const lowerKey =
                key.toLowerCase();


            if (
                !PAGINATION_QUERY_KEYS.has(
                    lowerKey
                )
            ) {
                continue;
            }


            if (
                /^\d+$/.test(value)
            ) {

                return {
                    key,
                    page:
                        Number(value)
                };
            }
        }


        return null;
    };


    const getPathPaginationInfo = (
        pathname
    ) => {

        const path =
            normalizePath(
                pathname
            );


        /*
         * 支持：
         *
         * /page/2
         * /page-2
         * /page2
         * /pages/2
         * /paged/2
         * /p/2
         * /p-2
         * /p2
         * /pg/2
         */

        const match =
            path.match(
                /^(.*)\/(?:page|pages|paged|p|pg)[\/_-]?(\d+)$/i
            );


        if (!match) {
            return null;
        }


        let base =
            normalizePath(
                match[1] || '/'
            );


        if (
            base.length === 0
        ) {
            base = '/';
        }


        return {
            base,
            page:
                Number(
                    match[2]
                )
        };
    };


    const isStrongPathPagination = (
        currentURL,
        targetURL
    ) => {

        if (
            !currentURL ||
            !targetURL
        ) {
            return false;
        }


        if (
            currentURL.origin !==
            targetURL.origin
        ) {
            return false;
        }


        const currentPath =
            normalizePath(
                currentURL.pathname
            );


        const targetPath =
            normalizePath(
                targetURL.pathname
            );


        const currentInfo =
            getPathPaginationInfo(
                currentPath
            );


        const targetInfo =
            getPathPaginationInfo(
                targetPath
            );


        if (!targetInfo) {
            return false;
        }


        // 保留其它 query 参数必须相同
        if (
            getComparableQuery(
                currentURL
            ) !==
            getComparableQuery(
                targetURL
            )
        ) {
            return false;
        }


        // 第一页 /foo -> /foo/page/2
        if (
            !currentInfo &&
            currentPath ===
                targetInfo.base
        ) {

            return (
                targetInfo.page >= 1
            );
        }


        // /foo/page/1 -> /foo/page/2
        // /foo/page/2 -> /foo/page/3
        if (
            currentInfo &&
            currentInfo.base ===
                targetInfo.base &&
            currentInfo.page !==
                targetInfo.page
        ) {

            return true;
        }


        return false;
    };


    const isStrongQueryPagination = (
        currentURL,
        targetURL
    ) => {

        if (
            !currentURL ||
            !targetURL
        ) {
            return false;
        }


        const currentPath =
            normalizePath(
                currentURL.pathname
            );


        const targetPath =
            normalizePath(
                targetURL.pathname
            );


        if (
            currentPath !==
            targetPath
        ) {
            return false;
        }


        if (
            getComparableQuery(
                currentURL
            ) !==
            getComparableQuery(
                targetURL
            )
        ) {
            return false;
        }


        const currentPage =
            getPageQueryInfo(
                currentURL
            );


        const targetPage =
            getPageQueryInfo(
                targetURL
            );


        if (!targetPage) {
            return false;
        }


        // /foo -> /foo?page=2
        if (!currentPage) {

            return (
                targetPage.page >= 1
            );
        }


        // /foo?page=1 -> /foo?page=2
        if (
            currentPage.page !==
            targetPage.page
        ) {

            return true;
        }


        return false;
    };


    const isExplicitPaginationElement = (
        element
    ) => {

        if (!(element instanceof Element)) {
            return false;
        }


        const signature =
            getElementSignature(
                element
            );


        const rel =
            normalize(
                element.getAttribute(
                    'rel'
                )
            );


        const ariaLabel =
            normalize(
                element.getAttribute(
                    'aria-label'
                )
            );


        const title =
            normalize(
                element.getAttribute(
                    'title'
                )
            );


        // rel=next / rel=prev
        if (
            /\b(?:next|prev|previous)\b/
                .test(rel)
        ) {

            return true;
        }


        // aria-label
        if (
            /^(?:next|prev|previous)(?:\s+page)?$/i
                .test(ariaLabel)
        ) {

            return true;
        }


        if (
            /^(?:下一页|上一页|下一頁|上一頁|首页|首頁|尾页|尾頁)$/
                .test(ariaLabel)
        ) {

            return true;
        }


        // title
        if (
            /^(?:next|prev|previous)(?:\s+page)?$/i
                .test(title)
        ) {

            return true;
        }


        if (
            /^(?:下一页|上一页|下一頁|上一頁|首页|首頁|尾页|尾頁)$/
                .test(title)
        ) {

            return true;
        }


        // class / ID
        return /\b(?:pagination|paginator|pager|paging|page-link|page-item|next-page|prev-page|previous-page|el-pagination|ant-pagination)\b/i
            .test(
                signature
            );
    };


    const isHighConfidencePagination = (
        element,
        currentURL,
        targetURL
    ) => {

        if (
            !element ||
            !currentURL ||
            !targetURL
        ) {
            return false;
        }


        if (
            currentURL.origin !==
            targetURL.origin
        ) {
            return false;
        }


        // ① /foo -> /foo/page/2
        if (
            isStrongPathPagination(
                currentURL,
                targetURL
            )
        ) {
            return true;
        }


        // ② /foo -> /foo?page=2
        if (
            isStrongQueryPagination(
                currentURL,
                targetURL
            )
        ) {
            return true;
        }


        // ③ rel / class / aria
        if (
            isExplicitPaginationElement(
                element
            )
        ) {
            return true;
        }


        // ④ 纯数字页码
        const text =
            getElementText(
                element
            );


        if (
            /^\d{1,5}$/.test(text)
        ) {

            const parent =
                element.closest(
                    [
                        '.pagination',
                        '.pagination-container',
                        '.pagination-wrapper',
                        '.pager',
                        '.paging',
                        '[role="navigation"]'
                    ].join(', ')
                );


            if (parent) {

                const children =
                    parent.querySelectorAll(
                        'a, button, [role="link"], [role="button"]'
                    );


                let pageNumberCount = 0;


                for (
                    const child
                    of children
                ) {

                    if (
                        /^\d{1,5}$/.test(
                            getElementText(
                                child
                            )
                        )
                    ) {
                        pageNumberCount++;
                    }
                }


                if (
                    pageNumberCount >= 2
                ) {
                    return true;
                }
            }
        }


        return false;
    };


    // ============================================================
    // ★★★★★
    // 强制当前页：搜索
    // ============================================================

    const SEARCH_PATH_PATTERNS = [
        /^\/search\/?$/i,
        /^\/search\//i,

        /^\/searches\/?$/i,
        /^\/find\/?$/i,
        /^\/find\//i,

        /^\/query\/?$/i,
        /^\/query\//i,

        /^\/results\/?$/i,
        /^\/results\//i,

        /^\/search-results\/?$/i,
        /^\/search-results\//i
    ];


    const SEARCH_QUERY_KEYS = new Set([
        'q',
        'query',
        'search',
        'keyword',
        'keywords',
        'searchterm',
        'search_term',
        'term',
        'text',
        'querystring'
    ]);


    const isSearchPath = (
        url
    ) => {

        if (!url) {
            return false;
        }


        const pathname =
            normalizePath(
                url.pathname
            );


        return SEARCH_PATH_PATTERNS.some(
            pattern =>
                pattern.test(
                    pathname
                )
        );
    };


    const hasSearchQuery = (
        url
    ) => {

        if (!url) {
            return false;
        }


        for (
            const key
            of url.searchParams.keys()
        ) {

            if (
                SEARCH_QUERY_KEYS.has(
                    key.toLowerCase()
                )
            ) {

                return true;
            }
        }


        return false;
    };


    const isSearchElement = (
        element
    ) => {

        if (!(element instanceof Element)) {
            return false;
        }


        const text =
            getElementText(
                element
            );


        const signature =
            getElementSignature(
                element
            );


        const aria =
            normalize(
                element.getAttribute(
                    'aria-label'
                )
            );


        const title =
            normalize(
                element.getAttribute(
                    'title'
                )
            );


        const combined =
            [
                text,
                signature,
                aria,
                title
            ].join(' ');


        return (
            /\b(?:search|find|searching|search results)\b/i
                .test(combined)
            ||
            /(?:搜索|搜寻|檢索|搜尋|查找|查詢|查询|搜索结果|搜尋結果)/
                .test(combined)
        );
    };


    const isHighConfidenceSearchNavigation = (
        element,
        currentURL,
        targetURL
    ) => {

        if (
            !element ||
            !currentURL ||
            !targetURL
        ) {
            return false;
        }


        // 必须是同站
        if (
            currentURL.origin !==
            targetURL.origin
        ) {
            return false;
        }


        const currentPath =
            normalizePath(
                currentURL.pathname
            );


        const targetPath =
            normalizePath(
                targetURL.pathname
            );


        // ========================================================
        // ①
        // /
        // ↓
        // /search/
        //
        // 这是本次新增的最重要规则。
        // ========================================================

        if (
            isSearchPath(
                targetURL
            )
        ) {

            return true;
        }


        // ========================================================
        // ②
        // 普通 URL -> ?q=xxx
        //
        // 例如：
        //
        // /
        // ↓
        // /?q=miku
        //
        // /home
        // ↓
        // /search?q=miku
        // ========================================================

        if (
            hasSearchQuery(
                targetURL
            )
        ) {
            return true;
        }


        // ========================================================
        // ③
        // 点击的元素本身明确是搜索
        //
        // 即使页面使用非传统 URL：
        //
        // /find
        // /results
        // /lookup
        // /discover
        //
        // 也优先保持当前页。
        // ========================================================

        if (
            isSearchElement(
                element
            )
        ) {

            // 必须至少发生真正的 URL 变化
            if (
                currentURL.href !==
                targetURL.href
            ) {
                return true;
            }
        }


        // ========================================================
        // ④
        // 已经在搜索页面，再进入搜索结果
        //
        // /search/
        // ↓
        // /search/miku
        //
        // 继续当前标签页。
        // ========================================================

        if (
            isSearchPath(
                currentURL
            ) &&
            (
                isSearchPath(
                    targetURL
                ) ||
                hasSearchQuery(
                    targetURL
                )
            )
        ) {

            if (
                currentPath !==
                targetPath ||
                currentURL.search !==
                targetURL.search
            ) {
                return true;
            }
        }


        return false;
    };


    // ============================================================
    // Auth
    // ============================================================

    const AUTH_PATTERNS = [
        /\blogin\b/,
        /\blog-in\b/,
        /\bsign[\s_-]?in\b/,
        /\bsign[\s_-]?on\b/,
        /\bsignin\b/,
        /\bsso\b/,
        /\bauth\b/,
        /\bauthentication\b/,
        /\boauth\b/,
        /\boidc\b/,
        /\bregister\b/,
        /\bregistration\b/,
        /\bsign[\s_-]?up\b/,
        /\bcreate[\s_-]?account\b/,
        /\bforgot[\s_-]?(?:password|pwd)\b/,
        /\breset[\s_-]?(?:password|pwd)\b/,
        /\brecover[\s_-]?(?:account|password)\b/,
        /\bverify[\s_-]?(?:email|account)\b/,
        /\bverification\b/,
        /\bcredential\b/,
        /\bcaptcha\b/,
        /\bsecurity[\s_-]?check\b/,
        /\blogout\b/,
        /\bsign[\s_-]?out\b/
    ];


    const AUTH_HOST_PATTERNS = [
        /^accounts\./i,
        /^login\./i,
        /^auth\./i,
        /^sso\./i,
        /^signin\./i,
        /^identity\./i
    ];


    const isAuthFlow = (
        element,
        url
    ) => {

        if (
            !CONFIG.protectAuthFlows ||
            !element ||
            !url
        ) {
            return false;
        }


        const href =
            normalize(
                getNavigationURL(
                    element
                )
            );


        const text =
            getElementText(
                element
            );


        const signature =
            getElementSignature(
                element
            );


        const combined =
            [
                href,
                url.pathname,
                url.search,
                url.hostname,
                text,
                signature
            ].join(' ');


        if (
            AUTH_HOST_PATTERNS.some(
                regex =>
                    regex.test(
                        url.hostname
                    )
            )
        ) {
            return true;
        }


        if (
            /[?&](?:redirect_uri|return_to|returnUrl|callback|callback_url)=/i
                .test(
                    url.search
                )
        ) {
            return true;
        }


        if (
            AUTH_PATTERNS.some(
                regex =>
                    regex.test(
                        combined
                    )
            )
        ) {
            return true;
        }


        return attributeContains(
            element,
            [
                'data-login',
                'data-auth',
                'data-provider',
                'data-callback',
                'data-redirect'
            ],
            [
                /login/,
                /signin/,
                /oauth/,
                /auth/,
                /sso/,
                /logout/
            ]
        );
    };


    // ============================================================
    // 页面内部 UI
    // ============================================================

    const UI_ATTRIBUTE_NAMES = [
        'data-toggle',
        'data-bs-toggle',
        'data-dismiss',
        'data-bs-dismiss',
        'data-target',
        'data-bs-target',

        'data-modal',
        'data-dialog',
        'data-popup',
        'data-popover',
        'data-drawer',
        'data-dropdown',
        'data-menu',

        'data-tab',
        'data-tab-target',
        'data-accordion',
        'data-collapse',
        'data-offcanvas',

        'data-fancybox',
        'data-mfp-src',
        'data-lightbox',
        'data-command'
    ];


    const UI_VALUE_PATTERNS = [
        /\bmodal\b/,
        /\bdialog\b/,
        /\bpopup\b/,
        /\bpop-up\b/,
        /\bpopover\b/,
        /\bdrawer\b/,
        /\boffcanvas\b/,
        /\bdropdown\b/,
        /\bmenu\b/,
        /\btooltip\b/,
        /\baccordion\b/,
        /\bcollapse\b/,
        /\btab\b/,
        /\btabs\b/,
        /\btoggle\b/,
        /\bexpand\b/,
        /\bexpandable\b/,
        /\bdisclosure\b/,
        /\blightbox\b/,
        /\bfancybox\b/,
        /\boverlay\b/,
        /\bsidebar\b/,
        /\btheme\b/,
        /\bdark[\s_-]?mode\b/,
        /\blight[\s_-]?mode\b/,
        /\bcolor[\s_-]?scheme\b/,
        /\blanguage\b/,
        /\blocale\b/,
        /\bcookie\b/
    ];


    const ONCLICK_UI_PATTERNS = [
        /\bpreventdefault\s*\(/,
        /\bstoppropagation\s*\(/,
        /\bstopimmediatepropagation\s*\(/,

        /\bshowmodal\s*\(/,
        /\bclosemodal\s*\(/,
        /\bopenmodal\s*\(/,
        /\bhidemodal\s*\(/,
        /\btogglemodal\s*\(/,

        /\btoggledropdown\s*\(/,
        /\btogglemenu\s*\(/,

        /\btoggletheme\s*\(/,
        /\bsettheme\s*\(/,

        /\bdarkmode\b/,
        /\blightmode\b/,

        /\bopenshare\b/,

        /\bpopup\b/,
        /\bdialog\b/,
        /\bmodal\b/,
        /\btooltip\b/,
        /\bpopover\b/,
        /\baccordion\b/,
        /\bcarousel\b/,
        /\btoggle\b/,
        /\bclasslist\./
    ];


    const isInPageInteraction = (
        element,
        url
    ) => {

        if (
            !CONFIG.protectInteractiveUI ||
            !(element instanceof Element)
        ) {
            return false;
        }


        // 原生 submit/reset 不碰
        if (
            element instanceof HTMLButtonElement
        ) {

            const type =
                normalize(
                    element.getAttribute(
                        'type'
                    )
                );


            if (
                type === 'submit' ||
                type === 'reset'
            ) {
                return true;
            }
        }


        const role =
            normalize(
                element.getAttribute(
                    'role'
                )
            );


        if (
            role === 'button'
        ) {
            return true;
        }


        const ariaHasPopup =
            normalize(
                element.getAttribute(
                    'aria-haspopup'
                )
            );


        if (
            ariaHasPopup === 'true' ||
            /^(?:menu|listbox|dialog|grid|tree)$/i
                .test(
                    ariaHasPopup
                )
        ) {
            return true;
        }


        if (
            element.hasAttribute(
                'aria-expanded'
            ) ||
            element.hasAttribute(
                'aria-pressed'
            )
        ) {
            return true;
        }


        if (
            hasAnyAttribute(
                element,
                UI_ATTRIBUTE_NAMES
            )
        ) {
            return true;
        }


        if (
            attributeContains(
                element,
                UI_ATTRIBUTE_NAMES,
                UI_VALUE_PATTERNS
            )
        ) {
            return true;
        }


        const signature =
            getElementSignature(
                element
            );


        if (
            UI_VALUE_PATTERNS.some(
                regex =>
                    regex.test(
                        signature
                    )
            )
        ) {
            return true;
        }


        const onclick =
            normalize(
                element.getAttribute(
                    'onclick'
                )
            );


        if (
            onclick &&
            ONCLICK_UI_PATTERNS.some(
                regex =>
                    regex.test(
                        onclick
                    )
            )
        ) {
            return true;
        }


        if (url) {

            const actionURL =
                `${url.pathname} ${url.search}`;


            if (
                /(?:^|[/?_-])(?:toggle|theme|dark-mode|light-mode|modal|dialog|popup|drawer|dropdown|menu|accordion|tab)(?:[/?_-]|$)/i
                    .test(
                        actionURL
                    )
            ) {
                return true;
            }


            if (
                /[?&](?:action|toggle|modal|dialog|popup|drawer|menu|tab|theme|locale|language)=/i
                    .test(
                        url.search
                    )
            ) {
                return true;
            }
        }


        return false;
    };


    // ============================================================
    // 下载 / 特殊行为
    // ============================================================

    const isLikelyDownload = (
        element,
        url
    ) => {

        if (
            !(element instanceof Element) ||
            !url
        ) {
            return false;
        }


        if (
            element.hasAttribute(
                'download'
            )
        ) {
            return true;
        }


        if (
            /\.(?:zip|rar|7z|tar|gz|bz2|xz|exe|msi|apk|dmg|pkg|deb|rpm|iso|img|bin|torrent|doc|docx|xls|xlsx|ppt|pptx|csv|rtf|odt|ods|odp)$/i
                .test(
                    url.pathname
                )
        ) {
            return true;
        }


        if (
            /(?:^|[/?_-])(?:download|attachment|export|file)(?:[/?_-]|$)/i
                .test(
                    url.pathname
                )
        ) {
            return true;
        }


        if (
            /[?&](?:download|attachment|export)=/i
                .test(
                    url.search
                )
        ) {
            return true;
        }


        return false;
    };


    const isSpecialBrowserAction = (
        element,
        url
    ) => {

        if (
            !element ||
            !url
        ) {
            return false;
        }


        const href =
            getNavigationURL(
                element
            );


        if (
            isNonNavigationScheme(
                href
            )
        ) {
            return true;
        }


        if (
            CONFIG.protectDownloads &&
            isLikelyDownload(
                element,
                url
            )
        ) {
            return true;
        }


        return /^(?:mailto|tel|sms|data|blob|file|about):/i
            .test(
                url.protocol
            );
    };


    // ============================================================
    // 普通导航评分
    // ============================================================

    const calculateNavigationScore = (
        element,
        url
    ) => {

        let score = 0;


        const href =
            normalize(
                getNavigationURL(
                    element
                )
            );


        const text =
            getElementText(
                element
            );


        const signature =
            getElementSignature(
                element
            );


        if (
            href &&
            !/^javascript:/i.test(
                href
            )
        ) {
            score += 2;
        }


        if (
            url.pathname !==
            location.pathname
        ) {
            score += 2;
        }


        if (
            url.search !==
            location.search
        ) {
            score += 1;
        }


        if (
            url.origin !==
            location.origin
        ) {
            score += 2;
        }


        if (
            /\/(?:article|articles|news|post|posts|blog|wiki|docs|document|product|products|category|categories|tag|tags|profile|settings)(?:\/|$)/i
                .test(
                    url.pathname
                )
        ) {
            score += 1;
        }


        if (
            /\b(?:read|read more|view|details|article|profile|home|settings|documentation|docs|open|view all)\b/i
                .test(
                    text
                )
        ) {
            score += 1;
        }


        if (
            element.hasAttribute(
                'aria-current'
            ) &&
            normalize(
                element.getAttribute(
                    'aria-current'
                )
            ) === 'page'
        ) {
            score -= 5;
        }


        if (
            isDisabledElement(
                element
            )
        ) {
            score -= 10;
        }


        if (
            /\b(?:button|btn|control|trigger)\b/i
                .test(
                    signature
                )
        ) {
            score -= 3;
        }


        if (
            /\b(?:modal|dialog|popup|dropdown|menu|tab|accordion|theme|toggle)\b/i
                .test(
                    signature
                )
        ) {
            score -= 8;
        }


        if (
            /\b(?:login|signin|signup|logout|auth|oauth|sso)\b/i
                .test(
                    `${text} ${signature} ${href}`
                )
        ) {
            score -= 10;
        }


        return score;
    };


    // ============================================================
    // 普通链接是否应新标签
    // ============================================================

    const shouldOpenInNewTab = (
        element,
        event
    ) => {

        if (
            !CONFIG.enabled ||
            !element ||
            !event
        ) {
            return false;
        }


        if (
            isDisabledElement(
                element
            )
        ) {
            return false;
        }


        if (
            CONFIG.respectRightClick &&
            event.button === 2
        ) {
            return false;
        }


        if (
            CONFIG.respectShiftClick &&
            event.shiftKey
        ) {
            return false;
        }


        const href =
            getNavigationURL(
                element
            );


        if (!href) {
            return false;
        }


        if (
            isHashOnly(
                href
            )
        ) {
            return false;
        }


        if (
            isNonNavigationScheme(
                href
            )
        ) {
            return false;
        }


        const url =
            parseURL(
                href
            );


        if (!url) {
            return false;
        }


        const currentURL =
            new URL(
                location.href
            );


        // --------------------------------------------------------
        // 高优先级分页
        // --------------------------------------------------------

        if (
            CONFIG.forcePaginationCurrentTab &&
            isHighConfidencePagination(
                element,
                currentURL,
                url
            )
        ) {
            return false;
        }


        // --------------------------------------------------------
        // 高优先级搜索
        // --------------------------------------------------------

        if (
            CONFIG.forceSearchCurrentTab &&
            isHighConfidenceSearchNavigation(
                element,
                currentURL,
                url
            )
        ) {
            return false;
        }


        // --------------------------------------------------------
        // 页面内部 UI
        // --------------------------------------------------------

        if (
            isInPageInteraction(
                element,
                url
            )
        ) {
            return false;
        }


        // --------------------------------------------------------
        // Auth
        // --------------------------------------------------------

        if (
            isAuthFlow(
                element,
                url
            )
        ) {
            return false;
        }


        // --------------------------------------------------------
        // 特殊行为
        // --------------------------------------------------------

        if (
            isSpecialBrowserAction(
                element,
                url
            )
        ) {
            return false;
        }


        // --------------------------------------------------------
        // Hash / 当前页面
        // --------------------------------------------------------

        if (
            isHashOnly(
                href
            )
        ) {
            return false;
        }


        if (
            url.origin ===
                currentURL.origin &&
            url.pathname ===
                currentURL.pathname &&
            url.search ===
                currentURL.search
        ) {
            return false;
        }


        // --------------------------------------------------------
        // target
        // --------------------------------------------------------

        const target =
            normalize(
                element.getAttribute(
                    'target'
                )
            );


        if (
            CONFIG.respectExplicitNewTab &&
            /^(?:_blank|_new)$/i
                .test(target)
        ) {
            return false;
        }


        // --------------------------------------------------------
        // 普通评分
        // --------------------------------------------------------

        const score =
            calculateNavigationScore(
                element,
                url
            );


        log(
            'NORMAL NAVIGATION',
            {
                url:
                    url.href,
                score
            }
        );


        return (
            score >=
            CONFIG.navigationScoreThreshold
        );
    };


    // ============================================================
    // 新标签
    // ============================================================

    const openInNewTab = (
        url,
        event
    ) => {

        if (!url) {
            return;
        }


        const background =
            !!(
                event?.ctrlKey ||
                event?.metaKey ||
                event?.button === 1
            );


        const active =
            CONFIG.backgroundWithModifier
                ? !background
                : true;


        log(
            'OPEN NEW TAB',
            url,
            {
                active,
                background
            }
        );


        GM_openInTab(
            url,
            {
                active,
                insert: true,
                setParent: true
            }
        );
    };


    // ============================================================
    // 当前页面导航
    // ============================================================

    const navigateCurrentTab = (
        url
    ) => {

        if (!url) {
            return;
        }


        log(
            'FORCE CURRENT TAB',
            url
        );


        window.location.assign(
            url
        );
    };


    // ============================================================
    // 阻止原网站 click
    // ============================================================

    const consumeEvent = (
        event
    ) => {

        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();
    };


    // ============================================================
    // Left Click
    // ============================================================

    window.addEventListener(
        'click',
        function (event) {

            if (
                event.button !== 0 &&
                event.button !== undefined
            ) {
                return;
            }


            const element =
                getClickableElement(
                    event
                );


            if (!element) {
                return;
            }


            const href =
                getNavigationURL(
                    element
                );


            if (!href) {
                return;
            }


            if (
                isNonNavigationScheme(
                    href
                )
            ) {
                return;
            }


            const url =
                parseURL(
                    href
                );


            if (!url) {
                return;
            }


            const currentURL =
                new URL(
                    location.href
                );


            // ====================================================
            // ★★★★★
            // 分页 -> 当前页面
            // ====================================================

            if (
                CONFIG.forcePaginationCurrentTab &&
                isHighConfidencePagination(
                    element,
                    currentURL,
                    url
                )
            ) {

                log(
                    'PAGINATION -> CURRENT TAB',
                    url.href
                );


                consumeEvent(
                    event
                );


                navigateCurrentTab(
                    url.href
                );


                return;
            }


            // ====================================================
            // ★★★★★
            // 搜索 -> 当前页面
            // ====================================================

            if (
                CONFIG.forceSearchCurrentTab &&
                isHighConfidenceSearchNavigation(
                    element,
                    currentURL,
                    url
                )
            ) {

                log(
                    'SEARCH -> CURRENT TAB',
                    url.href
                );


                consumeEvent(
                    event
                );


                navigateCurrentTab(
                    url.href
                );


                return;
            }


            // ====================================================
            // 普通链接 -> 新标签
            // ====================================================

            if (
                !shouldOpenInNewTab(
                    element,
                    event
                )
            ) {
                return;
            }


            consumeEvent(
                event
            );


            openInNewTab(
                url.href,
                event
            );

        },
        true
    );


    // ============================================================
    // Middle Click
    // ============================================================

    window.addEventListener(
        'auxclick',
        function (event) {

            if (
                event.button !== 1
            ) {
                return;
            }


            const element =
                getClickableElement(
                    event
                );


            if (!element) {
                return;
            }


            const href =
                getNavigationURL(
                    element
                );


            if (!href) {
                return;
            }


            const url =
                parseURL(
                    href
                );


            if (!url) {
                return;
            }


            const currentURL =
                new URL(
                    location.href
                );


            // ----------------------------------------------------
            // 分页中键
            // ----------------------------------------------------

            const pagination =
                isHighConfidencePagination(
                    element,
                    currentURL,
                    url
                );


            if (
                pagination &&
                CONFIG.forcePaginationMiddleClick
            ) {

                consumeEvent(
                    event
                );


                navigateCurrentTab(
                    url.href
                );


                return;
            }


            // ----------------------------------------------------
            // 搜索中键
            // ----------------------------------------------------

            const search =
                isHighConfidenceSearchNavigation(
                    element,
                    currentURL,
                    url
                );


            if (
                search &&
                CONFIG.forceSearchMiddleClick
            ) {

                consumeEvent(
                    event
                );


                navigateCurrentTab(
                    url.href
                );


                return;
            }


            // ----------------------------------------------------
            // 普通新标签
            // ----------------------------------------------------

            if (
                !shouldOpenInNewTab(
                    element,
                    event
                )
            ) {
                return;
            }


            consumeEvent(
                event
            );


            openInNewTab(
                url.href,
                event
            );

        },
        true
    );


    // ============================================================
    // Middle Mouse Down
    // ============================================================

    window.addEventListener(
        'mousedown',
        function (event) {

            if (
                event.button !== 1
            ) {
                return;
            }


            const element =
                getClickableElement(
                    event
                );


            if (!element) {
                return;
            }


            if (
                !shouldOpenInNewTab(
                    element,
                    event
                )
            ) {
                return;
            }


            event.preventDefault();

        },
        true
    );


    // ============================================================
    // Debug API
    // ============================================================

    window.SmartNewTab = {

        version:
            '4.2.0',


        analyze(element) {

            if (
                !(element instanceof Element)
            ) {

                return {
                    error:
                        'Element is required.'
                };
            }


            const href =
                getNavigationURL(
                    element
                );


            const url =
                parseURL(
                    href
                );


            const currentURL =
                new URL(
                    location.href
                );


            if (!url) {

                return {
                    element,
                    href,
                    url: null,
                    shouldOpen: false
                };
            }


            const pagination =
                isHighConfidencePagination(
                    element,
                    currentURL,
                    url
                );


            const search =
                isHighConfidenceSearchNavigation(
                    element,
                    currentURL,
                    url
                );


            const ui =
                isInPageInteraction(
                    element,
                    url
                );


            const auth =
                isAuthFlow(
                    element,
                    url
                );


            const special =
                isSpecialBrowserAction(
                    element,
                    url
                );


            const score =
                calculateNavigationScore(
                    element,
                    url
                );


            return {

                version:
                    '4.2.0',

                tag:
                    element.tagName,

                text:
                    getElementText(
                        element
                    ),

                href,

                currentURL:
                    currentURL.href,

                targetURL:
                    url.href,

                forcedPagination:
                    pagination,

                forcedSearch:
                    search,

                inPageUI:
                    ui,

                auth,

                special,

                disabled:
                    isDisabledElement(
                        element
                    ),

                navigationScore:
                    score,

                finalDecision:

                    pagination &&
                    CONFIG.forcePaginationCurrentTab

                        ? 'CURRENT TAB - PAGINATION'

                    : search &&
                      CONFIG.forceSearchCurrentTab

                        ? 'CURRENT TAB - SEARCH'

                    : ui

                        ? 'KEEP NATIVE - UI'

                    : auth

                        ? 'KEEP NATIVE - AUTH'

                    : special

                        ? 'KEEP NATIVE - SPECIAL'

                    : 'NEW TAB'
            };
        },


        config:
            CONFIG
    };


    log(
        'SmartNewTab 4.2.0 initialized on',
        domain
    );

})();
