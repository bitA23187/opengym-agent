import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {toolError} from '../errors.js';

test('error envelopes distinguish schema, permissions, business conflicts and storage without leaking arguments or paths',()=>{
  const schema=z.object({timezone:z.string()}).safeParse({timezone:{secret:'private value'}}).error;
  const validation=toolError(schema,'request');assert.equal(validation.error_code,'invalid_arguments');assert.ok(!JSON.stringify(validation).includes('private value'));
  const scope=Object.assign(Error('Authorize scopes'),{requiredScopes:['plan:write']});assert.equal(toolError(scope,'request').error_code,'authorization_required');
  const conflict=toolError(Error('Training data changed since preview'),'request');assert.equal(conflict.error_code,'revision_conflict');assert.equal(conflict.retryable,false);assert.ok(conflict.details.action);
  assert.equal(toolError(Error('Preview expired'),'request').error_code,'preview_unavailable');
  const disk=toolError(Object.assign(Error('EIO /private/account/file'),{code:'EIO'}),'request');assert.equal(disk.stage,'storage');assert.equal(disk.retryable,true);assert.ok(!JSON.stringify(disk).includes('/private/account'));
});
