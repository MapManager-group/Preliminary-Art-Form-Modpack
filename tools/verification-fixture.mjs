// Disposable integration source: never depends on this modpack's production targets.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pakku, requireSuccess} from './lib/pakku.mjs';

export async function createVerificationFixture(root) {
  const target={id:'fabric-1.21.1',path:'packs/fabric-1.21.1',artifacts:['modrinth','serverpack']};
  const dir=path.join(root,target.path);
  await fs.mkdir(dir,{recursive:true});
  requireSuccess(await pakku(root,dir,['--yes','init','--name','Verification-Fabric','--version','0.1.0','--mc-versions','1.21.1','--loaders','fabric=0.16.14','--target','modrinth'],{capture:true}));
  await fs.writeFile(path.join(dir,'pakku.json'),JSON.stringify({name:'Verification-Fabric',version:'0.1.0',overrides:['config'],client_overrides:['client-note.txt'],server_overrides:['server-note.txt']},null,2)+'\n');
  for(const [file,text] of Object.entries({
    'config/db-example.json':'{"example":true}',
    'client-note.txt':'client fixture', 'server-note.txt':'server fixture',
    '.pakku/overrides/template-common.txt':'common fixture',
    '.pakku/client-overrides/config/db-client.json':'{"client":true}',
    '.pakku/server-overrides/config/db-server.json':'{"server":true}'
  })) {
    await fs.mkdir(path.dirname(path.join(dir,file)),{recursive:true});
    await fs.writeFile(path.join(dir,file),text+'\n');
  }
  await fs.writeFile(path.join(root,'workspace.json'),JSON.stringify({targets:[target]},null,2)+'\n');
  return target;
}
