import { z } from 'zod';
import { failureKind } from './audit.js';
export const SCHEMA_VERSION='2026-10-28';
export function toolError(error,request_id,stage=null) {
  const error_code=stage==='authorization'||error?.requiredScopes?'authorization_required':stage==='tool_validation'||error instanceof z.ZodError?'invalid_arguments':failureKind(error);
  const retryable=error_code==='storage_error';
  const message=error_code==='storage_error'?'Storage unavailable; no changes confirmed.':error_code==='invalid_arguments'?'Invalid tool arguments':error?.message||'Tool failed';
  return {error_code,request_id,retryable,schema_version:SCHEMA_VERSION,
    stage:stage||(error_code==='storage_error'?'storage':error?.requiredScopes?'authorization':'business'),
    message,details:error_code==='invalid_arguments'?{action:'Read tools/list and correct the supplied arguments.'}:
      error_code==='revision_conflict'||error_code==='preview_unavailable'?{action:'Read current data and create a new preview.'}:{}};
}
export function errorResult(error,request_id,stage=null) {
  return {isError:true,content:[{type:'text',text:JSON.stringify(toolError(error,request_id,stage))}]};
}
