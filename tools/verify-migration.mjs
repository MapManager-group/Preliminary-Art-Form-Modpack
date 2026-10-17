// One-time v1 -> v2 acceptance check. The audit is historical, not a dependency registry.
// Usage: node tools/verify-migration.mjs <built.mrpack>
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inspectArchive} from './lib/archive.mjs';
import {filesUnder} from './lib/workspace.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv[2])throw new Error('需要指定迁移版本 A1.3.1 的 MRPACK');
const audit=JSON.parse(await fs.readFile(path.join(root,'docs/MIGRATION-V2-AUDIT.json'),'utf8'));
const target=path.join(root,'packs/client-26.2');
const lock=JSON.parse(await fs.readFile(path.join(target,'pakku-lock.json'),'utf8'));
const entries=inspectArchive(await fs.readFile(process.argv[2]),'modrinth');
const index=JSON.parse(new TextDecoder().decode(entries['modrinth.index.json']));
assert.deepEqual(index.dependencies,{minecraft:'26.2','fabric-loader':'0.19.5'});
assert.equal(index.name,'Preliminary Art Form');assert.equal(index.versionId,'A1.3.1');
const expected=audit.dependencies.filter(d=>d.mode==='modrinth');
assert.equal(lock.projects.length,86);assert.equal(index.files.length,86);
assert.equal(new Set(index.files.map(f=>f.path.toLowerCase())).size,86);
for(const dep of expected) {
  const project=lock.projects.find(p=>p.id.modrinth===dep['mod-id']);
  assert.ok(project,dep.source);
  assert.ok(project.files.some(f=>f.id===dep.version),dep.source+' exact version');
  const file=index.files.find(f=>f.path===dep.path);assert.ok(file,dep.path);
  for(const [algorithm,hash] of Object.entries(dep.hashes))assert.equal(file.hashes[algorithm],hash,dep.path);
  assert.equal(file.env.client,dep.side==='server'?'unsupported':'required',dep.path+' client');
  assert.equal(file.env.server,dep.side==='client'?'unsupported':'required',dep.path+' server');
}
const resources=audit.resources;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const actual=Object.keys(entries).filter(n=>n!=='modrinth.index.json'&&!n.endsWith('/'));
assert.equal(actual.length,resources.length);
for(const item of resources) {
  const entry='client-overrides/'+item.path;
  assert.ok(entries[entry],entry);assert.equal(digest(entries[entry]),item.sha256,entry);
  assert.equal(digest(await fs.readFile(path.join(target,'.pakku',entry))),item.sha256,item.path+' source');
}
assert.equal((await filesUnder(path.join(target,'.pakku/client-overrides'))).length,141);
assert.ok(!actual.includes('client-overrides/options.txt'));
assert.ok(entries['client-overrides/config/yosbr/options.txt']);
console.log(JSON.stringify({managed:86,resources:141,duplicates:0,versions:'exact',sides:'preserved',hashes:'passed',rootOptions:'excluded',yosbr:'preserved'}));
