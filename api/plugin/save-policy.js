// Deployment policy does not grant OAuth scopes or authorize unsolicited writes.
// Explicit constructor lists let isolated callers retain account-specific policy.
export function directSaveUsers(scope) {
  return process.env.PLUGIN_DIRECT_SAVE==='1'?['*']:(process.env[`PLUGIN_${scope}_AUTO_SAVE_USER_IDS`]||'').split(',').map(s=>s.trim()).filter(Boolean);
}
export const permitsDirectSave=(users,id)=>users.includes('*')||users.includes(id);
export const directSaveSource=users=>users.includes('*')?'deployment_policy':'account_preference';
