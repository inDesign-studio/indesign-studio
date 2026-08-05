import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pages = {
	iofs: await readFile('dist/projects/publications/iofs/index.html', 'utf8'),
	unesco: await readFile('dist/projects/publications/unesco/index.html', 'utf8'),
	kipd: await readFile('dist/projects/publications/kipd/index.html', 'utf8'),
	infographics: await readFile('dist/projects/infographics/index.html', 'utf8'),
};

for (const [name, html] of Object.entries(pages).filter(([name]) => name !== 'infographics')) {
	assert.match(html, /class="case-facts"/, `${name}: common facts module is missing`);
	assert.match(html, /class="case-results"/, `${name}: common results module is missing`);
}

assert.match(pages.iofs, /case-gallery-spread/);
assert.match(pages.unesco, /case-gallery-spread/);
assert.match(pages.kipd, /case-gallery-pages/);
assert.match(pages.infographics, /case-gallery-numbered/);
assert.match(pages.iofs, /data-case-lightbox="spread"/);
assert.match(pages.kipd, /data-case-lightbox="single"/);
assert.match(pages.infographics, /data-case-lightbox="single"/);

for (const [name, html] of Object.entries(pages).filter(([name]) => ['iofs', 'unesco', 'kipd', 'infographics'].includes(name))) {
	const gallery = html.match(/<section id="case-gallery"[\s\S]*?<\/section>/)?.[0] ?? '';
	const images = gallery.match(/<img\b[^>]*>/g) ?? [];
	assert.ok(images.length > 0, `${name}: gallery images are missing`);
	images.forEach((image) => {
		assert.match(image, /\bwidth="\d+"/, `${name}: gallery image width is missing`);
		assert.match(image, /\bheight="\d+"/, `${name}: gallery image height is missing`);
	});
}

console.log('Case modules: OK');
