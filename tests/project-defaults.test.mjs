import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {setup,save,stopped} from './sync-fixture.mjs';
import {deploy} from '../tools/lib/deploy.mjs';

test('YoSBR 默认设置可部署，未声明的玩家根 options 始终保留',async t=>{
  const f=await setup(t);
  await save(path.join(f.root,f.target.path,'.pakku/client-overrides/config/yosbr/options.txt'),'fullscreen:true\n');
  await save(path.join(f.gameDir,'options.txt'),'fullscreen:false\n');
  await f.stage();await deploy(f.root,f.runtime,f.target,stopped);
  assert.equal(await fs.readFile(path.join(f.gameDir,'config/yosbr/options.txt'),'utf8'),'fullscreen:true\n');
  assert.equal(await fs.readFile(path.join(f.gameDir,'options.txt'),'utf8'),'fullscreen:false\n');
});
