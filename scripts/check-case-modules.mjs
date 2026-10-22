import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';

const pages = {
	iofs: await readFile('dist/projects/publications/iofs/index.html', 'utf8'),
	unesco: await readFile('dist/projects/publications/unesco/index.html', 'utf8'),
	kipd: await readFile('dist/projects/publications/kipd/index.html', 'utf8'),
	infographics: await readFile('dist/projects/infographics/index.html', 'utf8'),
};

for (const [name, html] of Object.entries(pages).filter(([name]) => ['iofs', 'kipd'].includes(name))) {
	assert.match(html, /class="case-facts"/, `${name}: common facts module is missing`);
	assert.match(html, /class="case-results"/, `${name}: common results module is missing`);
}

assert.match(pages.iofs, /case-gallery-spread/);
assert.doesNotMatch(pages.unesco, /unesco-flipbook|case-gallery|case-analysis/);
assert.equal((pages.unesco.match(/<img\b[^>]*\bsrc=/g) ?? []).length, 6, 'UNESCO: expected the site logo and all five covers');
assert.ok(!(await readdir('dist')).includes('unesco-flipbook'), 'UNESCO: flipbook must not be published');
assert.deepEqual((await readdir('src/assets/portfolio/unesco')).sort(), ['appendix-1-cover.webp', 'appendix-2-cover.webp', 'appendix-3-cover.webp', 'appendix-4-cover.webp', 'diagnostic-cover.webp']);
const publications = await readFile('dist/projects/publications/index.html', 'utf8');
assert.match(publications, /href="\/projects\/publications\/unesco"/);
assert.doesNotMatch(publications, /pk-effekt-flipbook/);
const home = await readFile('dist/index.html', 'utf8');
assert.match(home, /href="\/projects\/catalogs"/);
const catalog = await readFile('dist/projects/catalogs/index.html', 'utf8');
assert.match(catalog, /href="\/pk-effekt-flipbook\/index\.html"/);
assert.match(await readFile('dist/sitemap.xml', 'utf8'), /\/projects\/catalogs<\/loc>/);
await access('dist/pk-effekt-flipbook/index.html');
const brochureScript = await readFile('dist/pk-effekt-flipbook/data/ru.js', 'utf8');
const brochure = JSON.parse(brochureScript.slice(brochureScript.indexOf(']={') + 2).trim().replace(/;$/, ''));
assert.equal(brochure.pages.length, 26, 'PK EFFEKT: expected all 26 pages');
assert.equal(brochure.n, brochure.pages.length);
for (let page = 1; page <= brochure.n; page++) {
	await access(`dist/pk-effekt-flipbook/ru/p-${String(page).padStart(2, '0')}.jpg`);
}
assert.match(pages.kipd, /case-gallery-pages/);
assert.match(pages.infographics, /case-gallery-numbered/);
assert.match(pages.iofs, /data-case-lightbox="spread"/);
assert.match(pages.kipd, /data-case-lightbox="single"/);
assert.match(pages.infographics, /data-case-lightbox="single"/);

for (const [name, html] of Object.entries(pages).filter(([name]) => ['iofs', 'kipd', 'infographics'].includes(name))) {
	const gallery = html.match(/<section id="case-gallery"[\s\S]*?<\/section>/)?.[0] ?? '';
	const images = gallery.match(/<img\b[^>]*>/g) ?? [];
	assert.ok(images.length > 0, `${name}: gallery images are missing`);
	images.forEach((image) => {
		assert.match(image, /\bwidth="\d+"/, `${name}: gallery image width is missing`);
		assert.match(image, /\bheight="\d+"/, `${name}: gallery image height is missing`);
	});
}

console.log('Case modules: OK');
