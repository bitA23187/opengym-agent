import { z } from 'zod';
import { climbingRouteSchema } from './activity-schema.js';
import { observationSchema } from './activity-fields-schema.js';
const id=z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export function sessionUpdateSchema(loggedExercise,setShape) {
  return z.object({session_id:id,expected_version:z.number().int().min(0),idempotency_key:id,
    operations:z.array(z.discriminatedUnion('type',[
      z.object({type:z.literal('start'),name:z.string().trim().min(1).max(80),routine_id:z.string().min(1).max(64).optional(),started_at:z.string().datetime({offset:true}).optional()}).strict(),
      z.object({type:z.literal('append_exercise'),entry_id:id,exercise:loggedExercise}).strict(),
      z.object({type:z.literal('append_set'),entry_id:id,set_id:id,set:setShape}).strict(),
      z.object({type:z.literal('update_set'),entry_id:id,set_id:id,side:z.enum(['L','R']).optional(),fields:setShape.partial().extend({rir:z.number().min(0).max(10).nullable().optional(),rpe:z.number().min(0).max(10).nullable().optional()})}).strict(),
      z.object({type:z.literal('set_observations'),entry_id:id,observations:z.array(observationSchema).min(1).max(200)}).strict(),
      z.object({type:z.literal('set_routes'),entry_id:id,routes:z.array(climbingRouteSchema).min(1).max(100)}).strict(),
      z.object({type:z.literal('set_note'),entry_id:id.optional(),note:z.string().trim().max(500).nullable(),append:z.boolean().default(false)}).strict(),
      z.object({type:z.literal('finish'),finished_at:z.string().datetime({offset:true}).optional()}).strict(),
      z.object({type:z.literal('cancel')}).strict(),
    ])).min(1).max(100)}).strict();
}
