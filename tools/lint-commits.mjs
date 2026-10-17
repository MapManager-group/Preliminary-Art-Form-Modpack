import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run,requireSuccess} from './lib/pakku.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

export async function lintCommits(root,args=[],{capture=false}={}) {
  args=[...args];if(args[0]==='--')args.shift();
  if(!args.length) {
    requireSuccess(await run('git',['rev-parse','--git-dir'],{cwd:root,capture:true}));
    const head=await run('git',['rev-parse','--verify','HEAD'],{cwd:root,capture:true});
    if(head.code!==0) {
      // Only an unborn branch is a valid empty history; repository errors must still fail.
      const ref=requireSuccess(await run('git',['symbolic-ref','HEAD'],{cwd:root,capture:true})).stdout.trim();
      const existing=await run('git',['show-ref','--verify','--quiet',ref],{cwd:root,capture:true});
      if(existing.code!==1)requireSuccess(head);
      return {code:0,stdout:'尚无提交，提交检查未执行\n',stderr:'',skipped:true};
    }
    args=['--last','--verbose'];
  }
  return requireSuccess(await run(process.execPath,[require.resolve('@commitlint/cli/cli.js'),...args],{cwd:root,capture}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const result=await lintCommits(process.cwd(),process.argv.slice(2));if(result.skipped)console.log(result.stdout.trim());}
  catch(e){console.error(e.message);process.exitCode=e.exitCode??1;}
}
