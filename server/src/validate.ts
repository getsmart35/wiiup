import type { LatLng, Place, RideTier } from '@/api/types';
import { TIER_ORDER } from '@/lib/fare';
import { PLAN_ORDER, type PlanId } from '@/lib/plans';
import { RATE_FIELDS, type RateCards } from '@/lib/rates';
import { badRequest } from './http.ts';

type Obj = Record<string, unknown>;

export function obj(v: unknown, what = 'Body'): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${what} must be an object`);
  return v as Obj;
}

export function str(v: unknown, what: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw badRequest(`${what} is required (up to ${max} characters)`);
  return v.trim();
}

export function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw badRequest(`${what} must be a number`);
  return v;
}

export function latLng(v: unknown, what = 'location'): LatLng {
  const o = obj(v, what);
  const latitude = num(o.latitude, `${what}.latitude`);
  const longitude = num(o.longitude, `${what}.longitude`);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw badRequest(`${what} is out of range`);
  return { latitude, longitude };
}

export function place(v: unknown, what: string): Place {
  const o = obj(v, what);
  return {
    id: str(o.id, `${what}.id`, 100),
    name: str(o.name, `${what}.name`),
    address: typeof o.address === 'string' ? o.address.slice(0, 300) : '',
    coords: latLng(o.coords, `${what}.coords`),
  };
}

export function phone(v: unknown): string {
  const digits = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  if (digits.length < 7 || digits.length > 15) throw badRequest('Enter a valid mobile number');
  return digits;
}

export function plan(v: unknown): PlanId {
  if (!PLAN_ORDER.includes(v as PlanId)) throw badRequest('Unknown plan');
  return v as PlanId;
}

/** A full set of rate cards, with every custom rate inside the allowed range. */
export function rateCards(v: unknown): RateCards {
  const o = obj(v, 'cards');
  const out = {} as RateCards;
  for (const tier of TIER_ORDER as RideTier[]) {
    const card = obj(o[tier], `cards.${tier}`);
    if (typeof card.useSuggested !== 'boolean') throw badRequest(`cards.${tier}.useSuggested must be true or false`);
    const custom = obj(card.custom, `cards.${tier}.custom`);
    const rates = {} as RateCards[RideTier]['custom'];
    for (const f of RATE_FIELDS) {
      const n = num(custom[f.id], `cards.${tier}.custom.${f.id}`);
      if (n < f.min - 1e-9 || n > f.max + 1e-9) throw badRequest(`${f.label} for ${tier} must be between ${f.min} and ${f.max}`);
      rates[f.id] = n;
    }
    out[tier] = { useSuggested: card.useSuggested, custom: rates };
  }
  return out;
}
