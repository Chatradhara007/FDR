import { z } from 'zod';
import { normDate } from './normalize';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Strict calendar date 'YYYY-MM-DD'. */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((s) => {
    try {
      return normDate(s) === s;
    } catch {
      return false;
    }
  }, 'Not a valid calendar date');

export const clockAdvanceSchema = z.object({
  days: z.number().int('Whole days only').min(1, 'At least 1 day').max(730, 'At most 730 days'),
});

export const clockSetSchema = z.object({ date: dateString });
