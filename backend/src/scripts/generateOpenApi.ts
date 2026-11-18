import fs from 'fs';
import path from 'path';
import { stringify } from 'yaml';
import { generateOpenApiDocument } from '../openapi';

const distDir = path.resolve(__dirname, '..', '..', 'dist');
const docsDir = path.resolve(__dirname, '..', '..', '..', 'docs');
const jsonOutputPath = path.join(distDir, 'openapi.json');
const yamlOutputPath = path.join(docsDir, 'openapi.yaml');

const document = generateOpenApiDocument();

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(jsonOutputPath, JSON.stringify(document, null, 2));
fs.writeFileSync(yamlOutputPath, stringify(document));

// eslint-disable-next-line no-console
console.log(
  `OpenAPI spec written to ${yamlOutputPath} (${document.paths ? Object.keys(document.paths).length : 0} paths)`,
);
