import { engine, Transform, MeshRenderer, Material } from '@dcl/sdk/ecs';
import { Color4, Quaternion } from '@dcl/sdk/math';

// ✅ Créer les murs et le plafond avec un système pour espacer la création sur plusieurs frames
export function createWalls() {
  let wallsCreated = false;
  
  engine.addSystem((dt: number) => {
    if (wallsCreated) return;
    
    // Créer les murs sur une frame différente pour éviter "Message too large"
    const wallNorth = engine.addEntity();
    Transform.create(wallNorth, { position: { x: 160, y: 10, z: 6 }, scale: { x: 320, y: 20, z: 2 } });
    MeshRenderer.setBox(wallNorth);
    Material.setBasicMaterial(wallNorth, { diffuseColor: Color4.Black() });
    
    const wallSouth = engine.addEntity();
    Transform.create(wallSouth, { position: { x: 160, y: 10, z: 314 }, scale: { x: 320, y: 20, z: 2 } });
    MeshRenderer.setBox(wallSouth);
    Material.setBasicMaterial(wallSouth, { diffuseColor: Color4.Black() });
    
    const wallWest = engine.addEntity();
    Transform.create(wallWest, { position: { x: 6, y: 10, z: 160 }, scale: { x: 2, y: 20, z: 320 } });
    MeshRenderer.setBox(wallWest);
    Material.setBasicMaterial(wallWest, { diffuseColor: Color4.Black() });
    
    const wallEast = engine.addEntity();
    Transform.create(wallEast, { position: { x: 314, y: 10, z: 160 }, scale: { x: 2, y: 20, z: 320 } });
    MeshRenderer.setBox(wallEast);
    Material.setBasicMaterial(wallEast, { diffuseColor: Color4.Black() });
    
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
}
