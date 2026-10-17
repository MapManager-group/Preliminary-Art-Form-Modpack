// Opt-in stderr protocol; stdout and exit codes remain owned by the CLI.
export function progress(stage, message) {
  emit({type:'progress',stage,message});
}
export function diagnostic(text) {
  if(text)emit({type:'diagnostic',text});
}
function emit(event) {
  if(process.env.MP_PROGRESS==='jsonl')process.stderr.write('@mp:'+JSON.stringify({schema:1,...event})+'\n');
}
