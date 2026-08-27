import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { PMTiles, Compression } from "../frontend/node_modules/pmtiles/dist/esm/index.js";
import { VectorTile } from "../frontend/node_modules/@mapbox/vector-tile/index.js";
import { PbfReader } from "../frontend/node_modules/pbf/index.js";

class NodeFileSource {
  constructor(path) {
    this.path = path;
  }

  getKey() {
    return this.path;
  }

  async getBytes(offset, length) {
    const handle = await open(this.path, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      return {
        data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      };
    } finally {
      await handle.close();
    }
  }
}

async function decompress(buffer, compression) {
  if (compression === Compression.None) return buffer;

  if (compression === Compression.Gzip) {
    const output = gunzipSync(Buffer.from(buffer));
    return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
  }

  if (compression === Compression.Brotli) {
    const output = brotliDecompressSync(Buffer.from(buffer));
    return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
  }

  throw new Error(`Unsupported PMTiles compression: ${compression}`);
}

function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat, zoom) {
  const rad = lat * Math.PI / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom
  );
}

async function convert(inputPath, outputPath) {
  const archive = new PMTiles(new NodeFileSource(inputPath), undefined, decompress);
  const header = await archive.getHeader();
  const zoom = header.maxZoom;

  const minX = lonToTileX(header.minLon, zoom);
  const maxX = lonToTileX(header.maxLon, zoom);
  const minY = latToTileY(header.maxLat, zoom);
  const maxY = latToTileY(header.minLat, zoom);

  const features = [];

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const response = await archive.getZxy(zoom, x, y);
      if (!response) continue;

      const tile = new VectorTile(new PbfReader(new Uint8Array(response.data)));
      const layer = tile.layers.buildings;
      if (!layer) continue;

      for (let index = 0; index < layer.length; index += 1) {
        const feature = layer.feature(index).toGeoJSON(x, y, zoom);

        if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) {
          continue;
        }

        features.push({
          type: "Feature",
          id: feature.id ?? `${zoom}-${x}-${y}-${index}`,
          properties: feature.properties || {},
          geometry: feature.geometry,
        });
      }
    }
  }

  await mkdir(dirname(outputPath), { recursive: true });

  await writeFile(
    outputPath,
    JSON.stringify({ type: "FeatureCollection", features }),
    "utf-8"
  );

  console.log(`Exported ${features.length} buildings`);
  console.log(outputPath);
}

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/export-buildings-pmtiles-to-geojson.mjs input.pmtiles output.geojson");
  process.exit(1);
}

convert(inputPath, outputPath).catch((error) => {
  console.error(error);
  process.exit(1);
});