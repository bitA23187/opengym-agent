import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createWatchCredentials, WatchError } from './watch-credentials.js';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export class HealthUploadError extends Error { constructor(message,code='invalid_upload_key'){super(message);this.status=401;this.code=code} }
// One upload credential for all Apple Health imports. Existing ogh_/ogd_ credentials
// stay valid without a migration write; either settings alias revokes/replaces both.
export function createHealthUploadCredentials({dataDir,getUser,now=Date.now}) {
  const watches=createWatchCredentials({dataDir,getUser});
  const shortcutDir=path.join(dataDir,'health-shortcuts');
  const roots=['heart-rate','daily-health'].map(name=>path.join(dataDir,name));
  const connection=(root,uid)=>path.join(root,hash(uid),'connection.json');
  const key=(root,digest)=>path.join(root,'keys',digest+'.json');
  const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}};
  const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(temp,file)}finally{fs.rmSync(temp,{force:true})}};
  const valid=(c,user)=>!!(c&&user&&!user.disabled&&c.uid===user.id&&c.sv===(user.sv||0));
  const connections=user=>roots.map(root=>({root,c:read(connection(root,user.id))})).filter(({c})=>valid(c,user));
  function revoke(uid){for(const root of roots){const c=read(connection(root,uid));if(c?.keyHash)fs.rmSync(key(root,c.keyHash),{force:true});fs.rmSync(connection(root,uid),{force:true})}}
  return {
    status(user){const active=connections(user);return {connected:!!active.length,expiresAt:null,credentialCount:active.length,lifetimeDays:null}},
    issue(user){revoke(user.id);const token='ogh_'+crypto.randomBytes(32).toString('base64url'),c={uid:user.id,sv:user.sv||0,keyHash:hash(token),expiresAt:null};write(key(roots[0],c.keyHash),c);write(connection(roots[0],user.id),c);return {token,expiresAt:c.expiresAt,lifetimeDays:null}},
    issueShortcut(user){
      fs.mkdirSync(shortcutDir,{recursive:true,mode:0o700});
      const active=[];
      for(const name of fs.readdirSync(shortcutDir)){
        if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
        const file=path.join(shortcutDir,name),c=read(file);
        if(!c||c.expiresAt<=now())fs.rmSync(file,{force:true});
        else if(c.uid===user.id)active.push({file,expiresAt:c.expiresAt});
      }
      // Bound simultaneous launches without touching long-lived client credentials.
      active.sort((a,b)=>b.expiresAt-a.expiresAt);
      for(const c of active.slice(9))fs.rmSync(c.file,{force:true});
      const token='ogs_'+crypto.randomBytes(32).toString('base64url');
      const expiresAt=now()+30*60000;
      write(path.join(shortcutDir,hash(token)+'.json'),{uid:user.id,sv:user.sv||0,expiresAt});
      return {token,expiresAt};
    },
    authenticate(req){
      if(/^Bearer ogs_/.test(req.headers.authorization||'')){
        const token=/^Bearer (ogs_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization)?.[1];
        const c=token&&read(path.join(shortcutDir,hash(token)+'.json')),user=c&&getUser(c.uid);
        const route=(req.method||'')+' '+new URL(req.url||'/', 'http://x').pathname;
        if(!valid(c,user)||c.expiresAt<=now()||!['POST /api/heart-rate/pending','POST /api/heart-rate/import','POST /api/daily-health/import'].includes(route))
          throw new HealthUploadError('请返回 OpenGym 网页重新启动同步。','expired_shortcut_session');
        return user;
      }
      if(/^Bearer ogw_/.test(req.headers.authorization||'')) {
        try{return watches.authenticate(req)}catch(e){if(e instanceof WatchError)throw new HealthUploadError(e.message,e.code);throw e}
      }
      const token=/^Bearer ((ogh_|ogd_)[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'')?.[1];
      if(!token)throw new HealthUploadError('需要 Apple 健康上传凭证。','missing_upload_key');
      const root=roots[token.startsWith('ogh_')?0:1],digest=hash(token),c=read(key(root,digest)),user=c&&getUser(c.uid);
      if(!valid(c,user)||c.keyHash!==digest||read(connection(root,c.uid))?.keyHash!==digest)throw new HealthUploadError('Apple 健康上传凭证已失效，请重新配置。');
      return user;
    },revoke
  };
}
