// Ghost Diamonds - Decentraland Hackathon 2025 submission

import { ReactEcsRenderer } from '@dcl/sdk/react-ecs';
import { engine, Transform, MeshRenderer, Material, MeshCollider, ColliderLayer } from '@dcl/sdk/ecs';
import { Color4, Quaternion } from '@dcl/sdk/math';
import { renderPlayerUI, LoadingScreen } from './ui';
import { sceneInitializer } from './systems/scene-initializer';
import { cleanupManager } from './systems/cleanup-manager';
import { initializeLoadingManager, markComponentLoaded, updateLoadingManager } from './systems/loading-manager';
import { initPlayerUISystem } from './systems/player';
import { initStaminaSystem } from './systems/stamina-simple';
import { initBackgroundMusicAudio, exposeAudioFunctionsGlobally } from './systems/audio-system';


ReactEcsRenderer.setUiRenderer(() => [
  renderPlayerUI(),
  LoadingScreen()
]);


function main() {
  // ✅ RÉINITIALISER les flags de modules pour permettre le rechargement correct
  (globalThis as any).__GHOSTS_SETUP__ = false;
  (globalThis as any).__DIAMONDS_SYSTEM__ = false;
  
  try {
    initializeLoadingManager();
    initBackgroundMusicAudio();
    exposeAudioFunctionsGlobally();
    
    // Marquer tous les composants comme chargés
    (['environment', 'safezones', 'ghosts', 'diamonds', 'player', 'leaderboard'] as const).forEach(component => {
      markComponentLoaded(component);
    });

    cleanupManager.start();
    initPlayerUISystem();
    initStaminaSystem();

    engine.addSystem((dt: number) => {
      updateLoadingManager(dt);
    });

    // ✅ Initialiser la scène (Mode Solo)
    sceneInitializer.initialize()
      .catch(err => console.error('[MAIN] Scene init error:', err));
    
    // ✅ Créer les murs et le plafond
    let wallsCreated = false;
    engine.addSystem((dt: number) => {
      if (wallsCreated) return;
      
      const wallNorth = engine.addEntity();
      Transform.create(wallNorth, { position: { x: 160, y: 10, z: 6 }, scale: { x: 320, y: 20, z: 2 } });
      MeshRenderer.setBox(wallNorth);
      Material.setBasicMaterial(wallNorth, { diffuseColor: Color4.Black() });
      // ✅ Ajouter collider pour empêcher le passage (PHYSICS + POINTER pour la caméra)
      MeshCollider.setBox(wallNorth, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER);
      
      const wallSouth = engine.addEntity();
      Transform.create(wallSouth, { position: { x: 160, y: 10, z: 314 }, scale: { x: 320, y: 20, z: 2 } });
      MeshRenderer.setBox(wallSouth);
      Material.setBasicMaterial(wallSouth, { diffuseColor: Color4.Black() });
      // ✅ Ajouter collider pour empêcher le passage (PHYSICS + POINTER pour la caméra)
      MeshCollider.setBox(wallSouth, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER);
      
      const wallWest = engine.addEntity();
      Transform.create(wallWest, { position: { x: 6, y: 10, z: 160 }, scale: { x: 2, y: 20, z: 320 } });
      MeshRenderer.setBox(wallWest);
      Material.setBasicMaterial(wallWest, { diffuseColor: Color4.Black() });
      // ✅ Ajouter collider pour empêcher le passage (PHYSICS + POINTER pour la caméra)
      MeshCollider.setBox(wallWest, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER);
      
      const wallEast = engine.addEntity();
      Transform.create(wallEast, { position: { x: 314, y: 10, z: 160 }, scale: { x: 2, y: 20, z: 320 } });
      MeshRenderer.setBox(wallEast);
      Material.setBasicMaterial(wallEast, { diffuseColor: Color4.Black() });
      // ✅ Ajouter collider pour empêcher le passage (PHYSICS + POINTER pour la caméra)
      MeshCollider.setBox(wallEast, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER);
      
      const ceiling = engine.addEntity();
      Transform.create(ceiling, { 
        position: { x: 160, y: 20, z: 160 }, 
        rotation: Quaternion.fromEulerDegrees(90, 0, 0),
        scale: { x: 320, y: 320, z: 1 } 
      });
      MeshRenderer.setPlane(ceiling);
      Material.setBasicMaterial(ceiling, { diffuseColor: Color4.Black() });
      
      wallsCreated = true;
    });
    
  } catch (error) {
    console.error('[MAIN] ❌ Initialization error:', error);
  }
}

main();
