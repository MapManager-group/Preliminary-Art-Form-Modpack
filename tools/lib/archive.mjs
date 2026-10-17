import { unzipSync } from 'fflate';
import { managedPath, portablePath, publicContent } from './content-policy.mjs';

const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes) {let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function inspectZip(input) {
  const bytes=Buffer.from(input);
  if(bytes.length>512*1024*1024||bytes.length<22)throw new Error('ZIP 大小无效或超过 512 MiB');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50 && i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
  if(end<0)throw new Error('ZIP 缺少完整目录');
  const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
  if(bytes.readUInt32LE(end+4)!==0||bytes.readUInt16LE(end+8)!==count||count===65535||count>20000||start+size!==end)throw new Error('不支持分卷/ZIP64 或无效 ZIP 目录');
  const records=[],names=new Map();let cursor=start,total=0;
  for(let i=0;i<count;i++) {
    if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)throw new Error('ZIP 目录损坏');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),compressed=bytes.readUInt32LE(cursor+20),length=bytes.readUInt32LE(cursor+24),n=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),offset=bytes.readUInt32LE(cursor+42);
    if(cursor+46+n+extra+comment>end||flags&1||![0,8].includes(method)||bytes.readUInt16LE(cursor+34)!==0)throw new Error('ZIP 编码/加密/压缩方式不受支持');
    const nameBytes=bytes.subarray(cursor+46,cursor+46+n),name=new TextDecoder('utf-8',{fatal:true}).decode(nameBytes),plain=name.replace(/\/$/,'');
    portablePath(plain);
    const key=plain.toLowerCase();
    if(names.has(key))throw new Error('ZIP 重复/大小写冲突路径');
    names.set(key,name.endsWith('/'));
    const mode=bytes.readUInt32LE(cursor+38)>>>16;
    if((mode&0xf000) && ![0x8000,0x4000].includes(mode&0xf000))throw new Error('ZIP 含链接或特殊文件');
    if(offset+30>start||bytes.readUInt32LE(offset)!==0x04034b50||bytes.readUInt16LE(offset+6)!==flags||bytes.readUInt16LE(offset+8)!==method)throw new Error('ZIP 本地头不一致');
    const localN=bytes.readUInt16LE(offset+26),localExtra=bytes.readUInt16LE(offset+28),dataStart=offset+30+localN+localExtra;
    if(dataStart+compressed>start||!bytes.subarray(offset+30,offset+30+localN).equals(nameBytes))throw new Error('ZIP 路径或数据边界不一致');
    total+=length;if(total>1024*1024*1024||length>256*1024*1024)throw new Error('ZIP 解压大小超限');
    records.push({name,length,crc,offset,end:dataStart+compressed});cursor+=46+n+extra+comment;
  }
  if(cursor!==end)throw new Error('ZIP 目录长度不符');
  const ranges=[...records].sort((a,b)=>a.offset-b.offset);
  for(let i=1;i<ranges.length;i++)if(ranges[i].offset<ranges[i-1].end)throw new Error('ZIP 文件数据重叠');
  for(const key of names.keys()) {const parts=key.split('/');parts.pop();while(parts.length){if(names.get(parts.join('/'))===false)throw new Error('ZIP 文件/目录冲突');parts.pop();}}
  const entries=unzipSync(bytes);
  for(const item of records)if(!entries[item.name]||entries[item.name].length!==item.length||crc32(entries[item.name])!==item.crc)throw new Error('ZIP 内容长度/CRC 校验失败');
  return entries;
}
export function inspectArchive(bytes,kind) {
  const entries=inspectZip(bytes);
  if(kind==='modrinth') {
    const raw=entries['modrinth.index.json'];if(!raw||raw.length>8*1024*1024)throw new Error('缺少或过大的 mrpack index');
    const index=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    if(index.formatVersion!==1||index.game!=='minecraft'||!Array.isArray(index.files)||!index.dependencies?.minecraft)throw new Error('无效 mrpack index');
    for(const name of Object.keys(entries)) {
      if(name==='modrinth.index.json')continue;
      const match=name.match(/^(overrides|client-overrides|server-overrides)\/(.*)$/);
      if(!match)throw new Error(`MRPACK 未知内容: ${name}`);
      if(match[2]) {
        managedPath(match[2].replace(/\/$/,''));
        if(!name.endsWith('/'))publicContent(entries[name],name);
      }
    }
  }
  if(kind==='curseforge') {
    if(!entries['manifest.json'])throw new Error('缺少 CurseForge manifest');
    const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entries['manifest.json']));
    if(manifest.manifestVersion!==1||!manifest.minecraft?.version||!Array.isArray(manifest.files)||manifest.files.some(f=>!Number.isSafeInteger(f.projectID)||!Number.isSafeInteger(f.fileID)))throw new Error('无效 CurseForge manifest');
  }
  return entries;
}
