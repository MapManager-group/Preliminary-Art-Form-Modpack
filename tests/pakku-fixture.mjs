import fs from 'node:fs/promises';
import path from 'node:path';
import {pakku,requireSuccess} from '../tools/lib/pakku.mjs';

// Independent test data: changing or deleting the public sample Targets must not change tests.
const config={name:'Fixture-Pack',version:'0.1.0',overrides:['config'],client_overrides:['client-note.txt'],server_overrides:['server-note.txt']};
const resources={
  'config/db-example.json':'{"template":true}\n',
  'client-note.txt':'Client fixture\n',
  'server-note.txt':'Server fixture\n',
  '.pakku/overrides/template-common.txt':'Common fixture\n',
  '.pakku/client-overrides/config/db-client.json':'{"templateClient":true}\n',
  '.pakku/server-overrides/config/db-server.json':'{"templateServer":true}\n',
};
async function write(dir,name,value) {
  const file=path.join(dir,name);await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
}
export async function writeFixture(dir) {
  await write(dir,'pakku.json',config);
  // Unit-test lock only; native integration always initializes its lock using Pakku.
  await write(dir,'pakku-lock.json',{target:'modrinth',mc_versions:['1.21.1'],loaders:{fabric:'0.16.14'},lockfile_version:2});
  for(const [name,bytes] of Object.entries(resources))await write(dir,name,bytes);
}
export async function nativeWorkspace(root,specs=[{id:'fabric-1.21.1',loader:'fabric',version:'0.16.14'}]) {
  const targets=[];
  for(const spec of specs) {
    const target={id:spec.id,path:`packs/${spec.id}`,artifacts:['modrinth','serverpack']};
    const dir=path.join(root,target.path);await fs.mkdir(dir,{recursive:true});
    requireSuccess(await pakku(root,dir,['--yes','init','--name','Fixture-'+spec.id,'--version','0.1.0','--mc-versions','1.21.1','--loaders',`${spec.loader}=${spec.version}`,'--target','modrinth'],{capture:true}));
    const initialized=JSON.parse(await fs.readFile(path.join(dir,'pakku.json'),'utf8'));
    await write(dir,'pakku.json',{...initialized,...config,name:'Fixture-'+spec.id});
    for(const [name,bytes] of Object.entries(resources))await write(dir,name,bytes);
    targets.push(target);
  }
  await write(root,'workspace.json',{targets});return {targets};
}
