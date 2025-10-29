// ============================================================================
// ENVIRONMENT SYSTEM
// ============================================================================
// Creates the dark, atmospheric environment for the haunted scene.
// ============================================================================

import { engine, Entity, Transform, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs';
import { Quaternion } from '@dcl/sdk/math';

// ============================================================================
// ENVIRONMENT GENERATION FUNCTIONS
// ============================================================================
// NOTE: Les murs sont créés dans src/index.ts, pas ici

// Protection reload
let groundEntity: Entity | null = null;

export async function createDarkEnvironment() {
  // Configuration du terrain cave_ground.glb (remodelé, sans scale)
  const TERRAIN_CONFIG = {
    POSITION: { x: 160, y: 1, z: 160 }, // Y = 1 maintenant (terrain remodelé)
    SCALE: { x: 1, y: 1, z: 1 }, // Pas de scale, terrain remodelé
    ROTATION: { x: 0, y: 0, z: 0 }
  };
  
  // === SOL CAVE GROUND ===
  const ground = engine.addEntity();
  Transform.create(ground, {
    position: { x: 160, y: 1, z: 160 }, // Y = 1 maintenant (terrain remodelé)
    scale: { x: 1, y: 1, z: 1 } // Pas de scale, terrain remodelé
  });
  GltfContainer.create(ground, { 
    src: "assets/scene/Models/cave_ground/cave_ground.glb",
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS
  });
  
  // === ARBRES ===
  
  // Positions finales des arbres (calculées et optimisées)
  const treePositions = [
    { x: 50, z: 50, y: 1.8, rotation: 0, scale: 3.2 },
    { x: 80, z: 30, y: 1.6, rotation: 45, scale: 3.8 },
    { x: 120, z: 80, y: 1.7, rotation: 90, scale: 3.5 },
    { x: 200, z: 60, y: 1.9, rotation: 135, scale: 3.9 },
    { x: 150, z: 120, y: 1.6, rotation: 180, scale: 3.3 },
    { x: 80, z: 180, y: 1.8, rotation: 225, scale: 3.7 },
    { x: 40, z: 140, y: 1.5, rotation: 270, scale: 3.4 },
    { x: 180, z: 200, y: 1.7, rotation: 315, scale: 3.6 },
    { x: 220, z: 140, y: 1.9, rotation: 30, scale: 3.1 },
    { x: 100, z: 220, y: 1.6, rotation: 60, scale: 3.8 },
    { x: 60, z: 100, y: 1.5, rotation: 90, scale: 3.2 },
    { x: 160, z: 80, y: 1.8, rotation: 120, scale: 3.5 },
    { x: 240, z: 120, y: 1.7, rotation: 150, scale: 3.7 },
    { x: 90, z: 160, y: 1.6, rotation: 180, scale: 3.3 },
    { x: 130, z: 240, y: 1.8, rotation: 210, scale: 3.6 },
    { x: 70, z: 200, y: 1.7, rotation: 240, scale: 3.4 },
    { x: 190, z: 160, y: 1.9, rotation: 270, scale: 3.8 },
    { x: 110, z: 40, y: 1.5, rotation: 300, scale: 3.2 },
    { x: 250, z: 80, y: 1.8, rotation: 330, scale: 3.5 },
    { x: 30, z: 160, y: 1.6, rotation: 0, scale: 3.7 },
    { x: 170, z: 40, y: 1.4, rotation: 45, scale: 3.1 },
    { x: 210, z: 180, y: 1.8, rotation: 90, scale: 3.6 },
    { x: 50, z: 240, y: 1.7, rotation: 135, scale: 3.3 },
    { x: 140, z: 100, y: 1.6, rotation: 180, scale: 3.8 },
    { x: 230, z: 200, y: 1.9, rotation: 225, scale: 3.4 },
    { x: 20, z: 80, y: 1.5, rotation: 270, scale: 3.5 },
    { x: 260, z: 160, y: 1.7, rotation: 315, scale: 3.2 },
    { x: 120, z: 20, y: 1.4, rotation: 0, scale: 3.7 },
    { x: 200, z: 240, y: 1.8, rotation: 45, scale: 3.6 },
    { x: 80, z: 260, y: 1.7, rotation: 90, scale: 3.3 },
    { x: 160, z: 20, y: 1.5, rotation: 135, scale: 3.8 },
    { x: 240, z: 100, y: 1.6, rotation: 180, scale: 3.1 },
    { x: 40, z: 200, y: 1.8, rotation: 225, scale: 3.5 },
    { x: 180, z: 280, y: 1.9, rotation: 270, scale: 3.4 },
    { x: 280, z: 40, y: 1.6, rotation: 315, scale: 3.7 },
    { x: 10, z: 120, y: 1.5, rotation: 0, scale: 3.2 },
    { x: 290, z: 180, y: 1.8, rotation: 45, scale: 3.6 },
    { x: 130, z: 300, y: 1.9, rotation: 90, scale: 3.3 },
    { x: 270, z: 60, y: 1.7, rotation: 135, scale: 3.8 },
    { x: 90, z: 300, y: 1.8, rotation: 180, scale: 3.5 },
    { x: 300, z: 140, y: 1.6, rotation: 225, scale: 3.1 },
    { x: 150, z: 320, y: 1.9, rotation: 270, scale: 3.7 },
    { x: 320, z: 80, y: 1.5, rotation: 315, scale: 3.4 },
    { x: 110, z: 320, y: 1.8, rotation: 0, scale: 3.6 },
    { x: 310, z: 220, y: 1.7, rotation: 45, scale: 3.2 },
    { x: 70, z: 320, y: 1.9, rotation: 90, scale: 3.8 },
    { x: 320, z: 260, y: 1.6, rotation: 135, scale: 3.3 },
    { x: 30, z: 320, y: 1.7, rotation: 180, scale: 3.5 },
    { x: 320, z: 300, y: 1.8, rotation: 225, scale: 3.7 },
    { x: 120, z: 260, y: 1.6, rotation: 35, scale: 3.5 },
    { x: 80, z: 240, y: 1.8, rotation: 65, scale: 3.9 }
  ];
  
  // Créer les arbres avec les positions finales en dur
  for (let i = 0; i < treePositions.length; i++) {
    const treeData = treePositions[i];
    
    const tree = engine.addEntity();
    
    Transform.create(tree, {
      position: { x: treeData.x, y: treeData.y, z: treeData.z },
      rotation: Quaternion.fromEulerDegrees(0, treeData.rotation, 0),
      scale: { x: treeData.scale, y: treeData.scale, z: treeData.scale }
    });
    
    GltfContainer.create(tree, { 
      src: "assets/asset-packs/scary_tree/HWN20_ScaryTree_01.glb",
      visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER, // ✅ Empêcher le passage des joueurs et de la caméra
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    }); // ✅ ScaryTree2
    
  }
  
  // Sauvegarder l'entité terrain
  groundEntity = ground;
  
  // console.log('[ENVIRONMENT] ✅ Environment created:', { ground: groundEntity }); // Réduit les logs pour éviter 'Message too large'
  
  return {
    ground
  };
}

// ============================================================================
// TREE SAFETY FUNCTIONS
// ============================================================================
// Functions to check if a position is safe from trees

/**
 * Check if a position is too close to any tree (within safety radius)
 * @param x - X coordinate to check
 * @param z - Z coordinate to check
 * @param safetyRadius - Minimum distance from trees (default: 3 meters)
 * @returns true if position is safe, false if too close to a tree
 */
export function isPositionSafeFromTrees(x: number, z: number, safetyRadius: number = 3): boolean {
  // Positions fixes des arbres (même que dans createDarkEnvironment)
  const treePositions = [
    // Zone Nord-Ouest
    { x: 50, z: 50 }, { x: 80, z: 60 }, { x: 70, z: 90 }, { x: 40, z: 80 }, { x: 100, z: 40 },
    // Zone Nord-Est
    { x: 220, z: 50 }, { x: 250, z: 70 }, { x: 280, z: 60 }, { x: 240, z: 90 }, { x: 200, z: 80 },
    // Zone Sud-Ouest
    { x: 50, z: 220 }, { x: 80, z: 240 }, { x: 70, z: 280 }, { x: 40, z: 250 }, { x: 100, z: 260 },
    // Zone Sud-Est
    { x: 220, z: 220 }, { x: 250, z: 240 }, { x: 280, z: 260 }, { x: 240, z: 280 }, { x: 200, z: 250 },
    // Zone Centre-Nord
    { x: 120, z: 80 }, { x: 140, z: 100 }, { x: 180, z: 90 }, { x: 200, z: 70 }, { x: 160, z: 50 },
    // Zone Centre-Sud
    { x: 120, z: 220 }, { x: 140, z: 240 }, { x: 180, z: 230 }, { x: 200, z: 250 }, { x: 160, z: 270 },
    // Zone Centre-Ouest
    { x: 80, z: 120 }, { x: 100, z: 140 }, { x: 70, z: 160 }, { x: 90, z: 180 }, { x: 60, z: 200 },
    // Zone Centre-Est
    { x: 240, z: 120 }, { x: 260, z: 140 }, { x: 280, z: 160 }, { x: 250, z: 180 }, { x: 270, z: 200 },
    // Zone Centre
    { x: 120, z: 120 }, { x: 200, z: 120 }, { x: 120, z: 200 }, { x: 200, z: 200 }, { x: 140, z: 160 }, { x: 180, z: 160 },
    // Zone périphérique
    { x: 30, z: 120 }, { x: 30, z: 200 }, { x: 290, z: 120 }, { x: 290, z: 200 }, { x: 160, z: 30 }, { x: 160, z: 290 }
  ];

  for (const tree of treePositions) {
    const distance = Math.sqrt((x - tree.x) ** 2 + (z - tree.z) ** 2);
    if (distance < safetyRadius) {
      return false; // Trop proche d'un arbre
    }
  }
  
  return true; // Position sûre
}

/**
 * Find a safe position for spawning (diamonds, etc.) that avoids trees
 * @param maxAttempts - Maximum number of attempts to find a safe position
 * @param safetyRadius - Minimum distance from trees
 * @returns Safe position or null if no safe position found
 */
export function findSafeSpawnPosition(maxAttempts: number = 50, safetyRadius: number = 3): { x: number, z: number } | null {
  for (let i = 0; i < maxAttempts; i++) {
    // Position aléatoire dans la scène (en évitant les bords)
    const x = Math.random() * 300 + 10; // 10 à 310
    const z = Math.random() * 300 + 10; // 10 à 310
    
    if (isPositionSafeFromTrees(x, z, safetyRadius)) {
      return { x, z };
    }
  }
  
  return null; // Aucune position sûre trouvée
}