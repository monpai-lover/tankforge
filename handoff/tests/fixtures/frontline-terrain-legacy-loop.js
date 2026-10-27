        for(let cellZ=cz-radius;cellZ<cz+radius;cellZ+=step)for(let cellX=cx-radius;cellX<cx+radius;cellX+=step){
          // The canonical cut/fill surface is narrower than the distant50/200m
          // mesh. Sample it more closely beside roads, without local regrading.
          const local=nearRoad(cellX+step/2,cellZ+step/2,step)?(aerial?25:10):step;
          for(let z=cellZ;z<cellZ+step;z+=local)for(let x=cellX;x<cellX+step;x+=local){
            const a=[x,surface(x,z),z],c=[x,surface(x,z+local),z+local],v=[x+local,surface(x+local,z),z],d=[x+local,surface(x+local,z+local),z+local];
            for(const triangle of dryTerrain.clipTriangle([a,c,v]))b.tri(IDENTITY,false,...triangle,material);
            for(const triangle of dryTerrain.clipTriangle([v,c,d]))b.tri(IDENTITY,false,...triangle,material);
          }
        }
