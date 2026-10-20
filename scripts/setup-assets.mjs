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
