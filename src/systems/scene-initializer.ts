// ============================================================================
// SCENE INITIALIZER SYSTEM
// ============================================================================
// Modular scene initialization system that orchestrates the startup of all
// game components in the correct order. This ensures proper dependency
// resolution and prevents initialization conflicts.
// ============================================================================

import { engine, Transform, GltfContainer, MeshRenderer, GltfNodeModifiers, Animator } from '@dcl/sdk/ecs';
import { Name } from '@dcl/sdk/ecs';
import { Vector3, Quaternion } from '@dcl/sdk/math';
import { createAllSafeZones, isInAnySafeZone, getSafeZonesList } from '../components/safezones';
import { setupGhosts, initGhostSyncSystem } from './ghosts';
import { setupDiamonds, createDiamondSystem } from '../diamonds/diamonds';
import { createDarkEnvironment } from '../components/environment';
import { initPlayerDetection } from './player';
import { initLeaderboard } from '../components/leaderboard';
import { createSimpleValidationZone } from '../diamonds/simple-diamond-validation';
import { createDiamondSyncSystem } from '../diamonds/diamond-sync';
import { createDeathDetectionSystem } from './death';
// import { startAutoCleanup } from '../services/atomic-events'; // SUPPRIMÉ

/**
 * SceneInitializer - Singleton class for managing scene initialization
 * 
 * This class ensures that all game systems are initialized in the correct
 * order and prevents duplicate initialization. It uses a singleton pattern
 * to maintain state across the application lifecycle.
 */
export class SceneInitializer {
  private static instance: SceneInitializer;
  private initialized = false;

  /**
   * Get the singleton instance of SceneInitializer
   * @returns The singleton instance
   */
  static getInstance(): SceneInitializer {
    if (!SceneInitializer.instance) {
      SceneInitializer.instance = new SceneInitializer();
    }
    return SceneInitializer.instance;
  }

  /**
   * Initialize the entire scene with all game systems
   * This method orchestrates the initialization of all components in the correct order
   * to ensure proper dependency resolution and prevent conflicts
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // 1. Environment - Create the dark, atmospheric world
      await this.initializeEnvironment();
      
      // 2. Safe zones - Establish player safety areas
      await this.initializeSafeZones();
      
      // 3. Game systems - Initialize core gameplay mechanics
      await this.initializeGameSystems();
      
      // 4. Collectibles - Set up diamond collection system
      await this.initializeCollectibles();
      
      // 5. Player & networking - Initialize player detection and networking
      await this.initializePlayer();
      
      // 6. UI & leaderboard - Set up user interface elements
      await this.initializeUI();
      
      // 7. Diamond systems - Initialize diamond-specific systems
      await this.initializeDiamondSystems();
      
      // 8. Cleanup systems - Start maintenance and cleanup processes
      await this.initializeCleanupSystems();
      
      // 9. Debug tools - Set up development and debugging utilities
      this.setupDebugTools();
      
      // 10. Disable shadows for vortex (via system that checks each frame)
      this.setupVortexShadowDisable();
      
      this.initialized = true;
      
    } catch (error) {
      console.error('[SCENE_INIT] ❌ Error during scene initialization:', error);
      throw error;
    }
  }

  private async initializeEnvironment(): Promise<void> {
    await createDarkEnvironment();
  }

  private async initializeSafeZones(): Promise<void> {
    createAllSafeZones();
  }

  private async initializeGameSystems(): Promise<void> {
    const safeZones = getSafeZonesList();
    await setupGhosts(safeZones, isInAnySafeZone);
    initGhostSyncSystem();
  }

  private async initializeCollectibles(): Promise<void> {
    setupDiamonds();
    createDiamondSystem();
  }

  private async initializePlayer(): Promise<void> {
    initPlayerDetection();
  }

  private async initializeUI(): Promise<void> {
    initLeaderboard();
  }

  private async initializeDiamondSystems(): Promise<void> {
    createSimpleValidationZone();
    createDiamondSyncSystem();
    createDeathDetectionSystem();
  }

  private async initializeCleanupSystems(): Promise<void> {
    // startAutoCleanup(); // SUPPRIMÉ - système atomic-events supprimé
  }

  private setupDebugTools(): void {
    // Expose debug functions globally for testing
    (globalThis as any).forceDiamondSync = () => {
      import('../diamonds/diamond-sync').then(({ forceDiamondSync }) => {
        forceDiamondSync();
      });
    };
    
    // Expose simple validation test
    (globalThis as any).testValidation = () => {
      import('../diamonds/simple-diamond-validation').then(({ testValidation }) => {
        testValidation();
      });
    };
    
    // Expose debug validation zone
    (globalThis as any).debugValidationZone = () => {
      import('../diamonds/simple-diamond-validation').then(({ debugValidationZone }) => {
        debugValidationZone();
      });
    };
  }

  /**
   * Créer le vortex au centre de la map avec animation et sans ombres
   */
  private setupVortexShadowDisable(): void {
    // console.log('[SCENE_INIT] Creating vortex at center of map...');
    
    // Créer l'entité vortex
    const vortexEntity = engine.addEntity();
    
    // Position au centre de la map à 18 mètres de hauteur
    Transform.create(vortexEntity, {
      position: Vector3.create(160, 18, 160),
      scale: Vector3.create(1, 1, 1),
      rotation: Quaternion.create(0, 0, 0, 1)
    });
    
    // Ajouter le modèle GLB
    GltfContainer.create(vortexEntity, {
      src: 'assets/scene/Models/vortex/vortex.glb',
      visibleMeshesCollisionMask: 0,
      invisibleMeshesCollisionMask: 0
    });
    
    // Désactiver les ombres
    GltfNodeModifiers.create(vortexEntity, {
      modifiers: [{
        path: '', // Chemin vide = tout le modèle
        castShadows: false
      }]
    });
    
    // Ajouter l'animation en boucle
    Animator.create(vortexEntity, {
      states: [{
        clip: 'vortexRotation',
        playing: true,
        weight: 1,
        speed: 0.5,
        loop: true,
        shouldReset: false
      }]
    });
    
    // Ajouter un nom pour le debug
    Name.create(vortexEntity, { value: 'vortex.glb' });
    
    // console.log('[SCENE_INIT] ✅ Vortex created successfully at center (160, 18, 160) - shadows disabled');
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const sceneInitializer = SceneInitializer.getInstance();