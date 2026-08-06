import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import sharp from "sharp";

const [sourceArg, outputArg] = process.argv.slice(2);

if (!sourceArg || !outputArg) {
  throw new Error("Usage: node scripts/optimize-portfolio-images.mjs <source> <output>");
}

const sourceRoot = resolve(sourceArg);
const outputRoot = resolve(outputArg);

if (sourceRoot === outputRoot || outputRoot.startsWith(`${sourceRoot}\\`)) {
  throw new Error("Output must be outside the source directory");
}

async function walk(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.webp$/i.test(entry.name)) files.push(path);
  }

  return files;
}

function psnr(reference, candidate) {
  let squaredError = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const difference = reference[index] - candidate[index];
    squaredError += difference * difference;
  }
  const meanSquaredError = squaredError / reference.length;
  return meanSquaredError === 0 ? Infinity : 10 * Math.log10((255 * 255) / meanSquaredError);
}

await mkdir(outputRoot, { recursive: false });

const files = await walk(sourceRoot);
const results = [];

for (const sourcePath of files) {
  const relativePath = relative(sourceRoot, sourcePath);
  const outputPath = join(outputRoot, relativePath);
  const sourceStats = await stat(sourcePath);
  const metadata = await sharp(sourcePath).metadata();
  const longEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);
  const shouldResize = longEdge > 1600;
  const shouldRecompress = sourceStats.size > 250_000;

  await mkdir(dirname(outputPath), { recursive: true });

  if (!shouldResize && !shouldRecompress) {
    await copyFile(sourcePath, outputPath);
    results.push({ relativePath, before: sourceStats.size, after: sourceStats.size, changed: false });
    continue;
  }

  async function encode(quality) {
    let pipeline = sharp(sourcePath).rotate();
    if (shouldResize) {
      pipeline = pipeline.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });
    }
    return pipeline.webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
  }

  async function measureQuality(buffer) {
    const optimizedMetadata = await sharp(buffer).metadata();
    const width = optimizedMetadata.width;
    const height = optimizedMetadata.height;
    const reference = await sharp(sourcePath)
      .rotate()
      .resize({ width, height, fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();
    const candidate = await sharp(buffer).removeAlpha().raw().toBuffer();
    return { quality: psnr(reference, candidate), width, height };
  }

  let encoded = await encode(86);
  let measurement = await measureQuality(encoded);

  // Ponytail: PSNR is a coarse pixel metric; detailed layouts still need a visual spot-check.
  if (measurement.quality < 35) {
    encoded = await encode(90);
    measurement = await measureQuality(encoded);
  }

  if (encoded.length >= sourceStats.size * 0.95 || measurement.quality < 35) {
    await copyFile(sourcePath, outputPath);
    results.push({ relativePath, before: sourceStats.size, after: sourceStats.size, changed: false });
    continue;
  }

  await writeFile(outputPath, encoded);
  const { quality, width, height } = measurement;

  results.push({
    relativePath,
    before: sourceStats.size,
    after: encoded.length,
    changed: true,
    quality,
    width,
    height,
  });
}

const changed = results.filter((result) => result.changed);
const before = results.reduce((sum, result) => sum + result.before, 0);
const after = results.reduce((sum, result) => sum + result.after, 0);
const qualities = changed.map((result) => result.quality).sort((a, b) => a - b);

console.log(
  JSON.stringify(
    {
      files: results.length,
      changed: changed.length,
      before,
      after,
      saved: before - after,
      reductionPercent: Number((((before - after) / before) * 100).toFixed(1)),
      minimumPsnr: qualities.length ? Number(qualities[0].toFixed(2)) : null,
      medianPsnr: qualities.length ? Number(qualities[Math.floor(qualities.length / 2)].toFixed(2)) : null,
      largestAfter: [...results]
        .sort((a, b) => b.after - a.after)
        .slice(0, 10)
        .map(({ relativePath, after: bytes, width, height }) => ({ relativePath, bytes, width, height })),
    },
    null,
    2,
  ),
);
