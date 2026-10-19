import { z } from 'zod';
import { MONTH_RE } from './services/fuelPrices';

export const fuelTypeSchema = z.enum(['petrol93', 'petrol95', 'diesel50ppm', 'diesel500ppm']);
export const zoneSchema = z.enum(['inland', 'coastal']);
export const monthSelectorSchema = z.union([
  z.literal('current'),
  z.literal('previous'),
  z.string().regex(MONTH_RE, "Use 'current', 'previous' or YYYY-MM"),
]);

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const routeRequestSchema = z
  .object({
    points: z.array(latLngSchema).min(2, 'At least 2 points are required').max(150, 'At most 150 points are allowed'),
    departAt: z.iso.datetime({ offset: true, local: false }).optional(),
    vehicleId: z.string().min(1).max(100).optional(),
    customConsumptionL100km: z.number().min(1).max(40).optional(),
    fuel: fuelTypeSchema,
    zone: zoneSchema.default('inland'),
    priceMonth: monthSelectorSchema.default('current'),
    compareFastest: z.boolean().default(false),
  })
  .refine((r) => r.vehicleId !== undefined || r.customConsumptionL100km !== undefined, {
    message: 'Provide either vehicleId or customConsumptionL100km',
    path: ['vehicleId'],
  });

export type ParsedRouteRequest = z.infer<typeof routeRequestSchema>;

export const vehiclesQuerySchema = z.object({ q: z.string().max(100).optional() });

export const fuelPricesQuerySchema = z.object({
  month: monthSelectorSchema.optional(),
  zone: zoneSchema.optional(),
  fuel: fuelTypeSchema.optional(),
});

/** Human-readable one-line summary of zod issues. */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}
