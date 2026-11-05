import {z} from 'zod';
export const fieldDefinitionSchema=z.object({key:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),label:z.string().min(1).max(80),type:z.enum(['number','text','boolean']),unit:z.string().max(30).optional(),min:z.number().optional(),max:z.number().optional(),aggregation:z.enum(['none','sum','mean']).default('none')}).strict();
export const observationSchema=z.object({record_id:z.string().min(1).max(64),values:z.record(z.string(),z.union([z.number(),z.string().max(500),z.boolean(),z.null()]))}).strict();
