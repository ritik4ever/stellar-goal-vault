import fs from 'fs';
import path from 'path';
import { generateOpenApiDocument } from '../openapi';

const outputDir = path.resolve(__dirname, '..', '..', 'dist');
const outputPath = path.join(outputDir, 'openapi.json');

const document = generateOpenApiDocument();

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));

// eslint-disable-next-line no-console
console.log(`OpenAPI spec written to ${outputPath} (${document.paths ? Object.keys(document.paths).length : 0} paths)`);
