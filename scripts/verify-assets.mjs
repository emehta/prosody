import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('../dist/asset-manifest.json',import.meta.url),'utf8'));
for(const file of manifest.files){const data=await readFile(new URL('../dist/'+file.path,import.meta.url));const hash=createHash('sha256').update(data).digest('hex');if(data.length!==file.bytes||hash!==file.sha256)throw Error(`Runtime asset changed: ${file.path}. Restore assets with scripts/setup-assets.mjs and review the manifest.`);}
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
if(pkg.dependencies['@huggingface/transformers']!==manifest.packages['@huggingface/transformers'])throw Error('Speech runtime version differs from vendored asset manifest.');
console.log(`Verified ${manifest.files.length} pinned browser assets.`);
