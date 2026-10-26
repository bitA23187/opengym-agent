import { random } from './store.js';
// Each service owns its drafts; an ID cannot be replayed through another save tool.
export function createDrafts() {
  const drafts=new Map();
  const prune=()=>{for(const [k,d] of drafts)if(d.exp<=Date.now())drafts.delete(k);};
  return {
    preview(user,grant,s,summary,fields) {
      prune();
      if(drafts.size>=100||[...drafts.values()].filter(d=>d.uid===user.id&&!d.result).length>=10)throw Error('Too many pending previews; wait for expiry.');
      const draft_id=random(),d={...fields,uid:user.id,grant,rev:s._rev||0,wid:s._wid||null,summary,exp:Date.now()+900000,result:null};
      drafts.set(draft_id,d);
      return {draft_id,revision:d.rev,expires_in_seconds:900,confirmation_summary:summary,instructions:'Show the complete confirmation_summary. Save only after explicit user confirmation, using the exact summary and matching save tool.'};
    },
    save(user,grant,id,confirmed,summary,save) {
      prune();const d=drafts.get(id);
      if(!d||d.uid!==user.id||d.grant!==grant)throw Error('Preview expired or belongs to a different authorization; preview again.');
      if(!confirmed||summary!==d.summary)throw Error('Explicit confirmation and the exact preview summary are required.');
      if(d.result)return {...d.result,already_saved:true};
      d.result=save(d);return d.result;
    }
  };
}
