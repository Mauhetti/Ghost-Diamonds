// ============================================================================
// CLEANUP MANAGER SYSTEM
// ============================================================================
// Persistent scene cleanup system that prevents memory leaks and maintains
// performance over long-running sessions. This is crucial for scenes that
// run 24/7 without restarting.
// ============================================================================

import { engine, Transform, GltfContainer, MeshRenderer } from '@dcl/sdk/ecs';

export class CleanupManager {
  private static instance: CleanupManager;
  private cleanupTimer = 0;
  private readonly CLEANUP_INTERVAL = 5 * 60; // 5 minutes

  static getInstance(): CleanupManager {
    if (!CleanupManager.instance) {
      CleanupManager.instance = new CleanupManager();
    }
    return CleanupManager.instance;
  }

  start(): void {
    
    engine.addSystem((dt: number) => {
      this.cleanupTimer += dt;
      
      if (this.cleanupTimer >= this.CLEANUP_INTERVAL) {
        this.performCleanup();
        this.cleanupTimer = 0;
      }
    });
  }

  private performCleanup(): void {
    
    try {
      this.cleanupGlobalVariables();
      this.cleanupOrphanedEntities();
      this.cleanupInactiveSystems();
      
    } catch (error) {
      console.error('[CLEANUP] Error during global cleanup:', error);
    }
  }

  private cleanupGlobalVariables(): void {
    // Nettoyer les variables globales qui s'accumulent
    if ((globalThis as any).__GHOSTS_CREATED__) {
      const count = (globalThis as any).__GHOSTS_CREATED__;
      if (count > 1000) {
        (globalThis as any).__GHOSTS_CREATED__ = 0;
      }
    }
  }

  private cleanupOrphanedEntities(): void {
    // Nettoyer les entités qui n'ont plus de composants essentiels
    const entities = engine.getEntitiesWith(Transform);
    let cleanedCount = 0;
    
    for (const [entity] of entities) {
      // Vérifier si l'entité a des composants valides
      if (!Transform.has(entity) && !MeshRenderer.has(entity) && !GltfContainer.has(entity)) {
        // Entité orpheline, la supprimer
        engine.removeEntity(entity);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
    }
  }

  private cleanupInactiveSystems(): void {
    // Note: Dans SDK7, on ne peut pas facilement lister les systèmes actifs
    // Mais on peut nettoyer les variables globales liées aux systèmes
  }
}

export const cleanupManager = CleanupManager.getInstance();
