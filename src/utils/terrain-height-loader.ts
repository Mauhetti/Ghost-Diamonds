// ============================================================================
// TERRAIN HEIGHT LOADER
// ============================================================================
// Charge les données de hauteur du terrain depuis terrain_data.json
// et fournit une fonction d'interpolation pour obtenir la hauteur à n'importe quelle position

import terrainData from '../data/terrain_data.json';

interface TerrainPoint {
  x: number;
  z: number;
  y: number;
}

// Données du terrain chargées
const TERRAIN_POINTS: TerrainPoint[] = terrainData as TerrainPoint[];

// Cache pour optimiser les recherches
let minX = Infinity;
let maxX = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
let gridSpacing = 0;

// Variable pour limiter les logs d'erreur
let lastOutOfBoundsLog = 0;

// Initialiser le cache
function initializeCache() {
  if (TERRAIN_POINTS.length === 0) {
    console.error('[TERRAIN_HEIGHT] Aucune donnée de terrain trouvée !');
    return;
  }

  // Trouver les limites
  for (const point of TERRAIN_POINTS) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  // Estimer l'espacement de la grille (en regardant les premiers points)
  if (TERRAIN_POINTS.length > 1) {
    const dx = Math.abs(TERRAIN_POINTS[1].x - TERRAIN_POINTS[0].x);
    const dz = Math.abs(TERRAIN_POINTS[1].z - TERRAIN_POINTS[0].z);
    gridSpacing = Math.max(dx, dz);
  }

  // console.log(`[TERRAIN_HEIGHT] Données chargées: ${TERRAIN_POINTS.length} points`); // Réduit les logs
  // console.log(`[TERRAIN_HEIGHT] Limites X: [${minX.toFixed(2)}, ${maxX.toFixed(2)}]`); // Réduit les logs
  // console.log(`[TERRAIN_HEIGHT] Limites Z: [${minZ.toFixed(2)}, ${maxZ.toFixed(2)}]`); // Réduit les logs
  // console.log(`[TERRAIN_HEIGHT] Espacement grille: ~${gridSpacing.toFixed(2)}m`); // Réduit les logs
}

// Trouver les 4 points les plus proches pour l'interpolation bilinéaire
function findNearestPoints(x: number, z: number): TerrainPoint[] {
  const nearestPoints: TerrainPoint[] = [];
  
  // Recherche simple des 4 points les plus proches
  // (On pourrait optimiser avec une grille spatiale, mais pour l'instant c'est suffisant)
  const distances = TERRAIN_POINTS.map(point => ({
    point,
    distance: Math.pow(point.x - x, 2) + Math.pow(point.z - z, 2)
  }));

  distances.sort((a, b) => a.distance - b.distance);

  // Prendre les 4 plus proches
  for (let i = 0; i < Math.min(4, distances.length); i++) {
    nearestPoints.push(distances[i].point);
  }

  return nearestPoints;
}

// Interpolation bilinéaire pour obtenir la hauteur à une position donnée
function bilinearInterpolation(x: number, z: number, points: TerrainPoint[]): number {
  if (points.length === 0) return 1.0; // Hauteur par défaut
  if (points.length === 1) return points[0].y;

  // Calculer la moyenne pondérée par la distance inverse
  let totalWeight = 0;
  let weightedHeight = 0;

  for (const point of points) {
    const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.z - z, 2));
    const weight = distance < 0.001 ? 1000 : 1 / (distance + 0.001); // Éviter division par zéro
    
    totalWeight += weight;
    weightedHeight += point.y * weight;
  }

  return totalWeight > 0 ? weightedHeight / totalWeight : points[0].y;
}

/**
 * Obtenir la hauteur du terrain à une position (x, z) donnée
 * Utilise une interpolation bilinéaire des points les plus proches
 */
export function getTerrainHeight(x: number, z: number): number {
  // Initialiser le cache si nécessaire
  if (gridSpacing === 0) {
    initializeCache();
  }

  // Vérifier si la position est dans les limites
  if (x < minX || x > maxX || z < minZ || z > maxZ) {
    // Log seulement une fois par minute pour éviter le spam
    const now = Date.now();
    if (now - lastOutOfBoundsLog > 60000) {
      console.log(`[TERRAIN_HEIGHT] Position (${x.toFixed(1)}, ${z.toFixed(1)}) hors limites du terrain`);
      lastOutOfBoundsLog = now;
    }
    return 1.0; // Hauteur par défaut
  }

  // Trouver les points les plus proches
  const nearestPoints = findNearestPoints(x, z);

  // Interpoler la hauteur
  const height = bilinearInterpolation(x, z, nearestPoints);

  return height;
}

/**
 * Vérifier si une position est dans les limites du terrain
 */
export function isInTerrainBounds(x: number, z: number): boolean {
  if (gridSpacing === 0) {
    initializeCache();
  }
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}

/**
 * Obtenir les limites du terrain
 */
export function getTerrainBounds() {
  if (gridSpacing === 0) {
    initializeCache();
  }
  return { minX, maxX, minZ, maxZ };
}