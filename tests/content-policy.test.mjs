import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {managedPath,portablePath,publicContent} from '../tools/lib/content-policy.mjs';
import {runtimePath} from '../tools/lib/runtime-fs.mjs';

test('作者内容按准确路径分类，不因扩展名、子目录或关键词误拦',()=>{
  for(const name of ['options.txt','optionsof.txt','optionsshaders.txt','custom.json','servers.dat','server.properties','kubejs/startup_scripts/a.js','scripts/helper.ps1','start.sh','native/helper.dll','config/accounts-settings.json','config/launcher-theme.json','config/hmcl-example.json','config/template/assets/a.png','config/template/saves/world.dat','config/example.log','config/public.pem','config/keybindings.key','resourcepacks/demo/assets/demo/a.png'])assert.equal(managedPath(name),name);
  for(const name of ['../escape','a\\b','C:/x','config/CON','config/x:stream','assets/index.json','saves/world.dat','logs/latest.log','versions/v/v.json','PCL/Setup.ini','hmclversion.cfg','launcher_profiles.json','launcher_accounts.json','config/credentials.json','config/.env','config/.git/a','.pakku/secret'])assert.throws(()=>managedPath(name),undefined,name);
  assert.equal(portablePath('overrides/saves/template.dat'),'overrides/saves/template.dat','generic ZIP structural validation is not a game-directory policy');
});
test('空凭据字段和公开证书允许，实际 token 与私钥仍拒绝',()=>{
  for(const text of ['{"accessToken":""}','{"refreshToken":null}','-----BEGIN CERTIFICATE-----\npublic','{"accountsSetting":true}'])assert.doesNotThrow(()=>publicContent(Buffer.from(text),'fixture'));
  for(const text of ['{"accessToken":"secret"}','curseforge_api_key = "secret"','-----BEGIN RSA PRIVATE KEY-----\nsecret'])assert.throws(()=>publicContent(Buffer.from(text),'fixture'),/凭据/);
});
test('按实际版本目录保护 JSON 和 JAR，允许其他根目录配置',()=>{
  const runtime={gameDir:path.resolve('fixture-game'),versionDir:path.resolve('fixture-game/Actual'),versionId:'incorrect-stored-id'};
  assert.equal(runtimePath(runtime,'custom.json'),'custom.json');
  for(const name of ['Actual/Actual.json','Actual/Actual.jar','actual/actual.JSON'])assert.throws(()=>runtimePath(runtime,name),/实际启动器/);
});
