import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const pagesDirectory = join(root, 'src', 'pages');
const widths = [320, 360, 390, 430, 768, 1024, 1280, 1440];
const productionOrigin = 'https://indesign-studio-layout.vercel.app';

const files = await findAstroPages(pagesDirectory);
const dynamicPages = files.filter((file) => relative(pagesDirectory, file).split(/[\\/]/).some((part) => part.startsWith('[')));
if (dynamicPages.length) throw new Error(`Add concrete responsive-test URLs for dynamic pages:\n${dynamicPages.join('\n')}`);
const routes = files
	.map((file) => relative(pagesDirectory, file).replaceAll('\\', '/'))
	.map((file) => {
		const path = file.replace(/\.astro$/, '').replace(/(^|\/)index$/, '$1');
		return `/${path}`.replace(/\/{2,}/g, '/');
	})
	.sort();

const browserPath = findBrowser();
const port = await getFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const astro = join(root, 'node_modules', 'astro', 'bin', 'astro.mjs');
const preview = spawn(process.execPath, [astro, 'preview', '--host', '127.0.0.1', '--port', String(port)], {
	cwd: root,
	stdio: ['ignore', 'pipe', 'pipe'],
});
let previewOutput = '';
preview.stdout.on('data', (chunk) => { previewOutput += chunk; });
preview.stderr.on('data', (chunk) => { previewOutput += chunk; });

let browser;
try {
	await waitForServer(baseUrl);
	await checkSeoEndpoints(baseUrl, routes);
	browser = await chromium.launch({ executablePath: browserPath, headless: true });
	const context = await browser.newContext({ viewport: { width: widths[0], height: 900 } });
	const page = await context.newPage();
	const failures = [];

	for (const width of widths) {
		await page.setViewportSize({ width, height: 900 });
		for (const route of routes) {
			const runtimeErrors = [];
			const onConsole = (message) => {
				if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
			};
			const onPageError = (error) => runtimeErrors.push(`page: ${error.message}`);
			const onRequestFailed = (request) => {
				const reason = request.failure()?.errorText;
				if (reason && reason !== 'net::ERR_ABORTED') runtimeErrors.push(`request: ${request.url()} (${reason})`);
			};
			page.on('console', onConsole);
			page.on('pageerror', onPageError);
			page.on('requestfailed', onRequestFailed);

			try {
				const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
				await page.evaluate(async () => {
					await document.fonts?.ready;
					const step = Math.max(240, Math.round(innerHeight * .8));
					for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
						scrollTo(0, y);
						await new Promise((resolve) => setTimeout(resolve, 15));
					}
					scrollTo(0, 0);
					await new Promise((resolve) => setTimeout(resolve, 150));
				});
				await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

				const audit = await page.evaluate(() => {
					const images = [...document.images];
					const interFaces = [...document.fonts].filter((face) => face.family.replaceAll('"', '') === 'Inter');
					const jsonLd = document.querySelector('script[type="application/ld+json"]')?.textContent ?? '';
					let structuredType = '';
					try { structuredType = JSON.parse(jsonLd)['@type']; } catch {}
					const raster = images.filter((image) => {
						const src = image.currentSrc || image.getAttribute('src') || '';
						return src && !src.startsWith('data:image/svg+xml');
					});
					return {
						overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
						brokenImages: raster.filter((image) => image.complete && image.naturalWidth === 0).length,
						missingDimensions: images.filter((image) => !image.width || !image.height).length,
						missingSrcset: raster.filter((image) => !image.srcset).length,
						missingSizes: raster.filter((image) => image.srcset && !image.sizes).length,
						fontLoaded: interFaces.length > 0 && interFaces.every((face) => face.status === 'loaded'),
						fontPreloaded: Boolean(document.querySelector('link[rel="preload"][as="font"][href="/fonts/inter-variable.woff2"]')),
						seo: {
							canonical: document.querySelector('link[rel="canonical"]')?.href ?? '',
							ogTitle: document.querySelector('meta[property="og:title"]')?.content ?? '',
							ogDescription: document.querySelector('meta[property="og:description"]')?.content ?? '',
							ogUrl: document.querySelector('meta[property="og:url"]')?.content ?? '',
							ogImage: document.querySelector('meta[property="og:image"]')?.content ?? '',
							twitterCard: document.querySelector('meta[name="twitter:card"]')?.content ?? '',
							structuredType,
						},
					};
				});
				const expectedCanonical = new URL(route === '/' ? '/' : route.replace(/\/+$/, ''), productionOrigin).toString();
				const issues = [
					!response?.ok() && `HTTP ${response?.status() ?? 'error'}`,
					audit.overflow > 0 && `horizontal overflow ${audit.overflow}px`,
					audit.brokenImages > 0 && `broken images ${audit.brokenImages}`,
					audit.missingDimensions > 0 && `images without dimensions ${audit.missingDimensions}`,
					audit.missingSrcset > 0 && `raster images without srcset ${audit.missingSrcset}`,
					audit.missingSizes > 0 && `responsive images without sizes ${audit.missingSizes}`,
					!audit.fontLoaded && 'Inter variable font is not loaded',
					!audit.fontPreloaded && 'Inter variable font preload is missing',
					width === widths[0] && audit.seo.canonical !== expectedCanonical && `wrong canonical ${audit.seo.canonical}`,
					width === widths[0] && (!audit.seo.ogTitle || !audit.seo.ogDescription) && 'Open Graph title or description is missing',
					width === widths[0] && audit.seo.ogUrl !== expectedCanonical && `wrong og:url ${audit.seo.ogUrl}`,
					width === widths[0] && audit.seo.ogImage !== `${productionOrigin}/og/indesign-studio.png` && `wrong og:image ${audit.seo.ogImage}`,
					width === widths[0] && audit.seo.twitterCard !== 'summary_large_image' && 'Twitter large card is missing',
					width === widths[0] && audit.seo.structuredType !== 'ProfessionalService' && 'ProfessionalService JSON-LD is missing',
					...runtimeErrors,
				].filter(Boolean);
				if (issues.length) failures.push({ route, width, issues });
			} catch (error) {
				failures.push({ route, width, issues: [error.message] });
			} finally {
				page.off('console', onConsole);
				page.off('pageerror', onPageError);
				page.off('requestfailed', onRequestFailed);
			}
		}
	}

	console.log(`Responsive check: ${routes.length} pages × ${widths.length} widths = ${routes.length * widths.length} checks`);
	console.log(`Browser: ${basename(browserPath)}`);
	console.log(`Widths: ${widths.join(', ')} px`);
	if (failures.length) {
		for (const failure of failures) console.error(`${failure.width}px ${failure.route}: ${failure.issues.join('; ')}`);
		process.exitCode = 1;
	} else {
		console.log('Responsive check: OK');
	}
} finally {
	await browser?.close();
	preview.kill();
}

