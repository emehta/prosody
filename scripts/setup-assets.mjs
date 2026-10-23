import {copyFile,mkdir} from 'node:fs/promises';
const pairs=[
  ['@huggingface/transformers/dist/transformers.min.js','vendor/transformers.js'],
  ['@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm','vendor/ort-wasm-simd-threaded.jsep.wasm'],
  ['@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs','vendor/ort-wasm-simd-threaded.jsep.mjs'],
  ['onnxruntime-web/dist/ort.bundle.min.mjs','vendor/ort.bundle.min.mjs'],
  ['@huggingface/transformers/LICENSE','vendor/transformers-LICENSE.txt'],
  ['@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2','assets/sans.woff2'],
  ['@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff2','assets/sans-medium.woff2'],
  ['@fontsource/dm-sans/LICENSE','assets/sans-LICENSE.txt']
];
await mkdir('dist/vendor',{recursive:true});await mkdir('dist/assets',{recursive:true});
for(const [source,target] of pairs)await copyFile('node_modules/'+source,'dist/'+target);
console.log('Browser runtime and fonts copied.');
const {readFile,writeFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
const packages=Object.fromEntries(await Promise.all(['@huggingface/transformers','@fontsource/dm-sans'].map(async name=>[name,JSON.parse(await readFile('node_modules/'+name+'/package.json','utf8')).version])));
const files=await Promise.all(pairs.map(async([,path])=>{const bytes=await readFile('dist/'+path);return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}));
await writeFile('dist/asset-manifest.json',JSON.stringify({packages,files},null,2)+'\n');
