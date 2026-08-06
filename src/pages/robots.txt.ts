import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
	const origin = site ?? new URL('https://indesign-studio-layout.vercel.app');
	return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', origin)}\n`, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
