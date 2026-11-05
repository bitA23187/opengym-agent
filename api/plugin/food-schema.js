import {z} from 'zod';
import {FOOD_UNITS,FOOD_PREPARATIONS} from '../../frontend/src/lib/foods.js';
const nutrient=z.number().nonnegative().max(5000).nullable().optional();
export const foodSchema=z.object({name:z.string().trim().min(1).max(120),brand:z.string().max(120).optional(),
  basis:z.object({quantity:z.number().positive().max(10000),unit:z.enum(FOOD_UNITS)}).strict(),
  nutrients:z.object({calories:z.number().nonnegative().max(30000).nullable().optional(),protein:nutrient,carbs:nutrient,fat:nutrient,alcohol:nutrient}).strict(),
  source:z.enum(['Label','Estimate','Weighed estimate','GPT estimate']),preparation:z.enum(FOOD_PREPARATIONS).default('unspecified'),source_reference:z.string().max(500).optional(),
  servings:z.array(z.object({id:z.string().min(1).max(64),name:z.string().min(1).max(80),quantity:z.number().positive().max(10000),unit:z.enum(FOOD_UNITS)}).strict()).max(30).default([]),archived:z.boolean().optional()}).strict();
export const mealItemSchema=z.object({item_id:z.string().min(1).max(64),food_id:z.string().min(1).max(100).optional(),quantity:z.number().positive().max(10000),unit:z.enum(FOOD_UNITS),serving_id:z.string().min(1).max(64).optional(),food_snapshot:foodSchema.optional()}).strict().refine(i=>!!i.food_id||!!i.food_snapshot,'Provide food_id or an explicit food snapshot');
export const foodUpdateSchema=z.object({operation:z.enum(['upsert','archive','restore','delete']),id:z.string().min(1).max(100).optional().describe('For a new food used by entries in this same batch, provide a unique ID and reference it with items[].food_id. Otherwise a new ID is generated.'),food:foodSchema.optional()}).strict();