async function findAstroPages(directory) {
	const result = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) result.push(...await findAstroPages(path));
		else if (entry.isFile() && entry.name.endsWith('.astro')) result.push(path);
	}
	return result;
}

function findBrowser() {
	const under = (directory, ...parts) => directory ? join(directory, ...parts) : null;
	const candidates = [
		process.env.BROWSER_PATH,
		under(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
		under(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
		under(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
		under(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
		'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/usr/bin/microsoft-edge',
		'/usr/bin/google-chrome',
		'/usr/bin/chromium',
	].filter(Boolean);
	const path = candidates.find(existsSync);
	if (!path) throw new Error('Chrome or Edge not found. Set BROWSER_PATH to the browser executable.');
	return path;
}

function getFreePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

async function waitForServer(url) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (preview.exitCode !== null) throw new Error(`Astro preview stopped early:\n${previewOutput}`);
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Astro preview did not start:\n${previewOutput}`);
}

async function checkSeoEndpoints(url, pageRoutes) {
	const [robotsResponse, sitemapResponse] = await Promise.all([
		fetch(`${url}/robots.txt`),
		fetch(`${url}/sitemap.xml`),
	]);
	if (!robotsResponse.ok || !sitemapResponse.ok) throw new Error('robots.txt or sitemap.xml is unavailable');
	const [robots, sitemap] = await Promise.all([robotsResponse.text(), sitemapResponse.text()]);
	if (!robots.includes(`Sitemap: ${productionOrigin}/sitemap.xml`)) throw new Error('robots.txt has the wrong sitemap URL');
	for (const route of pageRoutes) {
		const canonical = new URL(route === '/' ? '/' : route.replace(/\/+$/, ''), productionOrigin).toString();
		if (!sitemap.includes(`<loc>${canonical}</loc>`)) throw new Error(`sitemap.xml is missing ${canonical}`);
	}
}
