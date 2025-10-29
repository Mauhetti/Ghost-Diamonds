// src/shared-seed.ts
// Système de seed partagée pour synchronisation déterministe

import { FIREBASE_CONFIG } from '../config-firebase';

const RTDB_URL = FIREBASE_CONFIG.RTDB_URL;

// Seed partagée globale
let sharedSeed = 0;
let seedLoaded = false;

// Charger la seed partagée depuis Firebase
export async function loadSharedSeed(): Promise<number> {
  if (seedLoaded) return sharedSeed;
  
  try {
    const resp = await fetch(`${RTDB_URL}/sharedSeed.json`);
    if (resp.ok) {
      const data = await resp.json();
      if (data && typeof data.seed === 'number') {
        sharedSeed = data.seed;
      } else {
        // Générer une nouvelle seed si aucune n'existe
        sharedSeed = Math.floor(Math.random() * 1000000);
        await saveSharedSeed(sharedSeed);
      }
    } else {
      // Générer une nouvelle seed si erreur
      sharedSeed = Math.floor(Math.random() * 1000000);
      await saveSharedSeed(sharedSeed);
    }
    seedLoaded = true;
    return sharedSeed;
  } catch (e) {
    console.error('[SHARED_SEED] Error loading seed:', e);
    // Fallback local
    sharedSeed = Math.floor(Math.random() * 1000000);
    seedLoaded = true;
    return sharedSeed;
  }
}

// Sauvegarder la seed partagée
async function saveSharedSeed(seed: number) {
  try {
    const body = { seed, timestamp: Date.now() };
    await fetch(`${RTDB_URL}/sharedSeed.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.error('[SHARED_SEED] Error saving seed:', e);
  }
}

// Obtenir la seed actuelle
export function getSharedSeed(): number {
  return sharedSeed;
}

// Générer un nombre aléatoire déterministe basé sur la seed
export function deterministicRandom(): number {
  // Simple LCG (Linear Congruential Generator)
  sharedSeed = (sharedSeed * 1664525 + 1013904223) % 4294967296;
  return sharedSeed / 4294967296;
}

// Générer un nombre aléatoire dans une plage
export function randomRange(min: number, max: number): number {
  return min + deterministicRandom() * (max - min);
}

// Générer un angle aléatoire
export function randomAngle(): number {
  return deterministicRandom() * 2 * Math.PI;
}
