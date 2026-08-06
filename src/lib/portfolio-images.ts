import type { ImageMetadata } from 'astro';

const portfolioImages = import.meta.glob<{ default: ImageMetadata }>(
	'/src/assets/portfolio/**/*.{jpeg,jpg,png,webp}',
	{ eager: true },
);

export const getPortfolioImage = (src: string) => {
	const image = portfolioImages[`/src/assets${src}`]?.default;
	if (!image) throw new Error(`Portfolio image not found: ${src}`);
	return image;
};
